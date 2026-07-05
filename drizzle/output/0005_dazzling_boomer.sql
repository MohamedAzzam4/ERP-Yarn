ALTER TABLE "raw_material_batches" ADD COLUMN "storage_location_id" uuid;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD COLUMN "purchase_order_ref" text;--> statement-breakpoint
ALTER TABLE "raw_material_batches" ADD COLUMN "notes" text;--> statement-breakpoint
CREATE INDEX "raw_material_batches_tenant_storage_location_idx" ON "raw_material_batches" USING btree ("tenant_id","storage_location_id");