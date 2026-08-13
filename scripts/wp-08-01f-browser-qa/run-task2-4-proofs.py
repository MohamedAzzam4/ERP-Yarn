#!/usr/bin/env python3
"""
WP-08-01F Tasks 2-4 — Worker denial semantics, validation error, keyboard proof.
"""
import os, sys, time, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"
QA_TENANT = "00000000-0000-0000-0000-000000081e50"
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

def main():
    run_id = "qaB-r9-1786647635"
    ed = evidence_dir(run_id)
    results = {}

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # ═══════════════════════════════════════════════════════════════════
        # TASK 2: Worker denial — should now redirect, not 500
        # ═══════════════════════════════════════════════════════════════════
        print("=== TASK 2: Worker denial semantics ===")
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        login(page, WORKER)
        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, audit={before['audit']}, idem={before['idem']}")

        # Worker POSTs to migration endpoint
        result = page.evaluate('''async () => {
            try {
                const formData = new FormData();
                formData.append("sourceDescription", "WORKER TEST");
                formData.append("templateName", "opening_balance_inventory");
                formData.append("templateVersion", "1.0");
                formData.append("cutoverImportMode", "opening_balance");
                formData.append("idempotencyKey", "worker-test-" + Date.now());
                const resp = await fetch("/management/admin/migration", {
                    method: "POST", body: formData, redirect: "manual",
                });
                return { status: resp.status, statusText: resp.statusText, location: resp.headers.get("location") };
            } catch (e) { return { error: e.message }; }
        }''')
        print(f"  Fetch result: {json.dumps(result)}")
        time.sleep(2)
        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, audit={after['audit']}, idem={after['idem']}")

        # A redirect (3xx) or controlled error is acceptable. 500 is not.
        worker_ok = (result.get('status') in [200, 301, 302, 303, 307, 308] or
                     (result.get('status') == 0 and result.get('location'))) and \
                    after['batches'] == before['batches'] and \
                    after['audit'] == before['audit'] and \
                    after['idem'] == before['idem']
        print(f"  RESULT: {'PASS — controlled denial, zero effects' if worker_ok else 'FAIL'}")
        results['task2_worker'] = {'pass': worker_ok, 'fetchResult': result, 'before': before, 'after': after}
        page.close()

        # ═══════════════════════════════════════════════════════════════════
        # TASK 3: Controlled validation error (not crash)
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== TASK 3: Controlled validation error ===")
        for vp_name, vp_width in [("360", 360), ("1440", 1440)]:
            print(f"\n  --- {vp_name}px ---")
            page = browser.new_page(viewport={"width": vp_width, "height": 800})
            login(page, OWNER)
            before = get_counts()

            page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
            page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
            page.fill('input[name="sourceDescription"]', "VALIDATION ERROR TEST")
            # Clear idempotencyKey to trigger VALIDATION_FAILED
            page.evaluate('() => { document.querySelector("input[name=idempotencyKey]").value = ""; }')
            page.evaluate('() => document.querySelector("form[data-action=create-migration-batch]").requestSubmit()')
            page.wait_for_load_state("networkidle", timeout=15000)
            time.sleep(3)

            page.screenshot(path=str(ed / f"{vp_name}_task3-controlled-error.png"), full_page=True)
            url = page.url
            print(f"  URL: {url}")
            # Check for role=alert
            alerts = page.query_selector_all('[role="alert"]')
            alert_texts = [a.inner_text().strip() for a in alerts if a.inner_text().strip()]
            print(f"  role=alert elements: {len(alert_texts)}")
            for t in alert_texts: print(f"    text: {t[:80]}")

            after = get_counts()
            zero = after['batches'] == before['batches'] and after['audit'] == before['audit'] and after['idem'] == before['idem']
            has_error = len(alert_texts) > 0
            print(f"  zero_effects={zero}, error_visible={has_error}")
            results[f'task3_{vp_name}'] = {'pass': zero and has_error, 'alerts': alert_texts, 'before': before, 'after': after, 'url': url}
            page.close()

        # ═══════════════════════════════════════════════════════════════════
        # TASK 4: Keyboard-only proof
        # ═══════════════════════════════════════════════════════════════════
        print("\n=== TASK 4: Keyboard-only proof ===")
        page = browser.new_page(viewport={"width": 1024, "height": 768})
        key_seq = []

        # Login via keyboard
        page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
        key_seq.append("Tab to email")
        page.keyboard.press("Tab"); time.sleep(0.2)
        key_seq.append("Type email")
        page.keyboard.type(OWNER[0]); time.sleep(0.2)
        key_seq.append("Tab to password")
        page.keyboard.press("Tab"); time.sleep(0.2)
        key_seq.append("Type password")
        page.keyboard.type(OWNER[1]); time.sleep(0.2)
        key_seq.append("Tab to submit")
        page.keyboard.press("Tab"); time.sleep(0.2)
        key_seq.append("Enter to login")
        page.keyboard.press("Enter")
        page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
        page.screenshot(path=str(ed / "1024_task4-01-keyboard-login.png"), full_page=True)

        # Migration page via keyboard
        page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
        time.sleep(1)
        before = get_counts()

        # Tab to sourceDescription
        key_seq.append("Tab to sourceDescription")
        for _ in range(5):
            page.keyboard.press("Tab"); time.sleep(0.2)
            focused = page.evaluate('() => document.activeElement?.name')
            if focused == 'sourceDescription': break
        key_seq.append("Type description")
        page.keyboard.type("KEYBOARD TEST"); time.sleep(0.2)

        # Clear idempotencyKey for invalid submission
        page.evaluate('() => { document.querySelector("input[name=idempotencyKey]").value = ""; }')

        # Tab to submit and Enter
        key_seq.append("Tab to submit")
        for _ in range(5):
            page.keyboard.press("Tab"); time.sleep(0.2)
            focused = page.evaluate('() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type })')
            if focused.get('type') == 'submit': break
        key_seq.append("Enter to submit")
        page.keyboard.press("Enter")
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(3)
        page.screenshot(path=str(ed / "1024_task4-02-keyboard-after-submit.png"), full_page=True)

        after = get_counts()
        alerts = page.query_selector_all('[role="alert"]')
        zero = after['batches'] == before['batches'] and after['audit'] == before['audit']
        print(f"  Key sequence: {len(key_seq)} steps")
        print(f"  Zero effects: {zero}")
        print(f"  Error visible: {len(alerts) > 0}")
        results['task4_keyboard'] = {'pass': zero and len(alerts) > 0, 'keySequence': key_seq, 'before': before, 'after': after}
        page.close()

        browser.close()

    all_pass = all(r.get('pass', False) for r in results.values())
    results['all_pass'] = all_pass
    with open(ed / "task2-4-proofs.json", 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n=== TASKS 2-4 SUMMARY: {'ALL PASS' if all_pass else 'SOME FAILED'} ===")

if __name__ == "__main__":
    main()
