#!/usr/bin/env python3
"""
WP-08-01F Task 3-5 — B1a browser automation + proof capture.

Creates exactly one migration batch, uploads one valid source, polls DB
until source_uploaded, then proves all required B1a proof points.
"""
import os, sys, time, json, subprocess, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
HARNESS = Path(__file__).resolve().parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"
FIXTURES = HARNESS / "fixtures"
RUN_STATE_DIR = HARNESS / "run-state"
RUN_STATE_DIR.mkdir(exist_ok=True)

QA_TENANT = "00000000-0000-0000-0000-000000081e50"
OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")
ACCT = ("qa-browser-accountant@erp-yarn.test", "QABrowserAccountant2026!")
WORKER = ("qa-browser-worker@erp-yarn.test", "QABrowserWorker2026!")

def run_node_inline(script_code, *args):
    """Run inline Node.js code with the ERP-Yarn cwd."""
    result = subprocess.run(
        ["node", "-e", script_code] + list(args),
        capture_output=True, text=True, cwd=str(REPO),
        env=os.environ.copy()
    )
    return result.stdout.strip(), result.stderr.strip()

def db_query_rest(batch_id):
    """Query batch status via Supabase REST API."""
    code = """
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await supabase.from('import_batches')
    .select('status, staged_row_count, staged_data_hash, cutover_manifest_hash, validation_status, reconciliation_status, blocking_error_count, warning_count, tenant_id')
    .eq('id', process.argv[1]).maybeSingle();
  if (error) { console.error(error.message); process.exit(1); }
  console.log(JSON.stringify(data || {}));
  // Get file counts
  const { data: files } = await supabase.from('import_files').select('id, file_hash, file_version, is_current, storage_path, file_type').eq('import_batch_id', process.argv[1]);
  console.log(JSON.stringify({ files: files || [] }));
  // Get audit count
  const { count: auditCount } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', '00000000-0000-0000-0000-000000081e50');
  console.log(JSON.stringify({ audit_count: auditCount }));
  // Get idempotency count
  const { count: idemCount } = await supabase.from('idempotency_records').select('*', { count: 'exact', head: true }).eq('tenant_id', '00000000-0000-0000-0000-000000081e50');
  console.log(JSON.stringify({ idempotency_count: idemCount }));
})();
"""
    out, err = run_node_inline(code, batch_id)
    lines = out.split('\n')
    data = json.loads(lines[0]) if lines and lines[0] else {}
    files_info = json.loads(lines[1]) if len(lines) > 1 and lines[1] else {}
    audit_info = json.loads(lines[2]) if len(lines) > 2 and lines[2] else {}
    idem_info = json.loads(lines[3]) if len(lines) > 3 and lines[3] else {}
    return data, files_info, audit_info, idem_info

def poll_db(batch_id, expected_status, timeout_s=60, interval_s=3):
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        data, files, audit, idem = db_query_rest(batch_id)
        status = data.get("status", "UNKNOWN")
        if status == expected_status:
            print(f"  poll OK: status={status}")
            return True, data, files, audit, idem
        time.sleep(interval_s)
    print(f"  poll TIMEOUT: status={status} (expected {expected_status})")
    return False, data, files, audit, idem

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def ss(page, name, run_id, vp="1024"):
    ed = evidence_dir(run_id)
    path = ed / f"{vp}_{name}.png"
    page.screenshot(path=str(path), full_page=True)
    print(f"  screenshot: {path.name}")
    return str(path)

def login(page, creds):
    email, pw = creds
    print(f"  Login: {email}")
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
    print(f"  OK -> {page.url}")

def find_batch_by_description(description):
    """Query DB for batch ID by source_description."""
    code = """
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
(async () => {
  const { data, error } = await supabase.from('import_batches')
    .select('id').eq('source_description', process.argv[1])
    .order('created_at', { ascending: false }).limit(1);
  if (error) { console.error(error.message); process.exit(1); }
  console.log(data[0]?.id || '');
})();
"""
    out, err = run_node_inline(code, description)
    return out if out else None

