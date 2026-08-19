ALTER TABLE "import_alias_mappings" ADD COLUMN "is_current" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "superseded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "superseded_by" uuid;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "superseded_reason" text;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "group_id" uuid;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "occurrence_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD COLUMN "exception_source_row_ids" jsonb;--> statement-breakpoint
CREATE INDEX "import_alias_mappings_tenant_batch_current_idx" ON "import_alias_mappings" USING btree ("tenant_id","import_batch_id","is_current");--> statement-breakpoint
CREATE INDEX "import_alias_mappings_tenant_group_current_idx" ON "import_alias_mappings" USING btree ("tenant_id","group_id","is_current");--> statement-breakpoint
CREATE UNIQUE INDEX "import_alias_mappings_tenant_batch_entity_source_current_unique_idx" ON "import_alias_mappings" USING btree ("tenant_id","import_batch_id","entity_type","source_label") WHERE "import_alias_mappings"."is_current" = true;