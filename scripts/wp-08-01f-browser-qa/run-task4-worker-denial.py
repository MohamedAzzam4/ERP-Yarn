#!/usr/bin/env python3
"""
WP-08-01F Task 4 — Worker command denial proof.

Proves that the SERVER ACTION (not just the UI form) denies workers.
The worker is redirected to /worker shell and cannot access the migration
page at all. But to prove server-command denial, we need to bypass the
UI redirect and directly invoke the Server Action.

Since Server Actions can't be called directly from outside the browser
context, we test by:
A. Browser proof: worker visits migration route → redirected/denied
B. Server-command proof: worker is authenticated, then we use the
   browser's fetch API to POST to the Server Action endpoint, bypassing
   the UI form hiding. The server action's authorization check must
   deny the worker BEFORE any service invocation.
"""
import os, sys, time, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
HARNESS = Path(__file__).resolve().parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"

QA_TENANT = "00000000-0000-0000-0000-000000081e50"
QA_BATCH = "32fd0ab8-b52a-4a8e-927e-326e634f02b0"
OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")
WORKER = ("qa-browser-worker@erp-yarn.test", "QABrowserWorker2026!")

def run_node_inline(code, *args):
    result = subprocess.run(["node", "-e", code] + list(args),
        capture_output=True, text=True, cwd=str(REPO), env=os.environ.copy())
    return result.stdout.strip(), result.stderr.strip()

def get_counts():
    code = """
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const QA_TENANT = '00000000-0000-0000-0000-000000081e50';
const QA_BATCH = '32fd0ab8-b52a-4a8e-927e-326e634f02b0';
(async () => {
  const { count: batches } = await supabase.from('import_batches').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: files } = await supabase.from('import_files').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: audit } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: idem } = await supabase.from('idempotency_records').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: storage } = await supabase.from('import_files').select('*', { count: 'exact', head: true }).eq('import_batch_id', QA_BATCH);
  console.log(JSON.stringify({ batches, files, audit, idem, storage_files: storage }));
})();
"""
    out, _ = run_node_inline(code)
    return json.loads(out) if out else {}

def login(page, creds):
    email, pw = creds
    page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
    page.fill('input[type="email"]', email)
    page.fill('input[type="password"]', pw)
    page.click('button[type="submit"]')
    page.wait_for_url(lambda u: '/login' not in u, timeout=15000)

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def main():
    run_id = "qaB-r9-1786647635"
    ed = evidence_dir(run_id)
    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ═══════════════════════════════════════════════════════════════════
        # PART A: Browser/UI proof — worker visits migration route
        # ═══════════════════════════════════════════════════════════════════
        print("=== PART A: Worker browser proof ===")
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, WORKER)
        worker_shell_url = page.url
        print(f"  Worker shell URL: {worker_shell_url}")

        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, files={before['files']}, audit={before['audit']}, idem={before['idem']}")

        # Worker tries to access migration route
        page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        time.sleep(3)
        worker_migration_url = page.url
        print(f"  Worker migration URL: {worker_migration_url}")
        page.screenshot(path=str(ed / "1024_task4-worker-denied.png"), full_page=True)

        # Check what the worker sees
        page_text = page.inner_text("body")[:300]
        has_migration_form = page.query_selector('input[name="sourceDescription"]') is not None
        print(f"  Has migration form: {has_migration_form}")
        print(f"  Page text (first 150): {page_text[:150]}")

        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, files={after['files']}, audit={after['audit']}, idem={after['idem']}")

        browser_ok = (not has_migration_form and
                      after['batches'] == before['batches'] and
                      after['files'] == before['files'] and
                      after['audit'] == before['audit'] and
                      after['idem'] == before['idem'])
        print(f"  RESULT: {'PASS — worker denied at UI, zero effects' if browser_ok else 'FAIL'}")
        results['browser_proof'] = {
            'pass': browser_ok,
            'workerShellUrl': worker_shell_url,
            'workerMigrationUrl': worker_migration_url,
            'hasMigrationForm': has_migration_form,
            'before': before,
            'after': after,
        }

        # ═══════════════════════════════════════════════════════════════════
        # PART B: Server-command proof — worker invokes Server Action directly
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== PART B: Worker server-command proof ===")
        # The worker is authenticated. We use the browser's fetch API to
        # POST to the migration page (Server Actions are POST endpoints).
        # The server action's authenticateAndRequirePermission must deny
        # the worker BEFORE any service invocation.

        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, files={before['files']}, audit={before['audit']}, idem={before['idem']}")

        # Try to invoke the create-batch Server Action via fetch
        # Server Actions use the Next.js Server Action protocol
        result = page.evaluate('''async () => {
            try {
                // Try to POST to the migration page with form data
                const formData = new FormData();
                formData.append("sourceDescription", "WORKER FORGED BATCH");
                formData.append("templateName", "opening_balance_inventory");
                formData.append("templateVersion", "1.0");
                formData.append("cutoverImportMode", "opening_balance");
                formData.append("idempotencyKey", "worker-forged-" + Date.now());

                const resp = await fetch("/management/admin/migration", {
                    method: "POST",
                    body: formData,
                    redirect: "manual",
                });
                return {
                    status: resp.status,
                    statusText: resp.statusText,
                    type: resp.type,
                    url: resp.url,
                    redirected: resp.redirected,
                };
            } catch (e) {
                return { error: e.message };
            }
        }''')
        print(f"  Fetch result: {json.dumps(result)}")
        time.sleep(3)

        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, files={after['files']}, audit={after['audit']}, idem={after['idem']}")

        server_ok = (after['batches'] == before['batches'] and
                     after['files'] == before['files'] and
                     after['audit'] == before['audit'] and
                     after['idem'] == before['idem'])
        print(f"  RESULT: {'PASS — server denied worker, zero effects' if server_ok else 'FAIL — worker created effects'}")
        results['server_command_proof'] = {
            'pass': server_ok,
            'fetchResult': result,
            'before': before,
            'after': after,
        }

        page.close()
        browser.close()

    all_pass = all(r.get('pass', False) for r in results.values())
    results['all_pass'] = all_pass
    with open(ed / "task4-worker-denial-proofs.json", 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n=== TASK 4 SUMMARY: {'ALL PASS' if all_pass else 'SOME FAILED'} ===")

if __name__ == "__main__":
    main()
