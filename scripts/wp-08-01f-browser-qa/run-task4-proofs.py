#!/usr/bin/env python3
"""
WP-08-01F Task 4 — Replay, conflict, and denial proofs.

Proves with exact DB/storage before-and-after counts:
1. Same key + same body: returns original result, zero new effects
2. Same key + conflicting body: rejected, zero new effects
3. Worker attempt: denied, zero effects
4. Cross-tenant attempt: denied (if safely reproducible)
5. Forged client fields: ignored
"""
import os, sys, time, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
HARNESS = Path(__file__).resolve().parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"

QA_TENANT = "00000000-0000-0000-0000-000000081e50"
OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")
WORKER = ("qa-browser-worker@erp-yarn.test", "QABrowserWorker2026!")

# From B1a
BATCH_ID = "32fd0ab8-b52a-4a8e-927e-326e634f02b0"
IDEMPOTENCY_KEY = "batch-d991bf51-4bdd-441e-b350-5383b4f3cddc"
DESCRIPTION = "B1a qaB-r9-1786647635 d4b1c609"

def run_node_inline(code, *args):
    result = subprocess.run(["node", "-e", code] + list(args),
        capture_output=True, text=True, cwd=str(REPO), env=os.environ.copy())
    return result.stdout.strip(), result.stderr.strip()

