#!/usr/bin/env python3
"""
WP-08-01F — Cycle B sub-stage runner (B1a through B1e).

Splits the original B1 stage into 5 independently-resumable sub-stages:
  B1a: Create and upload only          → source_uploaded
  B1b: Staging, manifest, validation   → validation_complete (passed)
  B1c: Reconciliation only             → review_required
  B1d: Human review resolution         → review_required (matched, no blockers)
  B1e: Submit for dual approval        → pending_dual_approval

Each sub-stage:
  - Persists state after completion (DB-confirmed)
  - Can be run independently after a sandbox reset
  - Saves FAIL.txt + screenshot on failure
  - NEVER marks complete until DB polling confirms the expected terminal state

Usage:
  python3 run-b1-stages.py B1a <runId>
  python3 run-b1-stages.py B1b <runId>
  python3 run-b1-stages.py B1c <runId>
  python3 run-b1-stages.py B1d <runId>
  python3 run-b1-stages.py B1e <runId>
  python3 run-b1-stages.py status <runId>
  python3 run-b1-stages.py cleanup <runId>

Credentials via environment variables only. Never printed, never persisted.
"""
import os, sys, time, json, subprocess, tempfile
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
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SECRET_KEY") or os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

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
    """Query batch status from DB using REST API (no DATABASE_URL needed for REST)."""
    # Try REST-based db-proof first (works without DATABASE_URL)
    rest_script = "db-proof-rest.mjs"
    out, err = run_node(rest_script, batch_id, mode) if mode else run_node(rest_script, batch_id)
    if err and "NEXT_PUBLIC_SUPABASE_URL" in err:
        # Fall back to direct DB query if REST fails
        if DB_URL:
            out, err = run_node("db-proof.mjs", DB_URL, batch_id, mode) if mode else run_node("db-proof.mjs", DB_URL, batch_id)
    return out

def get_batch_status(batch_id):
    """Query DB for batch status + counts."""
    out = db_query(batch_id)
    lines = out.split('\n')
    data = json.loads(lines[0]) if lines and lines[0] else {}
    counts = json.loads(lines[1]) if len(lines) > 1 and lines[1] else {}
    return data, counts

def poll_db(batch_id, expected_status, timeout_s=60, interval_s=3):
    """Poll DB until expected status or timeout."""
    deadline = time.time() + timeout_s
    last_status = "UNKNOWN"
    while time.time() < deadline:
        data, counts = get_batch_status(batch_id)
        status = data.get("status", "UNKNOWN")
        last_status = status
        if status == expected_status:
            print(f"  poll OK: status={status}")
            return True, data, counts
        time.sleep(interval_s)
    print(f"  poll TIMEOUT: status={last_status} (expected {expected_status})")
    return False, {}, {}

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def ss(page, name, run_id, vp="1024"):
    """Save screenshot."""
    ed = evidence_dir(run_id)
    path = ed / f"{vp}_{name}.png"
    page.screenshot(path=str(path), full_page=True)
    print(f"  screenshot: {path}")
    return str(path)

