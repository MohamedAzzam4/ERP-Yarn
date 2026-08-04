/**
 * Accounting Screen Query Service — WP-08-01D.
 *
 * Contract: docs/contracts/10_frontend_screen_contracts.md §§8.5/8.6
 * Contract: docs/contracts/07_subledger_and_costs_contract.md
 *
 * Role-safe DTOs:
 * - Management DTOs: full financial fields (Owner/Accountant)
 * - Worker is NOT exposed to accounting screens (Contract 11: financial screens are management-only)
 *
 * Redaction (Contract 10 §8.5, Contract 11 §8):
 * - All amounts, balances, settlement states, and account entries are management-only
 * - Document codes, quantities, dates LTR-isolated
 * - Display server-derived results; never recreate balance authority in the client
 */
import "server-only";

import { eq, and, desc, inArray, sql as drizzleSql } from "drizzle-orm";
import {
  accounts,
  accountEntries,
  payments,
  paymentSettlements,
  directCosts,
  directCostAllocations,
  salesProfitabilitySnapshots,
} from "@/server/db/schema";
import { customers, suppliers, externalFactories } from "@/server/db/schema/master-data";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

// ---------------------------------------------------------------------------
// Management DTOs (full — includes financial fields)
// ---------------------------------------------------------------------------

export interface ManagementAccountStatementDto {
  id: string;
  ownerType: string;
  ownerId: string;
  ownerName: string;
  ownerCode: string;
  currency: string;
  status: string;
  entryCount: number;
  totalDebit: string;
  totalCredit: string;
  runningBalance: string;
}

export interface ManagementAccountEntryDto {
  id: string;
  accountId: string;
  entryNo: string;
  entryDate: string;
  amountSigned: string;
  currency: string;
  entryType: string;
  sourceDocumentType: string;
  sourceDocumentId: string;
  settlementStatus: string;
  reversalOfEntryId: string | null;
  notes: string | null;
  createdAt: Date;
}

export interface ManagementPaymentDto {
  id: string;
  paymentNo: string;
  paymentDate: string;
  accountId: string;
  ownerType: string;
  ownerName: string;
  ownerCode: string;
  amount: string;
  paymentDirection: string;
  paymentMethod: string;
  status: string;
  notes: string | null;
  postedEntryId: string | null;
  reversalOfPaymentId: string | null;
  isLocked: boolean;
  idempotencyKey: string | null;
  createdAt: Date;
}

export interface ManagementSettlementDto {
  id: string;
  paymentEntryId: string;
  settledEntryId: string;
  settledAmount: string;
  settlementStatus: string;
  settledEntryNo: string;
  settledEntryType: string;
  settledEntryAmount: string;
  createdAt: Date;
}

export interface ManagementDirectCostDto {
  id: string;
  costNo: string;
  costType: string;
  linkedEntityType: string;
  linkedEntityId: string;
  amount: string | null;
  currency: string;
  costResponsibilityType: string;
  actualPayerType: string;
  includedInProfitability: boolean;
  reviewStatus: string;
  notes: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface ManagementDirectCostAllocationDto {
  id: string;
  directCostId: string;
  responsiblePartyType: string;
  responsiblePartyId: string | null;
  shareAmount: string;
  sharePercent: string | null;
  subledgerEntryId: string | null;
}

export interface ManagementDerivedBalanceDto {
  accountId: string;
  ownerType: string;
  ownerId: string;
  currency: string;
  totalDebit: string;
  totalCredit: string;
  balance: string;
  entryCount: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class AccountingScreenQueryService {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------------
  // Account Statements (Contract 10 §8.5)
  // -------------------------------------------------------------------------

  /**
   * List all accounts for a tenant with derived balances.
   * Balance = SUM(amount_signed) — always server-derived, never client-calculated.
   */
  async listAccountStatements(
    tenantId: string,
    ownerType?: string,
  ): Promise<ManagementAccountStatementDto[]> {
    const conditions = [eq(accounts.tenantId, tenantId)];
    if (ownerType) {
      conditions.push(eq(accounts.ownerType, ownerType as any));
    }

    const accountRows = await this.db
      .select()
      .from(accounts)
      .where(and(...conditions))
      .orderBy(desc(accounts.createdAt));

    const results: ManagementAccountStatementDto[] = [];

    for (const acc of accountRows) {
      // Derive balance from entries — server-side only
      const balanceResult = await this.db
        .select({
          totalDebit: drizzleSql<string>`COALESCE(SUM(CASE WHEN amount_signed > 0 THEN amount_signed ELSE 0 END), 0)::numeric(18,2)`,
          totalCredit: drizzleSql<string>`COALESCE(SUM(CASE WHEN amount_signed < 0 THEN ABS(amount_signed) ELSE 0 END), 0)::numeric(18,2)`,
          runningBalance: drizzleSql<string>`COALESCE(SUM(amount_signed), 0)::numeric(18,2)`,
          entryCount: drizzleSql<number>`COUNT(*)::int`,
        })
        .from(accountEntries)
        .where(
          and(
            eq(accountEntries.tenantId, tenantId),
            eq(accountEntries.accountId, acc.id),
          ),
        );

      const b = balanceResult[0] ?? { totalDebit: "0", totalCredit: "0", runningBalance: "0", entryCount: 0 };

      // Resolve owner name
      const { name, code } = await this.resolveOwnerName(tenantId, acc.ownerType, acc.ownerId);

      results.push({
        id: acc.id,
        ownerType: acc.ownerType,
        ownerId: acc.ownerId,
        ownerName: name,
        ownerCode: code,
        currency: acc.currency,
        status: acc.status,
        entryCount: b.entryCount,
        totalDebit: b.totalDebit,
        totalCredit: b.totalCredit,
        runningBalance: b.runningBalance,
      });
    }

    return results;
  }

  /**
   * List account entries for a specific account (statement detail).
   */
  async listAccountEntries(
    tenantId: string,
    accountId: string,
  ): Promise<ManagementAccountEntryDto[]> {
    const rows = await this.db
      .select()
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.tenantId, tenantId),
          eq(accountEntries.accountId, accountId),
        ),
      )
      .orderBy(desc(accountEntries.entryDate), desc(accountEntries.createdAt));

