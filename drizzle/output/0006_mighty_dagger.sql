ALTER TABLE "production_receipts" ADD COLUMN "subject_hash" text;--> statement-breakpoint
ALTER TABLE "production_receipts" ADD COLUMN "subject_version" integer DEFAULT 1;