/**
 * In-memory PaymentRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 *
 * Supports snapshot/restore for rollback simulation in atomicity tests.
 */
import type { Payment, PaymentSettlement } from "@/server/db/schema/subledger";
import type {
  PaymentRepository,
  NewPaymentInput,
  UpdatePaymentStatusInput,
  NewSettlementInput,
} from "../payment-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryPaymentRepository implements PaymentRepository {
  private payments = new Map<string, Payment>();
  private settlements = new Map<string, PaymentSettlement>();
  private paymentCounter = 0;
  private settlementCounter = 0;
  /** Test-only: tracks lockPaymentEntry / lockSettledEntry calls. */
  lockCalls: string[] = [];

  // -------------------------------------------------------------------------
  // Snapshot/restore for transactional test rollback.
  // -------------------------------------------------------------------------

  snapshot(): {
    payments: Map<string, Payment>;
    settlements: Map<string, PaymentSettlement>;
    paymentCounter: number;
    settlementCounter: number;
  } {
    return {
      payments: new Map([...this.payments].map(([k, v]) => [k, { ...v }])),
      settlements: new Map([...this.settlements].map(([k, v]) => [k, { ...v }])),
      paymentCounter: this.paymentCounter,
      settlementCounter: this.settlementCounter,
    };
  }

  restore(snap: {
    payments: Map<string, Payment>;
    settlements: Map<string, PaymentSettlement>;
    paymentCounter: number;
    settlementCounter: number;
  }): void {
    this.payments = new Map([...snap.payments].map(([k, v]) => [k, { ...v }]));
    this.settlements = new Map([...snap.settlements].map(([k, v]) => [k, { ...v }]));
    this.paymentCounter = snap.paymentCounter;
    this.settlementCounter = snap.settlementCounter;
  }

  // -------------------------------------------------------------------------
  // payments
  // -------------------------------------------------------------------------

  async insertPayment(row: NewPaymentInput): Promise<Payment> {
    this.paymentCounter++;
    const id = nid("pay", this.paymentCounter);
    const payment: Payment = {
      id,
      tenantId: row.tenantId,
      paymentNo: row.paymentNo,
      paymentDate: row.paymentDate,
      accountId: row.accountId,
      amount: row.amount,
      paymentDirection: row.paymentDirection,
      paymentMethod: row.paymentMethod,
      status: row.status,
      notes: row.notes ?? null,
      attachmentFileId: null,
      postedEntryId: row.postedEntryId ?? null,
      reversalOfPaymentId: null,
      idempotencyKey: row.idempotencyKey,
      approvalRequestId: null,
      recordOrigin: "manual_live",
      recordPeriod: "live",
      isLocked: false,
      importBatchId: null,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.payments.set(`${row.tenantId}:${id}`, payment);
    return payment;
  }

  async findPaymentById(tenantId: string, paymentId: string): Promise<Payment | null> {
    return this.payments.get(`${tenantId}:${paymentId}`) ?? null;
  }

  async findPaymentByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Payment | null> {
    for (const p of this.payments.values()) {
      if (p.tenantId === tenantId && p.idempotencyKey === idempotencyKey) {
        return p;
      }
    }
    return null;
  }

  async findPaymentByPostedEntryId(tenantId: string, postedEntryId: string): Promise<Payment | null> {
    for (const p of this.payments.values()) {
      if (p.tenantId === tenantId && p.postedEntryId === postedEntryId) {
        return p;
      }
    }
    return null;
  }

  async updatePaymentStatus(
    tenantId: string,
    paymentId: string,
    patch: UpdatePaymentStatusInput,
    expectedCurrentStatuses: string[],
  ): Promise<Payment | null> {
    const key = `${tenantId}:${paymentId}`;
    const payment = this.payments.get(key);
    if (!payment) return null;
    if (!expectedCurrentStatuses.includes(payment.status)) return null;
    const updated: Payment = {
      ...payment,
      status: patch.status,
      postedEntryId: patch.postedEntryId ?? payment.postedEntryId,
      reversalOfPaymentId: patch.reversalOfPaymentId ?? payment.reversalOfPaymentId,
      isLocked: patch.isLocked ?? payment.isLocked,
      updatedAt: NOW(),
      updatedBy: patch.updatedBy,
    };
    this.payments.set(key, updated);
    return updated;
  }

  async lockPayment(tenantId: string, paymentId: string): Promise<Payment | null> {
    // In-memory: no real locking, just return the current row.
    return this.findPaymentById(tenantId, paymentId);
  }

  // -------------------------------------------------------------------------
  // payment_settlements
  // -------------------------------------------------------------------------

  async insertSettlement(row: NewSettlementInput): Promise<PaymentSettlement> {
    this.settlementCounter++;
    const id = nid("stl", this.settlementCounter);
    const settlement: PaymentSettlement = {
      id,
      tenantId: row.tenantId,
      paymentEntryId: row.paymentEntryId,
      settledEntryId: row.settledEntryId,
      settledAmount: row.settledAmount,
      settlementStatus: row.settlementStatus,
      createdAt: NOW(),
      createdBy: row.createdBy,
      updatedAt: NOW(),
      updatedBy: row.createdBy,
    };
    this.settlements.set(`${row.tenantId}:${id}`, settlement);
    return settlement;
  }

  async findSettlementById(tenantId: string, settlementId: string): Promise<PaymentSettlement | null> {
    return this.settlements.get(`${tenantId}:${settlementId}`) ?? null;
  }

  async listSettlementsForPaymentEntry(tenantId: string, paymentEntryId: string): Promise<PaymentSettlement[]> {
    return [...this.settlements.values()].filter(
      (s) => s.tenantId === tenantId && s.paymentEntryId === paymentEntryId,
    );
  }

  async listSettlementsForSettledEntry(tenantId: string, settledEntryId: string): Promise<PaymentSettlement[]> {
    return [...this.settlements.values()].filter(
      (s) => s.tenantId === tenantId && s.settledEntryId === settledEntryId,
    );
  }

  async lockSettlementsForPaymentEntry(tenantId: string, paymentEntryId: string): Promise<PaymentSettlement[]> {
    return this.listSettlementsForPaymentEntry(tenantId, paymentEntryId);
  }

  async lockSettledEntry(tenantId: string, entryId: string): Promise<void> {
    this.lockCalls.push(`settled|${tenantId}|${entryId}`);
  }

  async lockPaymentEntry(tenantId: string, entryId: string): Promise<void> {
    this.lockCalls.push(`paymentEntry|${tenantId}|${entryId}`);
  }

  async reverseSettlement(tenantId: string, settlementId: string, _updatedBy: string): Promise<PaymentSettlement | null> {
    const s = this.settlements.get(`${tenantId}:${settlementId}`);
    if (!s || s.settlementStatus !== "settled") return null;
    const updated = { ...s, settlementStatus: "reversed" as const };
    this.settlements.set(`${tenantId}:${settlementId}`, updated);
    return updated;
  }
}
