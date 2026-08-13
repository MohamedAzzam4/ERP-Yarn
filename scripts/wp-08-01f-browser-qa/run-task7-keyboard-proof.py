#!/usr/bin/env python3
"""
WP-08-01F Task 7 — Keyboard-only proof.

Demonstrates B1a form interaction without pointer clicks:
- Tab/Shift+Tab navigation
- visible focus
- typing values
- form navigation and submission via keyboard (Enter/Space)

Uses a harmless invalid submission (empty idempotencyKey) to avoid
creating another successful batch. File selection uses the automation
API because OS file dialogs are not keyboard-automatable.
"""
import os, sys, time, json, subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright

BASE_URL = "http://127.0.0.1:3000"
REPO = Path(__file__).resolve().parent.parent.parent
HARNESS = Path(__file__).resolve().parent
EVIDENCE_BASE = REPO / "docs/ui-ux/evidence/wp-08-01f/runs"

OWNER = ("qa-browser-owner@erp-yarn.test", "QABrowserOwner2026!")
QA_TENANT = "00000000-0000-0000-0000-000000081e50"

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
  const { count: audit } = await supabase.from('audit_logs').select('*', { count: 'exact', head: true }).eq('tenant_id', QA_TENANT);
  console.log(JSON.stringify({ batches, audit }));
})();
"""
    out, _ = run_node_inline(code)
    return json.loads(out) if out else {}

def evidence_dir(run_id):
    d = EVIDENCE_BASE / run_id
    d.mkdir(parents=True, exist_ok=True)
    return d

def main():
    run_id = "qaB-r9-1786647635"
    ed = evidence_dir(run_id)
    key_sequence = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 768})

        # Login (keyboard-driven)
        print("=== TASK 7: Keyboard-only proof ===")
        print("\n--- Login (keyboard) ---")
        page.goto(f"{BASE_URL}/login", wait_until="domcontentloaded")
        key_sequence.append("Tab to email field")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        key_sequence.append("Type email")
        page.keyboard.type(OWNER[0])
        time.sleep(0.3)
        key_sequence.append("Tab to password field")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        key_sequence.append("Type password")
        page.keyboard.type(OWNER[1])
        time.sleep(0.3)
        key_sequence.append("Tab to submit button")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        # Check focus is on submit button
        focused = page.evaluate('() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type, text: document.activeElement?.textContent?.trim()?.slice(0,20) })')
        print(f"  Focused before Enter: {focused}")
        key_sequence.append("Press Enter to submit login")
        page.keyboard.press("Enter")
        page.wait_for_url(lambda u: '/login' not in u, timeout=15000)
        print(f"  Login OK, URL: {page.url}")
        page.screenshot(path=str(ed / "1024_task7-01-keyboard-login.png"), full_page=True)

        # Navigate to migration page
        print("\n--- Migration page (keyboard) ---")
        page.goto(f"{BASE_URL}/management/admin/migration", wait_until="domcontentloaded")
        page.wait_for_selector('input[name="sourceDescription"]', timeout=10000)
        time.sleep(1)

        # Tab to sourceDescription field
        key_sequence.append("Tab to sourceDescription field")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        focused = page.evaluate('() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.name })')
        print(f"  Focused: {focused}")

        # If not on sourceDescription, tab more
        if focused.get('name') != 'sourceDescription':
            for _ in range(5):
                page.keyboard.press("Tab")
                time.sleep(0.2)
                focused = page.evaluate('() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.name })')
                if focused.get('name') == 'sourceDescription':
                    break

        key_sequence.append("Type sourceDescription value")
        page.keyboard.type("KEYBOARD TEST (invalid — should not persist)")
        time.sleep(0.3)
        page.screenshot(path=str(ed / "1024_task7-02-keyboard-typed.png"), full_page=True)

        # Tab to templateName
        key_sequence.append("Tab to templateName field")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        focused = page.evaluate('() => ({ name: document.activeElement?.name })')
        print(f"  Focused: {focused}")
        if focused.get('name') == 'templateName':
            key_sequence.append("Type templateName")
            page.keyboard.type("opening_balance_inventory")
            time.sleep(0.3)

        # Tab to templateVersion
        key_sequence.append("Tab to templateVersion field")
        page.keyboard.press("Tab")
        time.sleep(0.3)
        focused = page.evaluate('() => ({ name: document.activeElement?.name })')
        print(f"  Focused: {focused}")
        if focused.get('name') == 'templateVersion':
            key_sequence.append("Type templateVersion")
            page.keyboard.type("1.0")
            time.sleep(0.3)

        # Clear the idempotencyKey to make this an invalid submission (zero effects)
        page.evaluate('() => { document.querySelector("input[name=idempotencyKey]").value = ""; }')

        # Tab to submit button and press Enter
        key_sequence.append("Tab to submit button")
        for _ in range(5):
            page.keyboard.press("Tab")
            time.sleep(0.2)
            focused = page.evaluate('() => ({ tag: document.activeElement?.tagName, type: document.activeElement?.type, text: document.activeElement?.textContent?.trim()?.slice(0,20) })')
            if focused.get('type') == 'submit':
                break

        print(f"  Focused on submit: {focused}")
        page.screenshot(path=str(ed / "1024_task7-03-keyboard-focus-submit.png"), full_page=True)

        before = get_counts()
        print(f"  BEFORE: batches={before['batches']}, audit={before['audit']}")

        key_sequence.append("Press Enter to submit form")
        page.keyboard.press("Enter")
        page.wait_for_load_state("networkidle", timeout=15000)
        time.sleep(3)

        page.screenshot(path=str(ed / "1024_task7-04-keyboard-after-submit.png"), full_page=True)

        after = get_counts()
        print(f"  AFTER:  batches={after['batches']}, audit={after['audit']}")

        zero_effects = after['batches'] == before['batches'] and after['audit'] == before['audit']
        print(f"  Zero effects: {zero_effects}")

        # Check for error (role=alert)
        alerts = page.query_selector_all('[role="alert"]')
        print(f"  role=alert elements: {len(alerts)}")

        # Shift+Tab test (reverse navigation)
        key_sequence.append("Shift+Tab to reverse navigate")
        page.keyboard.press("Shift+Tab")
        time.sleep(0.3)
        focused_after_shift_tab = page.evaluate('() => ({ tag: document.activeElement?.tagName, name: document.activeElement?.name })')
        print(f"  After Shift+Tab: {focused_after_shift_tab}")
        page.screenshot(path=str(ed / "1024_task7-05-keyboard-shift-tab.png"), full_page=True)

        browser.close()

    # Save key sequence
    proof = {
        "keySequence": key_sequence,
        "zeroEffects": zero_effects,
        "errorVisible": len(alerts) > 0,
        "screenshotCount": 5,
    }
    with open(ed / "task7-keyboard-proof.json", 'w') as f:
        json.dump(proof, f, indent=2)
    print(f"\n=== TASK 7 SUMMARY: zero_effects={zero_effects}, error_visible={len(alerts) > 0} ===")
    print(f"  Key sequence ({len(key_sequence)} steps):")
    for step in key_sequence:
        print(f"    {step}")

if __name__ == "__main__":
    main()
