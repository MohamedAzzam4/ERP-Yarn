CREATE TABLE "quality_holds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"quality_test_id" uuid NOT NULL,
	"linked_entity_type" text NOT NULL,
	"linked_entity_id" uuid NOT NULL,
	"hold_reason" text NOT NULL,
	"hold_status" text DEFAULT 'active' NOT NULL,
	"cleared_by" uuid,
	"cleared_at" timestamp with time zone,
	"clearance_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "quality_holds_reason_check" CHECK (hold_reason IN ('needs_review', 'blocked', 'reprocess_required')),
	CONSTRAINT "quality_holds_status_check" CHECK (hold_status IN ('active', 'cleared'))
);
--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_quality_test_id_quality_tests_id_fk" FOREIGN KEY ("quality_test_id") REFERENCES "public"."quality_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_cleared_by_users_id_fk" FOREIGN KEY ("cleared_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_holds" ADD CONSTRAINT "quality_holds_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quality_holds_tenant_entity_idx" ON "quality_holds" USING btree ("tenant_id","linked_entity_type","linked_entity_id");--> statement-breakpoint
CREATE INDEX "quality_holds_tenant_test_idx" ON "quality_holds" USING btree ("tenant_id","quality_test_id");--> statement-breakpoint
CREATE INDEX "quality_holds_tenant_status_idx" ON "quality_holds" USING btree ("tenant_id","hold_status");