    return rows.map((r) => ({
      id: r.id,
      accountId: r.accountId,
      entryNo: r.entryNo,
      entryDate: r.entryDate,
      amountSigned: r.amountSigned,
      currency: r.currency,
      entryType: r.entryType,
      sourceDocumentType: r.sourceDocumentType,
      sourceDocumentId: r.sourceDocumentId,
      settlementStatus: r.settlementStatus,
      reversalOfEntryId: r.reversalOfEntryId,
      notes: r.notes,
      createdAt: r.createdAt,
    }));
  }

  /**
   * Get derived balance for a single account.
   */
  async getDerivedBalance(
    tenantId: string,
    accountId: string,
  ): Promise<ManagementDerivedBalanceDto | null> {
    const [acc] = await this.db
      .select()
      .from(accounts)
      .where(
        and(
          eq(accounts.tenantId, tenantId),
          eq(accounts.id, accountId),
        ),
      )
      .limit(1);

    if (!acc) return null;

    const [balanceResult] = await this.db
      .select({
        totalDebit: drizzleSql<string>`COALESCE(SUM(CASE WHEN amount_signed > 0 THEN amount_signed ELSE 0 END), 0)::numeric(18,2)`,
        totalCredit: drizzleSql<string>`COALESCE(SUM(CASE WHEN amount_signed < 0 THEN ABS(amount_signed) ELSE 0 END), 0)::numeric(18,2)`,
        balance: drizzleSql<string>`COALESCE(SUM(amount_signed), 0)::numeric(18,2)`,
        entryCount: drizzleSql<number>`COUNT(*)::int`,
      })
      .from(accountEntries)
      .where(
        and(
          eq(accountEntries.tenantId, tenantId),
          eq(accountEntries.accountId, accountId),
        ),
      );

    return {
      accountId: acc.id,
      ownerType: acc.ownerType,
      ownerId: acc.ownerId,
      currency: acc.currency,
      totalDebit: balanceResult?.totalDebit ?? "0",
      totalCredit: balanceResult?.totalCredit ?? "0",
      balance: balanceResult?.balance ?? "0",
      entryCount: balanceResult?.entryCount ?? 0,
    };
  }

  // -------------------------------------------------------------------------
  // Payments (Contract 10 §8.5)
  // -------------------------------------------------------------------------

  async listPayments(
    tenantId: string,
    statusFilter?: string,
  ): Promise<ManagementPaymentDto[]> {
    const conditions = [eq(payments.tenantId, tenantId)];
    if (statusFilter) {
      conditions.push(eq(payments.status, statusFilter as any));
    }

    const rows = await this.db
      .select({
        payment: payments,
        account: accounts,
      })
      .from(payments)
      .innerJoin(accounts, eq(payments.accountId, accounts.id))
      .where(and(...conditions))
      .orderBy(desc(payments.createdAt));

    const results: ManagementPaymentDto[] = [];
    for (const r of rows) {
      const { name, code } = await this.resolveOwnerName(tenantId, r.account.ownerType, r.account.ownerId);
      results.push({
        id: r.payment.id,
        paymentNo: r.payment.paymentNo,
        paymentDate: r.payment.paymentDate,
        accountId: r.payment.accountId,
        ownerType: r.account.ownerType,
        ownerName: name,
        ownerCode: code,
        amount: r.payment.amount,
        paymentDirection: r.payment.paymentDirection,
        paymentMethod: r.payment.paymentMethod,
        status: r.payment.status,
        notes: r.payment.notes,
        postedEntryId: r.payment.postedEntryId,
        reversalOfPaymentId: r.payment.reversalOfPaymentId,
        isLocked: r.payment.isLocked,
        idempotencyKey: r.payment.idempotencyKey,
        createdAt: r.payment.createdAt,
      });
    }
    return results;
  }

  async listSettlementsForPayment(
    tenantId: string,
    paymentEntryId: string,
  ): Promise<ManagementSettlementDto[]> {
    const rows = await this.db
      .select({
        settlement: paymentSettlements,
        settledEntry: accountEntries,
      })
      .from(paymentSettlements)
      .innerJoin(accountEntries, eq(paymentSettlements.settledEntryId, accountEntries.id))
      .where(
        and(
          eq(paymentSettlements.tenantId, tenantId),
          eq(paymentSettlements.paymentEntryId, paymentEntryId),
        ),
      )
      .orderBy(desc(paymentSettlements.createdAt));

    return rows.map((r) => ({
      id: r.settlement.id,
      paymentEntryId: r.settlement.paymentEntryId,
      settledEntryId: r.settlement.settledEntryId,
      settledAmount: r.settlement.settledAmount,
      settlementStatus: r.settlement.settlementStatus,
      settledEntryNo: r.settledEntry.entryNo,
      settledEntryType: r.settledEntry.entryType,
      settledEntryAmount: r.settledEntry.amountSigned,
      createdAt: r.settlement.createdAt,
    }));
  }

  // -------------------------------------------------------------------------
  // Direct Costs (Contract 10 §8.6)
  // -------------------------------------------------------------------------

  async listDirectCostsForReview(
    tenantId: string,
    reviewStatus?: string,
  ): Promise<ManagementDirectCostDto[]> {
    const conditions = [eq(directCosts.tenantId, tenantId)];
    if (reviewStatus) {
      conditions.push(eq(directCosts.reviewStatus, reviewStatus as any));
    }

    const rows = await this.db
      .select()
      .from(directCosts)
      .where(and(...conditions))
      .orderBy(desc(directCosts.createdAt));

    return rows.map((r) => ({
      id: r.id,
      costNo: r.costNo,
      costType: r.costType,
      linkedEntityType: r.linkedEntityType,
      linkedEntityId: r.linkedEntityId,
      amount: r.amount,
      currency: r.currency,
      costResponsibilityType: r.costResponsibilityType,
      actualPayerType: r.actualPayerType,
      includedInProfitability: r.includedInProfitability,
      reviewStatus: r.reviewStatus,
      notes: r.notes,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedAt,
      createdAt: r.createdAt,
    }));
  }

  async listDirectCostAllocations(
    tenantId: string,
    directCostId: string,
  ): Promise<ManagementDirectCostAllocationDto[]> {
    const rows = await this.db
      .select()
      .from(directCostAllocations)
      .where(
        and(
          eq(directCostAllocations.tenantId, tenantId),
          eq(directCostAllocations.directCostId, directCostId),
        ),
      )
      .orderBy(directCostAllocations.responsiblePartyType);

    return rows.map((r) => ({
      id: r.id,
      directCostId: r.directCostId,
      responsiblePartyType: r.responsiblePartyType,
      responsiblePartyId: r.responsiblePartyId,
      shareAmount: r.shareAmount,
      sharePercent: r.sharePercent,
      subledgerEntryId: r.subledgerEntryId,
    }));
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private async resolveOwnerName(
    tenantId: string,
    ownerType: string,
    ownerId: string,
  ): Promise<{ name: string; code: string }> {
    try {
      if (ownerType === "customer") {
        const [c] = await this.db
          .select({ name: customers.nameEn, code: customers.customerCode })
          .from(customers)
          .where(and(eq(customers.tenantId, tenantId), eq(customers.id, ownerId)))
          .limit(1);
        return { name: c?.name ?? "—", code: c?.code ?? "—" };
      } else if (ownerType === "supplier") {
        const [s] = await this.db
          .select({ name: suppliers.nameEn, code: suppliers.supplierCode })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.id, ownerId)))
          .limit(1);
        return { name: s?.name ?? "—", code: s?.code ?? "—" };
      } else if (ownerType === "factory") {
        const [f] = await this.db
          .select({ name: externalFactories.nameEn, code: externalFactories.factoryCode })
          .from(externalFactories)
          .where(and(eq(externalFactories.tenantId, tenantId), eq(externalFactories.id, ownerId)))
          .limit(1);
        return { name: f?.name ?? "—", code: f?.code ?? "—" };
      }
    } catch {
      // Table might not exist or join failed — return placeholder
    }
    return { name: "—", code: "—" };
  }
}
