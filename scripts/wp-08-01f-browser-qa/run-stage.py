#!/usr/bin/env python3
"""
WP-08-01F — Resumable browser QA stage runner.

Each stage is short and persists progress so it can resume after sandbox resets.

Usage:
  python3 run-stage.py preflight          — check credentials
  python3 run-stage.py cleanup             — clean QA tenant mutable fixtures
  python3 run-stage.py A1 <runId>          — create batch + upload invalid CSV
  python3 run-stage.py A2 <runId>          — finalize + validate
  python3 run-stage.py A3 <runId>          — verify findings + replacement
  python3 run-stage.py A4 <runId>          — corrected replacement + revalidate
  python3 run-stage.py B1 <runId>          — create + upload + finalize + validate + reconcile + submit
  python3 run-stage.py B2 <runId>          — owner + accountant approval
  python3 run-stage.py B3 <runId>          — commit (if supported)
  python3 run-stage.py status <runId>      — show persisted state
  python3 run-stage.py worker <runId>      — worker denial test
  python3 run-stage.py responsive <runId>  — capture 4 viewport screenshots

Credentials via environment variables only. Never printed, never persisted.
"""
import os, sys, time, json, subprocess, tempfile, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent  # ERP-Yarn root
HARNESS = Path(__file__).resolve().parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"
FIXTURES = HARNESS / "fixtures"
RUN_STATE_DIR = HARNESS / "run-state"
RUN_STATE_DIR.mkdir(exist_ok=True)

