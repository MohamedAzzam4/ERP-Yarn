CREATE TYPE "public"."alias_mapping_status" AS ENUM('candidate', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."correction_request_status" AS ENUM('draft', 'pending_review', 'approved', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."cutover_import_mode" AS ENUM('opening_balance', 'transaction_history', 'hybrid');--> statement-breakpoint
CREATE TYPE "public"."import_batch_status" AS ENUM('draft', 'source_uploaded', 'normalized', 'staged', 'validation_in_progress', 'validation_complete', 'reconciliation_in_progress', 'review_required', 'pending_dual_approval', 'approved_for_commit', 'committing', 'committed', 'rejected', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."migration_approver_role" AS ENUM('owner', 'accountant');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_result_status" AS ENUM('pending', 'matched', 'difference', 'accepted_difference', 'blocking');--> statement-breakpoint
CREATE TYPE "public"."review_item_decision" AS ENUM('pending', 'accepted', 'rejected', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."validation_severity" AS ENUM('blocking_error', 'review_required_warning', 'informational');--> statement-breakpoint
CREATE TABLE "historical_correction_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"doc_no" text NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"original_entity_type" text NOT NULL,
	"original_entity_id" uuid NOT NULL,
	"correction_type" text NOT NULL,
	"reason" text NOT NULL,
	"proposed_correction_json" jsonb,
	"impact_analysis_json" jsonb,
	"status" "correction_request_status" DEFAULT 'draft' NOT NULL,
	"owner_approved_by" uuid,
	"owner_approved_at" timestamp with time zone,
	"accountant_approved_by" uuid,
	"accountant_approved_at" timestamp with time zone,
	"corrected_entity_type" text,
	"corrected_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_alias_mappings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"source_label" text NOT NULL,
	"normalized_name" text NOT NULL,
	"target_master_id" uuid,
	"mapping_version" text,
	"confidence_score" numeric(18, 6),
	"status" "alias_mapping_status" DEFAULT 'candidate' NOT NULL,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_batch_approvals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"approver_role" "migration_approver_role" NOT NULL,
	"approver_user_id" uuid NOT NULL,
	"staged_data_hash" text NOT NULL,
	"cutover_manifest_hash" text NOT NULL,
	"template_version" text,
	"mapping_version" text,
	"validation_status" text NOT NULL,
	"reconciliation_status" text NOT NULL,
	"warning_summary" text,
	"approved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"batch_no" text NOT NULL,
	"status" "import_batch_status" DEFAULT 'draft' NOT NULL,
	"source_description" text,
	"template_name" text,
	"template_version" text,
	"mapping_version" text,
	"cutover_manifest_hash" text,
	"cutover_import_mode" "cutover_import_mode" DEFAULT 'opening_balance' NOT NULL,
	"staged_data_hash" text,
	"staged_row_count" integer DEFAULT 0 NOT NULL,
	"blocking_error_count" integer DEFAULT 0 NOT NULL,
	"warning_count" integer DEFAULT 0 NOT NULL,
	"accepted_warning_count" integer DEFAULT 0 NOT NULL,
	"validation_status" text,
	"reconciliation_status" text,
	"warning_summary" text,
	"committed_at" timestamp with time zone,
	"commit_effect_counts" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "import_batches_staged_count_check" CHECK (staged_row_count >= 0),
	CONSTRAINT "import_batches_blocking_count_check" CHECK (blocking_error_count >= 0),
	CONSTRAINT "import_batches_warning_count_check" CHECK (warning_count >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_cutover_manifests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"domain" text NOT NULL,
	"import_mode" "cutover_import_mode" DEFAULT 'opening_balance' NOT NULL,
	"cutoff_date" date,
	"source_coverage" text,
	"opening_balance_basis" text,
	"live_system_start_boundary" date,
	"reconciliation_owner" uuid,
	"manifest_hash" text NOT NULL,
	"is_approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"original_file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_hash" text NOT NULL,
	"file_size_bytes" integer,
	"content_type" text,
	"file_type" text NOT NULL,
	"superseded_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_human_review_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"staging_row_id" uuid,
	"review_reason" text NOT NULL,
	"assigned_to" uuid,
	"status" "review_item_decision" DEFAULT 'pending' NOT NULL,
	"decision" "review_item_decision",
	"decision_notes" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_reconciliation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"report_version" integer DEFAULT 1 NOT NULL,
	"metric_key" text NOT NULL,
	"expected_value" text,
	"staged_value" text,
	"committed_value" text,
	"difference_value" text,
	"status" "reconciliation_result_status" DEFAULT 'pending' NOT NULL,
	"accepted_by_owner" uuid,
	"accepted_by_accountant" uuid,
	"accepted_at" timestamp with time zone,
	"acceptance_reason" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "import_reconciliation_results_version_check" CHECK (report_version >= 1),
	CONSTRAINT "import_reconciliation_results_accepted_check" CHECK (status <> 'accepted_difference' OR (accepted_by_owner IS NOT NULL AND accepted_by_accountant IS NOT NULL AND acceptance_reason IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "import_staging_cells" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"staging_row_id" uuid NOT NULL,
	"source_column" text NOT NULL,
	"original_cell_value" text,
	"formula_text" text,
	"calculated_value" text,
	"transformed_value" text,
	"mapped_field" text,
	"transformation_type" text,
	"transformation_version" text,
	"confidence_level" numeric(18, 6),
	"warning_code" text,
	"review_status" text DEFAULT 'not_required' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_staging_rows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"import_file_id" uuid,
	"template_name" text,
	"source_sheet_name" text,
	"source_row_number" integer,
	"raw_row_json" jsonb,
	"transformed_row_json" jsonb,
	"validation_status" text DEFAULT 'pending' NOT NULL,
	"review_status" text DEFAULT 'not_required' NOT NULL,
	"ai_confidence" numeric(18, 6),
	"transformation_notes" text,
	"committed_entity_type" text,
	"committed_entity_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "import_staging_rows_source_row_check" CHECK (source_row_number IS NULL OR source_row_number >= 0)
);
--> statement-breakpoint
CREATE TABLE "import_template_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"template_name" text NOT NULL,
	"template_version" text NOT NULL,
	"schema_json" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "import_validation_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"import_batch_id" uuid NOT NULL,
	"staging_row_id" uuid,
	"severity" "validation_severity" NOT NULL,
	"error_code" text NOT NULL,
	"message" text NOT NULL,
	"field_name" text,
	"is_blocking" boolean DEFAULT false NOT NULL,
	"resolution_status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "import_validation_errors_blocking_check" CHECK (severity <> 'blocking_error' OR is_blocking = true)
);
--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_owner_approved_by_users_id_fk" FOREIGN KEY ("owner_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_accountant_approved_by_users_id_fk" FOREIGN KEY ("accountant_approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "historical_correction_requests" ADD CONSTRAINT "historical_correction_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD CONSTRAINT "import_alias_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD CONSTRAINT "import_alias_mappings_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD CONSTRAINT "import_alias_mappings_approved_by_users_id_fk" FOREIGN KEY ("approved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD CONSTRAINT "import_alias_mappings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_alias_mappings" ADD CONSTRAINT "import_alias_mappings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD CONSTRAINT "import_batch_approvals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD CONSTRAINT "import_batch_approvals_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD CONSTRAINT "import_batch_approvals_approver_user_id_users_id_fk" FOREIGN KEY ("approver_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD CONSTRAINT "import_batch_approvals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batch_approvals" ADD CONSTRAINT "import_batch_approvals_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_reconciliation_owner_users_id_fk" FOREIGN KEY ("reconciliation_owner") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_cutover_manifests" ADD CONSTRAINT "import_cutover_manifests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_files" ADD CONSTRAINT "import_files_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_staging_row_id_import_staging_rows_id_fk" FOREIGN KEY ("staging_row_id") REFERENCES "public"."import_staging_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_assigned_to_users_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_human_review_items" ADD CONSTRAINT "import_human_review_items_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_accepted_by_owner_users_id_fk" FOREIGN KEY ("accepted_by_owner") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_accepted_by_accountant_users_id_fk" FOREIGN KEY ("accepted_by_accountant") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_reconciliation_results" ADD CONSTRAINT "import_reconciliation_results_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_cells" ADD CONSTRAINT "import_staging_cells_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_cells" ADD CONSTRAINT "import_staging_cells_staging_row_id_import_staging_rows_id_fk" FOREIGN KEY ("staging_row_id") REFERENCES "public"."import_staging_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_cells" ADD CONSTRAINT "import_staging_cells_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_cells" ADD CONSTRAINT "import_staging_cells_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_import_file_id_import_files_id_fk" FOREIGN KEY ("import_file_id") REFERENCES "public"."import_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_staging_rows" ADD CONSTRAINT "import_staging_rows_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_template_versions" ADD CONSTRAINT "import_template_versions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_import_batch_id_import_batches_id_fk" FOREIGN KEY ("import_batch_id") REFERENCES "public"."import_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_staging_row_id_import_staging_rows_id_fk" FOREIGN KEY ("staging_row_id") REFERENCES "public"."import_staging_rows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_validation_errors" ADD CONSTRAINT "import_validation_errors_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "historical_correction_requests_tenant_doc_no_unique_idx" ON "historical_correction_requests" USING btree ("tenant_id","doc_no");--> statement-breakpoint
CREATE INDEX "historical_correction_requests_tenant_batch_idx" ON "historical_correction_requests" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "historical_correction_requests_tenant_original_idx" ON "historical_correction_requests" USING btree ("tenant_id","original_entity_type","original_entity_id");--> statement-breakpoint
CREATE INDEX "historical_correction_requests_tenant_status_idx" ON "historical_correction_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "import_alias_mappings_tenant_batch_idx" ON "import_alias_mappings" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_alias_mappings_tenant_status_idx" ON "import_alias_mappings" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "import_alias_mappings_tenant_entity_source_idx" ON "import_alias_mappings" USING btree ("tenant_id","entity_type","source_label");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batch_approvals_tenant_batch_role_unique_idx" ON "import_batch_approvals" USING btree ("tenant_id","import_batch_id","approver_role");--> statement-breakpoint
CREATE INDEX "import_batch_approvals_tenant_batch_idx" ON "import_batch_approvals" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_batch_approvals_tenant_approver_idx" ON "import_batch_approvals" USING btree ("tenant_id","approver_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_batches_tenant_batch_no_unique_idx" ON "import_batches" USING btree ("tenant_id","batch_no");--> statement-breakpoint
CREATE INDEX "import_batches_tenant_status_idx" ON "import_batches" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "import_cutover_manifests_tenant_batch_idx" ON "import_cutover_manifests" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_cutover_manifests_tenant_domain_idx" ON "import_cutover_manifests" USING btree ("tenant_id","domain");--> statement-breakpoint
CREATE UNIQUE INDEX "import_cutover_manifests_tenant_batch_domain_unique_idx" ON "import_cutover_manifests" USING btree ("tenant_id","import_batch_id","domain");--> statement-breakpoint
CREATE INDEX "import_files_tenant_batch_idx" ON "import_files" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_files_tenant_hash_idx" ON "import_files" USING btree ("tenant_id","file_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "import_files_tenant_batch_hash_type_unique_idx" ON "import_files" USING btree ("tenant_id","import_batch_id","file_hash","file_type");--> statement-breakpoint
CREATE INDEX "import_human_review_items_tenant_batch_idx" ON "import_human_review_items" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_human_review_items_tenant_status_idx" ON "import_human_review_items" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "import_reconciliation_results_tenant_batch_idx" ON "import_reconciliation_results" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_reconciliation_results_tenant_status_idx" ON "import_reconciliation_results" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "import_reconciliation_results_tenant_metric_idx" ON "import_reconciliation_results" USING btree ("tenant_id","metric_key");--> statement-breakpoint
CREATE INDEX "import_staging_cells_tenant_row_idx" ON "import_staging_cells" USING btree ("tenant_id","staging_row_id");--> statement-breakpoint
CREATE INDEX "import_staging_rows_tenant_batch_idx" ON "import_staging_rows" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_staging_rows_tenant_status_idx" ON "import_staging_rows" USING btree ("tenant_id","validation_status");--> statement-breakpoint
CREATE INDEX "import_staging_rows_tenant_committed_idx" ON "import_staging_rows" USING btree ("tenant_id","committed_entity_type","committed_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "import_template_versions_tenant_name_version_unique_idx" ON "import_template_versions" USING btree ("tenant_id","template_name","template_version");--> statement-breakpoint
CREATE INDEX "import_template_versions_tenant_active_idx" ON "import_template_versions" USING btree ("tenant_id","is_active");--> statement-breakpoint
CREATE INDEX "import_validation_errors_tenant_batch_idx" ON "import_validation_errors" USING btree ("tenant_id","import_batch_id");--> statement-breakpoint
CREATE INDEX "import_validation_errors_tenant_severity_idx" ON "import_validation_errors" USING btree ("tenant_id","severity");--> statement-breakpoint
CREATE INDEX "import_validation_errors_tenant_blocking_idx" ON "import_validation_errors" USING btree ("tenant_id","is_blocking");