def get_counts():
    code = """
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const QA_TENANT = '00000000-0000-0000-0000-000000081e50';
(async () => {
  const { count: batches } = await supabase.from('import_batches').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: files } = await supabase.from('import_files').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: audit } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  const { count: idem } = await supabase.from('idempotency_records').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  console.log(JSON.stringify({ batches, files, audit, idem }));
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

def submit_create_form(page, description, idempotency_key=None):
    """Submit the create-batch form with optional idempotency key override."""
    page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
    page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
    page.fill('input[name="sourceDescription"]', description)
    try:
        page.fill('input[name="templateName"]', "opening_balance_inventory")
        page.fill('input[name="templateVersion"]', "1.0")
    except:
        pass
    if idempotency_key:
        page.evaluate(f'() => document.querySelector("input[name=idempotencyKey]").value = "{idempotency_key}"')
    page.evaluate('() => document.querySelector("form[data-action=create-migration-batch]").requestSubmit()')
    page.wait_for_load_state("networkidle", timeout=30000)
    time.sleep(3)

def main():
    run_id = sys.argv[1] if len(sys.argv) > 1 else f"qaB-r9-proofs"
    ed = evidence_dir(run_id)
    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})

        # ═══════════════════════════════════════════════════════════════════
        # PROOF 1: Same key + same body → replay, zero new effects
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== PROOF 1: Same key + same body (replay) ===")
        login(page, OWNER)
        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, files={before['files']}, audit={before['audit']}, idem={before['idem']}")

        submit_create_form(page, DESCRIPTION, IDEMPOTENCY_KEY)
        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, files={after['files']}, audit={after['audit']}, idem={after['idem']}")

        replay_ok = (after['batches'] == before['batches'] and
                     after['files'] == before['files'] and
                     after['audit'] == before['audit'] and
                     after['idem'] == before['idem'])
        print(f"  RESULT: {'PASS — zero new effects' if replay_ok else 'FAIL — new effects created'}")
        results['replay'] = {'pass': replay_ok, 'before': before, 'after': after}
        page.screenshot(path=str(ed / "1024_proof1-replay.png"), full_page=True)

        # ═══════════════════════════════════════════════════════════════════
        # PROOF 2: Same key + conflicting body → rejected, zero new effects
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== PROOF 2: Same key + conflicting body (conflict) ===")
        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, files={before['files']}, audit={before['audit']}, idem={before['idem']}")

        conflicting_desc = DESCRIPTION + " CONFLICT"
        submit_create_form(page, conflicting_desc, IDEMPOTENCY_KEY)
        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, files={after['files']}, audit={after['audit']}, idem={after['idem']}")

        conflict_ok = (after['batches'] == before['batches'] and
                       after['files'] == before['files'] and
                       after['audit'] == before['audit'] and
                       after['idem'] == before['idem'])
        print(f"  RESULT: {'PASS — zero new effects' if conflict_ok else 'FAIL — new effects created'}")
        results['conflict'] = {'pass': conflict_ok, 'before': before, 'after': after}
        page.screenshot(path=str(ed / "1024_proof2-conflict.png"), full_page=True)

        # ═══════════════════════════════════════════════════════════════════
        # PROOF 3: Worker attempt → denied, zero effects
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== PROOF 3: Worker attempt (denial) ===")
        # Worker logs in and tries to CREATE a batch
        page2 = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page2, WORKER)
        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, files={before['files']}, audit={before['audit']}, idem={before['idem']}")

        # Worker navigates to migration page and tries to create a batch
        page2.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        time.sleep(2)
        worker_url_before = page2.url
        print(f"  Worker URL: {worker_url_before}")

        # Try to fill and submit the create form
        try:
            page2.wait_for_selector('input[name="sourceDescription"]', timeout=5000)
            page2.fill('input[name="sourceDescription"]', "WORKER FORGED BATCH")
            page2.evaluate('() => document.querySelector("form[data-action=create-migration-batch]").requestSubmit()')
            page2.wait_for_load_state("networkidle", timeout=15000)
            time.sleep(3)
        except Exception as e:
            print(f"  Worker form interaction: {e}")

        page2.screenshot(path=str(ed / "1024_proof3-worker-denied.png"), full_page=True)

        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, files={after['files']}, audit={after['audit']}, idem={after['idem']}")

        # Worker is denied if no new batch was created (zero effects)
        worker_denied = (after['batches'] == before['batches'] and
                         after['files'] == before['files'] and
                         after['audit'] == before['audit'] and
                         after['idem'] == before['idem'])
        print(f"  RESULT: {'PASS — worker denied, zero effects' if worker_denied else 'FAIL — worker created effects'}")
        results['worker_denial'] = {'pass': worker_denied, 'worker_url': worker_url_before, 'before': before, 'after': after}
        page2.close()

        # ═══════════════════════════════════════════════════════════════════
        # PROOF 4: Forged client fields → ignored
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== PROOF 4: Forged client role/permission fields ===")
        # Try to submit the create form with forged role/permission fields
        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}")

        page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
        forged_desc = "FORGED TEST " + str(int(time.time()))
        page.fill('input[name="sourceDescription"]', forged_desc)
        # Try to inject forged fields via JavaScript
        page.evaluate('''() => {
            const form = document.querySelector("form[data-action=create-migration-batch]");
            // Try to add forged role/permission fields
            const forge = document.createElement("input");
            forge.type = "hidden"; forge.name = "role"; forge.value = "owner";
            form.appendChild(forge);
            const forge2 = document.createElement("input");
            forge2.type = "hidden"; forge2.name = "permission"; forge2.value = "migration.commit";
            form.appendChild(forge2);
            const forge3 = document.createElement("input");
            forge3.type = "hidden"; forge3.name = "tenantId"; forge3.value = "00000000-0000-0000-0000-ffffffffffff";
            form.appendChild(forge3);
            form.requestSubmit();
        }''')
        page.wait_for_load_state("networkidle", timeout=30000)
        time.sleep(3)

        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}")

        # The forged fields should be ignored — the batch is created with the
        # authenticated user's tenant, not the forged one.
        # Check that the new batch (if any) belongs to the QA tenant, not the forged one
        code = """
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
(async () => {
  const { data } = await supabase.from('import_batches').select('id, tenant_id, source_description')
    .like('source_description', 'FORGED TEST%').order('created_at', { ascending: false }).limit(1);
  console.log(JSON.stringify(data?.[0] || {}));
})();
"""
        out, _ = run_node_inline(code)
        forged_batch = json.loads(out) if out else {}
        forged_tenant = forged_batch.get('tenant_id')
        forged_ok = forged_tenant == QA_TENANT  # Forged tenant was ignored
        print(f"  Forged batch tenant: {forged_tenant}")
        print(f"  RESULT: {'PASS — forged tenantId ignored' if forged_ok else 'FAIL — forged tenantId accepted'}")
        results['forged_fields'] = {'pass': forged_ok, 'forged_batch': forged_batch}

        # Clean up the forged test batch
        if forged_batch.get('id'):
            run_node_inline("""
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
(async () => {
  const bid = process.argv[1];
  await supabase.from('import_staging_rows').delete().eq('import_batch_id', bid);
  await supabase.from('import_files').delete().eq('import_batch_id', bid);
  await supabase.from('import_cutover_manifests').delete().eq('import_batch_id', bid);
  await supabase.from('import_batches').delete().eq('id', bid);
  console.log('cleaned');
})();
""", forged_batch['id'])

        browser.close()

    # Save results
    all_pass = all(r.get('pass', False) for r in results.values())
    results['all_pass'] = all_pass
    with open(ed / "task4-proofs.json", 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n=== TASK 4 SUMMARY: {'ALL PASS' if all_pass else 'SOME FAILED'} ===")
    for name, r in results.items():
        if name == 'all_pass': continue
        print(f"  {name}: {'PASS' if r.get('pass') else 'FAIL'}")
    return all_pass

if __name__ == "__main__":
    ok = main()
    sys.exit(0 if ok else 1)
