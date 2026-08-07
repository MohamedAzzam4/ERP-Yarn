/**
 * WP-08-01E Production Wiring + Permission Boundary Tests.
 *
 * Contract 10 §§7.3/8.7: Quality, Complaint, Return and Replacement Screens.
 * Contract 11 §8: Workers redacted from financial fields.
 *
 * Tests:
 * - Worker quality actions use QualityTestDbRepository/ComplaintDbRepository
 *   (NOT in-memory);
 * - Management return actions use ReturnRequestDbRepository (NOT in-memory);
 * - No production action in these paths constructs InMemory*Repository;
 * - Permission checks: quality_tests.create, complaints.investigate,
 *   returns.approve;
 * - Worker financial denial (quality_employee has no returns.approve);
 * - No InProcessDocumentSequenceStore or InProcessIdempotencyStore.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { PermissionDeniedError } from "@/server/security/guards";

const WORKER_QUALITY_ACTIONS = resolve(
  process.cwd(),
  "src/app/(worker)/worker/quality-entry/actions.ts",
);
const MGMT_RETURNS_ACTIONS = resolve(
  process.cwd(),
  "src/app/(management)/management/quality/returns/actions.ts",
);
const QUALITY_TEST_DB_REPO = resolve(
  process.cwd(),
  "src/server/services/quality-test-db-repository.ts",
);
const QUERY_SERVICE = resolve(
  process.cwd(),
  "src/server/services/quality-return-screen-query-service.ts",
);

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("WP-08-01E Production Wiring + Permission Boundaries", () => {
  describe("Worker quality actions use DB-backed repositories", () => {
    const actions = readFile(WORKER_QUALITY_ACTIONS);

    it("imports QualityTestDbRepository from production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/quality-test-db-repository"/,
      );
    });

    it("imports ComplaintDbRepository from production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/complaint-db-repository"/,
      );
    });

    it("does NOT import InMemory*Repository", () => {
      expect(actions).not.toMatch(/InMemory.*Repository/);
    });

    it("does NOT import InProcessDocumentSequenceStore", () => {
      expect(actions).not.toMatch(/InProcessDocumentSequenceStore/);
    });

    it("does NOT import InProcessIdempotencyStore", () => {
      expect(actions).not.toMatch(/InProcessIdempotencyStore/);
    });

    it("constructs QualityTestDbRepository(db)", () => {
      expect(actions).toMatch(/new QualityTestDbRepository\(dbInstance\)/);
    });

    it("constructs ComplaintDbRepository(db)", () => {
      expect(actions).toMatch(/new ComplaintDbRepository\(dbInstance\)/);
    });

    it("constructs DocumentSequenceDbRepository(db)", () => {
      expect(actions).toMatch(/new DocumentSequenceDbRepository\(db\)/);
    });

    it("constructs IdempotencyDbRepository(db)", () => {
      expect(actions).toMatch(/new IdempotencyDbRepository\(db\)/);
    });

    it("constructs AuditDbRepository(db)", () => {
      expect(actions).toMatch(/new AuditDbRepository\(db\)/);
    });
  });

  describe("Management return actions use DB-backed repositories", () => {
    const actions = readFile(MGMT_RETURNS_ACTIONS);

    it("imports ReturnRequestDbRepository from production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/return-request-db-repository"/,
      );
    });

    it("imports DbTenantOwnershipValidator from production path", () => {
      expect(actions).toMatch(
        /from\s+"@\/server\/services\/db-tenant-ownership-validator"/,
      );
    });

    it("does NOT import InMemory*Repository", () => {
      expect(actions).not.toMatch(/InMemory.*Repository/);
    });

    it("does NOT import InProcessDocumentSequenceStore", () => {
      expect(actions).not.toMatch(/InProcessDocumentSequenceStore/);
    });

    it("does NOT import InProcessIdempotencyStore", () => {
      expect(actions).not.toMatch(/InProcessIdempotencyStore/);
    });

    it("constructs ReturnRequestDbRepository(db)", () => {
      expect(actions).toMatch(/new ReturnRequestDbRepository\(dbInstance\)/);
    });

    it("constructs DbTenantOwnershipValidator(db)", () => {
      expect(actions).toMatch(/new DbTenantOwnershipValidator\(dbInstance\)/);
    });

    it("constructs DocumentSequenceDbRepository(db)", () => {
      expect(actions).toMatch(/new DocumentSequenceDbRepository\(db\)/);
    });

    it("constructs IdempotencyDbRepository(db)", () => {
      expect(actions).toMatch(/new IdempotencyDbRepository\(db\)/);
    });
  });

  describe("Permission boundaries (Contract 09 §11, Contract 11)", () => {
    it("createQualityTestAction requires quality_tests.create", () => {
      const actions = readFile(WORKER_QUALITY_ACTIONS);
      expect(actions).toMatch(/"quality_tests\.create"/);
    });

    it("createComplaintAction requires complaints.investigate", () => {
      const actions = readFile(WORKER_QUALITY_ACTIONS);
      expect(actions).toMatch(/"complaints\.investigate"/);
    });

    it("approveReturnAction requires returns.approve", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      expect(actions).toMatch(/"returns\.approve"/);
    });

    it("rejectReturnAction requires returns.approve", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      // Both approve and reject use returns.approve
      const matches = actions.match(/"returns\.approve"/g);
      expect(matches?.length).toBeGreaterThanOrEqual(2);
    });

    it("quality_employee is DENIED returns.approve (worker financial deny)", () => {
      // quality_employee has no financial permissions per Contract 11
      const qualityRoles = ["quality_employee"] as any[];
      expect(() => {
        resolveAndRequirePermission(
          qualityRoles,
          TEST_ROLE_PERMISSION_MATRIX,
          "returns.approve",
        );
      }).toThrow(PermissionDeniedError);
    });

    it("quality_employee is DENIED quality_risk_sales.approve", () => {
      const qualityRoles = ["quality_employee"] as any[];
      expect(() => {
        resolveAndRequirePermission(
          qualityRoles,
          TEST_ROLE_PERMISSION_MATRIX,
          "quality_risk_sales.approve",
        );
      }).toThrow(PermissionDeniedError);
    });

    it("owner is ALLOWED returns.approve", () => {
      const ownerRoles = ["owner"] as any[];
      const effective = resolveAndRequirePermission(
        ownerRoles,
        TEST_ROLE_PERMISSION_MATRIX,
        "returns.approve",
      );
      expect(effective.permissionKeys.has("returns.approve")).toBe(true);
    });

    it("accountant is ALLOWED returns.approve", () => {
      const acctRoles = ["accountant"] as any[];
      const effective = resolveAndRequirePermission(
        acctRoles,
        TEST_ROLE_PERMISSION_MATRIX,
        "returns.approve",
      );
      expect(effective.permissionKeys.has("returns.approve")).toBe(true);
    });

    it("warehouse_employee is DENIED returns.approve", () => {
      const whRoles = ["warehouse_employee"] as any[];
      expect(() => {
        resolveAndRequirePermission(
          whRoles,
          TEST_ROLE_PERMISSION_MATRIX,
          "returns.approve",
        );
      }).toThrow(PermissionDeniedError);
    });
  });

  describe("Forbidden field protection", () => {
    it("worker quality actions reject forbidden fields", () => {
      const actions = readFile(WORKER_QUALITY_ACTIONS);
      expect(actions).toMatch(/FORBIDDEN_QUALITY_FIELDS/);
      expect(actions).toMatch(/FORBIDDEN_COMPLAINT_FIELDS/);
      // Must reject testNo (server-assigned document number)
      expect(actions).toMatch(/"testNo"/);
      expect(actions).toMatch(/"complaintNo"/);
    });

    it("management return actions reject forbidden financial fields", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      expect(actions).toMatch(/FORBIDDEN_RETURN_FIELDS/);
      // Must reject financial authority fields (server-computed per Contract 09 §11)
      expect(actions).toMatch(/"customerAdjustmentAmount"/);
      expect(actions).toMatch(/"returnCreditValue"/);
      expect(actions).toMatch(/"residualAdjustment"/);
      expect(actions).toMatch(/"replacementOrderId"/);
    });
  });

  describe("Transaction runner wiring (WP-08-01E D-1/D-2/D-3 fix)", () => {
    it("approveReturnAction wires transactionRunner + txFactories", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      // Must contain at least 2 transactionRunner definitions (approve + reject)
      const trMatches = actions.match(/transactionRunner/g);
      expect(trMatches?.length).toBeGreaterThanOrEqual(2);
      // Must contain txFactories for approve (6 factories) and reject (6 factories)
      const txFactoriesMatches = actions.match(/txFactories/g);
      expect(txFactoriesMatches?.length).toBeGreaterThanOrEqual(2);
    });

    it("approveReturnAction txFactories includes all 6 required factories", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      expect(actions).toMatch(/createInventoryLedger/);
      expect(actions).toMatch(/createSubledger/);
      expect(actions).toMatch(/createSnapshotService/);
      expect(actions).toMatch(/createSalesRepository/);
      expect(actions).toMatch(/createReturnRequestRepository/);
      expect(actions).toMatch(/createAudit/);
    });

    it("rejectReturnAction wires transactionRunner + txFactories (D-3 fix)", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      // Split by export async function to isolate each action's body.
      const rejectIdx = actions.indexOf("export async function rejectReturnAction");
      const replaceIdx = actions.indexOf("export async function createReplacementOrderAction");
      const rejectSection = rejectIdx >= 0
        ? actions.slice(rejectIdx, replaceIdx >= 0 ? replaceIdx : undefined)
        : "";
      expect(rejectSection).toMatch(/transactionRunner/);
      expect(rejectSection).toMatch(/txFactories/);
    });

    it("createReplacementOrderAction wires transactionRunner + txFactories (D-2 fix)", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      const replaceIdx = actions.indexOf("export async function createReplacementOrderAction");
      const replaceSection = replaceIdx >= 0
        ? actions.slice(replaceIdx)
        : "";
      expect(replaceSection).toMatch(/transactionRunner/);
      expect(replaceSection).toMatch(/txFactories/);
      // Replacement factories: createSalesRepository, createReturnRequestRepository, createAudit
      expect(replaceSection).toMatch(/createSalesRepository/);
      expect(replaceSection).toMatch(/createReturnRequestRepository/);
      expect(replaceSection).toMatch(/createAudit/);
    });

    it("all three management return actions pass transactionRunner AND txFactories to service constructor", () => {
      const actions = readFile(MGMT_RETURNS_ACTIONS);
      // Each service constructor must receive both transactionRunner and txFactories
      const constructorMatches = actions.match(
        /transactionRunner,\s*txFactories,/g,
      );
      expect(constructorMatches?.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe("QualityTestDbRepository is DB-backed", () => {
    const repo = readFile(QUALITY_TEST_DB_REPO);

    it("imports qualityTests table from schema", () => {
      expect(repo).toMatch(/from\s+"@\/server\/db\/schema\/quality"/);
      expect(repo).toMatch(/\bqualityTests\b/);
    });

    it("implements QualityTestRepository interface", () => {
      expect(repo).toMatch(
        /class QualityTestDbRepository\s+implements\s+QualityTestRepository/,
      );
    });

    it("lockQualityTest uses SELECT ... FOR UPDATE", () => {
      expect(repo).toMatch(/\.for\("update"\)/);
    });

    it("updateQualityTestStatus uses conditional WHERE", () => {
      expect(repo).toMatch(/inArray/);
      expect(repo).toMatch(/eq\(qualityTests\.tenantId/);
      expect(repo).toMatch(/eq\(qualityTests\.id/);
    });
  });

  describe("Query service DTOs are role-safe", () => {
    const query = readFile(QUERY_SERVICE);

    it("exports WorkerQualityTestDto (redacted)", () => {
      expect(query).toMatch(/export interface WorkerQualityTestDto/);
    });

    it("exports WorkerComplaintDto (redacted)", () => {
      expect(query).toMatch(/export interface WorkerComplaintDto/);
    });

    it("exports ManagementReturnRequestDto", () => {
      expect(query).toMatch(/export interface ManagementReturnRequestDto/);
    });

    it("Worker DTOs do NOT include financial fields", () => {
      // Worker DTOs should not have price, cost, credit, refund, balance
      const workerDtoSection = query.match(
        /export interface WorkerQualityTestDto \{[^}]+\}/,
      )?.[0] ?? "";
      expect(workerDtoSection).not.toMatch(/price/i);
      expect(workerDtoSection).not.toMatch(/cost/i);
      expect(workerDtoSection).not.toMatch(/credit/i);
      expect(workerDtoSection).not.toMatch(/refund/i);
      expect(workerDtoSection).not.toMatch(/balance/i);
    });
  });
});
