ALTER TABLE "import_files" ADD COLUMN "file_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_files" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_files" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_files" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "import_files" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD COLUMN "staging_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD COLUMN "superseded_by_file_id" uuid;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD COLUMN "finding_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "import_files_tenant_batch_type_current_unique_idx" ON "import_files" USING btree ("tenant_id","import_batch_id","file_type") WHERE "import_files"."is_current" = true;--> statement-breakpoint
CREATE INDEX "import_files_tenant_batch_current_idx" ON "import_files" USING btree ("tenant_id","import_batch_id","is_current");--> statement-breakpoint
CREATE INDEX "import_staging_rows_tenant_batch_current_idx" ON "import_staging_rows" USING btree ("tenant_id","import_batch_id","is_current");--> statement-breakpoint
CREATE INDEX "import_staging_rows_tenant_file_idx" ON "import_staging_rows" USING btree ("tenant_id","import_file_id");--> statement-breakpoint
CREATE INDEX "import_validation_errors_tenant_batch_current_idx" ON "import_validation_errors" USING btree ("tenant_id","import_batch_id","is_current");