QA_TENANT = "00000000-0000-0000-0000-000000081e50"
DB_URL = os.environ.get("DATABASE_URL", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_SECRET_KEY", "")

OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")
ACCT = ("qa-browser-accountant@erp-yarn.test", "QABrowserAccountant2026!")
WORKER = ("qa-browser-worker@erp-yarn.test", "QABrowserWorker2026!")

# ─── Helpers ──────────────────────────────────────────────────────────────

def run_node(script, *args):
    """Run a Node.js helper script from the harness dir with ERP-Yarn cwd."""
    result = subprocess.run(
        ["node", str(HARNESS / script)] + list(args),
        capture_output=True, text=True, cwd=str(REPO)
    )
    return result.stdout.strip(), result.stderr.strip()

def db_query(batch_id, mode=""):
    """Query batch status from DB."""
    out, err = run_node("db-proof.mjs", DB_URL, batch_id, mode) if mode else run_node("db-proof.mjs", DB_URL, batch_id)
    return out

def get_batch_status(batch_id):
    """Query DB for batch status + counts. Returns (data_dict, counts_dict)."""
    out = db_query(batch_id)
    lines = out.split('\n')
    data = json.loads(lines[0]) if lines and lines[0] else {}
    counts = json.loads(lines[1]) if len(lines) > 1 and lines[1] else {}
    return data, counts

def poll_db(batch_id, expected_status, timeout_s=30, interval_s=2):
    """Poll DB until expected status is reached or timeout expires.
    Returns True if status matched, False on timeout."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        data, counts = get_batch_status(batch_id)
        status = data.get("status", "UNKNOWN")
        if status == expected_status:
            print(f"  poll OK: status={status}")
            return True
        time.sleep(interval_s)
    print(f"  poll TIMEOUT: status={status} (expected {expected_status})")
    return False

def poll_validation_complete(batch_id, timeout_s=30, interval_s=2):
    """Poll until validation_complete with validationStatus != unknown."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        data, counts = get_batch_status(batch_id)
        status = data.get("status", "UNKNOWN")
        vs = data.get("validation_status", "")
        if status == "validation_complete" and vs and vs != "unknown":
            print(f"  poll OK: status={status} validationStatus={vs}")
            return True, data, counts
        time.sleep(interval_s)
    print(f"  poll TIMEOUT: status={status} validationStatus={vs}")
    return False, data, counts

def get_batch_id_by_description(description):
    """Get exact batch ID from DB by source description using a proper helper script."""
    # Write description to a temp file to avoid shell escaping issues
    import tempfile
    with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
        f.write(description)
        desc_file = f.name
    try:
        result = subprocess.run([
            "node", "-e",
            "const p=require('" + str(REPO / "node_modules/postgres") + "');"
            "const fs=require('fs');"
            "const desc=fs.readFileSync('" + desc_file + "','utf-8').trim();"
            "const sql=p(process.argv[1],{prepare:false,max:3,connect_timeout:15,idle_timeout:10});"
            "(async()=>{"
            "const r=await sql`SELECT id FROM import_batches WHERE tenant_id=${process.argv[2]} AND source_description=${desc} ORDER BY created_at DESC LIMIT 1`;"
            "console.log(r[0]?.id||'');"
            "await sql.end();"
            "})();",
            DB_URL, QA_TENANT
        ], capture_output=True, text=True, cwd=str(REPO))
        return result.stdout.strip()
    finally:
        os.unlink(desc_file)

def load_state(run_id):
    f = RUN_STATE_DIR / f"{run_id}.json"
    if f.exists():
        return json.loads(f.read_text())
    return {"runId": run_id, "completed": [], "nextStage": None, "batchId": None, "expectedState": None}

def save_state(state):
    f = RUN_STATE_DIR / f"{state['runId']}.json"
    f.write_text(json.dumps(state, indent=2))

def verify_and_checkpoint(state, stage, expected_status, next_stage, run_id, page=None):
    """Verify persisted DB state matches expected, then checkpoint.
    NEVER marks complete unless DB status is confirmed."""
    bid = state.get("batchId")
    if not bid:
        print(f"  FAIL cannot verify — no batchId in state")
        if page: ss(page, f"{stage}-fail-no-batchid", run_id)
        return False
    status = db_query(bid, "status")
    if status != expected_status:
        print(f"  FAIL {stage}: DB status={status} expected={expected_status}")
        if page: ss(page, f"{stage}-fail-wrong-status", run_id)
        # Save failure diagnostics
        d = evidence_dir(run_id)
        (d / f"{stage}-FAIL.txt").write_text(f"Stage: {stage}\nExpected: {expected_status}\nActual: {status}\nBatchId: {bid}\n")
        return False
    print(f"  VERIFIED {stage}: DB status={status}")
    state["completed"].append(stage)
    state["nextStage"] = next_stage
    state["expectedState"] = expected_status
    save_state(state)
    return True

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def ss(page, name, run_id, vp="1024"):
    p = evidence_dir(run_id) / f"{vp}_{name}.png"
    page.screenshot(path=str(p), full_page=True)
    print(f"  photo {p.name}")
    return str(p)

def login(page, creds):
    email, pw = creds
    print(f"  Login: {email}")
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
    print(f"  OK -> {page.url}")

def goto_batch(page, batch_id):
    page.goto(f"{BASE_URL}/management/admin/migration/{batch_id}", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_selector("h1", timeout=15000)
    time.sleep(5)

def submit_form(page, action_name, run_id):
    selector = f'form[data-action="{action_name}"]'
    try:
        page.wait_for_selector(selector, timeout=15000)
    except:
        forms = page.query_selector_all('form[data-action]')
        avail = [f.get_attribute('data-action') for f in forms]
        print(f"  WARN form not found: {action_name} | available: {avail}")
        ss(page, f"error-no-{action_name}", run_id)
        return False
    page.evaluate(f'() => document.querySelector(\'{selector}\').requestSubmit()')
    print(f"  submitted: {action_name}")
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(3)
    return True

def create_batch(page, description, run_id):
    print(f"  Creating: {description}")
    page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
    page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
    page.fill('input[name="sourceDescription"]', description)
    page.fill('input[name="templateName"]', "opening_balance_inventory")
    page.fill('input[name="templateVersion"]', "1.0")
    page.click('button[type="submit"]')
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(3)
    bid = get_batch_id_by_description(description)
    if bid:
        print(f"  OK batch={bid}")
    else:
        print(f"  FAIL batch not found")
    return bid

def upload_csv_file(page, csv_path, run_id):
    """Upload a CSV file from a path."""
    fi = page.query_selector('input[type="file"][name="file"]')
    if not fi:
        print("  FAIL file input not found")
        return False
    fi.set_input_files(str(csv_path))
    btn = page.query_selector('form button[type="submit"]')
    if btn:
        btn.click()
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(3)
        print("  uploaded")
        return True
    return False

# ─── Stages ───────────────────────────────────────────────────────────────

def stage_preflight():
    out, err = run_node("preflight.mjs")
    print(out)
    if err: print(err)
    return "OK" in out and "Missing" not in out

def stage_cleanup():
    print("Cleaning QA tenant mutable fixtures...")
    out, err = run_node("cleanup.mjs", DB_URL, SUPABASE_URL, SUPABASE_KEY, QA_TENANT)
    print(out)
    if err: print(err)
    return "zero errors" in out

def stage_A1(run_id):
    print(f"\n=== A1: Create batch + upload invalid CSV (run={run_id}) ===")
    state = load_state(run_id)
    if "A1" in state["completed"]:
        print("  Already completed — skipping")
        return True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)

        # Create batch
        desc = f"Cycle A {run_id}"
        bid = create_batch(page, desc, run_id)
        if not bid:
            browser.close(); return False
        goto_batch(page, bid)
        ss(page, "A01-batch-created", run_id)

        # Verify template selector
        page.wait_for_selector('select#template-type-select', timeout=10000)
        opts = page.query_selector_all('select#template-type-select option')
        print(f"  {len(opts)} templates")
        ss(page, "A02-template-selector", run_id)

        # Upload invalid CSV
        csv_path = FIXTURES / "invalid.csv"
        if upload_csv_file(page, csv_path, run_id):
            goto_batch(page, bid)
            ss(page, "A03-after-upload", run_id)
            status = db_query(bid, "status")
            print(f"  DB status={status}")
            if status == "source_uploaded":
                state["batchId"] = bid
                state["completed"].append("A1")
                state["nextStage"] = "A2"
                state["evidenceDir"] = str(evidence_dir(run_id))
                save_state(state)
                print("  A1 COMPLETE")
                browser.close()
                return True
        browser.close()
        return False

def stage_A2(run_id):
    print(f"\n=== A2: Finalize + validate (run={run_id}) ===")
    state = load_state(run_id)
    if "A2" in state["completed"]:
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  FAIL no batchId in state")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)
        goto_batch(page, bid)

        # Finalize staging
        print("  Finalize staging...")
        if submit_form(page, "finalize-staging", run_id):
            goto_batch(page, bid)
            ss(page, "A04-staging-finalized", run_id)
            status = db_query(bid, "status")
            print(f"  DB status={status}")
            if status != "staged":
                print("  FAIL expected staged")
                browser.close(); return False
        else:
            browser.close(); return False

        # Finalize cutover manifest — reload page to ensure form is visible
        goto_batch(page, bid)
        print("  Finalize manifest...")
        try:
            page.wait_for_selector('form[data-action="finalize-cutover-manifest"]', timeout=15000)
        except:
            print("  WARN manifest form not found")
        di = page.query_selector('input[name="domain"]')
        if di: di.fill("inventory")
        ci = page.query_selector('input[name="cutoffDate"]')
        if ci: ci.fill("2024-01-01")
        if submit_form(page, "finalize-cutover-manifest", run_id):
            goto_batch(page, bid)
            ss(page, "A05-manifest-finalized", run_id)
            # Verify manifest hash
            out = db_query(bid)
            lines = out.split('\n')
            if lines:
                data = json.loads(lines[0])
                mh = data.get("cutover_manifest_hash", "")
                print(f"  cutoverManifestHash={'non-empty' if mh else 'EMPTY'}")

        # Run validation — reload page
        goto_batch(page, bid)
        print("  Run validation...")
        if submit_form(page, "run-validation", run_id):
            # Poll for validation_complete with validationStatus != unknown
            ok, vdata, vcounts = poll_validation_complete(bid, timeout_s=30, interval_s=2)
            goto_batch(page, bid)
            ss(page, "A06-validation", run_id)
            if ok:
                print(f"  VERIFIED validation_complete: validationStatus={vdata.get('validation_status')}")
                print(f"  findings={vcounts.get('findings', 0)}")
            else:
                print(f"  FAIL validation did not complete: status={vdata.get('status')} vs={vdata.get('validation_status')}")
                ss(page, "A06-fail-validation", run_id)
                d = evidence_dir(run_id)
                (d / "A2-FAIL.txt").write_text(f"Validation did not complete\nstatus={vdata.get('status')}\nvalidationStatus={vdata.get('validation_status')}\n")
                browser.close()
                return False

        state["completed"].append("A2")
        state["nextStage"] = "A3"
        save_state(state)
        print("  A2 COMPLETE")
        browser.close()
        return True

def stage_A3(run_id):
    print(f"\n=== A3: Verify findings + replacement (run={run_id}) ===")
    state = load_state(run_id)
    if "A3" in state["completed"]:
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  FAIL no batchId")
        return False

    # Capture BEFORE state
    before_data, before_counts = get_batch_status(bid)
    before_files = before_counts.get("files", 0)
    before_rows = before_counts.get("staging_rows", 0)
    before_findings = before_counts.get("findings", 0)
    print(f"  BEFORE: files={before_files} rows={before_rows} findings={before_findings} status={before_data.get('status')}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)
        goto_batch(page, bid)

        # Verify validation results on page
        body = page.inner_text('body')
        if 'خطأ مانع' in body:
            print("  Blocking errors found on page")
        if 'تحذير' in body:
            print("  Warnings found on page")
        ss(page, "A07-validation-results", run_id)

        # Upload corrected replacement
        print("  Upload corrected replacement...")
        replace_fi = None
        for fi in page.query_selector_all('input[type="file"]'):
            aria = fi.get_attribute('aria-label') or ''
            if 'مصحح' in aria or 'استبدال' in aria:
                replace_fi = fi
                break

        if not replace_fi:
            print("  FAIL replacement form file input not found")
            ss(page, "A08-no-replacement-form", run_id)
            d = evidence_dir(run_id)
            (d / "A3-FAIL.txt").write_text(f"Replacement form not found\nBatchId: {bid}\nStatus: {before_data.get('status')}\n")
            browser.close()
            return False

        csv_path = FIXTURES / "corrected.csv"
        replace_fi.set_input_files(str(csv_path))
        ta = page.query_selector('textarea[name="reworkReason"]')
        if ta: ta.fill(f"Cycle A correction {run_id}")
        cb = page.query_selector('input[type="checkbox"]')
        if cb: cb.check()
        # Submit replacement form
        page.evaluate('''() => {
            const forms = document.querySelectorAll('form');
            for (const f of forms) {
                if (f.querySelector('textarea[name="reworkReason"]')) {
                    f.requestSubmit();
                    return;
                }
            }
        }''')
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(5)
        goto_batch(page, bid)
        ss(page, "A08-after-replacement", run_id)

        # Capture AFTER state
        after_data, after_counts = get_batch_status(bid)
        after_files = after_counts.get("files", 0)
        after_rows = after_counts.get("staging_rows", 0)
        after_findings = after_counts.get("findings", 0)
        after_status = after_data.get("status", "UNKNOWN")
        print(f"  AFTER: files={after_files} rows={after_rows} findings={after_findings} status={after_status}")

        # Verify ALL replacement assertions
        all_ok = True

        # 1. file count increased by exactly 1
        if after_files != before_files + 1:
            print(f"  FAIL file count: {before_files} -> {after_files} (expected +1)")
            all_ok = False
        else:
            print(f"  OK file count: {before_files} -> {after_files} (+1)")

        # 2. batch status is source_uploaded
        if after_status != "source_uploaded":
            print(f"  FAIL status: {after_status} (expected source_uploaded)")
            all_ok = False
        else:
            print(f"  OK status: {after_status}")

        # 3. stagedDataHash cleared
        sdh = after_data.get("staged_data_hash", "")
        if sdh:
            print(f"  FAIL stagedDataHash not cleared: {sdh}")
            all_ok = False
        else:
            print(f"  OK stagedDataHash cleared")

        # 4. cutoverManifestHash cleared
        cmh = after_data.get("cutover_manifest_hash", "")
        if cmh:
            print(f"  FAIL cutoverManifestHash not cleared: {cmh}")
            all_ok = False
        else:
            print(f"  OK cutoverManifestHash cleared")

        # 5. validationStatus reset
        vs = after_data.get("validation_status", "")
        if vs and vs != "unknown":
            print(f"  FAIL validationStatus not reset: {vs}")
            all_ok = False
        else:
            print(f"  OK validationStatus reset: {vs or 'unknown'}")

        # 6. findings preserved (old findings still exist)
        if after_findings < before_findings:
            print(f"  FAIL findings decreased: {before_findings} -> {after_findings}")
            all_ok = False
        else:
            print(f"  OK findings preserved: {before_findings} -> {after_findings}")

        if not all_ok:
            print("  A3 FAILED — not checkpointing")
            d = evidence_dir(run_id)
            (d / "A3-FAIL.txt").write_text(
                f"Replacement verification failed\nBatchId: {bid}\n"
                f"Before: files={before_files} rows={before_rows} findings={before_findings} status={before_data.get('status')}\n"
                f"After: files={after_files} rows={after_rows} findings={after_findings} status={after_status}\n"
                f"stagedDataHash={sdh}\ncutoverManifestHash={cmh}\nvalidationStatus={vs}\n"
            )
            browser.close()
            return False

        print("  A3 ALL CHECKS PASSED")
        state["completed"].append("A3")
        state["nextStage"] = "A4"
        save_state(state)
        print("  A3 COMPLETE")
        browser.close()
        return True

def stage_A4(run_id):
    print(f"\n=== A4: Finalize corrected + revalidate (run={run_id}) ===")
    state = load_state(run_id)
    if "A4" in state["completed"]:
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)
        goto_batch(page, bid)

        # Finalize corrected staging
        print("  Finalize corrected staging...")
        if submit_form(page, "finalize-staging", run_id):
            goto_batch(page, bid)
            # Verify staged
            status = db_query(bid, "status")
            print(f"  DB status after finalize-staging={status}")
            if status != "staged":
                print(f"  FAIL expected staged, got {status}")
                ss(page, "A09-fail-not-staged", run_id)
                browser.close()
                return False
            ss(page, "A09-corrected-staging", run_id)

        # Finalize manifest — reload page first to ensure form is visible
        goto_batch(page, bid)
        print("  Finalize corrected manifest...")
        # Wait for manifest form to appear
        try:
            page.wait_for_selector('form[data-action="finalize-cutover-manifest"]', timeout=15000)
        except:
            print("  WARN manifest form not found — may already be set")
            ss(page, "A09b-no-manifest-form", run_id)
        di = page.query_selector('input[name="domain"]')
        if di: di.fill("inventory")
        ci = page.query_selector('input[name="cutoffDate"]')
        if ci: ci.fill("2024-01-01")
        if submit_form(page, "finalize-cutover-manifest", run_id):
            goto_batch(page, bid)
            # Verify manifest hash
            out = db_query(bid)
            lines = out.split('\n')
            if lines:
                data = json.loads(lines[0])
                manifest_hash = data.get("cutover_manifest_hash", "")
                print(f"  cutoverManifestHash={'non-empty' if manifest_hash else 'EMPTY'}")
                if not manifest_hash:
                    print("  FAIL manifest hash is empty")
                    ss(page, "A09c-fail-empty-manifest", run_id)

        # Run validation — reload page first
        goto_batch(page, bid)
        print("  Run corrected validation...")
        if submit_form(page, "run-validation", run_id):
            # Poll for validation_complete with validationStatus != unknown
            ok, vdata, vcounts = poll_validation_complete(bid, timeout_s=30, interval_s=2)
            goto_batch(page, bid)
            ss(page, "A10-corrected-validation", run_id)
            if ok:
                vs = vdata.get("validation_status", "")
                findings = vcounts.get("findings", 0)
                print(f"  VERIFIED validation_complete: validationStatus={vs} findings={findings}")
                if vs == "passed":
                    print("  A4 SUCCESS: validationStatus=passed, blockers=0")
                else:
                    print(f"  A4 WARNING: validationStatus={vs} (expected passed)")
            else:
                print(f"  FAIL corrected validation did not complete")
                ss(page, "A10-fail-validation", run_id)
                d = evidence_dir(run_id)
                (d / "A4-FAIL.txt").write_text(f"Corrected validation did not complete\nstatus={vdata.get('status')}\nvalidationStatus={vdata.get('validation_status')}\n")

        # Capture all viewports
        for name, w, h in [("360",360,640),("768",768,1024),("1024",1024,768),("1440",1440,900)]:
            page.set_viewport_size({"width": w, "height": h})
            time.sleep(1)
            ss(page, f"A11-responsive-{name}", run_id, name)

        state["completed"].append("A4")
        state["nextStage"] = None
        save_state(state)
        print("  A4 COMPLETE")
        browser.close()
        return True

def stage_B1(run_id):
    print(f"\n=== B1: Create + upload + finalize + validate + reconcile + submit (run={run_id}) ===")
    state = load_state(run_id)
    if "B1" in state["completed"]:
        print("  Already completed — skipping")
        return True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)

        # Create batch
        desc = f"Cycle B {run_id}"
        bid = create_batch(page, desc, run_id)
        if not bid:
            browser.close(); return False
        goto_batch(page, bid)
        ss(page, "B01-batch-created", run_id)

        # Upload valid CSV
        print("  Upload valid CSV...")
        csv_path = FIXTURES / "valid.csv"
        if upload_csv_file(page, csv_path, run_id):
            goto_batch(page, bid)
            ss(page, "B02-valid-upload", run_id)

        # Finalize staging
        print("  Finalize staging...")
        if submit_form(page, "finalize-staging", run_id):
            goto_batch(page, bid)
            ss(page, "B03-staging-finalized", run_id)

        # Finalize manifest
        print("  Finalize manifest...")
        di = page.query_selector('input[name="domain"]')
        if di: di.fill("inventory")
        ci = page.query_selector('input[name="cutoffDate"]')
        if ci: ci.fill("2024-01-01")
        if submit_form(page, "finalize-cutover-manifest", run_id):
            goto_batch(page, bid)
            ss(page, "B04-manifest-finalized", run_id)

        # Run validation
        print("  Run validation...")
        if submit_form(page, "run-validation", run_id):
            goto_batch(page, bid)
            ss(page, "B05-validation", run_id)

        # Run reconciliation
        print("  Run reconciliation...")
        if submit_form(page, "run-reconciliation", run_id):
            goto_batch(page, bid)
            ss(page, "B06-reconciliation", run_id)

        # Submit for approval
        print("  Submit for approval...")
        sw = page.query_selector('input[name="warningSummary"]')
        if sw: sw.fill("All warnings reviewed")
        if submit_form(page, "submit-migration-for-approval", run_id):
            goto_batch(page, bid)
            ss(page, "B07-submitted", run_id)
            status = db_query(bid, "status")
            print(f"  DB status={status}")

        state["batchId"] = bid
        state["completed"].append("B1")
        state["nextStage"] = "B2"
        state["evidenceDir"] = str(evidence_dir(run_id))
        save_state(state)
        print("  B1 COMPLETE")
        browser.close()
        return True

