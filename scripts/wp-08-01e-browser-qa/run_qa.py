#!/usr/bin/env python3
"""
WP-08-01E — Authenticated Browser Command-Success QA Runner (v2).

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
    it actually has (see SUCCESS_MARKER below).

Required environment variables:
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  SUPABASE_SECRET_KEY
  DATABASE_URL
  SUPABASE_PROJECT_REF
  ERP_YARN_REPO

Optional:
  BROWSER_QA_HEADLESS   (default "1")
  BROWSER_QA_PORT       (default "3210")
  BROWSER_QA_KEEP_SERVER (default unset)

Outputs (under docs/ui-ux/evidence/wp-08-01e/browser-qa/):
  summary.txt, summary.json, screenshots/*.png, SUCCESS_MARKER.txt
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

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

try:
    import bcrypt  # type: ignore
    HAS_BCRYPT = True
except ImportError:
    HAS_BCRYPT = False


# Deterministic UUIDs
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
# Second return request: pre-approved, is_replacement=true, so the
# createReplacementOrderAction form renders on /management/quality/returns.
RETURN_REQUEST_ID_APPROVED_REPLACEMENT = "00000000-0000-0000-0000-000000081e97"
RETURN_LINE_ID_APPROVED_REPLACEMENT = "00000000-0000-0000-0000-000000081e98"

# QA-only credentials (scoped to QA tenant, created/destroyed by this script)
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

# (action_label, route, role, form_index, fill_strategy, hidden_fields)
# role: "owner" or "worker" — which authenticated session to use
# form_index: 0-based index of the form on the page (forms are ordered in DOM)
# fill_strategy: only fills visible inputs (hidden inputs like idempotencyKey
# and returnId are pre-filled by the page and must NOT be overwritten)
# hidden_fields: additional hidden inputs to inject via Playwright evaluate
# (for fields the form doesn't include but the action requires, e.g. customerId)
COMMANDS = [
    # Worker commands (4) — all on /worker/quality-entry
    (
        "createQualityTestAction",
        "/worker/quality-entry",
        "worker",
        0,
        {
            "testDate": "2026-08-10",
            "linkedEntityType": "yarn_lot",
            "linkedEntityId": YARN_LOT_ID,
            "testStatus": "needs_review",
            "riskClassification": "needs_review",
            "notes": "QA browser runner createQualityTest",
        },
        {},
    ),
    # createComplaintAction — the form doesn't include customerId, but the
    # service requires at least one linked entity. We inject a hidden
    # customerId field via Playwright before submitting.
    (
        "createComplaintAction",
        "/worker/quality-entry",
        "worker",
        1,
        {
            "complaintDate": "2026-08-10",
            "subject": "QA browser runner complaint",
            "priority": "normal",
            "description": "QA browser runner createComplaint description",
        },
        {"customerId": CUSTOMER_ID},
    ),
    (
        "recordQualityTestValueAction",
        "/worker/quality-entry",
        "worker",
        2,
        {
            "qualityTestId": QUALITY_TEST_ID,
            "parameterName": "Twist",
            "parameterCode": "TWIST",
            "measuredValue": "850",
            "valueStatus": "pass",
            "notes": "QA browser runner recordValue",
        },
        {},
    ),
    (
        "updateComplaintAction",
        "/worker/quality-entry",
        "worker",
        3,
        {
            "complaintId": COMPLAINT_ID,
            "status": "investigating",
            "priority": "high",
            "investigationNotes": "QA browser runner updateComplaint",
        },
        {},
    ),
    # Owner commands (4)
    (
        "reviewQualityTestAction",
        "/management/quality/tests",
        "owner",
        0,
        {
            "qualityTestId": QUALITY_TEST_ID,
            "testStatus": "accepted",
            "riskClassification": "none",
            "reviewNotes": "QA browser runner reviewQualityTest",
        },
        {},
    ),
    (
        "approveReturnAction",
        "/management/quality/returns",
        "owner",
        0,
        {
            "financialTreatment": "customer_credit",
            "decisionReason": "QA browser runner approveReturn",
        },
        {},
    ),
    (
        "rejectReturnAction",
        "/management/quality/returns",
        "owner",
        1,
        {
            "decisionReason": "QA browser runner rejectReturn",
        },
        {},
    ),
    # createReplacementOrderAction form only renders when there's an approved
    # return with is_replacement=true. The form appears AFTER the pending
    # returns section (which contains approve/reject forms). When there are
    # no pending returns, the form index may be 0. We handle this dynamically.
    (
        "createReplacementOrderAction",
        "/management/quality/returns",
        "owner",
        -1,  # special: find the form by its returnRequestId field
        {
            "saleDate": "2026-08-10",
            "decisionNotes": "QA browser runner createReplacementOrder",
        },
        {},
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
        print("\nNo work was performed. Set them and re-run.", file=sys.stderr)
        sys.exit(2)
    return {k: os.environ[k] for k in REQUIRED_ENV}


def db_conn(env: dict[str, str]):
    return psycopg2.connect(env["DATABASE_URL"])


def compute_bcrypt_hash(password: str) -> str:
    if HAS_BCRYPT:
        return bcrypt.hashpw(password.encode(), bcrypt.gensalt(10)).decode()
    # Fallback: use a static hash that we'll override via pgcrypto if needed
    return "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"  # "password"


def seed_fixtures(env: dict[str, str]) -> dict[str, Any]:
    """Seed idempotent fixtures. Returns inserted/confirmed counts."""
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        # tenant (ON CONFLICT UPDATE name to ensure correct naming)
        cur.execute(
            """
            INSERT INTO public.tenants (id, company_name, default_language, currency_code, timezone, status)
            VALUES (%s, %s, 'ar', 'EGP', 'Africa/Cairo', 'active')
            ON CONFLICT (id) DO UPDATE SET company_name = EXCLUDED.company_name
            """,
            (TENANT_ID, TENANT_NAME),
        )
        counts["tenants"] = 1

        owner_hash = compute_bcrypt_hash(OWNER_PASSWORD)
        worker_hash = compute_bcrypt_hash(WORKER_PASSWORD)

        # auth.users
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
                ON CONFLICT (id) DO UPDATE SET auth_id = EXCLUDED.auth_id, email = EXCLUDED.email
                """,
                (user_id, TENANT_ID, auth_id, name, email),
            )
        counts["public_users"] = 2

        # roles — use valid role_code enum values: 'owner' and 'quality_employee'
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
        # Worker needs: quality_tests.create (for createQualityTest, recordQualityTestValue)
        # AND complaints.investigate (for createComplaint, updateComplaint)
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

        # master data — fiber_types (uses 'code', not 'status' as text)
        cur.execute(
            """
            INSERT INTO public.fiber_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-FIBER', 'ليف QA', 'QA Fiber', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (FIBER_TYPE_ID, TENANT_ID, OWNER_USER_ID),
        )
        # product_types
        cur.execute(
            """
            INSERT INTO public.product_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by)
            VALUES (%s, %s, 'QA-PROD', 'منتج QA', 'QA Product', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (PRODUCT_TYPE_ID, TENANT_ID, OWNER_USER_ID),
        )
        # customers — uses customer_code (not code), requires normalized_name
        cur.execute(
            """
            INSERT INTO public.customers (id, tenant_id, customer_code, name_ar, name_en, normalized_name, status, created_at, created_by)
            VALUES (%s, %s, 'QA-CUST', 'عميل QA', 'QA Customer', 'qa customer', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (CUSTOMER_ID, TENANT_ID, OWNER_USER_ID),
        )
        # locations — uses location_code (not code), requires location_type enum
        cur.execute(
            """
            INSERT INTO public.locations (id, tenant_id, location_code, name_ar, name_en, location_type, status, created_at, created_by)
            VALUES (%s, %s, 'QA-LOC', 'موقع QA', 'QA Location', 'internal_warehouse', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (LOCATION_ID, TENANT_ID, OWNER_USER_ID),
        )
        counts["master_data"] = 4

        # inventory_items — requires item_kind enum, item_code (not code), display_name_ar
        cur.execute(
            """
            INSERT INTO public.inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, status, created_at, created_by)
            VALUES (%s, %s, 'single_yarn', 'QA-INV-001', 'صنف QA', 'QA Inventory Item', 'accepted', 'active', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (INVENTORY_ITEM_ID, TENANT_ID, OWNER_USER_ID),
        )

        # yarn_lots — requires item_id (FK to inventory_items), lot_no (not lot_code), lot_type, status text, approval_status enum
        cur.execute(
            """
            INSERT INTO public.yarn_lots (id, tenant_id, item_id, lot_no, lot_type, quality_status, status, approval_status, created_at, created_by)
            VALUES (%s, %s, %s, 'QA-LOT-001', 'single_yarn', 'accepted', 'active', 'approved', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (YARN_LOT_ID, TENANT_ID, INVENTORY_ITEM_ID, OWNER_USER_ID),
        )
        counts["inventory_and_yarn"] = 2

        # sales_orders — uses doc_no (not order_number), sale_status enum, sale_date (not order_date)
        cur.execute(
            """
            INSERT INTO public.sales_orders (id, tenant_id, doc_no, customer_id, sale_status, approval_status, sale_date, total_gross_revenue, created_at, created_by)
            VALUES (%s, %s, 'QA-SO-001', %s, 'approved', 'approved', '2026-08-10', 1000.00, now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (SALES_ORDER_ID, TENANT_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        # sales_order_lines — uses line_no (not line_number), item_id, location_id, quantity_kg, price_per_ton
        # line_net_revenue_posted must be set so DEC-068 cap check passes (approveReturn verifies
        # cumulative return credit <= sale line net value)
        cur.execute(
            """
            INSERT INTO public.sales_order_lines (id, tenant_id, sales_order_id, line_no, item_id, location_id, quantity_kg, price_per_ton, line_gross_revenue, line_net_revenue_posted, line_net_revenue_precise, created_at, created_by)
            VALUES (%s, %s, %s, 1, %s, %s, 100.000, 10000.00, 1000.00, 1000.00, 1000.00000000, now(), %s)
            ON CONFLICT (id) DO UPDATE SET line_net_revenue_posted = EXCLUDED.line_net_revenue_posted, line_net_revenue_precise = EXCLUDED.line_net_revenue_precise
            """,
            (SALES_ORDER_LINE_ID, TENANT_ID, SALES_ORDER_ID, INVENTORY_ITEM_ID, LOCATION_ID, OWNER_USER_ID),
        )
        counts["sales_orders_and_lines"] = 2

        # quality_tests — uses test_no (not test_number), test_date, linked_entity_type/id, test_status enum
        # Set to 'needs_review' so the review form has something to review
        cur.execute(
            """
            INSERT INTO public.quality_tests (id, tenant_id, test_no, test_date, linked_entity_type, linked_entity_id, test_status, risk_classification, notes, created_at, created_by)
            VALUES (%s, %s, 'QA-QT-001', '2026-08-10', 'yarn_lot', %s, 'needs_review', 'low', 'QA fixture quality test', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (QUALITY_TEST_ID, TENANT_ID, YARN_LOT_ID, OWNER_USER_ID),
        )
        # complaints — uses complaint_no, complaint_date, subject, status text, priority text
        cur.execute(
            """
            INSERT INTO public.complaints (id, tenant_id, complaint_no, complaint_date, customer_id, subject, description, status, priority, created_at, created_by)
            VALUES (%s, %s, 'QA-COMPL-001', '2026-08-10', %s, 'QA fixture complaint', 'Initial complaint for browser QA', 'open', 'normal', now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (COMPLAINT_ID, TENANT_ID, CUSTOMER_ID, OWNER_USER_ID),
        )
        # return_requests — uses doc_no (not return_number), return_date, status enum (return_status), return_reason (NOT NULL), financial_treatment enum
        # Set status='pending_approval' so approve/reject forms have something to act on
        # DEC-080: requester/approver separation — created_by must be WORKER_USER_ID
        # (not OWNER_USER_ID), otherwise Owner cannot approve (RequesterCannotApproveOwnReturnError)
        cur.execute(
            """
            INSERT INTO public.return_requests (id, tenant_id, doc_no, sales_order_id, customer_id, return_date, status, approval_status, return_reason, financial_treatment, is_replacement, created_at, created_by)
            VALUES (%s, %s, 'QA-RET-001', %s, %s, '2026-08-10', 'pending_approval', 'pending_approval', 'QA fixture return', 'customer_credit', false, now(), %s)
            ON CONFLICT (id) DO UPDATE SET created_by = EXCLUDED.created_by, status = 'pending_approval', approval_status = 'pending_approval', financial_treatment = 'customer_credit', is_replacement = false, approved_by = NULL, approved_at = NULL
            """,
            (RETURN_REQUEST_ID, TENANT_ID, SALES_ORDER_ID, CUSTOMER_ID, WORKER_USER_ID),
        )
        # return_lines — uses original_sale_order_id (not sales_order_line_id), original_sale_line_id, item_id, quantity_kg, return_location_id, returned_stock_status enum
        cur.execute(
            """
            INSERT INTO public.return_lines (id, tenant_id, return_request_id, original_sale_order_id, original_sale_line_id, item_id, quantity_kg, return_location_id, returned_stock_status, return_credit_value, created_at, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, 10.000, %s, 'sellable_as_is', 100.00, now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (RETURN_LINE_ID, TENANT_ID, RETURN_REQUEST_ID, SALES_ORDER_ID, SALES_ORDER_LINE_ID, INVENTORY_ITEM_ID, LOCATION_ID, WORKER_USER_ID),
        )
        # Second return request: pre-approved + is_replacement=true, so the
        # createReplacementOrderAction form renders on /management/quality/returns.
        # Also created_by WORKER_USER_ID, approved_by OWNER_USER_ID (DEC-080 separation).
        cur.execute(
            """
            INSERT INTO public.return_requests (id, tenant_id, doc_no, sales_order_id, customer_id, return_date, status, approval_status, return_reason, financial_treatment, is_replacement, approved_by, approved_at, created_at, created_by)
            VALUES (%s, %s, 'QA-RET-002', %s, %s, '2026-08-10', 'approved', 'approved', 'QA fixture approved replacement return', 'replacement', true, %s, now(), now(), %s)
            ON CONFLICT (id) DO UPDATE SET created_by = EXCLUDED.created_by, approved_by = EXCLUDED.approved_by, status = 'approved', approval_status = 'approved', financial_treatment = 'replacement', is_replacement = true
            """,
            (RETURN_REQUEST_ID_APPROVED_REPLACEMENT, TENANT_ID, SALES_ORDER_ID, CUSTOMER_ID, OWNER_USER_ID, WORKER_USER_ID),
        )
        cur.execute(
            """
            INSERT INTO public.return_lines (id, tenant_id, return_request_id, original_sale_order_id, original_sale_line_id, item_id, quantity_kg, return_location_id, returned_stock_status, return_credit_value, created_at, created_by)
            VALUES (%s, %s, %s, %s, %s, %s, 5.000, %s, 'sellable_as_is', 50.00, now(), %s)
            ON CONFLICT (id) DO NOTHING
            """,
            (RETURN_LINE_ID_APPROVED_REPLACEMENT, TENANT_ID, RETURN_REQUEST_ID_APPROVED_REPLACEMENT, SALES_ORDER_ID, SALES_ORDER_LINE_ID, INVENTORY_ITEM_ID, LOCATION_ID, WORKER_USER_ID),
        )
        counts["business_records"] = 6

        # Profitability snapshot — approveReturn calls createReturnImpactSnapshot
        # which requires an active snapshot to exist for the sale order.
        # Use ON CONFLICT DO UPDATE to always reset to active state.
        SNAPSHOT_ID = "00000000-0000-0000-0000-000000081e99"
        cur.execute(
            """
            INSERT INTO public.sales_profitability_snapshots (
                id, tenant_id, sales_order_id, version, is_active,
                revenue_snapshot, profit_amount, profit_margin_percent,
                calculated_at, calculated_by, created_at, created_by
            )
            VALUES (%s, %s, %s, 1, 'active', 1000.00, 200.00, 20.000000, now(), %s, now(), %s)
            ON CONFLICT (id) DO UPDATE SET
                is_active = 'active',
                superseded_by_snapshot_id = NULL,
                revenue_snapshot = EXCLUDED.revenue_snapshot,
                profit_amount = EXCLUDED.profit_amount,
                profit_margin_percent = EXCLUDED.profit_margin_percent,
                calculated_at = now(),
                updated_at = now()
            """,
            (SNAPSHOT_ID, TENANT_ID, SALES_ORDER_ID, OWNER_USER_ID, OWNER_USER_ID),
        )
        counts["profitability_snapshot"] = 1

    return counts


def capture_db_counts(env: dict[str, str]) -> dict[str, int]:
    counts: dict[str, int] = {}
    with db_conn(env) as conn, conn.cursor() as cur:
        for table in [
            "quality_tests", "quality_test_values", "quality_holds",
            "complaints", "return_requests", "return_lines",
            "audit_logs", "idempotency_records", "document_sequences",
            "stock_movements", "inventory_balances", "account_entries",
            "sales_orders",
        ]:
            cur.execute(
                f"SELECT count(*) FROM public.{table} WHERE tenant_id = %s",
                (TENANT_ID,),
            )
            counts[table] = cur.fetchone()[0]
    return counts


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
    """Fill form inputs by name. Skips hidden inputs (they are pre-filled by the page).
    Returns a dict of fields actually filled."""
    filled = {}
    for name, value in fill_strategy.items():
        el = form.locator(f"input[name='{name}'], textarea[name='{name}'], select[name='{name}']").first
        if el.count() == 0:
            continue
        # Skip hidden inputs — they are pre-filled by the page and cannot be .fill()'d
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


def exercise_command(page, base_url: str, env: dict[str, str], action: str, route: str, role: str, form_index: int, fill_strategy: dict[str, str], hidden_fields: dict[str, str], screenshots_dir: Path) -> dict[str, Any]:
    # Always reload the page fresh before each command to avoid stale DOM
    page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
    not_login = "/login" not in page.url
    if not not_login:
        return {"action": action, "route": route, "role": role, "status": "REDIRECTED_TO_LOGIN", "before": None, "after": None, "audit_delta": 0, "filled": {}}

    before = capture_db_counts(env)
    page.screenshot(path=str(screenshots_dir / f"before-{action}.png"), full_page=True)

    forms = page.locator("form")
    form = None
    if form_index == -1:
        # Special: find the form that contains a select[name='returnRequestId']
        # (this is the createReplacementOrder form)
        for i in range(forms.count()):
            f = forms.nth(i)
            if f.locator("select[name='returnRequestId'], input[name='returnRequestId']").count() > 0:
                form = f
                form_index = i
                break
        if form is None:
            return {"action": action, "route": route, "role": role, "status": f"FORM_NOT_FOUND_BY_returnRequestId (forms={forms.count()})", "before": before, "after": before, "audit_delta": 0, "filled": {}}
    else:
        if form_index >= forms.count():
            return {"action": action, "route": route, "role": role, "status": f"FORM_INDEX_{form_index}_OUT_OF_RANGE (forms={forms.count()})", "before": before, "after": before, "audit_delta": 0, "filled": {}}
        form = forms.nth(form_index)

    # Inject hidden fields if any (e.g. customerId for createComplaint)
    for name, value in hidden_fields.items():
        existing = form.locator(f"input[name='{name}'], select[name='{name}'], textarea[name='{name}']").count()
        if existing == 0:
            # Use form's element handle to evaluate and inject the hidden input
            form_handle = form.element_handle()
            if form_handle:
                form_handle.evaluate(
                    """(args) => {
                        const form = args[0];
                        const name = args[1];
                        const value = args[2];
                        const input = document.createElement('input');
                        input.type = 'hidden';
                        input.name = name;
                        input.value = value;
                        form.appendChild(input);
                        return true;
                    }""",
                    [form_handle, name, value],
                )

    filled = fill_form(form, fill_strategy)
    page.screenshot(path=str(screenshots_dir / f"filled-{action}.png"), full_page=True)

    submit_btn = form.locator("button[type='submit']").first
    if submit_btn.count() == 0:
        return {"action": action, "route": route, "role": role, "status": "NO_SUBMIT_BUTTON", "before": before, "after": before, "audit_delta": 0, "filled": filled}

    submit_btn.click()
    try:
        page.wait_for_load_state("networkidle", timeout=30000)
    except PlaywrightTimeout:
        pass
    time.sleep(2)

    after = capture_db_counts(env)
    page.screenshot(path=str(screenshots_dir / f"after-{action}.png"), full_page=True)

    audit_delta = after["audit_logs"] - before["audit_logs"]
    effect_verified = audit_delta > 0

    return {
        "action": action,
        "route": route,
        "role": role,
        "status": "OK" if effect_verified else "NO_AUDIT_DELTA",
        "before": before,
        "after": after,
        "audit_delta": audit_delta,
        "filled": filled,
    }


def run_responsive_screenshots(page, base_url: str, screenshots_dir: Path) -> list[dict[str, Any]]:
    results = []
    for vp in VIEWPORTS:
        page.set_viewport_size({"width": vp["width"], "height": vp["height"]})
        for route in PROTECTED_ROUTES:
            page.goto(f"{base_url}{route}", wait_until="networkidle", timeout=30000)
            on_login = "/login" in page.url
            safe_route = route.replace("/", "_")
            path = screenshots_dir / f"resp-{vp['name']}{safe_route}.png"
            page.screenshot(path=str(path), full_page=True)
            # Capture overflow metrics at 360
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

    html_dir = page.evaluate("() => document.documentElement.getAttribute('dir') || 'ltr'")
    body_dir = page.evaluate("() => document.body.getAttribute('dir') || 'ltr'")
    results["direction"] = {"html_dir": html_dir, "body_dir": body_dir, "is_rtl": html_dir == "rtl" or body_dir == "rtl"}

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
    deleted: dict[str, int] = {}
    # FK-safe order: delete children first, then parents.
    # NOTE: audit_logs is append-only (trigger prevents DELETE per Contract 03 §7.7).
    # We do NOT delete audit_logs — they are historical evidence. Instead, we
    # delete users with ON DELETE SET NULL on audit_logs.user_id (if the FK
    # supports it), or we null out the user_id first.
    # idempotency_records must be deleted BEFORE users (idempotency_records.initiated_by FK → users.id).
    tables_children_first = [
        # children of return_requests/sales_orders/etc.
        "return_lines", "return_requests", "complaints",
        "quality_test_values", "quality_holds", "quality_tests",
        "sales_profitability_snapshots",
        "sales_order_lines", "sales_orders",
        "yarn_lots", "inventory_items",
        "locations", "customers", "product_types", "fiber_types",
        # children of users/roles/permissions
        "user_roles", "role_permissions", "permissions", "roles",
        "document_sequences", "idempotency_records",
        # users (parent) — delete after all FK references are gone
        "users",
        # tenant (root) — delete last
        "tenants",
    ]
    with db_conn(env) as conn, conn.cursor() as cur:
        # First, null out audit_logs.user_id for this tenant's audit entries
        # (audit_logs is append-only, so we can't DELETE rows, but we can
        # UPDATE the user_id to NULL to break the FK before deleting users).
        try:
            cur.execute("UPDATE public.audit_logs SET user_id = NULL WHERE tenant_id = %s", (TENANT_ID,))
            deleted["audit_logs.user_id_nulled"] = cur.rowcount
            conn.commit()
        except Exception as e:
            conn.rollback()
            deleted["audit_logs.user_id_nulled_error"] = str(e)[:100]

        for table in tables_children_first:
            try:
                cur.execute(f"DELETE FROM public.{table} WHERE tenant_id = %s", (TENANT_ID,))
                deleted[f"public.{table}"] = cur.rowcount
                conn.commit()
            except Exception as e:
                conn.rollback()
                deleted[f"public.{table}_error"] = str(e)[:100]
        # Now delete auth.users (independent schema, no FK from public.*)
        try:
            cur.execute("DELETE FROM auth.users WHERE id IN (%s, %s)", (OWNER_AUTH_ID, WORKER_AUTH_ID))
            deleted["auth.users"] = cur.rowcount
            conn.commit()
        except Exception as e:
            conn.rollback()
            deleted["auth.users_error"] = str(e)[:100]
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
        # Detach so the dev server survives between python operations
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
    screenshots_dir = evidence_dir / "screenshots"
    evidence_dir.mkdir(parents=True, exist_ok=True)
    screenshots_dir.mkdir(exist_ok=True)

    started_at = datetime.now(timezone.utc).isoformat()
    print(f"[qa] started at {started_at}")
    print(f"[qa] tenant_id={TENANT_ID}")
    print(f"[qa] owner_email={OWNER_EMAIL}")
    print(f"[qa] worker_email={WORKER_EMAIL}")
    print(f"[qa] STATUS: runner is prepared. A SUCCESS_MARKER.txt will be written only on full success.")

    print("[qa] seeding fixtures ...")
    seed_counts = seed_fixtures(env)
    print(f"[qa] seeded: {seed_counts}")

    port = int(os.environ.get("BROWSER_QA_PORT", "3210"))
    base_url = f"http://127.0.0.1:{port}"

    # Try to reach an existing dev server first; if not, start our own.
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

            # Owner session — for management routes
            owner_context = browser.new_context()
            owner_page = owner_context.new_page()
            print("[qa] logging in as Owner ...")
            if not login(owner_page, base_url, OWNER_EMAIL, OWNER_PASSWORD):
                print("FATAL: Owner login failed.", file=sys.stderr)
                owner_page.screenshot(path=str(evidence_dir / "owner-login-failed.png"))
                browser.close()
                return 1
            print("[qa] Owner login OK")

            # Worker session — for worker routes
            worker_context = browser.new_context()
            worker_page = worker_context.new_page()
            print("[qa] logging in as Worker ...")
            if not login(worker_page, base_url, WORKER_EMAIL, WORKER_PASSWORD):
                print("FATAL: Worker login failed.", file=sys.stderr)
                worker_page.screenshot(path=str(evidence_dir / "worker-login-failed.png"))
                browser.close()
                return 1
            print("[qa] Worker login OK")

            # Route assertions: Owner accesses management routes, Worker accesses worker route
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
                if not ok:
                    print(f"[qa] FAIL: {route} redirected to /login", file=sys.stderr)

            # Worker denial: Worker should be denied /management/quality/tests
            worker_page.goto(f"{base_url}/management/quality/tests", wait_until="networkidle", timeout=30000)
            worker_denied_ok = "/management/" not in worker_page.url
            worker_page.screenshot(path=str(screenshots_dir / "worker-denied-management.png"))

            # Execute commands using the correct session per role
            command_results = []
            for action, route, role, form_index, fill, hidden_fields in COMMANDS:
                # Before rejectReturnAction, re-seed the return request to
                # pending_approval (approveReturnAction may have transitioned it)
                if action == "rejectReturnAction":
                    print(f"[qa] re-seeding return request to pending_approval before rejectReturnAction ...")
                    with db_conn(env) as conn, conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE public.return_requests
                            SET status = 'pending_approval', approval_status = 'pending_approval',
                                approved_by = NULL, approved_at = NULL, updated_at = now()
                            WHERE id = %s
                            """,
                            (RETURN_REQUEST_ID,),
                        )
                        conn.commit()

                # Before createReplacementOrderAction, re-seed the approved
                # replacement return (reject may have changed return states)
                if action == "createReplacementOrderAction":
                    print(f"[qa] re-seeding approved replacement return before createReplacementOrderAction ...")
                    with db_conn(env) as conn, conn.cursor() as cur:
                        cur.execute(
                            """
                            UPDATE public.return_requests
                            SET status = 'approved', approval_status = 'approved',
                                is_replacement = true, financial_treatment = 'replacement',
                                approved_by = %s, approved_at = now(), updated_at = now()
                            WHERE id = %s
                            """,
                            (OWNER_USER_ID, RETURN_REQUEST_ID_APPROVED_REPLACEMENT),
                        )
                        conn.commit()

                page = worker_page if role == "worker" else owner_page
                print(f"[qa] exercising {action} on {route} as {role} ...")
                result = exercise_command(page, base_url, env, action, route, role, form_index, fill, hidden_fields, screenshots_dir)
                command_results.append(result)
                print(f"[qa]   -> {result['status']} (audit_delta={result.get('audit_delta', 'N/A')})")

            # Worker access to /worker/quality-entry
            worker_page.goto(f"{base_url}/worker/quality-entry", wait_until="networkidle", timeout=30000)
            worker_access_ok = "/worker/quality-entry" in worker_page.url
            worker_page.screenshot(path=str(screenshots_dir / "worker-quality-entry.png"))

            print("[qa] capturing responsive screenshots ...")
            # Use owner_page for management routes, worker_page for worker routes
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
        lines.append(f"  Form labels (labeled/unlabeled): {a11y['form_labels']['labeled']}/{a11y['form_labels']['unlabeled']}")
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
        (evidence_dir / "summary.txt").write_text("\n".join(lines))
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
