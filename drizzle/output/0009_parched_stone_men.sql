CREATE TABLE "quality_test_values" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quality_test_id" uuid NOT NULL,
	"parameter_name" text NOT NULL,
	"parameter_code" text NOT NULL,
	"measured_value" text,
	"value_status" text DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "quality_test_values_status_check" CHECK (value_status IN ('pending', 'pass', 'fail', 'review'))
);
--> statement-breakpoint
CREATE TABLE "quality_tests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"test_no" text NOT NULL,
	"test_date" date NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"sale_id" uuid,
	"customer_id" uuid,
	"test_status" "quality_status" DEFAULT 'needs_review' NOT NULL,
	"risk_classification" text DEFAULT 'none' NOT NULL,
	"tested_by" uuid,
	"tested_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "quality_test_values" ADD CONSTRAINT "quality_test_values_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_test_values" ADD CONSTRAINT "quality_test_values_quality_test_id_quality_tests_id_fk" FOREIGN KEY ("quality_test_id") REFERENCES "public"."quality_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_test_values" ADD CONSTRAINT "quality_test_values_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_test_values" ADD CONSTRAINT "quality_test_values_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_sale_id_sales_orders_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_tested_by_users_id_fk" FOREIGN KEY ("tested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_tests" ADD CONSTRAINT "quality_tests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quality_test_values_tenant_test_idx" ON "quality_test_values" USING btree ("tenant_id","quality_test_id");--> statement-breakpoint
CREATE INDEX "quality_test_values_tenant_parameter_idx" ON "quality_test_values" USING btree ("tenant_id","parameter_code");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_tests_tenant_test_no_unique_idx" ON "quality_tests" USING btree ("tenant_id","test_no");--> statement-breakpoint
CREATE INDEX "quality_tests_tenant_linked_idx" ON "quality_tests" USING btree ("tenant_id","linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE INDEX "quality_tests_tenant_date_idx" ON "quality_tests" USING btree ("tenant_id","test_date");--> statement-breakpoint
CREATE INDEX "quality_tests_tenant_status_idx" ON "quality_tests" USING btree ("tenant_id","test_status");--> statement-breakpoint
CREATE INDEX "quality_tests_tenant_sale_idx" ON "quality_tests" USING btree ("tenant_id","sale_id");--> statement-breakpoint
CREATE INDEX "quality_tests_tenant_customer_idx" ON "quality_tests" USING btree ("tenant_id","customer_id");