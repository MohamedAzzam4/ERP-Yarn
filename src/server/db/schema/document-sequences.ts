/**
 * `document_sequences` table.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.5
 *   Document type, year, prefix and last number.
 *   Unique `(tenant_id, document_type, year)`.
 *   Lock the row during allocation; document tables also enforce
 *   tenant-scoped document-number uniqueness.
 *
 * The allocation protocol is:
 *   BEGIN TRANSACTION
 *   SELECT document_sequences row FOR UPDATE
 *   increment last_number
 *   generate doc_no
 *   commit with business transaction
 *
 * WP-00-03A scope: table + uniqueness only. The actual `SELECT FOR UPDATE`
 * allocation service lands in WP-01-03 (Audit, Idempotency and Document
 * Numbering Foundation). The concurrency test in this package verifies
 * the in-process determinism of the allocation protocol using a
 * simulated sequence table.
 */
import { text, uuid, integer, timestamp, pgTable, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tenantIdColumn, makeTenantOwnedRow } from "./_helpers";
import { users } from "./users";

const usersId = users.id!;

export const documentSequences = pgTable(
  "document_sequences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantIdColumn(),
    documentType: text("document_type").notNull(),
    year: integer("year").notNull(),
    prefix: text("prefix").notNull(),
    lastNumber: integer("last_number").notNull().default(0),
    ...makeTenantOwnedRow(usersId),
  },
  (t) => [
    uniqueIndex("document_sequences_tenant_type_year_unique_idx").on(
      t.tenantId,
      t.documentType,
      t.year,
    ),
    index("document_sequences_tenant_type_idx").on(t.tenantId, t.documentType),
    check("document_sequences_year_check", sql`year >= 2020`),
    check("document_sequences_last_number_check", sql`last_number >= 0`),
  ],
);

export type DocumentSequence = typeof documentSequences.$inferSelect;
export type NewDocumentSequence = typeof documentSequences.$inferInsert;
