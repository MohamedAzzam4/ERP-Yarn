CREATE TYPE "public"."adjustment_direction" AS ENUM('positive', 'negative');--> statement-breakpoint
CREATE TYPE "public"."factory_type" AS ENUM('single_yarn', 'twisting', 'both');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('raw_material', 'single_yarn', 'twisted_yarn');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('internal_warehouse', 'port_warehouse', 'external_single_factory', 'external_twisting_factory', 'in_transit', 'returned_stock', 'temporary', 'wip_virtual');--> statement-breakpoint
CREATE TYPE "public"."master_data_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."movement_status" AS ENUM('draft', 'pending_approval', 'posted', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."movement_type" AS ENUM('raw_receipt', 'transfer', 'issue_to_production', 'receive_from_production', 'production_waste', 'return_from_wip', 'sale_issue', 'return_receipt', 'inventory_adjustment', 'stock_block', 'stock_unblock', 'reversal', 'correction');--> statement-breakpoint
CREATE TYPE "public"."quality_status" AS ENUM('accepted', 'needs_review', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('active', 'approved_consumed', 'released', 'failed');--> statement-breakpoint
CREATE TYPE "public"."returned_stock_status" AS ENUM('return_received', 'needs_quality_review', 'sellable_as_is', 'sellable_with_discount', 'blocked', 'reprocess_required');--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"customer_code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"normalized_name" text NOT NULL,
	"contact_info_json" text,
	"credit_limit" numeric(18, 2),
	"credit_terms" text,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "customers_credit_limit_check" CHECK (credit_limit IS NULL OR credit_limit >= 0)
);
--> statement-breakpoint
CREATE TABLE "external_factories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"factory_code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"factory_type" "factory_type" NOT NULL,
	"linked_location_id" uuid NOT NULL,
	"contact_info_json" text,
	"default_rate_per_input_ton" numeric(18, 2),
	"default_cost_basis" text DEFAULT 'input_quantity',
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "external_factories_default_cost_basis_check" CHECK (default_cost_basis IN ('input_quantity', 'output_quantity')),
	CONSTRAINT "external_factories_default_rate_check" CHECK (default_rate_per_input_ton IS NULL OR default_rate_per_input_ton >= 0)
);
--> statement-breakpoint
CREATE TABLE "fiber_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "inventory_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"adjustment_direction" "adjustment_direction" NOT NULL,
	"quantity_kg" numeric(18, 3) NOT NULL,
	"reason" text NOT NULL,
	"status" "movement_status" DEFAULT 'draft' NOT NULL,
	"approval_request_id" uuid,
	"posted_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "inventory_adjustments_quantity_check" CHECK (quantity_kg > 0),
	CONSTRAINT "inventory_adjustments_direction_check" CHECK (adjustment_direction IN ('positive', 'negative'))
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"on_hand_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"reserved_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"blocked_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"returned_qty_kg" numeric(18, 3) DEFAULT '0' NOT NULL,
	"last_movement_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_balances_reserved_check" CHECK (reserved_qty_kg >= 0),
	CONSTRAINT "inventory_balances_blocked_check" CHECK (blocked_qty_kg >= 0),
	CONSTRAINT "inventory_balances_returned_check" CHECK (returned_qty_kg >= 0),
	CONSTRAINT "inventory_balances_reserved_within_on_hand_check" CHECK (reserved_qty_kg <= GREATEST(on_hand_qty_kg, 0)),
	CONSTRAINT "inventory_balances_version_check" CHECK (version >= 1)
);
--> statement-breakpoint
CREATE TABLE "inventory_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_kind" "item_kind" NOT NULL,
	"item_code" text NOT NULL,
	"display_name_ar" text NOT NULL,
	"display_name_en" text,
	"quality_status" "quality_status" DEFAULT 'accepted' NOT NULL,
	"is_blocked" boolean DEFAULT false NOT NULL,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"location_code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"location_type" "location_type" NOT NULL,
	"address" text,
	"related_factory_id" uuid,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "product_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "quality_parameters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"unit" text,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "raw_material_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"supplier_id" uuid,
	"supplier_reference" text,
	"fiber_type_id" uuid,
	"origin_country" text,
	"season" text,
	"bales_count" numeric(18, 3),
	"gross_weight_kg" numeric(18, 3),
	"net_weight_kg" numeric(18, 3) NOT NULL,
	"purchase_price_per_ton" numeric(18, 2),
	"total_purchase_cost" numeric(18, 2),
	"received_date" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "raw_material_batches_net_weight_check" CHECK (net_weight_kg >= 0),
	CONSTRAINT "raw_material_batches_gross_net_check" CHECK (gross_weight_kg IS NULL OR gross_weight_kg >= net_weight_kg),
	CONSTRAINT "raw_material_batches_price_check" CHECK (purchase_price_per_ton IS NULL OR purchase_price_per_ton >= 0),
	CONSTRAINT "raw_material_batches_total_cost_check" CHECK (total_purchase_cost IS NULL OR total_purchase_cost >= 0),
	CONSTRAINT "raw_material_batches_bales_check" CHECK (bales_count IS NULL OR bales_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"movement_type" "movement_type" NOT NULL,
	"movement_status" "movement_status" DEFAULT 'draft' NOT NULL,
	"item_id" uuid NOT NULL,
	"from_location_id" uuid,
	"to_location_id" uuid,
	"quantity_kg" numeric(18, 3) NOT NULL,
	"movement_date" date NOT NULL,
	"source_document_type" text NOT NULL,
	"source_document_id" uuid NOT NULL,
	"approval_request_id" uuid,
	"reversal_of_movement_id" uuid,
	"idempotency_key" text NOT NULL,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"import_batch_id" uuid,
	"notes" text,
	"created_by" uuid,
	"posted_by" uuid,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "stock_movements_quantity_check" CHECK (quantity_kg > 0),
	CONSTRAINT "stock_movements_location_check" CHECK (from_location_id IS NOT NULL OR to_location_id IS NOT NULL),
	CONSTRAINT "stock_movements_from_to_diff_check" CHECK (from_location_id IS NULL OR to_location_id IS NULL OR from_location_id <> to_location_id)
);
--> statement-breakpoint
CREATE TABLE "stock_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reservation_no" text NOT NULL,
	"item_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"quantity_kg" numeric(18, 3) NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"sales_order_id" uuid,
	"sales_line_id" uuid,
	"status" "reservation_status" DEFAULT 'active' NOT NULL,
	"reserved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"idempotency_key" text NOT NULL,
	"failure_resolution_reason" text,
	"failure_resolution_actor" uuid,
	"failure_resolution_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "stock_reservations_quantity_check" CHECK (quantity_kg > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"supplier_code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text,
	"normalized_name" text NOT NULL,
	"contact_info_json" text,
	"status" "master_data_status" DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "yarn_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"lot_no" text NOT NULL,
	"lot_type" text NOT NULL,
	"yarn_count" text,
	"twist_factor" numeric(18, 6),
	"twists_per_meter" numeric(18, 3),
	"factory_id" uuid,
	"production_order_id" uuid,
	"production_date" date,
	"input_quantity_kg" numeric(18, 3),
	"output_quantity_kg" numeric(18, 3),
	"waste_quantity_kg" numeric(18, 3),
	"waste_percent" numeric(18, 6),
	"quality_status" "quality_status" DEFAULT 'accepted' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"approval_status" "approval_status" DEFAULT 'draft' NOT NULL,
	"record_origin" "record_origin" DEFAULT 'manual_live' NOT NULL,
	"record_period" "record_period" DEFAULT 'live' NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"import_batch_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "yarn_lots_lot_type_check" CHECK (lot_type IN ('single_yarn', 'twisted_yarn')),
	CONSTRAINT "yarn_lots_output_qty_check" CHECK (output_quantity_kg IS NULL OR output_quantity_kg >= 0),
	CONSTRAINT "yarn_lots_waste_qty_check" CHECK (waste_quantity_kg IS NULL OR waste_quantity_kg >= 0),
	CONSTRAINT "yarn_lots_input_qty_check" CHECK (input_quantity_kg IS NULL OR input_quantity_kg >= 0)
);
--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_factories" ADD CONSTRAINT "external_factories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_factories" ADD CONSTRAINT "external_factories_linked_location_id_locations_id_fk" FOREIGN KEY ("linked_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_factories" ADD CONSTRAINT "external_factories_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_factories" ADD CONSTRAINT "external_factories_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_types" ADD CONSTRAINT "fiber_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_types" ADD CONSTRAINT "fiber_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fiber_types" ADD CONSTRAINT "fiber_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_posted_movement_id_stock_movements_id_fk" FOREIGN KEY ("posted_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_adjustments" ADD CONSTRAINT "inventory_adjustments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_types" ADD CONSTRAINT "product_types_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_parameters" ADD CONSTRAINT "quality_parameters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_parameters" ADD CONSTRAINT "quality_parameters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_parameters" ADD CONSTRAINT "quality_parameters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_fiber_type_id_fiber_types_id_fk" FOREIGN KEY ("fiber_type_id") REFERENCES "public"."fiber_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD CONSTRAINT "raw_material_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_from_location_id_locations_id_fk" FOREIGN KEY ("from_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_to_location_id_locations_id_fk" FOREIGN KEY ("to_location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_approval_request_id_approval_requests_id_fk" FOREIGN KEY ("approval_request_id") REFERENCES "public"."approval_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_posted_by_users_id_fk" FOREIGN KEY ("posted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_failure_resolution_actor_users_id_fk" FOREIGN KEY ("failure_resolution_actor") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_factory_id_external_factories_id_fk" FOREIGN KEY ("factory_id") REFERENCES "public"."external_factories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "yarn_lots" ADD CONSTRAINT "yarn_lots_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_code_unique_idx" ON "customers" USING btree ("tenant_id","customer_code");--> statement-breakpoint
CREATE UNIQUE INDEX "customers_tenant_normalized_name_unique_idx" ON "customers" USING btree ("tenant_id","normalized_name");--> statement-breakpoint
CREATE INDEX "customers_tenant_status_idx" ON "customers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "external_factories_tenant_code_unique_idx" ON "external_factories" USING btree ("tenant_id","factory_code");--> statement-breakpoint
CREATE UNIQUE INDEX "external_factories_tenant_linked_location_unique_idx" ON "external_factories" USING btree ("tenant_id","linked_location_id");--> statement-breakpoint
CREATE INDEX "external_factories_tenant_type_idx" ON "external_factories" USING btree ("tenant_id","factory_type");--> statement-breakpoint
CREATE INDEX "external_factories_tenant_status_idx" ON "external_factories" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "fiber_types_tenant_code_unique_idx" ON "fiber_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "fiber_types_tenant_status_idx" ON "fiber_types" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_adjustments_tenant_doc_no_unique_idx" ON "inventory_adjustments" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_tenant_item_location_idx" ON "inventory_adjustments" USING btree ("tenant_id","item_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_adjustments_tenant_status_idx" ON "inventory_adjustments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_balances_tenant_item_location_unique_idx" ON "inventory_balances" USING btree ("tenant_id","item_id","location_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_item_idx" ON "inventory_balances" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "inventory_balances_tenant_location_idx" ON "inventory_balances" USING btree ("tenant_id","location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "inventory_items_tenant_kind_code_unique_idx" ON "inventory_items" USING btree ("tenant_id","item_kind","item_code");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_kind_idx" ON "inventory_items" USING btree ("tenant_id","item_kind");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_quality_idx" ON "inventory_items" USING btree ("tenant_id","quality_status");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_blocked_idx" ON "inventory_items" USING btree ("tenant_id","is_blocked");--> statement-breakpoint
CREATE INDEX "inventory_items_tenant_status_idx" ON "inventory_items" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_code_unique_idx" ON "locations" USING btree ("tenant_id","location_code");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_tenant_name_ar_unique_idx" ON "locations" USING btree ("tenant_id","name_ar");--> statement-breakpoint
CREATE INDEX "locations_tenant_type_idx" ON "locations" USING btree ("tenant_id","location_type");--> statement-breakpoint
CREATE INDEX "locations_tenant_status_idx" ON "locations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "product_types_tenant_code_unique_idx" ON "product_types" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "product_types_tenant_status_idx" ON "product_types" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_parameters_tenant_code_unique_idx" ON "quality_parameters" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "quality_parameters_tenant_status_idx" ON "quality_parameters" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_material_batches_tenant_item_unique_idx" ON "raw_material_batches" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_material_batches_tenant_batch_no_unique_idx" ON "raw_material_batches" USING btree ("tenant_id","batch_no");--> statement-breakpoint
CREATE INDEX "raw_material_batches_tenant_supplier_idx" ON "raw_material_batches" USING btree ("tenant_id","supplier_id");--> statement-breakpoint
CREATE INDEX "raw_material_batches_tenant_status_idx" ON "raw_material_batches" USING btree ("tenant_id","approval_status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_doc_no_unique_idx" ON "stock_movements" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_movements_tenant_idempotency_unique_idx" ON "stock_movements" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_item_date_idx" ON "stock_movements" USING btree ("tenant_id","item_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_from_location_date_idx" ON "stock_movements" USING btree ("tenant_id","from_location_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_to_location_date_idx" ON "stock_movements" USING btree ("tenant_id","to_location_id","movement_date");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_source_idx" ON "stock_movements" USING btree ("tenant_id","source_document_type","source_document_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_import_batch_idx" ON "stock_movements" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_reversal_idx" ON "stock_movements" USING btree ("tenant_id","reversal_of_movement_id");--> statement-breakpoint
CREATE INDEX "stock_movements_tenant_status_idx" ON "stock_movements" USING btree ("tenant_id","movement_status");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_tenant_no_unique_idx" ON "stock_reservations" USING btree ("tenant_id","reservation_no");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_active_source_scope_unique_idx" ON "stock_reservations" USING btree ("tenant_id","source_type","source_id","item_id","location_id") WHERE status = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "stock_reservations_tenant_idempotency_unique_idx" ON "stock_reservations" USING btree ("tenant_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_item_location_idx" ON "stock_reservations" USING btree ("tenant_id","item_id","location_id");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_status_idx" ON "stock_reservations" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "stock_reservations_tenant_sales_order_idx" ON "stock_reservations" USING btree ("tenant_id","sales_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_code_unique_idx" ON "suppliers" USING btree ("tenant_id","supplier_code");--> statement-breakpoint
CREATE UNIQUE INDEX "suppliers_tenant_normalized_name_unique_idx" ON "suppliers" USING btree ("tenant_id","normalized_name");--> statement-breakpoint
CREATE INDEX "suppliers_tenant_status_idx" ON "suppliers" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "yarn_lots_tenant_item_unique_idx" ON "yarn_lots" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "yarn_lots_tenant_lot_type_lot_no_unique_idx" ON "yarn_lots" USING btree ("tenant_id","lot_type","lot_no");--> statement-breakpoint
CREATE INDEX "yarn_lots_tenant_factory_idx" ON "yarn_lots" USING btree ("tenant_id","factory_id");--> statement-breakpoint
CREATE INDEX "yarn_lots_tenant_quality_idx" ON "yarn_lots" USING btree ("tenant_id","quality_status");--> statement-breakpoint
CREATE INDEX "yarn_lots_tenant_status_idx" ON "yarn_lots" USING btree ("tenant_id","approval_status");--> statement-breakpoint

-- ===========================================================================
-- Manual FK constraints (WP-00-03B)
-- ===========================================================================
-- These constraints are NOT generated by Drizzle Kit because they are
-- forward references or self-references that Drizzle cannot model in the
-- table definition without TS circular inference. They are added here as
-- explicit manual SQL constraints.
--
-- Contract: docs/contracts/03_database_schema_contract.md §§8–9
-- ===========================================================================

-- locations.related_factory_id -> external_factories.id
-- (forward reference within master-data.ts: locations is defined before
-- external_factories)
ALTER TABLE "locations" ADD CONSTRAINT "locations_related_factory_id_external_factories_id_fk"
  FOREIGN KEY ("related_factory_id") REFERENCES "public"."external_factories"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- stock_movements.reversal_of_movement_id -> stock_movements.id
-- (self-reference: reversal movement links to original posted movement)
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reversal_of_movement_id_stock_movements_id_fk"
  FOREIGN KEY ("reversal_of_movement_id") REFERENCES "public"."stock_movements"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- inventory_balances.last_movement_id -> stock_movements.id
-- (forward reference: inventory_balances is defined after stock_movements
-- but last_movement_id is a plain uuid without references())
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_last_movement_id_stock_movements_id_fk"
  FOREIGN KEY ("last_movement_id") REFERENCES "public"."stock_movements"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint
