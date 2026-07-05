-- WP-02-06 Manual Backup (sanitized)
-- Timestamp: 2026-07-05T19:09:14.368Z
-- Migration: unknown
-- Source: public schema (tenant b0206c0a-0002-4000-8000-000000000001)
-- Method: Logical export via SELECT + sanitized SQL INSERT generation (postgres.js). pg_dump not available in environment.

SET session_replication_role = replica;

-- Table: tenants (1 rows)
INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status, terminology_version, created_at, updated_at) VALUES ('b0206c0a-0002-4000-8000-000000000001', 'WP0206 Restore Smoke Tenant 560964', 'ar', 'EGP', 'Africa/Cairo', 'active', 'v1', '2026-07-05T19:09:21.060Z', NULL);

-- Table: users (2 rows)
INSERT INTO users (id, tenant_id, auth_id, name, email, phone, status, language_preference, last_login_at, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0002-4000-8000-000000000101', 'b0206c0a-0002-4000-8000-000000000001', 'wp0206-req-560964', 'WP0206 Requester', 'wp0206-req-560964.local@example.com', NULL, 'active', 'ar', NULL, '2026-07-05T19:09:21.459Z', NULL, NULL, NULL);
INSERT INTO users (id, tenant_id, auth_id, name, email, phone, status, language_preference, last_login_at, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0002-4000-8000-000000000201', 'b0206c0a-0002-4000-8000-000000000001', 'wp0206-owner-560964', 'WP0206 Owner', 'wp0206-owner-560964.local@example.com', NULL, 'active', 'ar', NULL, '2026-07-05T19:09:21.858Z', NULL, NULL, NULL);

-- Table: suppliers (1 rows)
INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, contact_info_json, status, notes, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0001-4000-8000-000000000301', 'b0206c0a-0002-4000-8000-000000000001', 'WP0206-RESTORE-SMOKE-SUP-560964', 'مورد WP0206', NULL, 'wp0206 supplier 560964', NULL, 'active', NULL, '2026-07-05T19:09:22.258Z', 'b0206c0a-0002-4000-8000-000000000101', NULL, NULL);

-- Table: locations (1 rows)
INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, address, related_factory_id, status, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0001-4000-8000-000000000401', 'b0206c0a-0002-4000-8000-000000000001', 'WP0206-RESTORE-SMOKE-LOC-560964', 'مخزن WP0206', NULL, 'internal_warehouse', NULL, NULL, 'active', '2026-07-05T19:09:22.657Z', 'b0206c0a-0002-4000-8000-000000000101', NULL, NULL);

-- Table: fiber_types (1 rows)
INSERT INTO fiber_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0001-4000-8000-000000000501', 'b0206c0a-0002-4000-8000-000000000001', 'WP0206-RESTORE-SMOKE-FT-560964', 'قطن WP0206', NULL, 'active', '2026-07-05T19:09:23.058Z', 'b0206c0a-0002-4000-8000-000000000101', NULL, NULL);

-- Table: inventory_items (1 rows)
INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_at, created_by, updated_at, updated_by) VALUES ('1b5ed45b-957d-48f9-872d-4874a4d70d6e', 'b0206c0a-0002-4000-8000-000000000001', 'raw_material', 'WP0206-RESTORE-SMOKE-BATCH-560964', 'قطن WP0206', NULL, 'accepted', FALSE, 'active', '2026-07-05T19:09:23.457Z', 'b0206c0a-0002-4000-8000-000000000101', NULL, NULL);

-- Table: raw_material_batches (1 rows)
INSERT INTO raw_material_batches (id, tenant_id, item_id, batch_no, supplier_id, supplier_reference, fiber_type_id, origin_country, season, bales_count, gross_weight_kg, net_weight_kg, purchase_price_per_ton, total_purchase_cost, received_date, status, approval_status, record_origin, record_period, is_locked, import_batch_id, created_at, created_by, updated_at, updated_by, storage_location_id, purchase_order_ref, notes) VALUES ('0e31435f-362b-408a-a526-739f3bae92d2', 'b0206c0a-0002-4000-8000-000000000001', '1b5ed45b-957d-48f9-872d-4874a4d70d6e', 'WP0206-RESTORE-SMOKE-BATCH-560964', 'b0206c0a-0001-4000-8000-000000000301', NULL, 'b0206c0a-0001-4000-8000-000000000501', 'السودان', '2024/2025', '25.000', '1250.000', '1000.000', NULL, NULL, '2026-07-06T00:00:00.000Z', 'approved', 'approved', 'manual_live', 'live', FALSE, NULL, '2026-07-05T19:09:23.857Z', 'b0206c0a-0002-4000-8000-000000000101', NULL, NULL, 'b0206c0a-0001-4000-8000-000000000401', 'PR-WP0206-560964', 'WP0206 restore smoke fixture');

-- Table: stock_movements (1 rows)
INSERT INTO stock_movements (id, tenant_id, doc_no, movement_type, movement_status, item_id, from_location_id, to_location_id, quantity_kg, movement_date, source_document_type, source_document_id, approval_request_id, reversal_of_movement_id, idempotency_key, record_origin, record_period, import_batch_id, notes, created_by, posted_by, posted_at, created_at, updated_at, updated_by) VALUES ('af486c69-a13d-43b8-aa35-ebb523db3dd6', 'b0206c0a-0002-4000-8000-000000000001', 'RC-2026-WP0206-560964', 'raw_receipt', 'posted', '1b5ed45b-957d-48f9-872d-4874a4d70d6e', NULL, 'b0206c0a-0001-4000-8000-000000000401', '1000.000', '2026-07-06T00:00:00.000Z', 'raw_material_batch', '0e31435f-362b-408a-a526-739f3bae92d2', NULL, NULL, 'wp0206-restore-smoke-560964', 'manual_live', 'live', NULL, NULL, NULL, 'b0206c0a-0002-4000-8000-000000000201', '2026-07-05T19:09:24.257Z', '2026-07-05T19:09:24.257Z', NULL, NULL);

-- Table: inventory_balances (1 rows)
INSERT INTO inventory_balances (id, tenant_id, item_id, location_id, on_hand_qty_kg, reserved_qty_kg, blocked_qty_kg, returned_qty_kg, last_movement_id, version, updated_at, updated_by, created_at) VALUES ('622f23a2-df73-4551-af04-2cbca802ae89', 'b0206c0a-0002-4000-8000-000000000001', '1b5ed45b-957d-48f9-872d-4874a4d70d6e', 'b0206c0a-0001-4000-8000-000000000401', '1000.000', '0.000', '0.000', '0.000', 'af486c69-a13d-43b8-aa35-ebb523db3dd6', 1, NULL, NULL, '2026-07-05T19:09:24.656Z');

-- Table: accounts (1 rows)
INSERT INTO accounts (id, tenant_id, owner_type, owner_id, currency, status, created_at, created_by, updated_at, updated_by) VALUES ('370edef1-9816-4907-8732-719ff036b16b', 'b0206c0a-0002-4000-8000-000000000001', 'supplier', 'b0206c0a-0001-4000-8000-000000000301', 'EGP', 'active', '2026-07-05T19:09:25.057Z', 'b0206c0a-0002-4000-8000-000000000201', NULL, NULL);

-- Table: account_entries (1 rows)
INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, reversal_of_entry_id, notes, record_origin, record_period, import_batch_id, created_at, created_by) VALUES ('bf394da6-904e-4a2d-b2d3-6569d4eb1436', 'b0206c0a-0002-4000-8000-000000000001', '370edef1-9816-4907-8732-719ff036b16b', 'AE-2026-WP0206-560964', '2026-07-06T00:00:00.000Z', '-80.00', 'EGP', 'supplier_raw_payable', 'raw_material_batch', '0e31435f-362b-408a-a526-739f3bae92d2', 'unsettled', NULL, NULL, 'manual_live', 'live', NULL, '2026-07-05T19:09:25.456Z', 'b0206c0a-0002-4000-8000-000000000201');