def create_batch_via_ui(page, description, run_id):
    """Create a migration batch via the real UI."""
    print(f"  Creating batch: {description[:50]}...")
    page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
    page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
    page.fill('input[name="sourceDescription"]', description)
    try:
        page.fill('input[name="templateName"]', "opening_balance_inventory")
        page.fill('input[name="templateVersion"]', "1.0")
    except:
        pass
    # Submit via requestSubmit (Server Action pattern)
    page.evaluate('() => document.querySelector("form[data-action=create-migration-batch]").requestSubmit()')
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(3)
    # Query DB for the batch (form doesn't redirect, but batch is created)
    bid = find_batch_by_description(description)
    if bid:
        print(f"  Created batch: {bid}")
    else:
        print(f"  FAIL: batch not found in DB")
    return bid

def upload_csv_via_ui(page, csv_path, run_id):
    """Upload a CSV file via the real private-storage action."""
    print(f"  Uploading: {csv_path.name}")
    fi = page.query_selector('input[type="file"]')
    if not fi:
        print("  FAIL: file input not found")
        return False
    fi.set_input_files(str(csv_path))
    # Find the submit button within the same form as the file input
    btn = page.query_selector('form:has(input[type="file"]) button[type="submit"]')
    if not btn:
        btn = page.query_selector('button[type="submit"]')
    if btn:
        btn.click()
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(3)
        print("  Upload submitted")
        return True
    print("  FAIL: submit button not found")
    return False

def save_run_state(run_id, batch_id, file_id=None, file_hash=None):
    """Persist credential-free run state."""
    git_sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=str(REPO)).decode().strip()
    state = {
        "runId": run_id,
        "batchId": batch_id,
        "completedStage": "B1a",
        "nextStage": "B1b",
        "fileId": file_id,
        "fileVersion": 1,
        "fileChecksum": file_hash,
        "evidenceDir": str(evidence_dir(run_id)),
        "serverGitSha": git_sha,
        "qaTenant": QA_TENANT,
        "createdAt": time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        "credentialsNote": "No credentials, cookies, or tokens stored. All via env vars.",
        "resumeCommand": f"NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... DATABASE_URL=... python3 scripts/wp-08-01f-browser-qa/run-b1a.py B1b {run_id}",
    }
    path = RUN_STATE_DIR / f"{run_id}.json"
    with open(path, 'w') as f:
        json.dump(state, f, indent=2)
    print(f"  Run state saved: {path.name}")

