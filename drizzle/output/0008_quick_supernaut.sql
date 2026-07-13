ALTER TABLE "sales_orders" ADD COLUMN "subject_hash" text;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD COLUMN "subject_version" integer DEFAULT 1;