-- Table: approval_requests (1 rows)
INSERT INTO approval_requests (id, tenant_id, request_type, entity_type, entity_id, risk_level, requested_by, requested_at, reason, state, decided_by, decided_at, decision_notes, idempotency_key, subject_version, subject_hash, submitted_child_version_summary, invalidated_by, invalidated_at, invalidation_reason, superseding_request_id, created_at, created_by, updated_at, updated_by) VALUES ('31a3a0e7-69d5-4459-9b99-3f3b7fdc44cf', 'b0206c0a-0002-4000-8000-000000000001', 'raw_receipt_approval', 'raw_receipt_draft', '0e31435f-362b-408a-a526-739f3bae92d2', 'high', 'b0206c0a-0002-4000-8000-000000000101', '2026-07-05T19:09:25.855Z', 'WP0206 restore smoke', 'decided', 'b0206c0a-0002-4000-8000-000000000201', NULL, NULL, NULL, 1, 'wp0206-subject-hash-placeholder-0000000000000000000000000000000000000000000000000000000000000000', '{"movementId":"af486c69-a13d-43b8-aa35-ebb523db3dd6","payableDeferred":false}', NULL, NULL, NULL, NULL, '2026-07-05T19:09:25.855Z', NULL, NULL, NULL);

SET session_replication_role = DEFAULT;
