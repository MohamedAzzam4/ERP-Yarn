DROP INDEX "import_batch_approvals_tenant_batch_role_unique_idx";--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "approval_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "invalidated_by" uuid;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "invalidation_reason" text;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD COLUMN "superseded_by_approval_id" uuid;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD COLUMN "report_version" integer;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_approvals_tenant_batch_role_current_unique_idx" ON "import_batch_approvals" USING btree ("tenant_id","import_batch_id","approver_role") WHERE "import_batch_approvals"."is_current" = true;--> statement-breakpoint
CREATE INDEX "import_batch_approvals_tenant_batch_current_idx" ON "import_batch_approvals" USING btree ("tenant_id","import_batch_id","is_current");--> statement-breakpoint
CREATE INDEX "import_human_review_items_tenant_batch_current_idx" ON "import_human_review_items" USING btree ("tenant_id","import_batch_id","is_current");--> statement-breakpoint
CREATE INDEX "import_human_review_items_tenant_batch_version_idx" ON "import_human_review_items" USING btree ("tenant_id","import_batch_id","report_version");