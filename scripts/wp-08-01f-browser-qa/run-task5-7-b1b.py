#!/usr/bin/env python3
"""
WP-08-01F Tasks 5-7 — B1b execution: finalize staging, manifest, validation.

Executes the real browser actions on the SAME active batch.
"""
import os, sys, time, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"
QA_TENANT = "00000000-0000-0000-0000-000000081e50"
BATCH_ID = "32fd0ab8-b52a-4a8e-927e-326e634f02b0"
OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")

def run_node_inline(code, *args):
    result = subprocess.run(["node", "-e", code] + list(args),
        capture_output=True, text=True, cwd=str(REPO), env=os.environ.copy())
    return result.stdout.strip(), result.stderr.strip()

def get_batch_state():
    code = """
const { createClient } = require("@supabase/supabase-js");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const QA_TENANT = '00000000-0000-0000-0000-000000081e50';
const BATCH_ID = '""" + BATCH_ID + """';
(async () => {
  const { data: batch } = await supabase.from("import_batches").select("*").eq("id", BATCH_ID).maybeSingle();
  const { count: audit } = await supabase.from("audit_logs").select("*", { count: "exact", head: true }).eq("tenant_id", QA_TENANT);
  const { count: idem } = await supabase.from("idempotency_records").select("*", { count: "exact", head: true }).eq("tenant_id", QA_TENANT);
  const { count: staging } = await supabase.from("import_staging_rows").select("*", { count: "exact", head: true }).eq("import_batch_id", BATCH_ID).eq("is_current", true);
  const { count: manifests } = await supabase.from("import_cutover_manifests").select("*", { count: "exact", head: true }).eq("import_batch_id", BATCH_ID);
  const { count: findings } = await supabase.from("import_validation_errors").select("*", { count: "exact", head: true }).eq("import_batch_id", BATCH_ID);
  const { data: currentManifest } = await supabase.from("import_cutover_manifests").select("*").eq("import_batch_id", BATCH_ID).eq("is_current", true).maybeSingle();
  console.log(JSON.stringify({
    status: batch?.status,
    stagedDataHash: batch?.staged_data_hash,
    stagedRowCount: batch?.staged_row_count,
    cutoverManifestHash: batch?.cutover_manifest_hash,
    validationStatus: batch?.validation_status,
    blockingErrorCount: batch?.blocking_error_count,
    warningCount: batch?.warning_count,
    audit, idem, staging, manifests, findings,
    currentManifest: currentManifest ? { id: currentManifest.id, version: currentManifest.manifest_version, hash: currentManifest.manifest_hash } : null,
  }));
})();
"""
    out, _ = run_node_inline(code)
    return json.loads(out) if out else {}

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def login(page, creds):
    email, pw = creds
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: '/login' not in u, timeout=15000)

def submit_form(page, action_name):
    selector = f'form[data-action="{action_name}"]'
    try:
        page.wait_for_selector(selector, timeout=5000)
    except:
        print(f"  WARN: form {action_name} not found")
        return False
    page.evaluate(f'() => document.querySelector(\'{selector}\').requestSubmit()')
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(3)
    return True

def fill_field(page, name, value):
    el = page.query_selector(f'input[name="{name}"]')
    if el:
        el.fill(value)
        return True
    return False

