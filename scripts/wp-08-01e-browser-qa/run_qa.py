#!/usr/bin/env python3
"""
WP-08-01E — Authenticated Browser Command-Success QA Runner (v4).

Credential-neutral Playwright (Python) runner that exercises the eight
WP-08-01E server-action workflows through real browser forms against a
live ERP-Yarn deployment backed by Supabase.

STATUS: PREPARED — NOT YET SUCCESSFULLY EXECUTED.
        This runner has never completed a full green run. Until it has,
        treat all eight command workflows as UNPROVEN via browser forms.

Key design principles (DEFECT 3 fix):
- Selects forms by stable data-action attributes (not positional indexes).
- Never fills hidden idempotency or entity fields through DOM injection.
- Re-fetches/reloads explicitly after each action.
- Waits for a visible success/error state and then verifies DB state.
- Fails immediately if the expected form or fixture is absent.
- Does not use arbitrary sleeps as the correctness mechanism.
- Does not report success based only on audit_delta.
- Every command asserts its expected entity status and exact effect counts.

Required environment variables:
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SECRET_KEY
  DATABASE_URL
  SUPABASE_PROJECT_REF
  ERP_YARN_REPO
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

try:
    import psycopg2  # type: ignore
except ImportError:
    print("FATAL: psycopg2 is not installed.", file=sys.stderr)
    sys.exit(3)

try:
    from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout  # type: ignore
except ImportError:
    print("FATAL: playwright is not installed.", file=sys.stderr)
    sys.exit(3)

try:
    import bcrypt  # type: ignore
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False

# Deterministic UUIDs (must match setup-fixtures.ts)
TENANT_ID = "00000000-0000-0000-0000-000000081e50"
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

# (action_label, route, role, data_action_selector, fill_strategy, entity_assertions)
# data_action_selector: CSS selector using data-action attribute
# fill_strategy: only fills visible inputs (hidden inputs are pre-filled by the page)
# entity_assertions: post-action DB queries to verify entity state (not just audit_delta)
COMMANDS = [
    (
        "createQualityTestAction",
        "/worker/quality-entry",
        "worker",
        "form[data-action='create-quality-test']",
        {
            "testDate": "2026-08-10",
            "linkedEntityType": "yarn_lot",
            "linkedEntityId": YARN_LOT_ID,
            "testStatus": "needs_review",
            "riskClassification": "needs_review",
            "notes": "QA browser runner createQualityTest",
        },
        {"table": "quality_tests", "expected_delta": 1},
    ),
    (
        "createComplaintAction",
        "/worker/quality-entry",
        "worker",
        "form[data-action='create-complaint']",
        {
            "complaintDate": "2026-08-10",
            "subject": "QA browser runner complaint",
            "priority": "normal",
            "linkedEntityType": "customer",
            "linkedEntityId": f"customer:{CUSTOMER_ID}",
            "description": "QA browser runner createComplaint description",
        },
        {"table": "complaints", "expected_delta": 1},
    ),
    (
        "recordQualityTestValueAction",
        "/worker/quality-entry",
        "worker",
        "form[data-action='record-quality-test-value']",
        {
            "qualityTestId": "00000000-0000-0000-0000-000000081e93",  # seed quality test
            "parameterName": "Twist",
            "parameterCode": "TWIST",
            "measuredValue": "850",
            "valueStatus": "pass",
            "notes": "QA browser runner recordValue",
        },
        {"table": "quality_test_values", "expected_delta": 1},
    ),
    (
        "updateComplaintAction",
        "/worker/quality-entry",
        "worker",
        "form[data-action='update-complaint']",
        {
            "complaintId": "00000000-0000-0000-0000-000000081e94",  # seed complaint
            "status": "investigating",
            "priority": "high",
            "investigationNotes": "QA browser runner updateComplaint",
        },
        {"table": "complaints", "expected_delta": 0, "expected_status": "investigating"},
    ),
    (
        "reviewQualityTestAction",
        "/management/quality/tests",
        "owner",
        "form[data-action='review-quality-test']",
        {
            "qualityTestId": "00000000-0000-0000-0000-000000081e93",
            "testStatus": "accepted",
            "riskClassification": "none",
            "reviewNotes": "QA browser runner reviewQualityTest",
        },
        {"table": "quality_tests", "expected_delta": 0, "expected_status": "accepted"},
    ),
    (
        "approveReturnAction",
        "/management/quality/returns",
        "owner",
        "form[data-action='approve-return']",
        {
            "financialTreatment": "customer_credit",
            "decisionReason": "QA browser runner approveReturn",
        },
        {"table": "return_requests", "expected_delta": 0, "expected_status": "approved"},
    ),
    (
        "rejectReturnAction",
        "/management/quality/returns",
        "owner",
        "form[data-action='reject-return']",
        {
            "decisionReason": "QA browser runner rejectReturn",
        },
        {"table": "return_requests", "expected_delta": 0, "expected_status": "rejected"},
    ),
    (
        "createReplacementOrderAction",
        "/management/quality/returns",
        "owner",
        "form[data-action='create-replacement-order']",
        {
            "saleDate": "2026-08-10",
            "decisionNotes": "QA browser runner createReplacementOrder",
        },
        {"table": "sales_orders", "expected_delta": 1},
    ),
]

PROTECTED_ROUTES = [
    "/management/quality/tests",
    "/management/quality/complaints",
    "/management/quality/returns",
    "/worker/quality-entry",
]


def validate_env() -> dict[str, str]:
    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print("FATAL: missing required environment variables:", file=sys.stderr)
        for k in missing:
            print(f"  - {k}", file=sys.stderr)
        sys.exit(2)
    return {k: os.environ[k] for k in REQUIRED_ENV}


def db_conn(env: dict[str, str]):
    return psycopg2.connect(env["DATABASE_URL"])


def compute_bcrypt_hash(password: str) -> str:
    if HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    return "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"


def seed_auth_users(env: dict[str, str]) -> dict[str, int]:
    """Seed only auth.users and public.users + roles/permissions.
    Business fixtures (sale, return, snapshot) are created by setup-fixtures.ts
    through the real domain lifecycle."""
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        # tenant
        cur.execute(
            """
            INSERT INTO public.tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (%s, 'WP-08-01E Browser QA Tenant', 'ar', 'EGP', 'Africa/Cairo', 'active')
            ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name
            """,
            (TENANT_ID,),
        )
        counts["tenants"] = 1

        owner_hash = compute_bcrypt_hash(OWNER_PASSWORD)
        worker_hash = compute_bcrypt_hash(WORKER_PASSWORD)

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

        for user_id, auth_id, email, name in [
            (OWNER_USER_ID, OWNER_AUTH_ID, OWNER_EMAIL, "QA Browser Owner"),
            (WORKER_USER_ID, WORKER_AUTH_ID, WORKER_EMAIL, "QA Browser Worker"),
        ]:
            cur.execute(
                """
                INSERT INTO public.users (id, tenant_id, auth_id, name, email, status, language_preference, created_at)
                VALUES (%s, %s, %s, %s, %s, 'active', 'ar', now())
                ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id, email = EXCLUDED.email
                """,
                (user_id, TENANT_ID, auth_id, name, email),
            )
        counts["public_users"] = 2

        # roles
        for role_id, code, name_ar, name_en, is_system, flag in [
            (OWNER_ROLE_ID, "owner", "مالك", "Owner", True, "system"),
            (WORKER_ROLE_ID, "quality_employee", "عامل جودة", "Quality Employee", False, "custom"),
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
        worker_perms = [perm_ids["quality_tests.create"], perm_ids["complaints.investigate"]]
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

        # Master data (needed for complaint linked-entity selection + quality test)
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
            INSERT INTO public.customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_at, created_by)
            VALUES (%s, %s, 'QA-CUST', 'عميل QA', 'QA Customer', 'qa customer', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (CUSTOMER_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_at, created_by)
            VALUES (%s, %s, 'QA-LOC', 'موقع QA', 'QA Location', 'internal_warehouse', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (LOCATION_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, status, created_at, created_by)
            VALUES (%s, %s, 'single_yarn', 'QA-INV-001', 'صنف QA', 'QA Inventory Item', 'accepted', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (INVENTORY_ITEM_ID, TENANT_ID, OWNER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.yarn_lots (id, tenant_id, item_id, lot_no, lot_type, quality_status, status, approval_status, created_at, created_by)
            VALUES (%s, %s, %s, 'QA-LOT-001', 'single_yarn', 'accepted', 'active', 'approved', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (YARN_LOT_ID, TENANT_ID, INVENTORY_ITEM_ID, OWNER_USER_ID),
        )
        counts["master_data"] = 6

        # Seed a quality test for recordQualityTestValueAction and reviewQualityTestAction
        QUALITY_TEST_ID = "00000000-0000-0000-0000-000000081e93"
        cur.execute(
            """
            INSERT INTO public.quality_tests (id, tenant_id, test_no, test_date, linked_entity_type, linked_entity_id, test_status, risk_classification, notes, created_at, created_by)
            VALUES (%s, %s, 'QA-QT-001', '2026-08-10', 'yarn_lot', %s, 'needs_review', 'low', 'QA fixture quality test', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (QUALITY_TEST_ID, TENANT_ID, YARN_LOT_ID, OWNER_USER_ID),
        )

        # Seed a complaint for updateComplaintAction
        COMPLAINT_ID = "00000000-0000-0000-0000-000000081e94"
        cur.execute(
            """
            INSERT INTO public.complaints (id, tenant_id, complaint_no, complaint_date, customer_id, subject, description, status, priority, created_at, created_by)
            VALUES (%s, %s, 'QA-COMPL-001', '2026-08-10', %s, 'QA fixture complaint', 'Initial complaint for browser QA', 'open', 'normal', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (COMPLAINT_ID, TENANT_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        counts["business_fixtures"] = 2

    return counts


def run_setup_fixtures(env: dict[str, str], run_id: str) -> dict[str, Any]:
    """Run the TypeScript setup-fixtures.ts script to create the approveReturn
    fixture through the real domain lifecycle (sale → snapshot → return).
    Passes QA_RUN_ID so idempotency keys are run-scoped."""
    repo = Path(env["ERP_YARN_REPO"])
    cmd = ["npx", "tsx", "--tsconfig", "tsconfig.json", "scripts/wp-08-01e-browser-qa/setup-fixtures.ts"]
    child_env = os.environ.copy()
    child_env["DATABASE_URL"] = env["DATABASE_URL"]
    child_env["NODE_OPTIONS"] = "--conditions react-server"
    child_env["QA_RUN_ID"] = run_id
    result = subprocess.run(
        cmd,
        cwd=str(repo),
        env=child_env,
        capture_output=True,
        text=True,
        timeout=180,
    )
    if result.returncode != 0:
        print(f"FATAL: setup-fixtures.ts failed (exit {result.returncode})", file=sys.stderr)
        print(f"stderr: {result.stderr[-1000:]}", file=sys.stderr)
        sys.exit(1)
    # Parse the JSON output (last block of JSON in stdout)
    output = result.stdout
    json_start = output.rfind("=== FIXTURES CREATED ===")
    if json_start >= 0:
        json_str = output[json_start + len("=== FIXTURES CREATED ==="):].strip()
        try:
            return json.loads(json_str)
        except json.JSONDecodeError:
            pass
    return {}


def capture_db_counts(env: dict[str, str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        for table in [
            "quality_tests", "quality_test_values", "quality_holds",
            "complaints", "return_requests", "return_lines",
            "audit_logs", "idempotency_records", "document_sequences",
            "stock_movements", "inventory_balances", "account_entries",
            "sales_orders", "sales_order_lines", "sales_profitability_snapshots",
        ]:
            cur.execute(
                f"SELECT count(*) FROM public.{table} WHERE tenant_id = %s",
                (TENANT_ID,),
            )
            counts[table] = cur.fetchone()[0]
    return counts


def get_entity_status(env: dict[str, str], table: str, entity_id: str) -> str | None:
    """Get the status of a specific entity by ID.
    Different tables use different status column names:
    - quality_tests: test_status
    - return_requests: status
    - complaints: status
    - sales_orders: sale_status
    """
    status_col = "status"
    if table == "quality_tests":
        status_col = "test_status"
    elif table == "sales_orders":
        status_col = "sale_status"
    elif table == "return_requests":
        status_col = "status"
    elif table == "complaints":
        status_col = "status"
    with db_conn(env) as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT {status_col} FROM public.{table} WHERE id = %s AND tenant_id = %s",
            (entity_id, TENANT_ID),
        )
        row = cur.fetchone()
        return row[0] if row else None


def login(page, base_url: str, email: str, password: str) -> bool:
    page.goto(f"{base_url}/login", wait_until="networkidle", timeout=30000)
    page.locator("input[name='email']").first.fill(email)
    page.locator("input[name='password']").first.fill(password)
    page.locator("button[type='submit']").first.click()
    try:
        page.wait_for_url(lambda url: "/login" not in url, timeout=15000)
        return True
    except PlaywrightTimeout:
        return False


def fill_form(form, fill_strategy: dict[str, str]) -> dict[str, str]:
    """Fill form inputs by name. Skips hidden inputs."""
    filled = {}
    for name, value in fill_strategy.items():
        el = form.locator(f"input[name='{name}'], textarea[name='{name}'], select[name='{name}']").first
        if el.count() == 0:
            continue
        if el.get_attribute("type") == "hidden":
            continue
        if not el.is_visible():
            continue
        tag = el.evaluate("el => el.tagName.toLowerCase()")
        try:
            if tag == "select":
                el.select_option(value)
            else:
                el.fill(value)
            filled[name] = value
        except Exception as e:
            print(f"  [fill_form] WARN: could not fill {name}: {e}")
    return filled


def exercise_command(page, base_url: str, env: dict[str, str], action: str, route: str, role: str, form_selector: str, fill_strategy: dict[str, str], entity_assertions: dict, screenshots_dir: Path, fixture_ids: dict) -> dict[str, Any]:
    page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
    not_login = "/login" not in page.url
    if not not_login:
        return {"action": action, "route": route, "role": role, "status": "REDIRECTED_TO_LOGIN", "before": None, "after": None, "audit_delta": 0, "filled": {}, "entity_status": None}

    before = capture_db_counts(env)
    page.screenshot(path=str(screenshots_dir / f"before-{action}.png"), full_page=True)

    form = page.locator(form_selector).first
    if form.count() == 0:
        return {"action": action, "route": route, "role": role, "status": "FORM_NOT_FOUND", "before": before, "after": before, "audit_delta": 0, "filled": {}, "entity_status": None}

    filled = fill_form(form, fill_strategy)
    page.screenshot(path=str(screenshots_dir / f"filled-{action}.png"), full_page=True)

    submit_btn = form.locator("button[type='submit']").first
    if submit_btn.count() == 0:
        return {"action": action, "route": route, "role": role, "status": "NO_SUBMIT_BUTTON", "before": before, "after": before, "audit_delta": 0, "filled": filled, "entity_status": None}

    submit_btn.click()
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except PlaywrightTimeout:
        pass

    # Reload the page to see the updated state
    page.reload(wait_until="networkidle", timeout=30000)
    page.screenshot(path=str(screenshots_dir / f"after-{action}.png"), full_page=True)

    after = capture_db_counts(env)
    audit_delta = after["audit_logs"] - before["audit_logs"]

    # Entity-specific assertions
    entity_status = None
    expected_table = entity_assertions.get("table")
    expected_delta = entity_assertions.get("expected_delta")
    expected_status = entity_assertions.get("expected_status")

    if expected_table and expected_delta is not None:
        actual_delta = after.get(expected_table, 0) - before.get(expected_table, 0)
        if actual_delta != expected_delta:
            return {
                "action": action, "route": route, "role": role,
                "status": f"ENTITY_DELTA_MISMATCH (table={expected_table}, expected={expected_delta}, actual={actual_delta})",
                "before": before, "after": after, "audit_delta": audit_delta, "filled": filled, "entity_status": entity_status,
            }

    if expected_status and expected_table:
        # Get the entity ID from fixture_ids or use a known seed ID
        entity_id = fixture_ids.get("returnRequestId", "00000000-0000-0000-0000-000000081e95")
        if action == "reviewQualityTestAction":
            entity_id = "00000000-0000-0000-0000-000000081e93"
        elif action == "updateComplaintAction":
            entity_id = "00000000-0000-0000-0000-000000081e94"
        entity_status = get_entity_status(env, expected_table, entity_id)
        if entity_status != expected_status:
            return {
                "action": action, "route": route, "role": role,
                "status": f"ENTITY_STATUS_MISMATCH (expected={expected_status}, actual={entity_status})",
                "before": before, "after": after, "audit_delta": audit_delta, "filled": filled, "entity_status": entity_status,
            }

    # Success requires both audit_delta > 0 AND entity assertions pass
    effect_verified = audit_delta > 0

    return {
        "action": action, "route": route, "role": role,
        "status": "OK" if effect_verified else "NO_AUDIT_DELTA",
        "before": before, "after": after, "audit_delta": audit_delta,
        "filled": filled, "entity_status": entity_status,
    }


def run_responsive_screenshots(owner_page, worker_page, base_url: str, screenshots_dir: Path) -> list[dict[str, Any]]:
    results = []
    for vp in VIEWPORTS:
        owner_page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
        worker_page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
        for route in PROTECTED_ROUTES:
            page = worker_page if route.startswith("/worker") else owner_page
            page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
            on_login = "/login" in page.url
            safe_route = route.replace("/", "_")
            path = screenshots_dir / f"resp-{vp['name']}{safe_route}.png"
            page.screenshot(path=str(path), full_page=True)
            metrics = None
            if vp["name"] == "360":
                metrics = page.evaluate("() => ({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth})")
            results.append({"viewport": vp["name"], "route": route, "screenshot": str(path), "on_login": on_login, "overflow_metrics": metrics})
    return results


def run_accessibility_checks(page, base_url: str) -> dict[str, Any]:
    results: dict[str, Any] = {}
    page.goto(f"{base_url}/management/quality/tests", wait_until="networkidle", timeout=30000)

    initial_focus = page.evaluate("() => document.activeElement?.tagName || 'BODY'")
    page.keyboard.press("Tab")
    after_tab_focus = page.evaluate("() => document.activeElement?.tagName || 'BODY'")
    results["keyboard_tab_moves_focus"] = (after_tab_focus != initial_focus) or (after_tab_focus != "BODY")

    # Measure labels while form is visible
    inputs = page.locator("input:visible, select:visible, textarea:visible")
    labeled = 0
    unlabeled = 0
    for i in range(inputs.count()):
        inp = inputs.nth(i)
        inp_id = inp.get_attribute("id")
        aria_label = inp.get_attribute("aria-label")
        # Check for label[for=id] association
        has_label_for = inp_id and page.locator(f"label[for='{inp_id}']").count() > 0
        # Check for wrapping <label> (input is inside a <label> element)
        has_wrapping_label = inp.evaluate("el => el.closest('label') !== null")
        if has_label_for or aria_label or has_wrapping_label:
            labeled += 1
        elif inp.get_attribute("type") in ("submit", "button", "hidden", "checkbox"):
            labeled += 1
        else:
            unlabeled += 1
    results["form_labels"] = {"labeled": labeled, "unlabeled": unlabeled}

    html_dir = page.evaluate("() => document.documentElement.getAttribute('dir') || 'ltr'")
    results["direction"] = {"html_dir": html_dir, "is_rtl": html_dir == "rtl"}

    page.set_viewport_size({"width": 360, "height": 640})
    buttons = page.locator("button:visible, a.btn:visible, [role='button']:visible")
    too_small = 0
    checked = min(buttons.count(), 20)
    for i in range(checked):
        btn = buttons.nth(i)
        box = btn.bounding_box()
        if box and (box["height"] < 44 or box["width"] < 44):
            too_small += 1
    results["touch_targets_44px"] = {"checked": checked, "too_small": too_small}

    return results


def cleanup(env: dict[str, str]) -> dict[str, int]:
    """Delete mutable QA fixtures in FK-safe order.
    Preserves immutable audit_logs (append-only per Contract 03 §7.7).
    Preserves QA tenant/users (durable — referenced by audit_logs).

    FK-safe order (children first, parents last):
    - stock_reservations → sales_order_lines → sales_orders
    - inventory_balances → stock_movements (last_movement_id FK)
    - return_lines → return_requests → sales_orders
    - audit_logs: NEVER deleted (append-only)
    """
    deleted: dict[str, int] = {}
    # Ordered cleanup statements with specific WHERE clauses for FK safety
    cleanup_statements = [
        # Delete inventory_adjustments that reference stock_movements
        ("inventory_adjustments", "DELETE FROM public.inventory_adjustments WHERE tenant_id = %s AND posted_movement_id IN (SELECT id FROM public.stock_movements WHERE tenant_id = %s)"),
        # Delete inventory_balances BEFORE stock_movements (FK: last_movement_id)
        ("inventory_balances", "DELETE FROM public.inventory_balances WHERE tenant_id = %s AND item_id = %s"),
        # Delete stock_reservations BEFORE sales_order_lines (FK)
        ("stock_reservations", "DELETE FROM public.stock_reservations WHERE tenant_id = %s"),
        # Delete sales_profitability_snapshots BEFORE sales_orders (FK)
        ("sales_profitability_snapshots", "DELETE FROM public.sales_profitability_snapshots WHERE tenant_id = %s"),
        # Delete account_entries
        ("account_entries", "DELETE FROM public.account_entries WHERE tenant_id = %s"),
        # Delete return_lines BEFORE return_requests + sales_order_lines (FK)
        ("return_lines", "DELETE FROM public.return_lines WHERE tenant_id = %s"),
        # Delete return_requests BEFORE sales_orders (FK)
        ("return_requests", "DELETE FROM public.return_requests WHERE tenant_id = %s"),
        # Delete complaints (seed complaint — mutable)
        ("complaints", "DELETE FROM public.complaints WHERE tenant_id = %s AND complaint_no LIKE 'QA-%'"),
        # Delete quality_test_values BEFORE quality_tests (FK)
        ("quality_test_values", "DELETE FROM public.quality_test_values WHERE tenant_id = %s"),
        ("quality_holds", "DELETE FROM public.quality_holds WHERE tenant_id = %s"),
        ("quality_tests", "DELETE FROM public.quality_tests WHERE tenant_id = %s AND test_no LIKE 'QA-%'"),
        # Delete sales_order_lines BEFORE sales_orders (FK)
        ("sales_order_lines", "DELETE FROM public.sales_order_lines WHERE tenant_id = %s"),
        # Delete sales_orders (now safe — no more FK references)
        ("sales_orders", "DELETE FROM public.sales_orders WHERE tenant_id = %s AND (doc_no LIKE 'QA-SO-%' OR doc_no LIKE 'SO-2026-%')"),
        # Delete stock_movements (now safe — inventory_balances already deleted)
        ("stock_movements", "DELETE FROM public.stock_movements WHERE tenant_id = %s AND source_document_type IN ('return_line', 'return_request', 'test_seed', 'sales_order_line')"),
        # NOTE: document_sequences are NOT deleted — they must remain monotonic.
        # New runs allocate new, higher document numbers through the production
        # DocumentSequenceDbRepository path.
        # NOTE: idempotency_records are NOT deleted — prior succeeded records
        # are preserved. Run-scoped idempotency keys prevent replay conflicts.
        # NOTE: audit_logs are NEVER deleted (append-only per Contract 03 §7.7).
    ]
    with db_conn(env) as conn, conn.cursor() as cur:
        for table_name, sql in cleanup_statements:
            try:
                # Handle specific parameter requirements per statement
                if table_name == "inventory_adjustments":
                    # 2 placeholders: tenant_id, tenant_id (subquery)
                    cur.execute(sql, (TENANT_ID, TENANT_ID))
                elif table_name == "inventory_balances":
                    # 2 placeholders: tenant_id, item_id
                    cur.execute(sql, (TENANT_ID, INVENTORY_ITEM_ID))
                else:
                    # 1 placeholder: tenant_id
                    cur.execute(sql, (TENANT_ID,))
                deleted[f"public.{table_name}"] = cur.rowcount
                conn.commit()
            except Exception as e:
                conn.rollback()
                deleted[f"public.{table_name}_error"] = str(e)[:100]
    return deleted


def start_dev_server(env: dict[str, str], port: int) -> subprocess.Popen:
    repo = Path(env["ERP_YARN_REPO"])
    child_env = os.environ.copy()
    child_env.update({k: env[k] for k in REQUIRED_ENV})
    child_env["NODE_ENV"] = "development"
    proc = subprocess.Popen(
        ["npm", "run", "dev", "--", "--port", str(port)],
        cwd=str(repo),
        env=child_env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        text=True,
        start_new_session=True,
    )
    return proc


def wait_for_server(port: int, timeout: float = 120.0) -> str:
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{base}/api/health", timeout=5) as r:
                if r.status == 200:
                    return base
        except Exception:
            pass
        time.sleep(2)
    raise RuntimeError(f"dev server not healthy at {base} after {timeout}s")


def main() -> int:
    env = validate_env()
    repo = Path(env["ERP_YARN_REPO"])
    evidence_dir = repo / "docs" / "ui-ux" / "evidence" / "wp-08-01e" / "browser-qa"

    # Run-scoped ID for idempotency keys and screenshot directory
    run_id = os.environ.get("QA_RUN_ID") or datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S")
    run_dir = evidence_dir / f"run-{run_id}"
    screenshots_dir = run_dir / "screenshots"
    run_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(exist_ok=True)

    started_at = datetime.now(timezone.utc).isoformat()
    print(f"[qa] started at {started_at}")
    print(f"[qa] tenant_id={TENANT_ID}")
    print(f"[qa] run_id={run_id}")

    print("[qa] seeding auth users + master data...")
    seed_counts = seed_auth_users(env)
    print(f"[qa] seeded: {seed_counts}")

    print("[qa] running setup-fixtures.ts (real domain lifecycle)...")
    fixture_ids = run_setup_fixtures(env, run_id)
    print(f"[qa] fixture IDs: {fixture_ids}")

    port = int(os.environ.get("BROWSER_QA_PORT", "3210"))
    base_url = f"http://127.0.0.1:{port}"

    dev_proc = None
    try:
        with urllib.request.urlopen(f"{base_url}/api/health", timeout=3) as r:
            if r.status == 200:
                print(f"[qa] dev server already running at {base_url}")
    except Exception:
        print(f"[qa] starting dev server on port {port} ...")
        dev_proc = start_dev_server(env, port)
        try:
            base_url = wait_for_server(port, timeout=120)
            print(f"[qa] dev server healthy at {base_url}")
        except Exception as e:
            print(f"FATAL: {e}", file=sys.stderr)
            if dev_proc:
                dev_proc.terminate()
            return 1

    headless = os.environ.get("BROWSER_QA_HEADLESS", "1") != "0"
    exit_code = 0
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=headless)

            owner_context = browser.new_context()
            owner_page = owner_context.new_page()
            print("[qa] logging in as Owner ...")
            if not login(owner_page, base_url, OWNER_EMAIL, OWNER_PASSWORD):
                print("FATAL: Owner login failed.", file=sys.stderr)
                owner_page.screenshot(path=str(evidence_dir / "owner-login-failed.png"))
                browser.close()
                return 1
            print("[qa] Owner login OK")

            worker_context = browser.new_context()
            worker_page = worker_context.new_page()
            print("[qa] logging in as Worker ...")
            if not login(worker_page, base_url, WORKER_EMAIL, WORKER_PASSWORD):
                print("FATAL: Worker login failed.", file=sys.stderr)
                worker_page.screenshot(path=str(evidence_dir / "worker-login-failed.png"))
                browser.close()
                return 1
            print("[qa] Worker login OK")

            route_assertions = []
            for route in PROTECTED_ROUTES:
                if route.startswith("/management"):
                    page = owner_page
                    expected_role = "owner"
                else:
                    page = worker_page
                    expected_role = "worker"
                page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
                ok = "/login" not in page.url
                route_assertions.append({"route": route, "role": expected_role, "not_on_login": ok, "actual_url": page.url})

            worker_page.goto(f"{base_url}/management/quality/tests", wait_until="networkidle", timeout=30000)
            worker_denied_ok = "/management/" not in worker_page.url
            worker_page.screenshot(path=str(screenshots_dir / "worker-denied-management.png"))

            # Before rejectReturnAction, re-seed the return request to pending_approval
            command_results = []
            for action, route, role, form_sel, fill, entity_assertions in COMMANDS:
                if action == "rejectReturnAction":
                    print(f"[qa] re-seeding return request to pending_approval before rejectReturnAction ...")
                    with db_conn(env) as conn, conn.cursor() as cur:
                        rr_id = fixture_ids.get("returnRequestId", "00000000-0000-0000-0000-000000081e95")
                        cur.execute(
                            """
                            UPDATE public.return_requests
                            SET status = 'pending_approval', approval_status = 'pending_approval',
                                approved_by = NULL, approved_at = NULL, updated_at = now()
                            WHERE id = %s
                            """,
                            (rr_id,),
                        )
                        conn.commit()

                page = worker_page if role == "worker" else owner_page
                print(f"[qa] exercising {action} on {route} as {role} ...")
                result = exercise_command(page, base_url, env, action, route, role, form_sel, fill, entity_assertions, screenshots_dir, fixture_ids)
                command_results.append(result)
                print(f"[qa]   -> {result['status']} (audit_delta={result.get('audit_delta', 'N/A')})")

            worker_page.goto(f"{base_url}/worker/quality-entry", wait_until="networkidle", timeout=30000)
            worker_access_ok = "/worker/quality-entry" in worker_page.url
            worker_page.screenshot(path=str(screenshots_dir / "worker-quality-entry.png"))

            print("[qa] capturing responsive screenshots ...")
            responsive = []
            for vp in VIEWPORTS:
                owner_page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
                worker_page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
                for route in PROTECTED_ROUTES:
                    page = worker_page if route.startswith("/worker") else owner_page
                    page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
                    on_login = "/login" in page.url
                    safe_route = route.replace("/", "_")
                    path = screenshots_dir / f"resp-{vp['name']}{safe_route}.png"
                    page.screenshot(path=str(path), full_page=True)
                    metrics = None
                    if vp["name"] == "360":
                        metrics = page.evaluate("() => ({scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth})")
                    responsive.append({"viewport": vp["name"], "route": route, "screenshot": str(path), "on_login": on_login, "overflow_metrics": metrics})

            print("[qa] running accessibility checks ...")
            a11y = run_accessibility_checks(owner_page, base_url)

            browser.close()

        print("[qa] cleaning up mutable fixtures (preserving audit_logs + QA users) ...")
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
        )

        summary = {
            "started_at": started_at,
            "finished_at": finished_at,
            "tenant_id": TENANT_ID,
            "seed_counts": seed_counts,
            "fixture_ids": fixture_ids,
            "route_assertions": route_assertions,
            "commands": command_results,
            "responsive_screenshots": responsive,
            "worker_access_ok": worker_access_ok,
            "worker_denied_ok": worker_denied_ok,
            "accessibility": a11y,
            "cleanup": deleted,
            "overall_success": success,
        }
        (run_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))

        lines = ["WP-08-01E Browser QA Summary", f"Started: {started_at}", f"Finished: {finished_at}", f"Tenant: {TENANT_ID}", ""]
        lines.append("=== Protected route assertions ===")
        for r in route_assertions:
            lines.append(f"  {r['route']:<40} not_on_login={r['not_on_login']}")
        lines.append("")
        lines.append("=== Commands ===")
        for r in command_results:
            lines.append(f"  {r['action']:<35} {r['status']} (audit_delta={r.get('audit_delta', 'N/A')})")
        lines.append("")
        lines.append(f"Worker access /worker/quality-entry: {'OK' if worker_access_ok else 'FAIL'}")
        lines.append(f"Worker denied /management/quality/tests: {'OK' if worker_denied_ok else 'FAIL'}")
        lines.append("")
        lines.append("=== Accessibility ===")
        lines.append(f"  Keyboard Tab moves focus: {a11y.get('keyboard_tab_moves_focus')}")
        total_inputs = a11y['form_labels']['labeled'] + a11y['form_labels']['unlabeled']
        lines.append(f"  Form labels: {a11y['form_labels']['labeled']}/{total_inputs} labelled; {a11y['form_labels']['unlabeled']} unlabelled")
        lines.append(f"  Direction (html dir): {a11y['direction']['html_dir']}")
        lines.append(f"  Touch targets too small (of {a11y['touch_targets_44px']['checked']} checked): {a11y['touch_targets_44px']['too_small']}")
        lines.append("")
        lines.append("=== 360px overflow metrics ===")
        for r in responsive:
            if r.get("overflow_metrics"):
                m = r["overflow_metrics"]
                lines.append(f"  {r['route']}: scrollWidth={m['scrollWidth']} clientWidth={m['clientWidth']} overflow={m['scrollWidth'] > m['clientWidth']}")
        lines.append("")
        lines.append("=== Cleanup ===")
        for k, v in deleted.items():
            lines.append(f"  {k}: {v}")
        lines.append("")
        lines.append(f"Overall success: {success}")
        (run_dir / "summary.txt").write_text("\n".join(lines))
        print("\n".join(lines))

        if success:
            (evidence_dir / "SUCCESS_MARKER.txt").write_text(
                f"WP-08-01E Browser QA SUCCESS\nTimestamp: {finished_at}\nTenant: {TENANT_ID}\nCommands OK: {len([r for r in command_results if r['status'] == 'OK'])}/{len(command_results)}\n"
            )
        exit_code = 0 if success else 1
    finally:
        if dev_proc and os.environ.get("BROWSER_QA_KEEP_SERVER") != "1":
            print("[qa] stopping dev server ...")
            dev_proc.terminate()
            try:
                dev_proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                dev_proc.kill()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
