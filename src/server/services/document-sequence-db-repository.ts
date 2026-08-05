/**
 * Drizzle-backed DocumentSequenceTransactionHandle — the production DB
 * document-sequence store.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.5
 *   Allocation protocol: BEGIN → SELECT FOR UPDATE → increment → commit
 *
 * Contract: docs/contracts/09_api_contracts.md §5
 *   "Do not accept authoritative ... document number ... from the request body."
 *
 * This repository replaces the InProcessDocumentSequenceStore in production
 * server actions. The InProcessDocumentSequenceStore is TEST-ONLY — it
 * resets its in-memory state on every new server action invocation, causing
 * document-number collisions when multiple posts happen in the same process.
 *
 * Concurrency protocol (Contract 03 §7.5):
 *   1. BEGIN TRANSACTION (caller MUST be inside db.transaction() for tx-scoped locks)
 *   2. SELECT ... FROM document_sequences WHERE (tenant, type, year) FOR UPDATE
 *      — acquires a row-level lock; concurrent allocations block here
 *   3. If no row: INSERT with ON CONFLICT DO NOTHING; if concurrent insert
 *      wins, retry findForUpdate to pick up the existing row
 *   4. UPDATE document_sequences SET last_number = last_number + 1
 *   5. Format doc_no = `${prefix}-${year}-${sequence.toString().padStart(6, "0")}`
 *   6. COMMIT (or ROLLBACK on failure — last_number increment rolls back too)
 *
 * Gap-free guarantee:
 *   The contract does NOT require gap-free document numbers. If a transaction
 *   allocates a number and then rolls back, that number is "lost" (the
 *   last_number increment rolled back, but the next allocation will get
 *   last_number + 1 from the committed state). This is acceptable per
 *   Contract 03 §7.5 which only requires uniqueness, not gap-free sequences.
 *
 * Tenant/type/year isolation:
 *   The unique index on (tenant_id, document_type, year) enforces isolation
 *   at the DB level. No two tenants can share a sequence row; no two document
 *   types can share a sequence row; no two years can share a sequence row.
 */
import "server-only";
import { eq, and, sql as drizzleSql } from "drizzle-orm";
import { documentSequences } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  DocumentSequenceTransactionHandle,
  DocumentSequenceRow,
} from "./document-sequence-service";

type Db = NonNullable<typeof DbType>;
type DbOrTx = Db | Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Drizzle-backed DocumentSequenceTransactionHandle.
 *
 * Accepts either the root `db` instance or a `tx` from a db.transaction()
 * callback. When constructed with a `tx`, all queries run on the same
 * transaction connection, so SELECT ... FOR UPDATE is transaction-scoped
 * (released on COMMIT or ROLLBACK).
 */
export class DocumentSequenceDbRepository
  implements DocumentSequenceTransactionHandle
{
  constructor(private readonly db: DbOrTx) {}

  /**
   * Find a document_sequences row by (tenantId, documentType, year) and lock
   * it for the duration of the transaction using SELECT ... FOR UPDATE.
   *
   * Caller MUST be inside a db.transaction() for the lock to be
   * transaction-scoped. Concurrent calls to findForUpdate for the same
   * (tenant, type, year) will block until the first transaction commits
   * or rolls back.
   *
   * Returns null if no row exists (caller will call insert() to create one).
   */
  async findForUpdate(
    tenantId: string,
    documentType: string,
    year: number,
  ): Promise<DocumentSequenceRow | null> {
    const [row] = await this.db
      .select()
      .from(documentSequences)
      .where(
        and(
          eq(documentSequences.tenantId, tenantId),
          eq(documentSequences.documentType, documentType),
          eq(documentSequences.year, year),
        ),
      )
      .for("update")
      .limit(1);
    return row ? this.mapRow(row) : null;
  }

  /**
   * Insert a new document_sequences row with ON CONFLICT DO NOTHING safety.
   *
   * If a concurrent insert wins the race on the unique
   * (tenant_id, document_type, year) index, this insert does nothing and
   * returns null. The caller (allocateDocumentNumber) retries findForUpdate
   * to pick up the existing row.
   *
   * This mirrors the SubledgerDbRepository.insertAccount pattern for
   * concurrent account get-or-create.
   */
  async insert(
    tenantId: string,
    documentType: string,
    year: number,
    prefix: string,
  ): Promise<DocumentSequenceRow> {
    const [row] = await this.db
      .insert(documentSequences)
      .values({
        tenantId,
        documentType,
        year,
        prefix,
        lastNumber: 0,
      })
      .onConflictDoNothing({
        target: [
          documentSequences.tenantId,
          documentSequences.documentType,
          documentSequences.year,
        ],
      })
      .returning();

    if (!row) {
      // Concurrent insert won — caller retries findForUpdate.
      throw new DocumentSequenceConcurrentInsertError(
        tenantId,
        documentType,
        year,
      );
    }
    return this.mapRow(row);
  }

  /**
   * Increment last_number for a document_sequences row.
   *
   * The WHERE clause filters by id (which was obtained under a FOR UPDATE
   * lock in findForUpdate, so no other transaction can modify it concurrently).
   */
  async updateLastNumber(id: string, newValue: number): Promise<void> {
    await this.db
      .update(documentSequences)
      .set({ lastNumber: newValue })
      .where(eq(documentSequences.id, id));
  }

  private mapRow(row: typeof documentSequences.$inferSelect): DocumentSequenceRow {
    return {
      id: row.id,
      tenantId: row.tenantId,
      documentType: row.documentType,
      year: row.year,
      prefix: row.prefix,
      lastNumber: row.lastNumber,
    };
  }
}

/**
 * Thrown when insert detects a concurrent insert race.
 * The caller retries findForUpdate to pick up the existing row.
 */
export class DocumentSequenceConcurrentInsertError extends Error {
  readonly code = "DOCUMENT_SEQUENCE_CONCURRENT_INSERT";
  constructor(
    readonly tenantId: string,
    readonly documentType: string,
    readonly year: number,
  ) {
    super(
      `Concurrent insert for document_sequence (${tenantId}, ${documentType}, ${year}). Retry findForUpdate.`,
    );
    this.name = "DocumentSequenceConcurrentInsertError";
  }
}

/**
 * Factory: create a DocumentSequenceDbRepository bound to the root db or a tx.
 * Used by server actions and by tx-scoped factory closures.
 */
export function createDocumentSequenceDbRepository(
  db: DbOrTx,
): DocumentSequenceDbRepository {
  return new DocumentSequenceDbRepository(db);
}