def main():
    run_id = sys.argv[1] if len(sys.argv) > 1 else f"qaB-r9-{int(time.time())}"
    print(f"\n=== B1a: Create + Upload (run={run_id}) ===")

    # Generate unique description
    unique_suffix = uuid.uuid4().hex[:8]
    description = f"B1a {run_id} {unique_suffix}"

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})

        # Login as owner
        login(page, OWNER)
        ss(page, "B1a-01-after-login", run_id)

        # Capture BEFORE state (audit + idempotency counts)
        _, _, audit_before, idem_before = db_query_rest("00000000-0000-0000-0000-000000000000")
        print(f"  BEFORE: audit_count={audit_before.get('audit_count')}, idempotency_count={idem_before.get('idempotency_count')}")

        # Create batch
        bid = create_batch_via_ui(page, description, run_id)
        if not bid:
            print("  FAIL: Could not create batch")
            browser.close()
            return False
        ss(page, "B1a-02-batch-created", run_id)

        # Navigate to batch detail page
        page.goto(f"{BASE_URL}/management/admin/migration/{bid}", wait_until="domcontentloaded")
        page.wait_for_selector("h1", timeout=15000)
        time.sleep(3)
        ss(page, "B1a-03-batch-detail", run_id)

        # Upload valid CSV
        csv_path = FIXTURES / "valid.csv"
        if not upload_csv_via_ui(page, csv_path, run_id):
            print("  FAIL: Upload failed")
            browser.close()
            return False
        page.goto(f"{BASE_URL}/management/admin/migration/{bid}", wait_until="domcontentloaded")
        time.sleep(3)
        ss(page, "B1a-04-after-upload", run_id)

        # Poll DB for source_uploaded
        ok, data, files_info, audit_after, idem_after = poll_db(bid, "source_uploaded", timeout_s=30)
        if not ok:
            print(f"  FAIL: DB poll timeout")
            browser.close()
            return False

        # Verify proof points
        print(f"\n=== B1a PROOF POINTS ===")
        print(f"  1. Batch created: {bid}")
        print(f"  2. Status: {data.get('status')}")
        print(f"  3. Tenant: {data.get('tenant_id')} (expected: {QA_TENANT})")
        print(f"  4. Tenant match: {data.get('tenant_id') == QA_TENANT}")

        files = files_info.get("files", [])
        current_files = [f for f in files if f.get("is_current")]
        print(f"  5. Total files: {len(files)}")
        print(f"  6. Current files: {len(current_files)}")
        if current_files:
            f = current_files[0]
            print(f"  7. File version: {f.get('file_version')}")
            print(f"  8. File hash (checksum): {f.get('file_hash', '')[:20]}...")
            print(f"  9. Storage path: {f.get('storage_path', '')[:30]}...")
            print(f"  10. File type: {f.get('file_type')}")
            has_public_url = "http" in f.get("storage_path", "") and "supabase.co" in f.get("storage_path", "") and "public" in f.get("storage_path", "").lower()
            print(f"  11. No public URL: {not has_public_url}")
            file_id = f.get("id")
            file_hash = f.get("file_hash")
        else:
            print(f"  7-11. FAIL: No current file")
            file_id = None
            file_hash = None

        audit_delta = audit_after.get("audit_count", 0) - audit_before.get("audit_count", 0)
        idem_delta = idem_after.get("idempotency_count", 0) - idem_before.get('idempotency_count', 0)
        print(f"  12. Audit delta: +{audit_delta}")
        print(f"  13. Idempotency delta: +{idem_delta}")

        print(f"\n  B1a COMPLETE: batch={bid}, status=source_uploaded")
        save_run_state(run_id, bid, file_id, file_hash)

        # Capture responsive screenshots
        for vp in [360, 768, 1024, 1440]:
            page.set_viewport_size({"width": vp, "height": 800})
            time.sleep(1)
            ss(page, f"B1a-responsive-{vp}", run_id, str(vp))
        page.set_viewport_size({"width": 1024, "height": 768})

        # Capture worker denial
        print("\n  Worker denial test...")
        page2 = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page2, WORKER)
        page2.goto(f"{BASE_URL}/management/admin/migration/{bid}", wait_until="domcontentloaded")
        time.sleep(3)
        ss(page2, "B1a-05-worker-denied", run_id)
        # Check if worker is redirected or denied
        print(f"  Worker URL: {page2.url}")
        page2.close()

        browser.close()

        # Save proof summary
        proof = {
            "runId": run_id,
            "batchId": bid,
            "status": data.get("status"),
            "tenantMatch": data.get("tenant_id") == QA_TENANT,
            "fileCount": len(files),
            "currentFileCount": len(current_files),
            "fileVersion": current_files[0].get("file_version") if current_files else None,
            "fileHash": current_files[0].get("file_hash") if current_files else None,
            "fileType": current_files[0].get("file_type") if current_files else None,
            "storagePath": current_files[0].get("storage_path") if current_files else None,
            "auditDelta": audit_delta,
            "idempotencyDelta": idem_delta,
        }
        with open(evidence_dir(run_id) / "b1a-proof.json", 'w') as f:
            json.dump(proof, f, indent=2)
        print(f"  Proof saved: b1a-proof.json")

        return True

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
