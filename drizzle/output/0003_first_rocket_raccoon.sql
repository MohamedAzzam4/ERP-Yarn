CREATE TYPE "public"."account_entry_type" AS ENUM('customer_sale_receivable', 'customer_return_credit', 'supplier_raw_payable', 'factory_production_payable', 'customer_payment', 'supplier_payment', 'factory_payment', 'customer_direct_cost_receivable', 'factory_direct_cost_recovery', 'historical_opening_balance', 'reversal');--> statement-breakpoint
CREATE TYPE "public"."account_owner_type" AS ENUM('customer', 'supplier', 'factory');--> statement-breakpoint
CREATE TYPE "public"."actual_payer_type" AS ENUM('company', 'customer', 'factory', 'other', 'unknown', 'not_recorded');--> statement-breakpoint
CREATE TYPE "public"."cost_responsibility_type" AS ENUM('company', 'customer', 'factory', 'shared', 'other', 'unknown', 'included_elsewhere', 'needs_accountant_review');--> statement-breakpoint
CREATE TYPE "public"."direct_cost_type" AS ENUM('transport', 'loading', 'unloading', 'customs', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_direction" AS ENUM('received_from_party', 'paid_to_party');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('cash', 'bank_transfer', 'check', 'wallet_instapay', 'other');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('draft', 'posted', 'reversed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."return_financial_treatment" AS ENUM('no_financial_impact', 'customer_credit', 'refund_due', 'replacement');--> statement-breakpoint
CREATE TYPE "public"."return_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('not_required', 'needs_accountant_review', 'reviewed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."sale_status" AS ENUM('draft', 'pending_approval', 'needs_review', 'approval_failed', 'approved', 'rejected', 'cancelled', 'reversed', 'partially_returned', 'fully_returned');--> statement-breakpoint
CREATE TYPE "public"."settlement_status" AS ENUM('unsettled', 'partially_settled', 'settled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."snapshot_active_state" AS ENUM('active', 'superseded');--> statement-breakpoint
CREATE TABLE "account_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"entry_no" text NOT NULL,
	"entry_date" date NOT NULL,
	"amount_signed" numeric(18, 2) NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"entry_type" "account_entry_type" NOT NULL,
	"source_document_type" text NOT NULL,
	"source_document_id" uuid NOT NULL,
	"settlement_status" "settlement_status" DEFAULT 'unsettled' NOT NULL,
	"reversal_of_entry_id" uuid,
	"notes" text,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "account_entries_amount_nonzero_check" CHECK (amount_signed <> 0)
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"owner_type" "account_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"currency" text DEFAULT 'EGP' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "direct_cost_allocations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"direct_cost_id" uuid NOT NULL,
	"responsible_party_type" text NOT NULL,
	"responsible_party_id" uuid,
	"share_amount" numeric(18, 2) NOT NULL,
	"share_percent" numeric(18, 12),
	"subledger_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "direct_cost_allocations_share_check" CHECK (share_amount >= 0),
	CONSTRAINT "direct_cost_allocations_percent_check" CHECK (share_percent IS NULL OR (share_percent >= 0 AND share_percent <= 100))
);
--> statement-breakpoint
CREATE TABLE "direct_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"cost_no" text NOT NULL,
	"cost_type" "direct_cost_type" NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"amount" numeric(18, 2),
	"currency" text DEFAULT 'EGP' NOT NULL,
	"cost_responsibility_type" "cost_responsibility_type" NOT NULL,
	"actual_payer_type" "actual_payer_type" NOT NULL,
	"included_in_profitability" boolean DEFAULT false NOT NULL,
	"review_status" "review_status" DEFAULT 'needs_accountant_review' NOT NULL,
	"notes" text,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "direct_costs_amount_check" CHECK (amount IS NULL OR amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "payment_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_entry_id" uuid NOT NULL,
	"settled_entry_id" uuid NOT NULL,
	"settled_amount" numeric(18, 2) NOT NULL,
	"settlement_status" "settlement_status" DEFAULT 'settled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "payment_settlements_amount_check" CHECK (settled_amount > 0)
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"payment_no" text NOT NULL,
	"payment_date" date NOT NULL,
	"account_id" uuid NOT NULL,
	"amount" numeric(18, 2) NOT NULL,
	"payment_direction" "payment_direction" NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"attachment_file_id" uuid,
	"posted_entry_id" uuid,
	"reversal_of_payment_id" uuid,
	"idempotency_key" text NOT NULL,
	"approval_request_id" uuid,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "payments_amount_check" CHECK (amount > 0)
);
--> statement-breakpoint
CREATE TABLE "raw_purchase_price_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"raw_material_batch_id" uuid NOT NULL,
	"confirmed_price_per_ton" numeric(18, 2) NOT NULL,
	"quantity_basis" text DEFAULT 'net_accepted_kg' NOT NULL,
	"quantity_basis_kg" numeric(18, 3) NOT NULL,
	"precise_calculated_amount" numeric(24, 8),
	"posted_payable_amount" numeric(18, 2),
	"currency" text DEFAULT 'EGP' NOT NULL,
	"subject_version" integer DEFAULT 1 NOT NULL,
	"subject_hash" text NOT NULL,
	"approval_request_id" uuid,
	"account_entry_id" uuid,
	"idempotency_key" text NOT NULL,
	"confirmed_by" uuid,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"reversal_of_id" uuid,
	"is_locked" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	CONSTRAINT "raw_price_confirmations_price_check" CHECK (confirmed_price_per_ton >= 0),
	CONSTRAINT "raw_price_confirmations_qty_check" CHECK (quantity_basis_kg > 0),
	CONSTRAINT "raw_price_confirmations_payable_check" CHECK (posted_payable_amount IS NULL OR posted_payable_amount >= 0),
	CONSTRAINT "raw_price_confirmations_subject_version_check" CHECK (subject_version >= 1)
);
--> statement-breakpoint
CREATE TABLE "return_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"return_request_id" uuid NOT NULL,
	"original_sale_order_id" uuid NOT NULL,
	"original_sale_line_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"quantity_kg" numeric(18, 3) NOT NULL,
	"return_location_id" uuid NOT NULL,
	"returned_stock_status" "returned_stock_status" NOT NULL,
	"quality_status_after_return" text,
	"original_sale_line_net_unit_value" numeric(18, 6),
	"return_credit_value" numeric(18, 2),
	"residual_adjustment" numeric(18, 2) DEFAULT '0' NOT NULL,
	"cumulative_prior_return_qty" numeric(18, 3) DEFAULT '0' NOT NULL,
	"cumulative_prior_return_credit" numeric(18, 2) DEFAULT '0' NOT NULL,
	"return_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "return_lines_qty_check" CHECK (quantity_kg > 0),
	CONSTRAINT "return_lines_credit_check" CHECK (return_credit_value IS NULL OR return_credit_value >= 0),
	CONSTRAINT "return_lines_cumulative_qty_check" CHECK (cumulative_prior_return_qty >= 0),
	CONSTRAINT "return_lines_cumulative_credit_check" CHECK (cumulative_prior_return_credit >= 0)
);
--> statement-breakpoint
CREATE TABLE "return_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"return_date" date NOT NULL,
	"status" "return_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"return_reason" text NOT NULL,
	"financial_treatment" "return_financial_treatment",
	"customer_adjustment_amount" numeric(18, 2),
	"is_replacement" boolean DEFAULT false NOT NULL,
	"replacement_order_id" uuid,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "return_requests_adjustment_check" CHECK (customer_adjustment_amount IS NULL OR customer_adjustment_amount >= 0)
);
--> statement-breakpoint
CREATE TABLE "sales_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_kg" numeric(18, 3) NOT NULL,
	"price_per_ton" numeric(18, 2),
	"line_gross_revenue" numeric(18, 2),
	"line_allocated_discount_precise" numeric(24, 8),
	"line_allocated_discount_posted" numeric(18, 2),
	"line_net_revenue_precise" numeric(24, 8),
	"line_net_revenue_posted" numeric(18, 2),
	"rounding_adjustment" numeric(18, 2) DEFAULT '0' NOT NULL,
	"reservation_id" uuid,
	"sale_issue_movement_id" uuid,
	"quality_warning_snapshot_json" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "sales_order_lines_qty_check" CHECK (quantity_kg > 0),
	CONSTRAINT "sales_order_lines_price_check" CHECK (price_per_ton IS NULL OR price_per_ton >= 0),
	CONSTRAINT "sales_order_lines_rounding_check" CHECK (rounding_adjustment = 0 OR (line_gross_revenue IS NOT NULL AND line_allocated_discount_posted IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"customer_id" uuid NOT NULL,
	"sale_status" "sale_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"sale_date" date NOT NULL,
	"total_gross_revenue" numeric(18, 2) DEFAULT '0' NOT NULL,
	"order_discount_total" numeric(18, 2) DEFAULT '0' NOT NULL,
	"document_total_posted" numeric(18, 2) DEFAULT '0' NOT NULL,
	"quality_warning_status" text,
	"reservation_status" text,
	"payment_status" text,
	"delivery_status" text,
	"is_replacement_order" boolean DEFAULT false NOT NULL,
	"original_return_request_id" uuid,
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
	CONSTRAINT "sales_orders_total_gross_check" CHECK (total_gross_revenue >= 0),
	CONSTRAINT "sales_orders_discount_check" CHECK (order_discount_total >= 0),
	CONSTRAINT "sales_orders_doc_total_check" CHECK (document_total_posted >= 0),
	CONSTRAINT "sales_orders_discount_within_gross_check" CHECK (order_discount_total <= total_gross_revenue)
);
--> statement-breakpoint
CREATE TABLE "sales_profitability_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sales_order_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"is_active" "snapshot_active_state" DEFAULT 'active' NOT NULL,
	"superseded_by_snapshot_id" uuid,
	"profile_version" text,
	"raw_cost_snapshot" numeric(18, 2),
	"single_production_cost_snapshot" numeric(18, 2),
	"twisting_cost_snapshot" numeric(18, 2),
	"transport_cost_snapshot" numeric(18, 2),
	"discount_snapshot" numeric(18, 2),
	"return_impact_snapshot" numeric(18, 2),
	"revenue_snapshot" numeric(18, 2),
	"profit_amount" numeric(18, 2),
	"profit_margin_percent" numeric(18, 6),
	"missing_cost_flags_json" text,
	"calculation_notes" text,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"calculated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "profitability_snapshots_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_entries" ADD CONSTRAINT "account_entries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_cost_allocations" ADD CONSTRAINT "direct_cost_allocations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_cost_allocations" ADD CONSTRAINT "direct_cost_allocations_direct_cost_id_direct_costs_id_fk" FOREIGN KEY ("direct_cost_id") REFERENCES "public"."direct_costs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_cost_allocations" ADD CONSTRAINT "direct_cost_allocations_subledger_entry_id_account_entries_id_fk" FOREIGN KEY ("subledger_entry_id") REFERENCES "public"."account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_cost_allocations" ADD CONSTRAINT "direct_cost_allocations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_cost_allocations" ADD CONSTRAINT "direct_cost_allocations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "direct_costs" ADD CONSTRAINT "direct_costs_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_payment_entry_id_account_entries_id_fk" FOREIGN KEY ("payment_entry_id") REFERENCES "public"."account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_settled_entry_id_account_entries_id_fk" FOREIGN KEY ("settled_entry_id") REFERENCES "public"."account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_settlements" ADD CONSTRAINT "payment_settlements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_posted_entry_id_account_entries_id_fk" FOREIGN KEY ("posted_entry_id") REFERENCES "public"."account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_raw_material_batch_id_raw_material_batches_id_fk" FOREIGN KEY ("raw_material_batch_id") REFERENCES "public"."raw_material_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_account_entry_id_account_entries_id_fk" FOREIGN KEY ("account_entry_id") REFERENCES "public"."account_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_purchase_price_confirmations" ADD CONSTRAINT "raw_purchase_price_confirmations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_request_id_return_requests_id_fk" FOREIGN KEY ("return_request_id") REFERENCES "public"."return_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_original_sale_order_id_sales_orders_id_fk" FOREIGN KEY ("original_sale_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_original_sale_line_id_sales_order_lines_id_fk" FOREIGN KEY ("original_sale_line_id") REFERENCES "public"."sales_order_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_location_id_locations_id_fk" FOREIGN KEY ("return_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_return_movement_id_stock_movements_id_fk" FOREIGN KEY ("return_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_lines" ADD CONSTRAINT "return_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "return_requests" ADD CONSTRAINT "return_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_reservation_id_stock_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."stock_reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_sale_issue_movement_id_stock_movements_id_fk" FOREIGN KEY ("sale_issue_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_order_lines" ADD CONSTRAINT "sales_order_lines_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_profitability_snapshots" ADD CONSTRAINT "sales_profitability_snapshots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_profitability_snapshots" ADD CONSTRAINT "sales_profitability_snapshots_sales_order_id_sales_orders_id_fk" FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_profitability_snapshots" ADD CONSTRAINT "sales_profitability_snapshots_calculated_by_users_id_fk" FOREIGN KEY ("calculated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_profitability_snapshots" ADD CONSTRAINT "sales_profitability_snapshots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_profitability_snapshots" ADD CONSTRAINT "sales_profitability_snapshots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_entries_tenant_entry_no_unique_idx" ON "account_entries" USING btree ("tenant_id","entry_no");--> statement-breakpoint
CREATE INDEX "account_entries_tenant_account_date_idx" ON "account_entries" USING btree ("tenant_id","account_id","entry_date");--> statement-breakpoint
CREATE INDEX "account_entries_tenant_source_idx" ON "account_entries" USING btree ("tenant_id","source_document_type","source_document_id");--> statement-breakpoint
CREATE INDEX "account_entries_tenant_settlement_idx" ON "account_entries" USING btree ("tenant_id","settlement_status");--> statement-breakpoint
CREATE INDEX "account_entries_tenant_reversal_idx" ON "account_entries" USING btree ("tenant_id","reversal_of_entry_id");--> statement-breakpoint
CREATE INDEX "account_entries_tenant_import_idx" ON "account_entries" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_tenant_owner_type_owner_currency_unique_idx" ON "accounts" USING btree ("tenant_id","owner_type","owner_id","currency");--> statement-breakpoint
CREATE INDEX "accounts_tenant_owner_idx" ON "accounts" USING btree ("tenant_id","owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "direct_cost_allocations_tenant_cost_idx" ON "direct_cost_allocations" USING btree ("tenant_id","direct_cost_id");--> statement-breakpoint
CREATE INDEX "direct_cost_allocations_tenant_party_idx" ON "direct_cost_allocations" USING btree ("tenant_id","responsible_party_type","responsible_party_id");--> statement-breakpoint
CREATE UNIQUE INDEX "direct_costs_tenant_cost_no_unique_idx" ON "direct_costs" USING btree ("tenant_id","cost_no");--> statement-breakpoint
CREATE INDEX "direct_costs_tenant_linked_idx" ON "direct_costs" USING btree ("tenant_id","linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE INDEX "direct_costs_tenant_review_idx" ON "direct_costs" USING btree ("tenant_id","review_status");--> statement-breakpoint
CREATE INDEX "payment_settlements_tenant_payment_entry_idx" ON "payment_settlements" USING btree ("tenant_id","payment_entry_id");--> statement-breakpoint
CREATE INDEX "payment_settlements_tenant_settled_entry_idx" ON "payment_settlements" USING btree ("tenant_id","settled_entry_id");--> statement-breakpoint
CREATE INDEX "payment_settlements_tenant_status_idx" ON "payment_settlements" USING btree ("tenant_id","settlement_status");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_payment_no_unique_idx" ON "payments" USING btree ("tenant_id","payment_no");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_tenant_idempotency_unique_idx" ON "payments" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_tenant_account_idx" ON "payments" USING btree ("tenant_id","account_id");--> statement-breakpoint
CREATE INDEX "payments_tenant_date_idx" ON "payments" USING btree ("tenant_id","payment_date");--> statement-breakpoint
CREATE INDEX "payments_tenant_status_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "payments_tenant_method_idx" ON "payments" USING btree ("tenant_id","payment_method");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_price_confirmations_tenant_doc_no_unique_idx" ON "raw_purchase_price_confirmations" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_price_confirmations_tenant_idempotency_unique_idx" ON "raw_purchase_price_confirmations" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "raw_price_confirmations_tenant_batch_idx" ON "raw_purchase_price_confirmations" USING btree ("tenant_id","raw_material_batch_id");--> statement-breakpoint
CREATE INDEX "raw_price_confirmations_tenant_reversal_idx" ON "raw_purchase_price_confirmations" USING btree ("tenant_id","reversal_of_id");--> statement-breakpoint
CREATE INDEX "return_lines_tenant_request_idx" ON "return_lines" USING btree ("tenant_id","return_request_id");--> statement-breakpoint
CREATE INDEX "return_lines_tenant_sale_line_idx" ON "return_lines" USING btree ("tenant_id","original_sale_line_id");--> statement-breakpoint
CREATE UNIQUE INDEX "return_requests_tenant_doc_no_unique_idx" ON "return_requests" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "return_requests_tenant_sale_idx" ON "return_requests" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "return_requests_tenant_customer_idx" ON "return_requests" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "return_requests_tenant_status_idx" ON "return_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_order_lines_tenant_order_line_unique_idx" ON "sales_order_lines" USING btree ("tenant_id","sales_order_id","line_no");--> statement-breakpoint
CREATE INDEX "sales_order_lines_tenant_order_idx" ON "sales_order_lines" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE INDEX "sales_order_lines_tenant_item_idx" ON "sales_order_lines" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_orders_tenant_doc_no_unique_idx" ON "sales_orders" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_customer_idx" ON "sales_orders" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_status_idx" ON "sales_orders" USING btree ("tenant_id","sale_status");--> statement-breakpoint
CREATE INDEX "sales_orders_tenant_date_idx" ON "sales_orders" USING btree ("tenant_id","sale_date");--> statement-breakpoint
CREATE UNIQUE INDEX "profitability_snapshots_tenant_order_version_unique_idx" ON "sales_profitability_snapshots" USING btree ("tenant_id","sales_order_id","version");--> statement-breakpoint
CREATE INDEX "profitability_snapshots_tenant_active_idx" ON "sales_profitability_snapshots" USING btree ("tenant_id","sales_order_id","is_active");--> statement-breakpoint

-- ===========================================================================
-- Manual FK constraints (WP-00-03D)
-- ===========================================================================
-- Forward references: columns defined in WP-00-03B (stock_reservations) and
-- WP-00-03C (production_receipts) that reference tables created in WP-00-03D.
-- ===========================================================================

-- stock_reservations.sales_order_id -> sales_orders.id
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sales_order_id_sales_orders_id_fk"
  FOREIGN KEY ("sales_order_id") REFERENCES "public"."sales_orders"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- stock_reservations.sales_line_id -> sales_order_lines.id
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_sales_line_id_sales_order_lines_id_fk"
  FOREIGN KEY ("sales_line_id") REFERENCES "public"."sales_order_lines"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- production_receipts.account_entry_id -> account_entries.id
ALTER TABLE "production_receipts" ADD CONSTRAINT "production_receipts_account_entry_id_account_entries_id_fk"
  FOREIGN KEY ("account_entry_id") REFERENCES "public"."account_entries"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
