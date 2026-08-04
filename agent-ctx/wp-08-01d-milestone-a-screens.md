# Task: WP-08-01D Milestone A — Payments / Accounts / Direct-Cost screens

## Scope
Created 3 management routes under `src/app/(management)/management/accounts/`:
- `payments/` (page + loading + error + actions)
- `balances/` (page + loading + error)
- `direct-costs/` (page + loading + error + actions)

All files follow the WP-08-01C `sales/orders/` pattern.

## Files created
1. `src/app/(management)/management/accounts/payments/page.tsx`
   - Auth: `getErpAuthContextWithRoles()`, redirect to `/login` or `/worker`
   - Nav: `isManagementShellRole` + `getManagementNavForRole`
   - Shell: `ManagementShell`
   - Data: `AccountingScreenQueryService.listPayments(tenantId)` via `db`
   - Groups: posted payments (settle + reverse forms), draft payments (post form), all-payments table
   - All amounts/codes LTR-isolated via `<LtrValue>`
   - `dbAvailable` fallback + empty state + `overflow-x-auto`
   - All buttons/inputs `style={{ minHeight: "44px" }}`
   - Settle form fields: `paymentId`, `idempotencyKey` (UUID), `settledAmount`, `settledEntryId`, `notes`
   - Reverse form fields: `paymentId`, `idempotencyKey` (UUID), `reason`
   - Post form fields: `paymentId`, `idempotencyKey` (UUID), `notes`

2. `src/app/(management)/management/accounts/payments/loading.tsx`
   - Arabic spinner "جارٍ التحميل..."

3. `src/app/(management)/management/accounts/payments/error.tsx`
   - Arabic error with 44px reset button, detects `PERMISSION_DENIED` / `FORBIDDEN_FIELD`

4. `src/app/(management)/management/accounts/payments/actions.ts`
   - `postPaymentAction` → `PaymentService.postPayment` (perm: `payments.create`)
   - `settlePaymentAction` → `SettlementService.settlePayment` (perm: `payments.create`)
   - `reversePaymentAction` → `PaymentReversalService.reversePayment` (perm: `payments.reverse`)
   - `FORBIDDEN_PAYMENT_FIELDS`: `amountSigned`, `entryType`, `entryNo`, `settlementStatus`, `postedEntryId`, `reversalOfPaymentId`, `reversalOfEntryId`, `isLocked`, `paymentNo`, `status`, `accountId`, `ownerType`, `ownerId`, `tenantId`, `createdBy`, `updatedBy`, `auditLogId`, `idempotencyRecordId`
   - `getSharedDeps()`: `IdempotencyDbRepository`, `AuditDbRepository`, `InProcessDocumentSequenceStore`
   - `makeTransactionRunner()` + `makeTxFactories()` with `createIdempotency` + `createAudit`
   - `revalidatePath("/management/accounts/payments")` after each action

5. `src/app/(management)/management/accounts/balances/page.tsx`
   - Permission: `balances.view_customer OR balances.view_supplier_factory` via `requireAnyPermission`
   - Data: `AccountingScreenQueryService.listAccountStatements(tenantId)`
   - Table: ownerType, ownerName, ownerCode, currency, entryCount, totalDebit, totalCredit, runningBalance, status
   - Balance is server-derived (not recomputed client-side) — explicitly stated in the page footer
   - All amounts LTR-isolated

6. `src/app/(management)/management/accounts/balances/loading.tsx`
7. `src/app/(management)/management/accounts/balances/error.tsx`
   - Same patterns as payments

8. `src/app/(management)/management/accounts/direct-costs/page.tsx`
   - Data: `AccountingScreenQueryService.listDirectCostsForReview(tenantId)`
   - Pending review costs get a review form:
     - amount, costResponsibilityType, actualPayerType, includedInProfitability (Y/N), notes, allocationsJson (free-text JSON for shared allocations)
   - All-costs table: costNo, costType, linkedEntityType+Id, amount, currency, costResponsibilityType, actualPayerType, reviewStatus
   - All amounts/codes LTR-isolated

9. `src/app/(management)/management/accounts/direct-costs/loading.tsx`
10. `src/app/(management)/management/accounts/direct-costs/error.tsx`

11. `src/app/(management)/management/accounts/direct-costs/actions.ts`
    - `reviewDirectCostAction` → `DirectCostService.reviewDirectCost` (perm: `direct_costs.review`)
    - `FORBIDDEN_DIRECT_COST_FIELDS`: `reviewStatus`, `reviewedBy`, `reviewedAt`, `subledgerEntryId`, `snapshotId`, `snapshotVersion`, `costNo`, `tenantId`, `createdBy`, `updatedBy`, `auditLogId`, `idempotencyRecordId`
    - Parses allocationsJson (defensive JSON parse, validated `customer|supplier|factory` party types)
    - Wires `DirectCostService` with `InMemoryDirectCostRepository`, `SubledgerService`+`SubledgerDbRepository`, `ProfitabilitySnapshotService`+`ProfitabilitySnapshotDbRepository`, `AuditDbRepository`, `IdempotencyDbRepository`, `InProcessDocumentSequenceStore`
    - `revalidatePath("/management/accounts/direct-costs")` after action

## Patterns followed
- Page structure mirrors `sales/orders/page.tsx` (auth → shell → queryService → groups → table → fallbacks)
- Action structure mirrors `sales/orders/actions.ts` (FORBIDDEN_FIELDS → rejectForbiddenFields → getSharedDeps → transactionRunner + txFactories → service call → revalidatePath)
- Loading/error files are byte-for-byte identical patterns to `sales/orders/loading.tsx` and `error.tsx`
- `crypto.randomUUID()` for idempotency keys in hidden inputs (NOT `Math.random()` — ESLint purity)
- `signOut` imported from `@/app/login/actions`
- All `@/`-prefixed imports; no relative parent imports
- 44px touch targets on every interactive element

## Known follow-ups (out of scope for Milestone A)
- `PaymentDbRepository` (Drizzle-backed) does not yet exist; actions currently wire the
  in-memory test repo (`InMemoryPaymentRepository`). Subledger entries, audit logs, and
  idempotency records DO persist to the live DB; payment/settlement rows do not.
- `DirectCostDbRepository` (Drizzle-backed) does not yet exist; same pattern — the
  in-memory test repo is wired for now. Subledger entries, profitability snapshots,
  audit logs, and idempotency records DO persist to the live DB.
- A DB-backed payments screen (one that survives Node.js restarts and serves all
  tenants) requires those two repos to be added in a follow-up work package.

## Validation
- `bun run typecheck` → clean (no TS errors)
- `npx eslint src/app/(management)/management/accounts/` → exit 0 (no lint errors)
- `npx eslint .` → exit 0 (no project-wide lint regressions)

## Routes added to sidebar nav-config
The sidebar already exposes:
- `/management/accounts/payments` (perm: `payments.approve`)
- `/management/accounts/balances` (perm: `balances.view_customer`)
- `/management/accounts/direct-costs` (perm: `direct_costs.review`)

for `owner` and `accountant` roles — no nav-config changes needed.