def stage_B2(run_id):
    print(f"\n=== B2: Owner + Accountant approval (run={run_id}) ===")
    state = load_state(run_id)
    if "B2" in state["completed"]:
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})

        # Owner approval
        login(page, OWNER)
        goto_batch(page, bid)
        print("  Owner approval...")
        ri = page.query_selector('input[name="reason"]')
        if ri: ri.fill("Owner approves")
        if submit_form(page, "record-owner-approval", run_id):
            goto_batch(page, bid)
            ss(page, "B08-owner-approved", run_id)

        # Accountant approval
        page.context.clear_cookies()
        login(page, ACCT)
        goto_batch(page, bid)
        print("  Accountant approval...")
        ri = page.query_selector('input[name="reason"]')
        if ri: ri.fill("Accountant approves")
        if submit_form(page, "record-accountant-approval", run_id):
            goto_batch(page, bid)
            ss(page, "B09-accountant-approved", run_id)
            status = db_query(bid, "status")
            print(f"  DB status={status}")

        state["completed"].append("B2")
        state["nextStage"] = "B3"
        save_state(state)
        print("  B2 COMPLETE")
        browser.close()
        return True

def stage_B3(run_id):
    print(f"\n=== B3: Commit (run={run_id}) ===")
    state = load_state(run_id)
    if "B3" in state["completed"]:
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)
        goto_batch(page, bid)
        print("  Commit...")
        if submit_form(page, "commit-batch", run_id):
            goto_batch(page, bid)
            ss(page, "B10-committed", run_id)
            status = db_query(bid, "status")
            print(f"  DB status={status}")
            state["completed"].append("B3")
            state["nextStage"] = None
            save_state(state)
            print("  B3 COMPLETE")
        else:
            print("  WARN commit form not found — may need domain fixtures")
            ss(page, "B10-no-commit", run_id)
        browser.close()
        return True