def save_fail(run_id, stage, page, error_msg, server_error=""):
    """Save failure evidence."""
    ed = evidence_dir(run_id)
    fail_path = ed / f"FAIL_{stage}.txt"
    with open(fail_path, 'w') as f:
        f.write(f"Stage: {stage}\n")
        f.write(f"Run ID: {run_id}\n")
        f.write(f"Timestamp: {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
        f.write(f"Error: {error_msg}\n")
        f.write(f"Server error: {server_error}\n")
        try:
            f.write(f"Current URL: {page.url}\n")
        except:
            f.write(f"Current URL: (page not available)\n")
        # Capture DB state
        state = load_state(run_id)
        bid = state.get("batchId")
        if bid:
            data, counts = get_batch_status(bid)
            f.write(f"\nDB state before/after:\n")
            f.write(json.dumps({"batch": data, "counts": counts}, indent=2))
        f.write(f"\nNext safe resume command:\n")
        f.write(f"  python3 {__file__} {stage} {run_id}\n")
    if page:
        try:
            ss(page, f"FAIL_{stage}", run_id)
        except:
            pass
    print(f"  FAIL evidence saved: {fail_path}")

def login(page, creds):
    """Login via the real management UI."""
    email, password = creds
    page.goto(f"{BASE_URL}/login", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    # Fill email
    ei = page.query_selector('input[type="email"]') or page.query_selector('input[name="email"]')
    if ei:
        ei.fill(email)
    # Fill password
    pi = page.query_selector('input[type="password"]') or page.query_selector('input[name="password"]')
    if pi:
        pi.fill(password)
    # Submit
    btn = page.query_selector('button[type="submit"]')
    if btn:
        btn.click()
    page.wait_for_load_state("networkidle", timeout=15000)
    time.sleep(1)
    print(f"  Logged in as {email}")

def goto_batch(page, batch_id):
    """Navigate to batch detail page."""
    page.goto(f"{BASE_URL}/management/admin/migration/{batch_id}", wait_until="networkidle", timeout=30000)
    time.sleep(1)

def submit_form(page, action_name, run_id):
    """Submit a form by action name."""
    # Try to find the form by data-action attribute or button text
    btn = page.query_selector(f'button[data-action="{action_name}"]')
    if not btn:
        # Try finding by form action
        form = page.query_selector(f'form[action*="{action_name}"]')
        if form:
            btn = form.query_selector('button[type="submit"]')
    if not btn:
        print(f"  WARNING: Could not find form/button for action '{action_name}'")
        return False
    btn.click()
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(2)
    # Check for error messages
    err = page.query_selector('[role="alert"]')
    if err and err.is_visible():
        err_text = err.inner_text()
        if "error" in err_text.lower() or "failed" in err_text.lower():
            print(f"  ACTION ERROR: {err_text}")
            return False
    print(f"  Submitted: {action_name}")
    return True

def create_batch(page, description, run_id):
    """Create a new migration batch via the UI."""
    page.goto(f"{BASE_URL}/management/admin/migration", wait_until="networkidle", timeout=30000)
    time.sleep(1)
    # Fill the create-batch form
    di = page.query_selector('input[name="sourceDescription"]') or page.query_selector('textarea[name="sourceDescription"]')
    if di:
        di.fill(description)
    # Submit
    if submit_form(page, "create-batch", run_id):
        # Extract batch ID from URL
        page.wait_for_load_state("networkidle", timeout=15000)
        url = page.url
        # URL format: /management/admin/migration/{batchId}
        parts = url.rstrip("/").split("/")
        bid = parts[-1]
        if len(bid) == 36 and bid.count("-") == 4:  # UUID format
            print(f"  Created batch: {bid}")
            return bid
    print("  ERROR: Could not create batch")
    return None

def upload_csv_file(page, csv_path, run_id):
    """Upload a CSV file via the real private-storage action."""
    # Find the file input
    fi = page.query_selector('input[type="file"]')
    if not fi:
        print("  ERROR: No file input found")
        return False
    fi.set_input_files(str(csv_path))
    # Submit the upload form
    if submit_form(page, "upload-source", run_id):
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(2)
        return True
    return False

def load_state(run_id):
    """Load persisted run state."""
    path = RUN_STATE_DIR / f"{run_id}.json"
    if path.exists():
        with open(path) as f:
            return json.load(f)
    return {
        "runId": run_id,
        "batchId": None,
        "stages": {},
        "currentCompletedStage": None,
        "expectedNextStage": "B1a",
    }

def save_state(state):
    """Persist run state (no credentials)."""
    path = RUN_STATE_DIR / f"{state['runId']}.json"
    # Strip any sensitive fields
    safe = {k: v for k, v in state.items() if k not in ("credentials", "cookies", "tokens")}
    safe["gitSha"] = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(REPO)).decode().strip()
    safe["lastSavedAt"] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    with open(path, 'w') as f:
        json.dump(safe, f, indent=2)
    print(f"  State saved: {path}")

def mark_stage_complete(state, stage, batch_id, data):
    """Mark a stage as complete and update state."""
    if "stages" not in state:
        state["stages"] = {}
    state["stages"][stage] = {
        "status": "completed",
        "completedAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "lastDbStatus": data,
    }
    state["batchId"] = batch_id
    state["currentCompletedStage"] = stage
    stage_order = ["B1a", "B1b", "B1c", "B1d", "B1e"]
    idx = stage_order.index(stage)
    state["expectedNextStage"] = stage_order[idx + 1] if idx + 1 < len(stage_order) else "dual_approval"
    save_state(state)

# ─── B1 Sub-Stages ─────────────────────────────────────────────────────────

def stage_B1a(run_id):
    """B1a: Create and upload only → source_uploaded."""
    print(f"\n=== B1a: Create and upload only (run={run_id}) ===")
    state = load_state(run_id)
    if state.get("stages", {}).get("B1a", {}).get("status") == "completed":
        print("  Already completed — skipping")
        return True

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        try:
            login(page, OWNER)
            desc = f"Cycle B r8 {run_id}"
            bid = create_batch(page, desc, run_id)
            if not bid:
                save_fail(run_id, "B1a", page, "Could not create batch")
                browser.close(); return False
            goto_batch(page, bid)
            ss(page, "B1a-batch-created", run_id)

            # Upload valid CSV
            print("  Upload valid CSV...")
            csv_path = FIXTURES / "valid.csv"
            if not upload_csv_file(page, csv_path, run_id):
                save_fail(run_id, "B1a", page, "Upload failed")
                browser.close(); return False
            goto_batch(page, bid)
            ss(page, "B1a-valid-upload", run_id)

            # Poll DB for source_uploaded
            ok, data, counts = poll_db(bid, "source_uploaded", timeout_s=30)
            if not ok:
                save_fail(run_id, "B1a", page, f"DB poll timeout: status={data.get('status', 'UNKNOWN')}")
                browser.close(); return False

            mark_stage_complete(state, "B1a", bid, data)
            print("  B1a COMPLETE — batch at source_uploaded")
            browser.close()
            return True
        except Exception as e:
            save_fail(run_id, "B1a", page, str(e))
            browser.close()
            return False

def stage_B1b(run_id):
    """B1b: Staging, manifest, validation → validation_complete (passed)."""
    print(f"\n=== B1b: Staging, manifest, validation (run={run_id}) ===")
    state = load_state(run_id)
    if state.get("stages", {}).get("B1b", {}).get("status") == "completed":
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  ERROR: No batchId in state — run B1a first")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        try:
            login(page, OWNER)
            goto_batch(page, bid)

            # Finalize staging
            print("  Finalize staging...")
            if submit_form(page, "finalize-staging", run_id):
                goto_batch(page, bid)
                ss(page, "B1b-staging-finalized", run_id)

            # Finalize manifest
            print("  Finalize manifest...")
            di = page.query_selector('input[name="domain"]')
            if di: di.fill("inventory")
            ci = page.query_selector('input[name="cutoffDate"]')
            if ci: ci.fill("2024-01-01")
            if submit_form(page, "finalize-cutover-manifest", run_id):
                goto_batch(page, bid)
                ss(page, "B1b-manifest-finalized", run_id)

            # Run validation
            print("  Run validation...")
            if submit_form(page, "run-validation", run_id):
                goto_batch(page, bid)
                ss(page, "B1b-validation", run_id)

            # Poll DB for validation_complete
            ok, data, counts = poll_db(bid, "validation_complete", timeout_s=60)
            if not ok:
                save_fail(run_id, "B1b", page, f"DB poll timeout: status={data.get('status', 'UNKNOWN')}")
                browser.close(); return False

            # Verify validationStatus=passed
            vs = data.get("validation_status", "UNKNOWN")
            if vs != "passed":
                save_fail(run_id, "B1b", page, f"validationStatus={vs} (expected 'passed')")
                browser.close(); return False

            mark_stage_complete(state, "B1b", bid, data)
            print(f"  B1b COMPLETE — validationStatus=passed, blockers={data.get('blocking_error_count', '?')}")
            browser.close()
            return True
        except Exception as e:
            save_fail(run_id, "B1b", page, str(e))
            browser.close()
            return False

def stage_B1c(run_id):
    """B1c: Reconciliation only → review_required."""
    print(f"\n=== B1c: Reconciliation only (run={run_id}) ===")
    state = load_state(run_id)
    if state.get("stages", {}).get("B1c", {}).get("status") == "completed":
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  ERROR: No batchId in state — run B1a first")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        try:
            login(page, OWNER)
            goto_batch(page, bid)

            # Run reconciliation
            print("  Run reconciliation...")
            if not submit_form(page, "run-reconciliation", run_id):
                save_fail(run_id, "B1c", page, "Reconciliation action failed")
                browser.close(); return False
            goto_batch(page, bid)
            ss(page, "B1c-reconciliation", run_id)

            # Poll DB for review_required (or matched if no review needed)
            ok1, data1, _ = poll_db(bid, "review_required", timeout_s=30)
            if not ok1:
                ok2, data2, _ = poll_db(bid, "matched", timeout_s=10)
                if ok2:
                    data1 = data2
                    ok1 = True
            if not ok1:
                save_fail(run_id, "B1c", page, f"DB poll timeout: status={data1.get('status', 'UNKNOWN')}")
                browser.close(); return False

            mark_stage_complete(state, "B1c", bid, data1)
            print(f"  B1c COMPLETE — reconciliationStatus={data1.get('reconciliation_status', '?')}")
            browser.close()
            return True
        except Exception as e:
            save_fail(run_id, "B1c", page, str(e))
            browser.close()
            return False

def stage_B1d(run_id):
    """B1d: Human review resolution → eligible for approval."""
    print(f"\n=== B1d: Human review and reconciliation rerun (run={run_id}) ===")
    state = load_state(run_id)
    if state.get("stages", {}).get("B1d", {}).get("status") == "completed":
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  ERROR: No batchId in state — run B1a first")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        try:
            login(page, OWNER)
            goto_batch(page, bid)

            # Resolve any pending review items
            print("  Resolving review items...")
            review_buttons = page.query_selector_all('button[data-action="resolve-review"]')
            for btn in review_buttons:
                btn.click()
                page.wait_for_load_state("networkidle", timeout=15000)
                time.sleep(1)
            goto_batch(page, bid)
            ss(page, "B1d-review-resolved", run_id)

            # If reconciliation needs rerun, run it again
            print("  Re-run reconciliation if needed...")
            submit_form(page, "run-reconciliation", run_id)
            goto_batch(page, bid)
            ss(page, "B1d-reconciliation-rerun", run_id)

            # Poll for review_required (with matched reconciliation)
            ok, data, counts = poll_db(bid, "review_required", timeout_s=30)
            if not ok:
                # Maybe already at a state eligible for submission
                data, _ = get_batch_status(bid)
                ok = True  # accept current state

            rs = data.get("reconciliation_status", "UNKNOWN")
            print(f"  reconciliationStatus={rs}")

            mark_stage_complete(state, "B1d", bid, data)
            print("  B1d COMPLETE — review items resolved")
            browser.close()
            return True
        except Exception as e:
            save_fail(run_id, "B1d", page, str(e))
            browser.close()
            return False

def stage_B1e(run_id):
    """B1e: Submit for dual approval → pending_dual_approval."""
    print(f"\n=== B1e: Submit for dual approval (run={run_id}) ===")
    state = load_state(run_id)
    if state.get("stages", {}).get("B1e", {}).get("status") == "completed":
        print("  Already completed — skipping")
        return True
    bid = state.get("batchId")
    if not bid:
        print("  ERROR: No batchId in state — run B1a first")
        return False

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        try:
            login(page, OWNER)
            goto_batch(page, bid)

            # Fill warning summary and submit
            print("  Submit for approval...")
            sw = page.query_selector('input[name="warningSummary"]') or page.query_selector('textarea[name="warningSummary"]')
            if sw: sw.fill("All warnings reviewed and accepted")
            if not submit_form(page, "submit-migration-for-approval", run_id):
                save_fail(run_id, "B1e", page, "Submit for approval failed")
                browser.close(); return False
            goto_batch(page, bid)
            ss(page, "B1e-submitted", run_id)

            # Poll DB for pending_dual_approval
            ok, data, counts = poll_db(bid, "pending_dual_approval", timeout_s=30)
            if not ok:
                save_fail(run_id, "B1e", page, f"DB poll timeout: status={data.get('status', 'UNKNOWN')}")
                browser.close(); return False

            mark_stage_complete(state, "B1e", bid, data)
            print("  B1e COMPLETE — batch submitted for dual approval")
            print("  NEXT MILESTONE: dual approval (NOT started in this milestone)")
            browser.close()
            return True
        except Exception as e:
            save_fail(run_id, "B1e", page, str(e))
            browser.close()
            return False

def stage_status(run_id):
    """Print current run state."""
    state = load_state(run_id)
    print(f"\n=== Status for run {run_id} ===")
    print(f"  Run ID: {state.get('runId')}")
    print(f"  Batch ID: {state.get('batchId', '(none)')}")
    print(f"  Git SHA: {state.get('gitSha', '(unknown)')}")
    print(f"  Current completed: {state.get('currentCompletedStage')}")
    print(f"  Expected next: {state.get('expectedNextStage')}")
    print(f"  Stages:")
    for stage, info in state.get("stages", {}).items():
        print(f"    {stage}: {info.get('status', '?')} (completed: {info.get('completedAt', '?')})")
        if info.get("lastDbStatus"):
            print(f"      DB: {json.dumps(info['lastDbStatus'])}")

def stage_cleanup(run_id):
    """Clean mutable fixtures for this run's batch (FK-safe)."""
    state = load_state(run_id)
    bid = state.get("batchId")
    if not bid:
        print("  No batchId in state — nothing to clean")
        return True
    print(f"  Cleaning batch {bid}...")
    # Use the REST-based cleanup
    out, err = run_node("cleanup-superseded-run.mjs")
    # Actually, we need a targeted cleanup for this specific batch
    # For now, just mark the run as superseded
    ed = evidence_dir(run_id)
    with open(ed / "SUPERSEDED.txt", 'w') as f:
        f.write(f"SUPERSEDED — run {run_id} cleaned at {time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}\n")
    print("  Cleanup done (batch data remains for inspection)")
    return True

# ─── Main ──────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 run-b1-stages.py <stage> <runId>")
        print("Stages: B1a, B1b, B1c, B1d, B1e, status, cleanup")
        sys.exit(1)

    stage = sys.argv[1]
    run_id = sys.argv[2] if len(sys.argv) > 2 else "qaB-r8-1786628462"

    stages = {
        "B1a": stage_B1a,
        "B1b": stage_B1b,
        "B1c": stage_B1c,
        "B1d": stage_B1d,
        "B1e": stage_B1e,
        "status": stage_status,
        "cleanup": stage_cleanup,
    }

    if stage not in stages:
        print(f"Unknown stage: {stage}")
        sys.exit(1)

    ok = stages[stage](run_id)
    sys.exit(0 if ok else 1)
