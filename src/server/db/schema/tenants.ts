/**
 * `tenants` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.1
 *   Fields: company name, default language `ar`, ISO currency code,
 *   required timezone, status, and terminology version.
 *   Current-client seed uses `currency_code = EGP` and timezone
 *   `Africa/Cairo`; timezone remains tenant-configurable.
 *
 * The Arabic display label for EGP is `جنيه` (Contract 03 §7.1).
 *
 * NOTE: `tenants` is the only tenant-owned table whose `id` is the
 * tenant identifier itself (no separate `tenant_id` FK). All other
 * tenant-owned tables reference `tenants.id` via the `tenantIdColumn()`
 * helper.
 */
import { text, uuid, timestamp, pgTable, uniqueIndex } from "drizzle-orm/pg-core";
import { tenantStatus } from "./enums";

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyName: text("company_name").notNull(),
    defaultLanguage: text("default_language").notNull().default("ar"),
    currencyCode: text("currency_code").notNull().default("EGP"),
    timezone: text("timezone").notNull().default("Africa/Cairo"),
    status: tenantStatus("status").notNull().default("active"),
    terminologyVersion: text("terminology_version"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }),
  },
  (t) => [
    uniqueIndex("tenants_company_name_unique_idx").on(t.companyName),
  ],
);

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
