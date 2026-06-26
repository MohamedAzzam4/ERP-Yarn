/**
 * `terminology_labels` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.4
 *   Stable key, module, Arabic/English labels, source aliases,
 *   approved/provisional classification, editability, notes and version.
 *   Unique `(tenant_id, label_key)`.
 *
 * Contract 02 §Arabic Terminology: business logic uses stable internal
 * keys. UI labels come from a terminology layer with `approved_terms`
 * and `provisional_terms`; provisional labels remain replaceable and
 * must not be hardcoded. Backend work must not be blocked by provisional
 * wording, but GLM must not invent Arabic labels.
 *
 * Initial approved/probable mappings (Contract 02 / Decision Log):
 *   raw_batch = رسالة خام
 *   single_yarn_lot = لوط فرد
 *   twisted_yarn_lot = لوط زوى
 *   single_yarn_factory = مصنع الفرد
 *   twisting_factory = مصنع الزوى
 *   inventory_movements = حركة مخازن
 */
import { text, uuid, boolean, integer, pgTable, uniqueIndex, index } from "drizzle-orm/pg-core";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";

const usersId = users.id!;

export const terminologyLabels = pgTable(
  "terminology_labels",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    labelKey: text("label_key").notNull(),
    module: text("module").notNull(),
    defaultArLabel: text("default_ar_label").notNull(),
    sourceArAlias: text("source_ar_alias"),
    enLabel: text("en_label"),
    isApproved: boolean("is_approved").notNull().default(false),
    isProvisional: boolean("is_provisional").notNull().default(true),
    isUserEditableMvp: boolean("is_user_editable_mvp").notNull().default(false),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("terminology_labels_tenant_key_unique_idx").on(
      t.tenantId,
      t.labelKey,
    ),
    index("terminology_labels_tenant_module_idx").on(t.tenantId, t.module),
  ],
);

export type TerminologyLabel = typeof terminologyLabels.$inferSelect;
export type NewTerminationLabel = typeof terminologyLabels.$inferInsert;
