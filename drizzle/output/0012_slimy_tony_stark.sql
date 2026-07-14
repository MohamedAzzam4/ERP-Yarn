CREATE TABLE "complaints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"complaint_no" text NOT NULL,
	"complaint_date" date NOT NULL,
	"customer_id" uuid,
	"sale_id" uuid,
	"sale_line_id" uuid,
	"item_id" uuid,
	"quality_test_id" uuid,
	"subject" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"investigated_by" uuid,
	"investigated_at" timestamp with time zone,
	"investigation_notes" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"resolution_type" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "complaints_status_check" CHECK (status IN ('open', 'investigating', 'resolved', 'closed')),
	CONSTRAINT "complaints_priority_check" CHECK (priority IN ('low', 'normal', 'high', 'urgent'))
);
--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_sale_id_sales_orders_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_item_id_inventory_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."inventory_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_quality_test_id_quality_tests_id_fk" FOREIGN KEY ("quality_test_id") REFERENCES "public"."quality_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_investigated_by_users_id_fk" FOREIGN KEY ("investigated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaints" ADD CONSTRAINT "complaints_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "complaints_tenant_complaint_no_unique_idx" ON "complaints" USING btree ("tenant_id","complaint_no");--> statement-breakpoint
CREATE INDEX "complaints_tenant_customer_idx" ON "complaints" USING btree ("tenant_id","customer_id");--> statement-breakpoint
CREATE INDEX "complaints_tenant_sale_idx" ON "complaints" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "complaints_tenant_item_idx" ON "complaints" USING btree ("tenant_id","item_id");--> statement-breakpoint
CREATE INDEX "complaints_tenant_quality_test_idx" ON "complaints" USING btree ("tenant_id","quality_test_id");--> statement-breakpoint
CREATE INDEX "complaints_tenant_date_idx" ON "complaints" USING btree ("tenant_id","complaint_date");--> statement-breakpoint
CREATE INDEX "complaints_tenant_status_idx" ON "complaints" USING btree ("tenant_id","status");