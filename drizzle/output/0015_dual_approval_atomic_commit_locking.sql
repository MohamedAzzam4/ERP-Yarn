CREATE TABLE "import_backup_evidence" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL,
        "import_batch_id" uuid NOT NULL,
        "backup_type" text NOT NULL,
        "backup_location" text NOT NULL,
        "backup_hash" text NOT NULL,
        "backup_size_bytes" integer,
        "backup_created_at" timestamp with time zone NOT NULL,
        "verified_by" uuid,
        "verified_at" timestamp with time zone,
        "verification_notes" text,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_by" uuid,
        "updated_at" timestamp with time zone,
        "updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_cutover_locks" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "tenant_id" uuid NOT NULL,
        "import_batch_id" uuid NOT NULL,
        "lock_scope" text NOT NULL,
        "acquired_by" uuid NOT NULL,
        "acquired_at" timestamp with time zone DEFAULT now() NOT NULL,
        "expires_at" timestamp with time zone NOT NULL,
        "released_at" timestamp with time zone,
        "released_by" uuid,
        "release_reason" text,
        "commit_idempotency_key" text NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "created_by" uuid,
        "updated_at" timestamp with time zone,
        "updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "import_backup_evidence" ADD CONSTRAINT "import_backup_evidence_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_backup_evidence" ADD CONSTRAINT "import_backup_evidence_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_backup_evidence" ADD CONSTRAINT "import_backup_evidence_verified_by_users_id_fk" FOREIGN KEY ("verified_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_backup_evidence" ADD CONSTRAINT "import_backup_evidence_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_backup_evidence" ADD CONSTRAINT "import_backup_evidence_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_acquired_by_users_id_fk" FOREIGN KEY ("acquired_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_released_by_users_id_fk" FOREIGN KEY ("released_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_locks" ADD CONSTRAINT "import_cutover_locks_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "import_backup_evidence_tenant_batch_idx" ON "import_backup_evidence" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_backup_evidence_tenant_hash_idx" ON "import_backup_evidence" USING btree ("tenant_id","backup_hash");--> statement-breakpoint
CREATE INDEX "import_cutover_locks_tenant_batch_idx" ON "import_cutover_locks" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_cutover_locks_tenant_scope_idx" ON "import_cutover_locks" USING btree ("tenant_id","lock_scope");--> statement-breakpoint
CREATE INDEX "import_cutover_locks_tenant_active_idx" ON "import_cutover_locks" USING btree ("tenant_id","released_at");--> statement-breakpoint
-- WP-07-04: Partial unique index — only one ACTIVE (unreleased) cutover lock
-- per (tenant, batch, scope). Prevents concurrent commits on the same batch.
-- Contract 08 §8.10: "cutover manifest is approved and affected live-write
-- scopes are locked/paused" — concurrent commit attempts must serialize.
CREATE UNIQUE INDEX "import_cutover_locks_tenant_batch_scope_active_unique_idx"
  ON "import_cutover_locks" ("tenant_id", "import_batch_id", "lock_scope")
  WHERE "released_at" IS NULL;