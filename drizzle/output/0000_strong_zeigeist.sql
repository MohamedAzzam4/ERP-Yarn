CREATE TYPE "public"."alert_severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."alert_state" AS ENUM('open', 'acknowledged', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."approval_request_state" AS ENUM('active', 'decided', 'invalidated', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."approval_risk_level" AS ENUM('standard', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('draft', 'pending_approval', 'approved', 'rejected', 'cancelled', 'reversed');--> statement-breakpoint
CREATE TYPE "public"."idempotency_state" AS ENUM('in_progress', 'succeeded', 'business_failed', 'retryable_failed');--> statement-breakpoint
CREATE TYPE "public"."record_origin" AS ENUM('manual_live', 'excel_import', 'ai_assisted_import', 'manual_historical_entry', 'system_generated');--> statement-breakpoint
CREATE TYPE "public"."record_period" AS ENUM('live', 'historical');--> statement-breakpoint
CREATE TYPE "public"."role_code" AS ENUM('owner', 'accountant', 'warehouse_employee', 'production_employee', 'quality_employee');--> statement-breakpoint
CREATE TYPE "public"."role_system_flag" AS ENUM('system', 'custom');--> statement-breakpoint
CREATE TYPE "public"."tenant_setting_level" AS ENUM('safe_ui', 'restricted_setup', 'deferred_productization');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."worker_scope_type" AS ENUM('location', 'external_factory', 'task_type');--> statement-breakpoint
CREATE TABLE "approval_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_type" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"risk_level" "approval_risk_level" DEFAULT 'standard' NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	"state" "approval_request_state" DEFAULT 'active' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_notes" text,
	"idempotency_key" text,
	"subject_version" integer DEFAULT 1 NOT NULL,
	"subject_hash" text NOT NULL,
	"submitted_child_version_summary" jsonb,
	"invalidated_by" uuid,
	"invalidated_at" timestamp with time zone,
	"invalidation_reason" text,
	"superseding_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "approval_requests_subject_version_check" CHECK (subject_version >= 1),
	CONSTRAINT "approval_requests_subject_hash_nonempty_check" CHECK (length(subject_hash) > 0)
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action_type" text NOT NULL,
	"old_values_json" jsonb,
	"new_values_json" jsonb,
	"reason" text,
	"approval_request_id" uuid,
	"idempotency_key" text,
	"ip_address" text,
	"device_info" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_sequences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"document_type" text NOT NULL,
	"year" integer NOT NULL,
	"prefix" text NOT NULL,
	"last_number" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "document_sequences_year_check" CHECK (year >= 2020),
	CONSTRAINT "document_sequences_last_number_check" CHECK (last_number >= 0)
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"operation_scope" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"state" "idempotency_state" DEFAULT 'in_progress' NOT NULL,
	"entity_type" text,
	"entity_id" uuid,
	"response_code" integer,
	"response_body" jsonb,
	"owner_token" text,
	"attempt_count" integer DEFAULT 1 NOT NULL,
	"lease_heartbeat_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"last_error_class" text,
	"initiated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "idempotency_records_attempt_count_check" CHECK (attempt_count >= 1),
	CONSTRAINT "idempotency_records_state_check" CHECK (state IN ('in_progress', 'succeeded', 'business_failed', 'retryable_failed'))
);
--> statement-breakpoint
CREATE TABLE "operational_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"severity" "alert_severity" NOT NULL,
	"alert_type" text NOT NULL,
	"source_entity_type" text,
	"source_entity_id" uuid,
	"message_key" text NOT NULL,
	"message_details" jsonb,
	"state" "alert_state" DEFAULT 'open' NOT NULL,
	"detected_by" uuid,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolution_reason" text,
	"audit_log_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "operational_alerts_resolved_window_check" CHECK ((state <> 'resolved' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)))
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"permission_key" text NOT NULL,
	"module" text NOT NULL,
	"action" text NOT NULL,
	"field_key" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "role_permissions_pk" PRIMARY KEY("role_id","permission_id")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"role_code" "role_code" NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"is_system_role" boolean DEFAULT true NOT NULL,
	"system_flag" "role_system_flag" DEFAULT 'system' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"setting_key" text NOT NULL,
	"setting_value_json" jsonb NOT NULL,
	"setting_level" "tenant_setting_level" NOT NULL,
	"is_runtime_editable" boolean DEFAULT false NOT NULL,
	"is_sensitive" boolean DEFAULT false NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	"changed_by" uuid,
	"changed_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "tenant_settings_level_check" CHECK (setting_level IN ('safe_ui', 'restricted_setup', 'deferred_productization'))
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"default_language" text DEFAULT 'ar' NOT NULL,
	"currency_code" text DEFAULT 'EGP' NOT NULL,
	"timezone" text DEFAULT 'Africa/Cairo' NOT NULL,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"terminology_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "terminology_labels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"label_key" text NOT NULL,
	"module" text NOT NULL,
	"default_ar_label" text NOT NULL,
	"source_ar_alias" text,
	"en_label" text,
	"is_approved" boolean DEFAULT false NOT NULL,
	"is_provisional" boolean DEFAULT true NOT NULL,
	"is_user_editable_mvp" boolean DEFAULT false NOT NULL,
	"notes" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "user_roles" (
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "user_roles_pk" PRIMARY KEY("user_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"auth_id" text NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"language_preference" text DEFAULT 'ar' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "worker_scope_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"scope_type" "worker_scope_type" NOT NULL,
	"target_identifier" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"effective_from" timestamp with time zone,
	"effective_to" timestamp with time zone,
	"assigned_by" uuid NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_at" timestamp with time zone,
	"updated_by" uuid,
	CONSTRAINT "worker_scope_effective_window_check" CHECK ((effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from))
);
--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_invalidated_by_users_id_fk" FOREIGN KEY ("invalidated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_sequences" ADD CONSTRAINT "document_sequences_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_detected_by_users_id_fk" FOREIGN KEY ("detected_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_alerts" ADD CONSTRAINT "operational_alerts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_permissions_id_fk" FOREIGN KEY ("permission_id") REFERENCES "public"."permissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "roles" ADD CONSTRAINT "roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminology_labels" ADD CONSTRAINT "terminology_labels_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminology_labels" ADD CONSTRAINT "terminology_labels_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terminology_labels" ADD CONSTRAINT "terminology_labels_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_roles" ADD CONSTRAINT "user_roles_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_scope_assignments" ADD CONSTRAINT "worker_scope_assignments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_scope_assignments" ADD CONSTRAINT "worker_scope_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_scope_assignments" ADD CONSTRAINT "worker_scope_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_scope_assignments" ADD CONSTRAINT "worker_scope_assignments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "worker_scope_assignments" ADD CONSTRAINT "worker_scope_assignments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_tenant_idempotency_unique_idx" ON "approval_requests" USING btree ("tenant_id","idempotency_key") WHERE idempotency_key IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_requests_active_entity_unique_idx" ON "approval_requests" USING btree ("tenant_id","entity_type","entity_id","request_type") WHERE state = 'active';--> statement-breakpoint
CREATE INDEX "approval_requests_tenant_state_idx" ON "approval_requests" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "approval_requests_tenant_entity_idx" ON "approval_requests" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "approval_requests_tenant_requested_by_idx" ON "approval_requests" USING btree ("tenant_id","requested_by");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_entity_idx" ON "audit_logs" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_user_idx" ON "audit_logs" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_action_idx" ON "audit_logs" USING btree ("tenant_id","action_type");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_created_at_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_tenant_approval_request_idx" ON "audit_logs" USING btree ("tenant_id","approval_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "document_sequences_tenant_type_year_unique_idx" ON "document_sequences" USING btree ("tenant_id","document_type","year");--> statement-breakpoint
CREATE INDEX "document_sequences_tenant_type_idx" ON "document_sequences" USING btree ("tenant_id","document_type");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_tenant_scope_key_unique_idx" ON "idempotency_records" USING btree ("tenant_id","operation_scope","idempotency_key");--> statement-breakpoint
CREATE INDEX "idempotency_records_tenant_state_idx" ON "idempotency_records" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "idempotency_records_tenant_entity_idx" ON "idempotency_records" USING btree ("tenant_id","entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idempotency_records_lease_expires_idx" ON "idempotency_records" USING btree ("lease_expires_at");--> statement-breakpoint
CREATE INDEX "operational_alerts_tenant_state_idx" ON "operational_alerts" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE INDEX "operational_alerts_tenant_severity_idx" ON "operational_alerts" USING btree ("tenant_id","severity");--> statement-breakpoint
CREATE INDEX "operational_alerts_tenant_type_idx" ON "operational_alerts" USING btree ("tenant_id","alert_type");--> statement-breakpoint
CREATE INDEX "operational_alerts_tenant_source_idx" ON "operational_alerts" USING btree ("tenant_id","source_entity_type","source_entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "permissions_tenant_key_unique_idx" ON "permissions" USING btree ("tenant_id","permission_key");--> statement-breakpoint
CREATE INDEX "permissions_tenant_module_idx" ON "permissions" USING btree ("tenant_id","module");--> statement-breakpoint
CREATE INDEX "permissions_tenant_action_idx" ON "permissions" USING btree ("tenant_id","action");--> statement-breakpoint
CREATE INDEX "role_permissions_tenant_role_idx" ON "role_permissions" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE INDEX "role_permissions_tenant_permission_idx" ON "role_permissions" USING btree ("tenant_id","permission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_tenant_role_code_unique_idx" ON "roles" USING btree ("tenant_id","role_code");--> statement-breakpoint
CREATE INDEX "roles_tenant_idx" ON "roles" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_settings_key_effective_unique_idx" ON "tenant_settings" USING btree ("tenant_id","setting_key","effective_from");--> statement-breakpoint
CREATE INDEX "tenant_settings_tenant_key_idx" ON "tenant_settings" USING btree ("tenant_id","setting_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_company_name_unique_idx" ON "tenants" USING btree ("company_name");--> statement-breakpoint
CREATE UNIQUE INDEX "terminology_labels_tenant_key_unique_idx" ON "terminology_labels" USING btree ("tenant_id","label_key");--> statement-breakpoint
CREATE INDEX "terminology_labels_tenant_module_idx" ON "terminology_labels" USING btree ("tenant_id","module");--> statement-breakpoint
CREATE INDEX "user_roles_tenant_user_idx" ON "user_roles" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "user_roles_tenant_role_idx" ON "user_roles" USING btree ("tenant_id","role_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_tenant_email_unique_idx" ON "users" USING btree ("tenant_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_auth_id_unique_idx" ON "users" USING btree ("auth_id");--> statement-breakpoint
CREATE INDEX "users_tenant_status_idx" ON "users" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "worker_scope_active_unique_idx" ON "worker_scope_assignments" USING btree ("tenant_id","user_id","scope_type","target_identifier") WHERE is_active = true;--> statement-breakpoint
CREATE INDEX "worker_scope_tenant_user_idx" ON "worker_scope_assignments" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "worker_scope_tenant_type_target_idx" ON "worker_scope_assignments" USING btree ("tenant_id","scope_type","target_identifier");--> statement-breakpoint

-- ===========================================================================
-- Manual FK constraints (WP-00-03A correction pass)
-- ===========================================================================
-- These constraints are NOT generated by Drizzle Kit because they are
-- self-referential FKs on the `users` table (users.created_by -> users.id,
-- users.updated_by -> users.id). Drizzle's `references(() => users.id)`
-- inside the `users` table definition creates a TypeScript self-reference
-- cycle that TS strict mode cannot resolve. Per the WP-00-03A correction
-- pass, these FKs are added here as explicit manual SQL constraints.
--
-- Contract: docs/contracts/03_database_schema_contract.md §5.1
--   "created_by UUID NULL REFERENCES users(id)
--    updated_by UUID NULL REFERENCES users(id)"
-- ===========================================================================

ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ===========================================================================
-- Audit append-only DB-level protection (WP-00-03A correction pass)
-- ===========================================================================
-- Contract: docs/contracts/03_database_schema_contract.md §7.7
--   "Append-only tenant/user/entity/action, old/new JSON, reason,
--    approval request, idempotency key, IP/device and timestamp.
--    Application roles cannot update/delete. Important audit rows are
--    written in the business transaction."
--
-- Contract: docs/contracts/13_work_packages.md WP-00-03A Tests/Acceptance:
--   "audit immutability"
--
-- This trigger function rejects any UPDATE or DELETE on `audit_logs`.
-- Only INSERT is permitted. The table also has no `updated_at`/`deleted_at`
-- columns at the schema level (defense in depth).
--
-- A DB superuser can still bypass triggers (e.g. for emergency recovery),
-- but that is not an application path and is not authorized by any ERP
-- role. Application roles (owner, accountant, workers) cannot disable
-- triggers.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_modification"()
RETURNS "pg_catalog"."trigger"
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are not permitted (Contract 03 §7.7). Action: %, User: %, Row ID: %',
    TG_OP,
    current_user,
    OLD.id;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "public"."audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."prevent_audit_log_modification"();--> statement-breakpoint

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "public"."audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."prevent_audit_log_modification"();--> statement-breakpoint
--> statement-breakpoint

-- ===========================================================================
-- Manual FK constraints (WP-00-03A correction pass)
-- ===========================================================================
-- These constraints are NOT generated by Drizzle Kit because they are
-- self-referential FKs on the `users` table (users.created_by -> users.id,
-- users.updated_by -> users.id). Drizzle's `references(() => users.id)`
-- inside the `users` table definition creates a TypeScript self-reference
-- cycle that TS strict mode cannot resolve. Per the WP-00-03A correction
-- pass, these FKs are added here as explicit manual SQL constraints.
--
-- Contract: docs/contracts/03_database_schema_contract.md §5.1
--   "created_by UUID NULL REFERENCES users(id)
--    updated_by UUID NULL REFERENCES users(id)"
-- ===========================================================================

ALTER TABLE "users" ADD CONSTRAINT "users_created_by_users_id_fk"
  FOREIGN KEY ("created_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "users" ADD CONSTRAINT "users_updated_by_users_id_fk"
  FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- ===========================================================================
-- Audit append-only DB-level protection (WP-00-03A correction pass)
-- ===========================================================================
-- Contract: docs/contracts/03_database_schema_contract.md §7.7
--   "Append-only tenant/user/entity/action, old/new JSON, reason,
--    approval request, idempotency key, IP/device and timestamp.
--    Application roles cannot update/delete. Important audit rows are
--    written in the business transaction."
--
-- Contract: docs/contracts/13_work_packages.md WP-00-03A Tests/Acceptance:
--   "audit immutability"
--
-- This trigger function rejects any UPDATE or DELETE on `audit_logs`.
-- Only INSERT is permitted. The table also has no `updated_at`/`deleted_at`
-- columns at the schema level (defense in depth).
--
-- A DB superuser can still bypass triggers (e.g. for emergency recovery),
-- but that is not an application path and is not authorized by any ERP
-- role. Application roles (owner, accountant, workers) cannot disable
-- triggers.
-- ===========================================================================

CREATE OR REPLACE FUNCTION "public"."prevent_audit_log_modification"()
RETURNS "pg_catalog"."trigger"
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: UPDATE and DELETE are not permitted (Contract 03 §7.7). Action: %, User: %, Row ID: %',
    TG_OP,
    current_user,
    OLD.id;
  RETURN NULL;
END;
$$;--> statement-breakpoint

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "public"."audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."prevent_audit_log_modification"();--> statement-breakpoint

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "public"."audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "public"."prevent_audit_log_modification"();--> statement-breakpoint