def main():
    run_id = "qaB-r9-1786647635"
    ed = evidence_dir(run_id)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, OWNER)

        # ═══════════════════════════════════════════════════════════════════
        # TASK 5: Finalize staging
        # ═══════════════════════════════════════════════════════════════════
        print("=== TASK 5: Finalize staging ===")
        before = get_batch_state()
        print(f"  BEFORE: status={before['status']}, stagedDataHash={before['stagedDataHash']}, staging={before['staging']}, audit={before['audit']}, idem={before['idem']}")

        page.goto(f"{BASE_URL}/management/admin/migration/{BATCH_ID}", wait_until="domcontentloaded")
        page.wait_for_selector("h1", timeout=15000)
        time.sleep(2)

        if submit_form(page, "finalize-staging"):
            page.goto(f"{BASE_URL}/management/admin/migration/{BATCH_ID}", wait_until="domcontentloaded")
            time.sleep(2)
            page.screenshot(path=str(ed / "1024_task5-staging-finalized.png"), full_page=True)
        else:
            print("  FAIL: finalize-staging form not found")
            browser.close()
            return False

        after = get_batch_state()
        sdh = (after['stagedDataHash'] or '')[:16] if after.get('stagedDataHash') else 'None'
        print(f"  AFTER:  status={after['status']}, stagedDataHash={sdh}, staging={after['staging']}, audit={after['audit']}, idem={after['idem']}")
        staging_ok = after['status'] == 'staged' and after['stagedDataHash'] and after['stagedDataHash'] != before['stagedDataHash']
        print(f"  RESULT: {'PASS — staging finalized' if staging_ok else 'FAIL'}")

        # ═══════════════════════════════════════════════════════════════════
        # TASK 6: Finalize cutover manifest
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== TASK 6: Finalize cutover manifest ===")
        before = get_batch_state()
        print(f"  BEFORE: cutoverManifestHash={before['cutoverManifestHash']}, manifests={before['manifests']}")

        # Fill manifest fields
        fill_field(page, "domain", "inventory")
        fill_field(page, "cutoffDate", "2024-01-01")
        if submit_form(page, "finalize-cutover-manifest"):
            page.goto(f"{BASE_URL}/management/admin/migration/{BATCH_ID}", wait_until="domcontentloaded")
            time.sleep(2)
            page.screenshot(path=str(ed / "1024_task6-manifest-finalized.png"), full_page=True)
        else:
            print("  WARN: finalize-cutover-manifest form not found, trying alternative...")

        after = get_batch_state()
        cmh = (after['cutoverManifestHash'] or '')[:16] if after.get('cutoverManifestHash') else 'None'
        print(f"  AFTER:  cutoverManifestHash={cmh}, manifests={after['manifests']}, currentManifest={after['currentManifest']}")
        manifest_ok = after['cutoverManifestHash'] and after['manifests'] == 1 and after['currentManifest'] and after['currentManifest']['version'] == 1
        print(f"  RESULT: {'PASS — manifest finalized' if manifest_ok else 'FAIL'}")

        # ═══════════════════════════════════════════════════════════════════
        # TASK 7: Run validation
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== TASK 7: Run validation ===")
        before = get_batch_state()
        print(f"  BEFORE: validationStatus={before['validationStatus']}, findings={before['findings']}")

        # Re-navigate to batch detail page
        page.goto(f"{BASE_URL}/management/admin/migration/{BATCH_ID}", wait_until="domcontentloaded")
        page.wait_for_selector("h1", timeout=15000)
        time.sleep(2)

        if submit_form(page, "run-validation"):
            page.goto(f"{BASE_URL}/management/admin/migration/{BATCH_ID}", wait_until="domcontentloaded")
            time.sleep(2)
            page.screenshot(path=str(ed / "1024_task7-validation-complete.png"), full_page=True)
        else:
            print("  WARN: run-validation form not found")

        after = get_batch_state()
        print(f"  AFTER:  status={after['status']}, validationStatus={after['validationStatus']}, blockers={after['blockingErrorCount']}, warnings={after['warningCount']}, findings={after['findings']}")
        validation_ok = after['status'] == 'validation_complete' and after['validationStatus'] == 'passed' and after['blockingErrorCount'] == 0
        print(f"  RESULT: {'PASS — validation complete, passed, 0 blockers' if validation_ok else 'FAIL'}")

        # Capture responsive screenshots
        for vp in [360, 768, 1024, 1440]:
            page.set_viewport_size({"width": vp, "height": 800})
            time.sleep(1)
            page.screenshot(path=str(ed / f"{vp}_task8-validation-complete.png"), full_page=True)
        page.set_viewport_size({"width": 1024, "height": 768})

        # Save final state
        final_state = get_batch_state()
        proof = {
            "taskId": "Tasks5-7-B1b",
            "before": before,
            "after": after,
            "finalState": final_state,
            "stagingOk": staging_ok,
            "manifestOk": manifest_ok,
            "validationOk": validation_ok,
        }
        with open(ed / "task5-7-b1b-proofs.json", 'w') as f:
            json.dump(proof, f, indent=2)
        print(f"\nFinal state: {json.dumps(final_state, indent=2)}")

        browser.close()
        return validation_ok

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
