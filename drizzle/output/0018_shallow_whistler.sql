DROP INDEX "import_cutover_manifests_tenant_batch_domain_unique_idx";--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD COLUMN "manifest_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
CREATE UNIQUE INDEX "import_cutover_manifests_tenant_batch_domain_current_unique_idx" ON "import_cutover_manifests" USING btree ("tenant_id","import_batch_id","domain") WHERE "import_cutover_manifests"."is_current" = true;--> statement-breakpoint
CREATE INDEX "import_cutover_manifests_tenant_batch_current_idx" ON "import_cutover_manifests" USING btree ("tenant_id","import_batch_id","is_current");