-- WP-02-06 True Separate-Target Restore Backup (sanitized)
-- Timestamp: 2026-07-06T09:47:28.841Z
-- Method: logical export via postgres.js

SET session_replication_role = replica;

-- tenants (1 rows)
INSERT INTO tenants (id, company_name, default_language, currency_code, timezone, status, terminology_version, created_at, updated_at) VALUES ('b0206c0a-0004-4000-8000-000000000001', 'WP0206 True Restore 235483', 'ar', 'EGP', 'Africa/Cairo', 'active', 'v1', '2026-07-06T09:47:20.916Z', NULL);

-- users (2 rows)
INSERT INTO users (id, tenant_id, auth_id, name, email, phone, status, language_preference, last_login_at, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0004-4000-8000-000000000101', 'b0206c0a-0004-4000-8000-000000000001', 'wp0206-tr-req-235483', 'WP0206 True Req', 'wp0206-tr-req-235483.local@example.com', NULL, 'active', 'ar', NULL, '2026-07-06T09:47:21.332Z', NULL, NULL, NULL);
INSERT INTO users (id, tenant_id, auth_id, name, email, phone, status, language_preference, last_login_at, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0004-4000-8000-000000000201', 'b0206c0a-0004-4000-8000-000000000001', 'wp0206-tr-owner-235483', 'WP0206 True Owner', 'wp0206-tr-owner-235483.local@example.com', NULL, 'active', 'ar', NULL, '2026-07-06T09:47:21.743Z', NULL, NULL, NULL);

-- suppliers (1 rows)
INSERT INTO suppliers (id, tenant_id, supplier_code, name_ar, name_en, normalized_name, contact_info_json, status, notes, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0004-4000-8000-000000000301', 'b0206c0a-0004-4000-8000-000000000001', 'WP0206-TRUE-RESTORE-SUP-235483', 'مورد', NULL, 'wp0206 true sup 235483', NULL, 'active', NULL, '2026-07-06T09:47:22.154Z', 'b0206c0a-0004-4000-8000-000000000101', NULL, NULL);

-- locations (1 rows)
INSERT INTO locations (id, tenant_id, location_code, name_ar, name_en, location_type, address, related_factory_id, status, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0004-4000-8000-000000000401', 'b0206c0a-0004-4000-8000-000000000001', 'WP0206-TRUE-RESTORE-LOC-235483', 'مخزن', NULL, 'internal_warehouse', NULL, NULL, 'active', '2026-07-06T09:47:22.565Z', 'b0206c0a-0004-4000-8000-000000000101', NULL, NULL);

-- fiber_types (1 rows)
INSERT INTO fiber_types (id, tenant_id, code, name_ar, name_en, status, created_at, created_by, updated_at, updated_by) VALUES ('b0206c0a-0004-4000-8000-000000000501', 'b0206c0a-0004-4000-8000-000000000001', 'WP0206-TRUE-RESTORE-FT-235483', 'قطن', NULL, 'active', '2026-07-06T09:47:22.977Z', 'b0206c0a-0004-4000-8000-000000000101', NULL, NULL);

-- inventory_items (1 rows)
INSERT INTO inventory_items (id, tenant_id, item_kind, item_code, display_name_ar, display_name_en, quality_status, is_blocked, status, created_at, created_by, updated_at, updated_by) VALUES ('95ae69f9-88bb-459c-b731-8b05d6aa2b68', 'b0206c0a-0004-4000-8000-000000000001', 'raw_material', 'WP0206-TRUE-RESTORE-BATCH-235483', 'قطن', NULL, 'accepted', FALSE, 'active', '2026-07-06T09:47:23.388Z', 'b0206c0a-0004-4000-8000-000000000101', NULL, NULL);

-- raw_material_batches (1 rows)
INSERT INTO raw_material_batches (id, tenant_id, item_id, batch_no, supplier_id, supplier_reference, fiber_type_id, origin_country, season, bales_count, gross_weight_kg, net_weight_kg, purchase_price_per_ton, total_purchase_cost, received_date, status, approval_status, record_origin, record_period, is_locked, import_batch_id, created_at, created_by, updated_at, updated_by, storage_location_id, purchase_order_ref, notes) VALUES ('caaf5034-37f1-463c-b2a0-c1f52c418f97', 'b0206c0a-0004-4000-8000-000000000001', '95ae69f9-88bb-459c-b731-8b05d6aa2b68', 'WP0206-TRUE-RESTORE-BATCH-235483', 'b0206c0a-0004-4000-8000-000000000301', NULL, 'b0206c0a-0004-4000-8000-000000000501', 'السودان', '2024/2025', '25.000', '1250.000', '1000.000', NULL, NULL, '2026-07-06T00:00:00.000Z', 'approved', 'approved', 'manual_live', 'live', FALSE, NULL, '2026-07-06T09:47:23.800Z', 'b0206c0a-0004-4000-8000-000000000101', NULL, NULL, 'b0206c0a-0004-4000-8000-000000000401', 'PR-WP0206TR-235483', 'fixture');

-- stock_movements (1 rows)
INSERT INTO stock_movements (id, tenant_id, doc_no, movement_type, movement_status, item_id, from_location_id, to_location_id, quantity_kg, movement_date, source_document_type, source_document_id, approval_request_id, reversal_of_movement_id, idempotency_key, record_origin, record_period, import_batch_id, notes, created_by, posted_by, posted_at, created_at, updated_at, updated_by) VALUES ('7b84f288-b7d7-4c49-84c7-2a1e83ac711c', 'b0206c0a-0004-4000-8000-000000000001', 'RC-2026-TR-235483', 'raw_receipt', 'posted', '95ae69f9-88bb-459c-b731-8b05d6aa2b68', NULL, 'b0206c0a-0004-4000-8000-000000000401', '1000.000', '2026-07-06T00:00:00.000Z', 'raw_material_batch', 'caaf5034-37f1-463c-b2a0-c1f52c418f97', NULL, NULL, 'wp0206-tr-235483', 'manual_live', 'live', NULL, NULL, NULL, 'b0206c0a-0004-4000-8000-000000000201', '2026-07-06T09:47:24.212Z', '2026-07-06T09:47:24.212Z', NULL, NULL);

-- inventory_balances (1 rows)
INSERT INTO inventory_balances (id, tenant_id, item_id, location_id, on_hand_qty_kg, reserved_qty_kg, blocked_qty_kg, returned_qty_kg, last_movement_id, version, updated_at, updated_by, created_at) VALUES ('6a04595f-0c71-4c06-a149-2db8531ef519', 'b0206c0a-0004-4000-8000-000000000001', '95ae69f9-88bb-459c-b731-8b05d6aa2b68', 'b0206c0a-0004-4000-8000-000000000401', '1000.000', '0.000', '0.000', '0.000', '7b84f288-b7d7-4c49-84c7-2a1e83ac711c', 1, NULL, NULL, '2026-07-06T09:47:24.624Z');

-- accounts (1 rows)
INSERT INTO accounts (id, tenant_id, owner_type, owner_id, currency, status, created_at, created_by, updated_at, updated_by) VALUES ('163165b1-24f4-4913-98cb-624750b3ad93', 'b0206c0a-0004-4000-8000-000000000001', 'supplier', 'b0206c0a-0004-4000-8000-000000000301', 'EGP', 'active', '2026-07-06T09:47:25.036Z', 'b0206c0a-0004-4000-8000-000000000201', NULL, NULL);

-- account_entries (1 rows)
INSERT INTO account_entries (id, tenant_id, account_id, entry_no, entry_date, amount_signed, currency, entry_type, source_document_type, source_document_id, settlement_status, reversal_of_entry_id, notes, record_origin, record_period, import_batch_id, created_at, created_by) VALUES ('34488cf0-0748-49d1-8722-d30681a92973', 'b0206c0a-0004-4000-8000-000000000001', '163165b1-24f4-4913-98cb-624750b3ad93', 'AE-2026-TR-235483', '2026-07-06T00:00:00.000Z', '-80.00', 'EGP', 'supplier_raw_payable', 'raw_material_batch', 'caaf5034-37f1-463c-b2a0-c1f52c418f97', 'unsettled', NULL, NULL, 'manual_live', 'live', NULL, '2026-07-06T09:47:25.447Z', 'b0206c0a-0004-4000-8000-000000000201');

-- approval_requests (1 rows)
INSERT INTO approval_requests (id, tenant_id, request_type, entity_type, entity_id, risk_level, requested_by, requested_at, reason, state, decided_by, decided_at, decision_notes, idempotency_key, subject_version, subject_hash, submitted_child_version_summary, invalidated_by, invalidated_at, invalidation_reason, superseding_request_id, created_at, created_by, updated_at, updated_by) VALUES ('3c870ccf-7d79-4161-8aa3-1f7327f04d85', 'b0206c0a-0004-4000-8000-000000000001', 'raw_receipt_approval', 'raw_receipt_draft', 'caaf5034-37f1-463c-b2a0-c1f52c418f97', 'high', 'b0206c0a-0004-4000-8000-000000000101', '2026-07-06T09:47:25.859Z', 'WP0206 true restore', 'decided', 'b0206c0a-0004-4000-8000-000000000201', NULL, NULL, NULL, 1, 'wp0206trhash000000000000000000000000000000000000000000000000000000000000', '{"movementId":"7b84f288-b7d7-4c49-84c7-2a1e83ac711c","payableDeferred":false}', NULL, NULL, NULL, NULL, '2026-07-06T09:47:25.859Z', NULL, NULL, NULL);

SET session_replication_role = DEFAULT;
