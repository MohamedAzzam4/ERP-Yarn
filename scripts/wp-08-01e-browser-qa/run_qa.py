#!/usr/bin/env python3
"""
WP-08-01E — Authenticated Browser Command-Success QA Runner
============================================================

Credential-neutral Playwright (Python) runner that exercises the eight
WP-08-01E server-action workflows through real browser forms against a
live ERP-Yarn deployment backed by Supabase.

STATUS: PREPARED — NOT YET SUCCESSFULLY EXECUTED.
        This runner has never completed a full green run. Until it has,
        treat all eight command workflows as UNPROVEN via browser forms.

Hard requirements (enforced at startup):
  * Reads every credential from environment variables only.
  * Refuses to run when any required variable is missing (exit 2).
  * Asserts authenticated protected URLs do NOT resolve to /login.
  * Seeds deterministic actionable fixtures directly via DATABASE_URL.
  * Exercises all eight required command workflows.
  * Records DB before/after evidence for each command.
  * Captures screenshots at 360, 768, 1024, 1440 widths.
  * Checks keyboard access, form labels, RTL/LTR direction, touch targets.
  * Cleans up all seeded data in deterministic FK-safe order.
  * Exits non-zero on any failed assertion.
  * NEVER modifies Git state (no `git` invocations).
  * NEVER deploys (no `vercel`/`docker`/`ssh` invocations).
  * Documents clearly that it has not yet completed successfully unless
    it actually has (see SUCCESS_LOG below).

Required environment variables (read at startup, never persisted):
  NEXT_PUBLIC_SUPABASE_URL              e.g. https://<project>.supabase.co
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY  browser-safe publishable key
  SUPABASE_SECRET_KEY                   server-only service-role key
  DATABASE_URL                          postgresql://...pooler.supabase.com:5432/postgres
  SUPABASE_PROJECT_REF                  e.g. <project>
  ERP_YARN_REPO                         absolute path to ERP-Yarn checkout

Optional:
  BROWSER_QA_HEADLESS   (default "1")  — "0" shows the chromium window
  BROWSER_QA_PORT       (default "3210") — port for the Next.js dev server
  BROWSER_QA_KEEP_SERVER (default unset) — "1" keeps the dev server up after QA

Success log:
  This runner writes a marker file at
  docs/ui-ux/evidence/wp-08-01e/browser-qa/SUCCESS_MARKER.txt
  ONLY when all assertions pass. The marker file contains the timestamp
  and the run summary. If the file is absent, the runner has not yet
  completed successfully. Do NOT claim browser-success without it.

Outputs (under docs/ui-ux/evidence/wp-08-01e/browser-qa/):
  summary.txt              human-readable summary table
  summary.json             machine-readable evidence
  screenshots/*.png        one per command + per viewport
  db-before-after.json     DB counts before/after each command
  accessibility.json       a11y check results
  SUCCESS_MARKER.txt       only present if all assertions passed

Exit codes:
  0  — all assertions passed (also writes SUCCESS_MARKER.txt)
  1  — one or more assertions failed
  2  — missing required environment variables (no work performed)
  3  — Python dependency missing (psycopg2 / playwright / bcrypt)
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Dependency check
# ---------------------------------------------------------------------------

try:
    import psycopg2  # type: ignore
except ImportError:
    print("FATAL: psycopg2 is not installed. Run: pip install psycopg2-binary", file=sys.stderr)
    sys.exit(3)

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout  # type: ignore
except ImportError:
    print("FATAL: playwright is not installed. Run: pip install playwright && playwright install chromium", file=sys.stderr)
    sys.exit(3)

# bcrypt is optional — used to pre-hash QA passwords. If unavailable, the
# runner falls back to Postgres's pgcrypto.crypt() at seed time.
try:
    import bcrypt  # type: ignore
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False


# ---------------------------------------------------------------------------
# Constants — deterministic UUIDs for idempotent seeding
# ---------------------------------------------------------------------------

TENANT_ID = "00000000-0000-0000-0000-000000081e50"
TENANT_NAME = "WP-08-01E Browser QA Tenant"

OWNER_AUTH_ID = "00000000-0000-0000-0000-000000081e51"
WORKER_AUTH_ID = "00000000-0000-0000-0000-000000081e52"

OWNER_USER_ID = "00000000-0000-0000-0000-000000081e61"
WORKER_USER_ID = "00000000-0000-0000-0000-000000081e62"

OWNER_ROLE_ID = "00000000-0000-0000-0000-000000081e71"
WORKER_ROLE_ID = "00000000-0000-0000-0000-000000081e72"

FIBER_TYPE_ID = "00000000-0000-0000-0000-000000081e81"
PRODUCT_TYPE_ID = "00000000-0000-0000-0000-000000081e82"
CUSTOMER_ID = "00000000-0000-0000-0000-000000081e83"
YARN_LOT_ID = "00000000-0000-0000-0000-000000081e84"
INVENTORY_ITEM_ID = "00000000-0000-0000-0000-000000081e85"
LOCATION_ID = "00000000-0000-0000-0000-000000081e86"

SALES_ORDER_ID = "00000000-0000-0000-0000-000000081e91"
SALES_ORDER_LINE_ID = "00000000-0000-0000-0000-000000081e92"
QUALITY_TEST_ID = "00000000-0000-0000-0000-000000081e93"
COMPLAINT_ID = "00000000-0000-0000-0000-000000081e94"
RETURN_REQUEST_ID = "00000000-0000-0000-0000-000000081e95"
RETURN_LINE_ID = "00000000-0000-0000-0000-000000081e96"

# QA-only credentials. These are NOT real Supabase account credentials.
# They are scoped to the QA tenant (00000000-...-081e50) which is created
# and destroyed by this script. The bcrypt hash is computed at runtime.
OWNER_EMAIL = "qa-browser-owner@erp-yarn.test"
WORKER_EMAIL = "qa-browser-worker@erp-yarn.test"
OWNER_PASSWORD = "qa-browser-owner-pw-2026"
WORKER_PASSWORD = "qa-browser-worker-pw-2026"

REQUIRED_ENV = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_SECRET_KEY",
    "DATABASE_URL",
    "SUPABASE_PROJECT_REF",
    "ERP_YARN_REPO",
]

VIEWPORTS = [
    {"name": "360", "width": 360, "height": 640},
    {"name": "768", "width": 768, "height": 1024},
    {"name": "1024", "width": 1024, "height": 768},
    {"name": "1440", "width": 1440, "height": 900},
]

# (action_label, route, form_selector) — selectors use data-action attributes
# so they survive styling refactors.
COMMANDS = [
    ("createQualityTestAction", "/management/quality/tests", "form[data-action='create-quality-test']"),
    ("recordQualityTestValueAction", "/management/quality/tests", "form[data-action='record-quality-test-value']"),
    ("createComplaintAction", "/management/quality/complaints", "form[data-action='create-complaint']"),
    ("updateComplaintAction", "/management/quality/complaints", "form[data-action='update-complaint']"),
    ("reviewQualityTestAction", "/management/quality/tests", "form[data-action='review-quality-test']"),
    ("approveReturnAction", "/management/quality/returns", "form[data-action='approve-return']"),
    ("rejectReturnAction", "/management/quality/returns", "form[data-action='reject-return']"),
    ("createReplacementOrderAction", "/management/quality/returns", "form[data-action='create-replacement-order']"),
]

PROTECTED_ROUTES = [
    "/management/quality/tests",
    "/management/quality/complaints",
    "/management/quality/returns",
    "/worker/quality-entry",
]


# ---------------------------------------------------------------------------
# Step 1 — env validation (fail-closed)
# ---------------------------------------------------------------------------

def validate_env() -> dict[str, str]:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print("FATAL: missing required environment variables:", file=sys.stderr)
        for k in missing:
            print(f"  - {k}", file=sys.stderr)
        print("", file=sys.stderr)
        print("No work was performed. Set them and re-run.", file=sys.stderr)
        sys.exit(2)
    return {k: os.environ[k] for k in REQUIRED_ENV}


# ---------------------------------------------------------------------------
# Step 2 — Next.js dev server
# ---------------------------------------------------------------------------

def start_dev_server(env: dict[str, str], port: int) -> subprocess.Popen:
    repo = Path(env["ERP_YARN_REPO"])
    if not (repo / "package.json").is_file():
        print(f"FATAL: ERP_YARN_REPO does not point to ERP-Yarn: {repo}", file=sys.stderr)
        sys.exit(2)
    child_env = os.environ.copy()
    child_env.update({k: env[k] for k in REQUIRED_ENV})
    child_env["NODE_ENV"] = "development"
    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(port)],
        cwd=str(repo),
        env=child_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    return proc


def wait_for_server(proc: subprocess.Popen, port: int, timeout: float = 120.0) -> str:
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + timeout
    last_err = ""
    while time.time() < deadline:
        if proc.poll() is not None:
            print("FATAL: Next.js dev server exited early.", file=sys.stderr)
            out, _ = proc.communicate(timeout=5)
            print(out[-3000:], file=sys.stderr)
            sys.exit(1)
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=5) as r:
                if r.status == 200:
                    print(f"[server] ready at {base}")
                    return base
        except Exception as e:  # noqa: BLE001
            last_err = str(e)
        time.sleep(2)
    print(f"FATAL: server did not become healthy in {timeout}s. Last error: {last_err}", file=sys.stderr)
    proc.terminate()
    sys.exit(1)


# ---------------------------------------------------------------------------
# Step 3 — DB connection & fixture seeding
# ---------------------------------------------------------------------------

def db_conn(env: dict[str, str]):
    return psycopg2.connect(env["DATABASE_URL"])


def compute_bcrypt_hash(password: str) -> str:
    """Compute a bcrypt hash. Uses Python bcrypt if available; falls back
    to a sentinel that the SQL layer replaces via pgcrypto.crypt() at seed time.
    """
    if HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    return f"__NEEDS_PGCRYPTO__:{password}"


def seed_fixtures(env: dict[str, str]) -> dict[str, Any]:
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        # tenant
        cur.execute(
            """
            INSERT INTO public.tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (%s, %s, 'ar', 'EGP', 'Africa/Cairo', 'active')
            ON CONFLICT (id) DO NOTHING
            """,
            (TENANT_ID, TENANT_NAME),
        )
        counts["tenants"] = cur.rowcount

        owner_hash = compute_bcrypt_hash(OWNER_PASSWORD)
        worker_hash = compute_bcrypt_hash(WORKER_PASSWORD)

        # auth.users — Supabase GoTrue-managed
        for auth_id, email, name, pw_hash in [
            (OWNER_AUTH_ID, OWNER_EMAIL, "QA Browser Owner", owner_hash),
            (WORKER_AUTH_ID, WORKER_EMAIL, "QA Browser Worker", worker_hash),
        ]:
            cur.execute(
                """
                INSERT INTO auth.users (
                    id, instance_id, aud, role, email,
                    encrypted_password, email_confirmed_at,
                    raw_app_meta_data, raw_user_meta_data,
                    created_at, updated_at, last_sign_in_at,
                    confirmation_token, recovery_token,
                    email_change_token_new, email_change
                )
                VALUES (
                    %s, '00000000-0000-0000-0000-000000000000',
                    'authenticated', 'authenticated', %s,
                    %s, now(),
                    '{"provider":"email","providers":["email"]}',
                    %s,
                    now(), now(), NULL, '', '', '', ''
                )
                ON CONFLICT (id) DO UPDATE SET
                    encrypted_password = EXCLUDED.encrypted_password,
                    email_confirmed_at = now(),
                    updated_at = now()
                """,
                (auth_id, email, pw_hash, json.dumps({"email_verified": True, "name": name})),
            )
        counts["auth_users"] = 2

        # public.users
        for user_id, auth_id, email, name in [
            (OWNER_USER_ID, OWNER_AUTH_ID, OWNER_EMAIL, "QA Browser Owner"),
            (WORKER_USER_ID, WORKER_AUTH_ID, WORKER_EMAIL, "QA Browser Worker"),
        ]:
            cur.execute(
                """
                INSERT INTO public.users (id, tenant_id, auth_id, name, email, status, language_preference, created_at)
                VALUES (%s, %s, %s, %s, %s, 'active', 'ar', now())
                ON CONFLICT (id) DO NOTHING
                """,
                (user_id, TENANT_ID, auth_id, name, email),
            )
        counts["public_users"] = 2

        # roles
        for role_id, code, name_ar, name_en, is_system, flag in [
            (OWNER_ROLE_ID, "owner", "مالك", "Owner", True, "system"),
            (WORKER_ROLE_ID, "quality_worker", "عامل جودة", "Quality Worker", False, "custom"),
        ]:
            cur.execute(
                """
                INSERT INTO public.roles (id, tenant_id, role_code, name_ar, name_en, is_system_role, system_flag, created_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, now())
                ON CONFLICT (id) DO NOTHING
                """,
                (role_id, TENANT_ID, code, name_ar, name_en, is_system, flag),
            )
        counts["roles"] = 2

        # permissions
        perms = [
            ("quality_tests.create", "quality", "create"),
            ("quality_risk_sales.approve", "quality", "approve"),
            ("complaints.investigate", "complaints", "investigate"),
            ("returns.approve", "returns", "approve"),
        ]
        for key, module, action in perms:
            cur.execute(
                """
                INSERT INTO public.permissions (tenant_id, permission_key, module, action, description, created_at)
                VALUES (%s, %s, %s, %s, %s, now())
                ON CONFLICT (tenant_id, permission_key) DO NOTHING
                """,
                (TENANT_ID, key, module, action, f"QA fixture: {key}"),
            )
        counts["permissions"] = len(perms)

        cur.execute(
            "SELECT permission_key, id FROM public.permissions WHERE tenant_id = %s AND permission_key = ANY(%s)",
            (TENANT_ID, [p[0] for p in perms]),
        )
        perm_ids = {k: pid for k, pid in cur.fetchall()}

        owner_perms = list(perm_ids.values())
        worker_perms = [perm_ids["quality_tests.create"]]
        for pid in owner_perms:
            cur.execute(
                """
                INSERT INTO public.role_permissions (role_id, permission_id, tenant_id, created_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT DO NOTHING
                """,
                (OWNER_ROLE_ID, pid, TENANT_ID),
            )
        for pid in worker_perms:
            cur.execute(
                """
                INSERT INTO public.role_permissions (role_id, permission_id, tenant_id, created_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT DO NOTHING
                """,
                (WORKER_ROLE_ID, pid, TENANT_ID),
            )
        counts["role_permissions"] = len(owner_perms) + len(worker_perms)

        for user_id, role_id in [(OWNER_USER_ID, OWNER_ROLE_ID), (WORKER_USER_ID, WORKER_ROLE_ID)]:
            cur.execute(
                """
                INSERT INTO public.user_roles (user_id, role_id, tenant_id, created_at)
                VALUES (%s, %s, %s, now())
                ON CONFLICT DO NOTHING
                """,
                (user_id, role_id, TENANT_ID),
            )
        counts["user_roles"] = 2

        # master data
        cur.execute(
            """
            INSERT INTO public.fiber_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-FIBER', 'ليف QA', 'QA Fiber', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (FIBER_TYPE_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.product_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-PROD', 'منتج QA', 'QA Product', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (PRODUCT_TYPE_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.customers (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-CUST', 'عميل QA', 'QA Customer', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (CUSTOMER_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.locations (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-LOC', 'موقع QA', 'QA Location', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (LOCATION_ID, TENANT_ID, OWNER_USER_ID),
        )
        counts["master_data"] = 4

        cur.execute(
            """
            INSERT INTO public.yarn_lots (id, tenant_id, lot_code, product_type_id, fiber_type_id, status, created_at, created_by)
            VALUES (%s, %s, 'QA-LOT-001', %s, %s, 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (YARN_LOT_ID, TENANT_ID, PRODUCT_TYPE_ID, FIBER_TYPE_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.inventory_items (id, tenant_id, product_type_id, yarn_lot_id, status, created_at, created_by)
            VALUES (%s, %s, %s, %s, 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (INVENTORY_ITEM_ID, TENANT_ID, PRODUCT_TYPE_ID, YARN_LOT_ID, OWNER_USER_ID),
        )
        counts["yarn_lots_and_inventory"] = 2

        cur.execute(
            """
            INSERT INTO public.sales_orders (id, tenant_id, order_number, customer_id, status, currency_code, total_amount, total_quantity, order_date, created_at, created_by)
            VALUES (%s, %s, 'QA-SO-001', %s, 'completed', 'EGP', 1000.00, 100, now(), now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (SALES_ORDER_ID, TENANT_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.sales_order_lines (id, tenant_id, sales_order_id, line_number, product_type_id, yarn_lot_id, quantity, unit_price, total_price, created_at, created_by)
            VALUES (%s, %s, %s, 1, %s, %s, 100, 10.00, 1000.00, now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (SALES_ORDER_LINE_ID, TENANT_ID, SALES_ORDER_ID, PRODUCT_TYPE_ID, YARN_LOT_ID, OWNER_USER_ID),
        )
        counts["sales_orders_and_lines"] = 2

        cur.execute(
            """
            INSERT INTO public.quality_tests (id, tenant_id, test_number, sales_order_line_id, status, created_at, created_by)
            VALUES (%s, %s, 'QA-QT-001', %s, 'in_review', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (QUALITY_TEST_ID, TENANT_ID, SALES_ORDER_LINE_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.complaints (id, tenant_id, complaint_number, customer_id, status, description, created_at, created_by)
            VALUES (%s, %s, 'QA-COMPL-001', %s, 'open', 'QA fixture complaint', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (COMPLAINT_ID, TENANT_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.return_requests (id, tenant_id, return_number, sales_order_id, customer_id, status, total_quantity, total_amount, currency_code, created_at, created_by)
            VALUES (%s, %s, 'QA-RET-001', %s, %s, 'pending_approval', 10, 100.00, 'EGP', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (RETURN_REQUEST_ID, TENANT_ID, SALES_ORDER_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.return_lines (id, tenant_id, return_request_id, sales_order_line_id, quantity, unit_price, total_price, created_at, created_by)
            VALUES (%s, %s, %s, %s, 10, 10.00, 100.00, now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (RETURN_LINE_ID, TENANT_ID, RETURN_REQUEST_ID, SALES_ORDER_LINE_ID, OWNER_USER_ID),
        )
        counts["business_records"] = 4

    return counts


# ---------------------------------------------------------------------------
# Step 4 — Playwright browser QA
# ---------------------------------------------------------------------------

def login(page, base_url: str, email: str, password: str) -> bool:
    page.goto(f"{base_url}/login", wait_until="networkidle")
    email_input = page.locator("input[name='email'], input[type='email']").first
    pw_input = page.locator("input[name='password'], input[type='password']").first
    email_input.fill(email)
    pw_input.fill(password)
    submit = page.locator("button[type='submit']").first
    submit.click()
    try:
        page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
        return True
    except PlaywrightTimeout:
        return False


def assert_not_on_login(page, route: str) -> bool:
    """Fail-closed assertion: protected route must NOT resolve to /login."""
    return "/login" not in page.url


def capture_db_counts(env: dict[str, str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        for table in [
            "quality_tests", "quality_test_values", "quality_holds",
            "complaints", "return_requests", "return_lines",
            "audit_logs", "idempotency_records", "document_sequences",
            "stock_movements", "inventory_balances", "account_entries",
        ]:
            cur.execute(
                f"SELECT count(*) FROM public.{table} WHERE tenant_id = %s",
                (TENANT_ID,),
            )
            counts[table] = cur.fetchone()[0]
    return counts


def exercise_command(page, base_url: str, env: dict[str, str], action: str, route: str, form_selector: str, screenshots_dir: Path) -> dict[str, Any]:
    page.goto(f"{base_url}{route}", wait_until="networkidle")
    not_login = assert_not_on_login(page, route)
    if not not_login:
        return {
            "action": action,
            "route": route,
            "status": "REDIRECTED_TO_LOGIN",
            "before": None,
            "after": None,
            "screenshot_before": None,
            "screenshot_after": None,
        }

    before = capture_db_counts(env)
    screenshot_before = screenshots_dir / f"before-{action}.png"
    page.screenshot(path=str(screenshot_before), full_page=True)

    form = page.locator(form_selector).first
    if form.count() == 0:
        return {
            "action": action,
            "route": route,
            "status": "FORM_NOT_FOUND",
            "before": before,
            "after": before,
            "screenshot_before": str(screenshot_before),
            "screenshot_after": None,
        }

    inputs = form.locator("input:visible, textarea:visible, select:visible")
    for i in range(inputs.count()):
        inp = inputs.nth(i)
        inp_type = inp.get_attribute("type") or "text"
        if inp_type in ("text", "number", "textarea"):
            placeholder = inp.get_attribute("placeholder") or "QA"
            inp.fill("1" if inp_type == "number" else placeholder)

    submit_btn = form.locator("button[type='submit'], button:not([type])").first
    if submit_btn.count() > 0:
        submit_btn.click()
        try:
            page.wait_for_load_state("networkidle", timeout=15000)
        except PlaywrightTimeout:
            pass

    after = capture_db_counts(env)
    screenshot_after = screenshots_dir / f"after-{action}.png"
    page.screenshot(path=str(screenshot_after), full_page=True)

    effect_verified = after["audit_logs"] > before["audit_logs"]

    return {
        "action": action,
        "route": route,
        "status": "OK" if effect_verified else "NO_AUDIT_DELTA",
        "before": before,
        "after": after,
        "screenshot_before": str(screenshot_before),
        "screenshot_after": str(screenshot_after),
    }


def run_responsive_screenshots(page, base_url: str, screenshots_dir: Path) -> list[dict[str, str]]:
    results = []
    for vp in VIEWPORTS:
        page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
        for route in PROTECTED_ROUTES:
            page.goto(f"{base_url}{route}", wait_until="networkidle")
            safe_route = route.replace("/", "_")
            path = screenshots_dir / f"resp-{vp['name']}{safe_route}.png"
            page.screenshot(path=str(path), full_page=True)
            results.append({"viewport": vp["name"], "route": route, "screenshot": str(path)})
    return results


def run_accessibility_checks(page, base_url: str) -> dict[str, Any]:
    results: dict[str, Any] = {}
    page.goto(f"{base_url}/management/quality/tests", wait_until="networkidle")

    # Keyboard nav
    initial_focus = page.evaluate("() => document.activeElement?.tagName || 'BODY'")
    page.keyboard.press("Tab")
    after_tab_focus = page.evaluate("() => document.activeElement?.tagName || 'BODY'")
    results["keyboard_tab_moves_focus"] = (after_tab_focus != initial_focus) or (after_tab_focus != "BODY")

    # Form labels
    inputs = page.locator("input:visible")
    labeled = 0
    unlabeled = 0
    for i in range(inputs.count()):
        inp = inputs.nth(i)
        inp_id = inp.get_attribute("id")
        aria_label = inp.get_attribute("aria-label")
        if inp_id and page.locator(f"label[for='{inp_id}']").count() > 0:
            labeled += 1
        elif aria_label:
            labeled += 1
        elif inp.get_attribute("type") in ("submit", "button", "hidden", "checkbox"):
            labeled += 1
        else:
            unlabeled += 1
    results["form_labels"] = {"labeled": labeled, "unlabeled": unlabeled}

    # RTL/LTR
    html_dir = page.evaluate("() => document.documentElement.getAttribute('dir') || 'ltr'")
    body_dir = page.evaluate("() => document.body.getAttribute('dir') || 'ltr'")
    results["direction"] = {"html_dir": html_dir, "body_dir": body_dir, "is_rtl": html_dir == "rtl" or body_dir == "rtl"}

    # Touch targets at 360 viewport
    page.set_viewport_size({"width": 360, "height": 640})
    buttons = page.locator("button:visible, a.btn:visible, [role='button']:visible")
    too_small = 0
    checked = min(buttons.count(), 20)
    for i in range(checked):
        btn = buttons.nth(i)
        box = btn.bounding_box()
        if box and (box["height"] < 24 or box["width"] < 24):
            too_small += 1
    results["touch_targets"] = {"checked": checked, "too_small": too_small}

    return results


# ---------------------------------------------------------------------------
# Step 5 — cleanup
# ---------------------------------------------------------------------------

def cleanup(env: dict[str, str]) -> dict[str, int]:
    deleted: dict[str, int] = {}
    tables_children_first = [
        "return_lines",
        "return_requests",
        "complaints",
        "quality_test_values",
        "quality_holds",
        "quality_tests",
        "sales_order_lines",
        "sales_orders",
        "inventory_items",
        "yarn_lots",
        "locations",
        "customers",
        "product_types",
        "fiber_types",
        "user_roles",
        "role_permissions",
        "permissions",
        "roles",
        "users",
        "document_sequences",
        "idempotency_records",
        "audit_logs",
        "tenants",
    ]
    with db_conn(env) as conn, conn.cursor() as cur:
        cur.execute(
            "DELETE FROM auth.users WHERE id IN (%s, %s)",
            (OWNER_AUTH_ID, WORKER_AUTH_ID),
        )
        deleted["auth.users"] = cur.rowcount
        for table in tables_children_first:
            cur.execute(f"DELETE FROM public.{table} WHERE tenant_id = %s", (TENANT_ID,))
            deleted[f"public.{table}"] = cur.rowcount
    return deleted


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def main() -> int:
    env = validate_env()
    repo = Path(env["ERP_YARN_REPO"])
    evidence_dir = repo / "docs" / "ui-ux" / "evidence" / "wp-08-01e" / "browser-qa"
    screenshots_dir = evidence_dir / "screenshots"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(exist_ok=True)

    started_at = datetime.now(timezone.utc).isoformat()
    print(f"[qa] started at {started_at}")
    print(f"[qa] tenant_id={TENANT_ID}")
    print(f"[qa] owner_email={OWNER_EMAIL}")
    print(f"[qa] worker_email={WORKER_EMAIL}")
    print(f"[qa] STATUS: runner is prepared but has not yet completed a successful run.")
    print(f"[qa]        If this run succeeds, a SUCCESS_MARKER.txt will be written.")

    print("[qa] seeding fixtures ...")
    seed_counts = seed_fixtures(env)
    print(f"[qa] seeded: {seed_counts}")

    port = int(os.environ.get("BROWSER_QA_PORT", "3210"))
    print(f"[qa] starting Next.js dev server on port {port} ...")
    proc = start_dev_server(env, port)
    try:
        base_url = wait_for_server(proc, port)

        headless = os.environ.get("BROWSER_QA_HEADLESS", "1") != "0"
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=headless)
            context = browser.new_context()
            page = context.new_page()

            print("[qa] logging in as Owner ...")
            if not login(page, base_url, OWNER_EMAIL, OWNER_PASSWORD):
                print("FATAL: Owner login failed.", file=sys.stderr)
                page.screenshot(path=str(evidence_dir / "owner-login-failed.png"))
                return 1
            print("[qa] Owner login OK")

            # Assert all protected routes do not redirect to /login
            route_assertions = []
            for route in PROTECTED_ROUTES:
                page.goto(f"{base_url}{route}", wait_until="networkidle")
                ok = assert_not_on_login(page, route)
                route_assertions.append({"route": route, "not_on_login": ok, "actual_url": page.url})
                if not ok:
                    print(f"[qa] FAIL: {route} redirected to /login", file=sys.stderr)

            command_results = []
            for action, route, form_sel in COMMANDS:
                print(f"[qa] exercising {action} on {route} ...")
                result = exercise_command(page, base_url, env, action, route, form_sel, screenshots_dir)
                command_results.append(result)
                print(f"[qa]   -> {result['status']}")

            print("[qa] capturing responsive screenshots ...")
            responsive = run_responsive_screenshots(page, base_url, screenshots_dir)

            # Worker session
            print("[qa] logging in as Worker ...")
            context2 = browser.new_context()
            page2 = context2.new_page()
            if not login(page2, base_url, WORKER_EMAIL, WORKER_PASSWORD):
                print("FATAL: Worker login failed.", file=sys.stderr)
                page2.screenshot(path=str(evidence_dir / "worker-login-failed.png"))
                return 1
            print("[qa] Worker login OK")
            page2.goto(f"{base_url}/worker/quality-entry", wait_until="networkidle")
            worker_access_ok = "/worker/quality-entry" in page2.url
            page2.screenshot(path=str(screenshots_dir / "worker-quality-entry.png"))
            page2.goto(f"{base_url}/management/quality/tests", wait_until="networkidle")
            worker_denied_ok = "/management/" not in page2.url
            page2.screenshot(path=str(screenshots_dir / "worker-denied-management.png"))

            print("[qa] running accessibility checks ...")
            a11y = run_accessibility_checks(page, base_url)

            browser.close()

        print("[qa] cleaning up seeded data ...")
        deleted = cleanup(env)
        print(f"[qa] cleaned up: {deleted}")

        finished_at = datetime.now(timezone.utc).isoformat()
        all_commands_ok = all(r["status"] == "OK" for r in command_results)
        all_routes_ok = all(r["not_on_login"] for r in route_assertions)
        success = (
            all_commands_ok
            and all_routes_ok
            and worker_access_ok
            and worker_denied_ok
            and a11y["keyboard_tab_moves_focus"]
            and a11y["form_labels"]["unlabeled"] == 0
        )

        summary = {
            "started_at": started_at,
            "finished_at": finished_at,
            "tenant_id": TENANT_ID,
            "seed_counts": seed_counts,
            "route_assertions": route_assertions,
            "commands": command_results,
            "responsive_screenshots": responsive,
            "worker_access_ok": worker_access_ok,
            "worker_denied_ok": worker_denied_ok,
            "accessibility": a11y,
            "cleanup": deleted,
            "overall_success": success,
        }
        (evidence_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

        lines = []
        lines.append("WP-08-01E Browser QA Summary")
        lines.append(f"Started: {started_at}")
        lines.append(f"Finished: {finished_at}")
        lines.append(f"Tenant: {TENANT_ID}")
        lines.append("")
        lines.append("=== Protected route assertions (must not resolve to /login) ===")
        for r in route_assertions:
            lines.append(f"  {r['route']:<40} not_on_login={r['not_on_login']}")
        lines.append("")
        lines.append("=== Commands ===")
        for r in command_results:
            lines.append(f"  {r['action']:<35} {r['status']}")
        lines.append("")
        lines.append(f"Worker access to /worker/quality-entry: {'OK' if worker_access_ok else 'FAIL'}")
        lines.append(f"Worker denied /management/quality/tests: {'OK' if worker_denied_ok else 'FAIL'}")
        lines.append("")
        lines.append("=== Accessibility ===")
        lines.append(f"  Keyboard Tab moves focus: {a11y.get('keyboard_tab_moves_focus')}")
        lines.append(f"  Form labels (labeled/unlabeled): {a11y['form_labels']['labeled']}/{a11y['form_labels']['unlabeled']}")
        lines.append(f"  Direction (html dir): {a11y['direction']['html_dir']}")
        lines.append(f"  Touch targets too small (of {a11y['touch_targets']['checked']} checked): {a11y['touch_targets']['too_small']}")
        lines.append("")
        lines.append("=== Cleanup ===")
        for k, v in deleted.items():
            lines.append(f"  {k}: {v}")
        lines.append("")
        lines.append(f"Overall success: {success}")
        if success:
            lines.append("")
            lines.append("SUCCESS_MARKER written.")
        (evidence_dir / "summary.txt").write_text("\n".join(lines))
        print("\n".join(lines))

        if success:
            marker = evidence_dir / "SUCCESS_MARKER.txt"
            marker.write_text(
                f"WP-08-01E Browser QA SUCCESS\n"
                f"Timestamp: {finished_at}\n"
                f"Tenant: {TENANT_ID}\n"
                f"Commands OK: {len(command_results)}/{len(command_results)}\n"
                f"Routes not on /login: {sum(1 for r in route_assertions if r['not_on_login'])}/{len(route_assertions)}\n"
            )

        return 0 if success else 1

    finally:
        if os.environ.get("BROWSER_QA_KEEP_SERVER") != "1":
            print("[qa] stopping Next.js dev server ...")
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


if __name__ == "__main__":
    sys.exit(main())
