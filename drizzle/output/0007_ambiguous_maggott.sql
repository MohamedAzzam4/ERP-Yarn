ALTER TABLE "production_wip_returns" ADD COLUMN "subject_hash" text;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD COLUMN "subject_version" integer DEFAULT 1;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD COLUMN "confirmed_by" uuid;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD COLUMN "confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "production_wip_returns" ADD CONSTRAINT "production_wip_returns_confirmed_by_users_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;