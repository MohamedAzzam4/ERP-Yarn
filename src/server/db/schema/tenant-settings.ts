/**
 * `tenant_settings` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.3
 *   Fields: setting key/value JSON, level, runtime-editable flag,
 *   sensitivity, effective-from, changer and reason.
 *   Unique `(tenant_id, setting_key, effective_from)`.
 *   Level is `safe_ui`, `restricted_setup`, or `deferred_productization`.
 *
 * DB-level FK: changed_by -> users.id.
 */
import { text, uuid, boolean, timestamp, jsonb, pgTable, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow, userRefColumn } from "./_helpers";
import { users } from "./users";
import { tenantSettingLevel } from "./enums";

const usersId = users.id!;

export const tenantSettings = pgTable(
  "tenant_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    settingKey: text("setting_key").notNull(),
    settingValueJson: jsonb("setting_value_json").notNull(),
    settingLevel: tenantSettingLevel("setting_level").notNull(),
    isRuntimeEditable: boolean("is_runtime_editable").notNull().default(false),
    isSensitive: boolean("is_sensitive").notNull().default(false),
    effectiveFrom: timestamp("effective_from", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    changedBy: userRefColumn("changed_by", usersId),
    changedReason: text("changed_reason"),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("tenant_settings_key_effective_unique_idx").on(
      t.tenantId,
      t.settingKey,
      t.effectiveFrom,
    ),
    index("tenant_settings_tenant_key_idx").on(t.tenantId, t.settingKey),
    check(
      "tenant_settings_level_check",
      sql`setting_level IN ('safe_ui', 'restricted_setup', 'deferred_productization')`,
    ),
  ],
);

export type TenantSetting = typeof tenantSettings.$inferSelect;
export type NewTenantSetting = typeof tenantSettings.$inferInsert;
