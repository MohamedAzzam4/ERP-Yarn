CREATE TYPE "public"."historical_cost_basis_source" AS ENUM('imported_excel', 'input_based', 'output_based', 'manual', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."production_status" AS ENUM('draft', 'material_issued', 'partially_received', 'completed', 'correction_requested', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."production_type" AS ENUM('single_yarn', 'twisted_yarn');--> statement-breakpoint
CREATE TYPE "public"."wip_return_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TABLE "production_inputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_order_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"input_location_id" uuid NOT NULL,
	"planned_input_qty_kg" numeric(18, 3) NOT NULL,
	"issued_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"consumed_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"returned_from_wip_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"remaining_wip_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"issue_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_inputs_planned_check" CHECK (planned_input_qty_kg > 0),
	CONSTRAINT "production_inputs_issued_check" CHECK (issued_qty_kg >= 0),
	CONSTRAINT "production_inputs_consumed_check" CHECK (consumed_qty_kg >= 0),
	CONSTRAINT "production_inputs_returned_check" CHECK (returned_from_wip_qty_kg >= 0),
	CONSTRAINT "production_inputs_remaining_wip_check" CHECK (remaining_wip_qty_kg >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"production_type" "production_type" NOT NULL,
	"factory_id" uuid NOT NULL,
	"factory_location_id" uuid NOT NULL,
	"status" "production_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"send_date" date,
	"receive_date" date,
	"expected_waste_percent" numeric(18, 6),
	"total_input_qty_kg" numeric(18, 3) DEFAULT '0',
	"total_output_qty_kg" numeric(18, 3) DEFAULT '0',
	"total_waste_qty_kg" numeric(18, 3) DEFAULT '0',
	"payable_trigger_used" text DEFAULT 'production_receipt_approval',
	"factory_cost_basis_used" text DEFAULT 'input_quantity',
	"factory_rate_per_input_ton_used" numeric(18, 2),
	"calculation_version" text,
	"calculated_factory_cost" numeric(18, 2),
	"rate_confirmed_by" uuid,
	"rate_confirmed_at" timestamp with time zone,
	"imported_total_factory_cost" numeric(18, 2),
	"erp_calculated_factory_cost" numeric(18, 2),
	"historical_cost_basis_source" "historical_cost_basis_source",
	"source_formula_text" text,
	"source_calculated_value" numeric(18, 2),
	"cost_difference_amount" numeric(18, 2),
	"cost_difference_percent" numeric(18, 6),
	"migration_warning" text,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"reversal_of_id" uuid,
	"correction_of_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_orders_total_input_check" CHECK (total_input_qty_kg IS NULL OR total_input_qty_kg >= 0),
	CONSTRAINT "production_orders_total_output_check" CHECK (total_output_qty_kg IS NULL OR total_output_qty_kg >= 0),
	CONSTRAINT "production_orders_total_waste_check" CHECK (total_waste_qty_kg IS NULL OR total_waste_qty_kg >= 0),
	CONSTRAINT "production_orders_rate_check" CHECK (factory_rate_per_input_ton_used IS NULL OR factory_rate_per_input_ton_used >= 0),
	CONSTRAINT "production_orders_cost_basis_check" CHECK (factory_cost_basis_used IN ('input_quantity', 'output_quantity'))
);
--> statement-breakpoint
CREATE TABLE "production_outputs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_order_id" uuid NOT NULL,
	"output_item_id" uuid NOT NULL,
	"output_lot_id" uuid,
	"output_location_id" uuid NOT NULL,
	"output_qty_kg" numeric(18, 3) NOT NULL,
	"receipt_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_outputs_qty_check" CHECK (output_qty_kg > 0)
);
--> statement-breakpoint
CREATE TABLE "production_receipt_input_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_receipt_id" uuid NOT NULL,
	"production_input_id" uuid NOT NULL,
	"consumed_toward_output_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"allocated_waste_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"payable_cost_basis_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "receipt_allocations_consumed_check" CHECK (consumed_toward_output_qty_kg >= 0),
	CONSTRAINT "receipt_allocations_waste_check" CHECK (allocated_waste_qty_kg >= 0),
	CONSTRAINT "receipt_allocations_basis_check" CHECK (payable_cost_basis_qty_kg >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"production_order_id" uuid NOT NULL,
	"output_item_id" uuid NOT NULL,
	"output_lot_id" uuid,
	"output_location_id" uuid NOT NULL,
	"output_qty_kg" numeric(18, 3) NOT NULL,
	"receipt_date" date NOT NULL,
	"status" "production_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"payable_trigger_used" text DEFAULT 'production_receipt_approval',
	"factory_cost_basis_used" text DEFAULT 'input_quantity',
	"factory_rate_per_input_ton_used" numeric(18, 2),
	"factory_cost_basis_input_qty_kg" numeric(18, 3),
	"calculated_factory_cost" numeric(18, 2),
	"calculation_version" text,
	"factory_payable" numeric(18, 2),
	"account_entry_id" uuid,
	"idempotency_key" text NOT NULL,
	"approval_request_id" uuid,
	"receipt_movement_id" uuid,
	"notes" text,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_receipts_output_qty_check" CHECK (output_qty_kg > 0),
	CONSTRAINT "production_receipts_rate_check" CHECK (factory_rate_per_input_ton_used IS NULL OR factory_rate_per_input_ton_used >= 0),
	CONSTRAINT "production_receipts_payable_check" CHECK (factory_payable IS NULL OR factory_payable >= 0),
	CONSTRAINT "production_receipts_basis_input_qty_check" CHECK (factory_cost_basis_input_qty_kg IS NULL OR factory_cost_basis_input_qty_kg >= 0)
);
--> statement-breakpoint
CREATE TABLE "production_waste_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_order_id" uuid NOT NULL,
	"production_input_id" uuid NOT NULL,
	"production_receipt_id" uuid,
	"waste_qty_kg" numeric(18, 3) NOT NULL,
	"waste_percent" numeric(18, 6),
	"waste_reason" text,
	"movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_waste_qty_check" CHECK (waste_qty_kg > 0),
	CONSTRAINT "production_waste_percent_check" CHECK (waste_percent IS NULL OR (waste_percent >= 0 AND waste_percent <= 100))
);
--> statement-breakpoint
CREATE TABLE "production_wip_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"production_order_id" uuid NOT NULL,
	"input_item_id" uuid NOT NULL,
	"factory_location_id" uuid NOT NULL,
	"wip_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "production_wip_balances_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "production_wip_returns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"production_order_id" uuid NOT NULL,
	"production_input_id" uuid NOT NULL,
	"return_qty_kg" numeric(18, 3) NOT NULL,
	"return_location_id" uuid NOT NULL,
	"status" "wip_return_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"reason" text NOT NULL,
	"notes" text,
	"idempotency_key" text NOT NULL,
	"approval_request_id" uuid,
	"return_movement_id" uuid,
	"financial_review_status" text DEFAULT 'needs_accountant_review',
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "production_wip_returns_qty_check" CHECK (return_qty_kg > 0)
);
--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_input_item_id_inventory_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_input_location_id_locations_id_fk" FOREIGN KEY ("input_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_issue_movement_id_stock_movements_id_fk" FOREIGN KEY ("issue_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_inputs" ADD CONSTRAINT "production_inputs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_factory_id_external_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."external_factories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_factory_location_id_locations_id_fk" FOREIGN KEY ("factory_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_rate_confirmed_by_users_id_fk" FOREIGN KEY ("rate_confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_orders" ADD CONSTRAINT "production_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_output_item_id_inventory_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_output_lot_id_yarn_lots_id_fk" FOREIGN KEY ("output_lot_id") REFERENCES "public"."yarn_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_output_location_id_locations_id_fk" FOREIGN KEY ("output_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_receipt_movement_id_stock_movements_id_fk" FOREIGN KEY ("receipt_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_outputs" ADD CONSTRAINT "production_outputs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipt_input_allocations" ADD CONSTRAINT "production_receipt_input_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipt_input_allocations" ADD CONSTRAINT "production_receipt_input_allocations_production_receipt_id_production_receipts_id_fk" FOREIGN KEY ("production_receipt_id") REFERENCES "public"."production_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipt_input_allocations" ADD CONSTRAINT "production_receipt_input_allocations_production_input_id_production_inputs_id_fk" FOREIGN KEY ("production_input_id") REFERENCES "public"."production_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipt_input_allocations" ADD CONSTRAINT "production_receipt_input_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipt_input_allocations" ADD CONSTRAINT "production_receipt_input_allocations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_output_item_id_inventory_items_id_fk" FOREIGN KEY ("output_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_output_lot_id_yarn_lots_id_fk" FOREIGN KEY ("output_lot_id") REFERENCES "public"."yarn_lots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_output_location_id_locations_id_fk" FOREIGN KEY ("output_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_receipt_movement_id_stock_movements_id_fk" FOREIGN KEY ("receipt_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_production_input_id_production_inputs_id_fk" FOREIGN KEY ("production_input_id") REFERENCES "public"."production_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_production_receipt_id_production_receipts_id_fk" FOREIGN KEY ("production_receipt_id") REFERENCES "public"."production_receipts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_movement_id_stock_movements_id_fk" FOREIGN KEY ("movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_waste_entries" ADD CONSTRAINT "production_waste_entries_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_balances" ADD CONSTRAINT "production_wip_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_balances" ADD CONSTRAINT "production_wip_balances_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_balances" ADD CONSTRAINT "production_wip_balances_input_item_id_inventory_items_id_fk" FOREIGN KEY ("input_item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_balances" ADD CONSTRAINT "production_wip_balances_factory_location_id_locations_id_fk" FOREIGN KEY ("factory_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_balances" ADD CONSTRAINT "production_wip_balances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_production_order_id_production_orders_id_fk" FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_production_input_id_production_inputs_id_fk" FOREIGN KEY ("production_input_id") REFERENCES "public"."production_inputs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_return_location_id_locations_id_fk" FOREIGN KEY ("return_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_return_movement_id_stock_movements_id_fk" FOREIGN KEY ("return_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "production_inputs_tenant_order_idx" ON "production_inputs" USING btree ("tenant_id","production_order_id");--> statement-breakpoint
CREATE INDEX "production_inputs_tenant_item_idx" ON "production_inputs" USING btree ("tenant_id","input_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_orders_tenant_doc_no_unique_idx" ON "production_orders" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "production_orders_tenant_factory_idx" ON "production_orders" USING btree ("tenant_id","factory_id");--> statement-breakpoint
CREATE INDEX "production_orders_tenant_status_idx" ON "production_orders" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "production_orders_tenant_type_idx" ON "production_orders" USING btree ("tenant_id","production_type");--> statement-breakpoint
CREATE INDEX "production_outputs_tenant_order_idx" ON "production_outputs" USING btree ("tenant_id","production_order_id");--> statement-breakpoint
CREATE INDEX "production_outputs_tenant_item_idx" ON "production_outputs" USING btree ("tenant_id","output_item_id");--> statement-breakpoint
CREATE INDEX "production_outputs_tenant_lot_idx" ON "production_outputs" USING btree ("tenant_id","output_lot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "receipt_allocations_receipt_input_unique_idx" ON "production_receipt_input_allocations" USING btree ("tenant_id","production_receipt_id","production_input_id");--> statement-breakpoint
CREATE INDEX "receipt_allocations_tenant_input_idx" ON "production_receipt_input_allocations" USING btree ("tenant_id","production_input_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_receipts_tenant_doc_no_unique_idx" ON "production_receipts" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_receipts_tenant_idempotency_unique_idx" ON "production_receipts" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "production_receipts_tenant_order_idx" ON "production_receipts" USING btree ("tenant_id","production_order_id");--> statement-breakpoint
CREATE INDEX "production_receipts_tenant_status_idx" ON "production_receipts" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "production_receipts_tenant_lot_idx" ON "production_receipts" USING btree ("tenant_id","output_lot_id");--> statement-breakpoint
CREATE INDEX "production_waste_tenant_order_idx" ON "production_waste_entries" USING btree ("tenant_id","production_order_id");--> statement-breakpoint
CREATE INDEX "production_waste_tenant_input_idx" ON "production_waste_entries" USING btree ("tenant_id","production_input_id");--> statement-breakpoint
CREATE INDEX "production_waste_tenant_receipt_idx" ON "production_waste_entries" USING btree ("tenant_id","production_receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_wip_balances_tenant_order_item_location_unique_idx" ON "production_wip_balances" USING btree ("tenant_id","production_order_id","input_item_id","factory_location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "production_wip_returns_tenant_doc_no_unique_idx" ON "production_wip_returns" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "production_wip_returns_tenant_idempotency_unique_idx" ON "production_wip_returns" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "production_wip_returns_tenant_order_idx" ON "production_wip_returns" USING btree ("tenant_id","production_order_id");--> statement-breakpoint
CREATE INDEX "production_wip_returns_tenant_input_idx" ON "production_wip_returns" USING btree ("tenant_id","production_input_id");--> statement-breakpoint
CREATE INDEX "production_wip_returns_tenant_status_idx" ON "production_wip_returns" USING btree ("tenant_id","status");--> statement-breakpoint

-- ===========================================================================
-- Manual FK constraint (WP-00-03C)
-- ===========================================================================
-- yarn_lots.production_order_id -> production_orders.id
-- (forward reference: yarn_lots was defined in WP-00-03B before
-- production_orders existed. Now that production_orders exists in WP-00-03C,
-- the FK is added here as a manual ALTER TABLE.)
-- ===========================================================================

ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_production_order_id_production_orders_id_fk"
  FOREIGN KEY ("production_order_id") REFERENCES "public"."production_orders"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