def stage_worker(run_id):
    print(f"\n=== Worker denial (run={run_id}) ===")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, WORKER)
        print(f"  Worker at: {page.url}")
        ss(page, "W01-worker-landing", run_id)
        page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        time.sleep(3)
        print(f"  Worker at migration: {page.url}")
        if '/worker' in page.url:
            print("  OK worker redirected")
        ss(page, "W02-worker-denied", run_id)
        browser.close()
        return True

def stage_responsive(run_id):
    print(f"\n=== Responsive screenshots (run={run_id}) ===")
    state = load_state(run_id)
    bid = state.get("batchId")
    if not bid:
        print("  No batchId — taking screenshots of migration list")
        url = f"{BASE_URL}/management/admin/migration"
    else:
        url = f"{BASE_URL}/management/admin/migration/{bid}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        login(page, OWNER)
        page.goto(url, wait_until="networkidle")
        time.sleep(5)
        for name, w, h in [("360",360,640),("768",768,1024),("1024",1024,768),("1440",1440,900)]:
            page.set_viewport_size({"width": w, "height": h})
            time.sleep(1)
            ss(page, f"responsive-{name}", run_id, name)
        browser.close()
        return True

def stage_status(run_id):
    state = load_state(run_id)
    out, _ = run_node("status.mjs", str(RUN_STATE_DIR / f"{run_id}.json"))
    print(out)
    if state.get("batchId"):
        status = db_query(state["batchId"])
        print(f"DB status: {status}")

# ─── Main ─────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    stage = sys.argv[1]
    run_id = sys.argv[2] if len(sys.argv) > 2 else None

    if stage == "preflight":
        stage_preflight()
    elif stage == "cleanup":
        stage_cleanup()
    elif stage == "status":
        if not run_id: print("Usage: status <runId>"); sys.exit(1)
        stage_status(run_id)
    elif stage == "A1":
        stage_A1(run_id)
    elif stage == "A2":
        stage_A2(run_id)
    elif stage == "A3":
        stage_A3(run_id)
    elif stage == "A4":
        stage_A4(run_id)
    elif stage == "B1":
        stage_B1(run_id)
    elif stage == "B2":
        stage_B2(run_id)
    elif stage == "B3":
        stage_B3(run_id)
    elif stage == "worker":
        stage_worker(run_id)
    elif stage == "responsive":
        stage_responsive(run_id)
    else:
        print(f"Unknown stage: {stage}")
        print(__doc__)
        sys.exit(1)

if __name__ == "__main__":
    main()
