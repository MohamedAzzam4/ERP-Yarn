/**
 * Document sequence allocation service.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.5
 *   Allocation protocol: BEGIN → SELECT FOR UPDATE → increment → commit
 *
 * Contract: docs/contracts/09_api_contracts.md §5
 *   "Do not accept authoritative ... document number ... from the request body."
 */
import "server-only";
import { SequenceAllocationFailedError, ClientDocumentNumberRejectedError } from "./errors";

export interface DocumentSequenceAllocationInput {
  tenantId: string;
  documentType: string;
  year: number;
  entityType?: string;
}

export interface AllocatedDocumentNumber {
  sequenceNumber: number;
  docNo: string;
  prefix: string;
  year: number;
  tenantId: string;
  documentType: string;
}

export interface DocumentSequenceRow {
  id: string;
  tenantId: string;
  documentType: string;
  year: number;
  prefix: string;
  lastNumber: number;
}

export interface DocumentSequenceTransactionHandle {
  findForUpdate(tenantId: string, documentType: string, year: number): Promise<DocumentSequenceRow | null>;
  insert(tenantId: string, documentType: string, year: number, prefix: string): Promise<DocumentSequenceRow>;
  updateLastNumber(id: string, newValue: number): Promise<void>;
}

const DEFAULT_PREFIXES: Record<string, string> = {
  raw_receipt: "RC", raw_receipt_approval: "RCA",
  transfer: "TR", transfer_approval: "TRA",
  adjustment: "AD", adjustment_approval: "ADA",
  return_receipt: "RR", reversal: "REV", stock_block: "BLK", stock_unblock: "UBL",
  sales_order: "SO", sales_approval: "SOA",
  reservation: "RES", // WP-03-03: stock reservation numbering
  production_order: "PO", production_issue: "PI",
  production_receipt: "PR", production_wip_return: "WR",
  // WP-04-03: receive_from_production + production_waste movement doc_no prefixes.
  // The receipt doc_no uses `production_receipt`; these are for the linked
  // stock_movement rows posted by InventoryLedgerService during receipt approval.
  production_receive: "PRC",
  production_waste: "PW",
  payment: "PAY", return_request: "RR", return_approval: "RRA",
  quality_test: "QT", complaint: "CMP",
  migration_batch: "MIG", backup: "BAK",
  account_entry: "AE", // WP-02-03: SubledgerService account entry numbering
  direct_cost: "DC", // WP-05-05: direct cost numbering
};

function resolvePrefix(documentType: string, year: number, existingRow: DocumentSequenceRow | null, explicitPrefix?: string): string {
  if (existingRow) return existingRow.prefix;
  if (explicitPrefix) return explicitPrefix;
  const defaultPrefix = DEFAULT_PREFIXES[documentType];
  if (!defaultPrefix) {
    throw new SequenceAllocationFailedError(documentType, year, {
      reason: `No default prefix for document type '${documentType}'. Register a default or pre-seed the document_sequences table.`,
    });
  }
  return defaultPrefix;
}

export function formatDocNo(prefix: string, year: number, sequenceNumber: number): string {
  return `${prefix}-${year}-${sequenceNumber.toString().padStart(6, "0")}`;
}

export async function allocateDocumentNumber(
  tx: DocumentSequenceTransactionHandle,
  input: DocumentSequenceAllocationInput,
  explicitPrefix?: string,
): Promise<AllocatedDocumentNumber> {
  let row = await tx.findForUpdate(input.tenantId, input.documentType, input.year);

  if (!row) {
    const prefix = resolvePrefix(input.documentType, input.year, null, explicitPrefix);
    try {
      row = await tx.insert(input.tenantId, input.documentType, input.year, prefix);
    } catch (e) {
      throw new SequenceAllocationFailedError(input.documentType, input.year, { cause: e, reason: "Failed to insert new document_sequences row." });
    }
  }

  const newSequenceNumber = row.lastNumber + 1;
  try {
    await tx.updateLastNumber(row.id, newSequenceNumber);
  } catch (e) {
    throw new SequenceAllocationFailedError(input.documentType, input.year, { cause: e, reason: "Failed to increment last_number." });
  }

  return {
    sequenceNumber: newSequenceNumber,
    docNo: formatDocNo(row.prefix, input.year, newSequenceNumber),
    prefix: row.prefix,
    year: input.year,
    tenantId: input.tenantId,
    documentType: input.documentType,
  };
}

export const CLIENT_DOCUMENT_NUMBER_FIELDS: ReadonlySet<string> = new Set([
  "doc_no", "docNo", "document_number", "documentNumber", "sequence_number", "sequenceNumber",
]);

export function rejectClientDocumentNumber(body: Record<string, unknown>): void {
  for (const fieldKey of Object.keys(body)) {
    if (CLIENT_DOCUMENT_NUMBER_FIELDS.has(fieldKey)) {
      throw new ClientDocumentNumberRejectedError(fieldKey);
    }
  }
}

export class InProcessDocumentSequenceStore implements DocumentSequenceTransactionHandle {
  private rows = new Map<string, DocumentSequenceRow>();
  private locks = new Map<string, Promise<unknown>>();
  private idCounter = 0;

  clear(): void { this.rows.clear(); this.locks.clear(); this.idCounter = 0; }

  private key(tenantId: string, documentType: string, year: number): string {
    return `${tenantId}:${documentType}:${year}`;
  }

  async acquireLock(tenantId: string, documentType: string, year: number): Promise<() => void> {
    const lockKey = this.key(tenantId, documentType, year);
    const previousLock = this.locks.get(lockKey) ?? Promise.resolve();
    let release!: () => void;
    const acquired = new Promise<void>((resolve) => { release = () => resolve(); });
    this.locks.set(lockKey, acquired);
    await previousLock;
    return release;
  }

  async findForUpdate(tenantId: string, documentType: string, year: number): Promise<DocumentSequenceRow | null> {
    const row = this.rows.get(this.key(tenantId, documentType, year));
    return row ? { ...row } : null;
  }

  async insert(tenantId: string, documentType: string, year: number, prefix: string): Promise<DocumentSequenceRow> {
    const key = this.key(tenantId, documentType, year);
    const row: DocumentSequenceRow = { id: `seq-${++this.idCounter}`, tenantId, documentType, year, prefix, lastNumber: 0 };
    this.rows.set(key, row);
    return { ...row };
  }

  async updateLastNumber(id: string, newValue: number): Promise<void> {
    for (const [key, row] of this.rows.entries()) {
      if (row.id === id) {
        this.rows.set(key, { ...row, lastNumber: newValue });
        return;
      }
    }
    throw new Error(`Document sequence '${id}' not found`);
  }

  peekLastNumber(tenantId: string, documentType: string, year: number): number | null {
    const row = this.rows.get(this.key(tenantId, documentType, year));
    return row ? row.lastNumber : null;
  }

  preSeed(tenantId: string, documentType: string, year: number, prefix: string, lastNumber: number): void {
    this.rows.set(this.key(tenantId, documentType, year), {
      id: `seq-preseed-${++this.idCounter}`, tenantId, documentType, year, prefix, lastNumber,
    });
  }
}

export async function allocateDocumentNumberWithLock(
  store: InProcessDocumentSequenceStore,
  input: DocumentSequenceAllocationInput,
  explicitPrefix?: string,
): Promise<AllocatedDocumentNumber> {
  const release = await store.acquireLock(input.tenantId, input.documentType, input.year);
  try {
    return await allocateDocumentNumber(store, input, explicitPrefix);
  } finally {
    release();
  }
}

export { SequenceAllocationFailedError, ClientDocumentNumberRejectedError } from "./errors";
