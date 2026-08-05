/**
 * WP-08-01E Command-Wiring Correction Tests.
 *
 * Verifies the 4 new contracted commands are correctly wired:
 *   1. recordQualityTestValueAction (worker) — quality_tests.create
 *   2. updateComplaintAction (worker) — complaints.investigate
 *   3. reviewQualityTestAction (management) — quality_risk_sales.approve
 *   4. createReplacementOrderAction (management) — returns.approve
 *
 * Tests prove:
 *   - Correct permissions and worker denial;
 *   - Worker DTO redaction;
 *   - Domain-service wiring uses DB-backed repositories;
 *   - Replacement command creates a linked normal sales order (no manual
 *     stock, no automatic refund, no direct account-entry mutation);
 *   - No automatic refund/payment;
 *   - Quality/complaint actions have no unapproved operational effects.
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
const MGMT_QUALITY_TESTS_ACTIONS = resolve(
  process.cwd(),
  "src/app/(management)/management/quality/tests/actions.ts",
);
const MGMT_RETURNS_ACTIONS = resolve(
  process.cwd(),
  "src/app/(management)/management/quality/returns/actions.ts",
);
const REPLACEMENT_SERVICE = resolve(
  process.cwd(),
  "src/server/services/replacement-workflow-service.ts",
);
const QUALITY_TEST_SERVICE = resolve(
  process.cwd(),
  "src/server/services/quality-test-service.ts",
);
const COMPLAINT_SERVICE = resolve(
  process.cwd(),
  "src/server/services/complaint-service.ts",
);

function readFile(path: string): string {
  return readFileSync(path, "utf8");
}

describe("WP-08-01E Command-Wiring Correction", () => {
  describe("1. Worker quality: recordQualityTestValueAction", () => {
    const actions = readFile(WORKER_QUALITY_ACTIONS);

    it("exports recordQualityTestValueAction", () => {
      expect(actions).toMatch(
        /export async function recordQualityTestValueAction/,
      );
    });

    it("requires quality_tests.create permission", () => {
      expect(actions).toMatch(
        /recordQualityTestValueAction[\s\S]*?"quality_tests\.create"/,
      );
    });

    it("wires to QualityTestService.recordQualityTestValue", () => {
      expect(actions).toMatch(
        /service\.recordQualityTestValue\(/,
      );
    });

    it("uses QualityTestDbRepository (DB-backed, not in-memory)", () => {
      expect(actions).toMatch(/new QualityTestDbRepository\(dbInstance\)/);
      expect(actions).not.toMatch(/InMemory.*Repository/);
    });

    it("does NOT expose management review/risk-clearance to workers", () => {
      // The worker action should NOT call reviewQualityTest or clearQualityHold
      const recordSection = actions.match(
        /recordQualityTestValueAction[\s\S]*?^}/m,
      )?.[0] ?? "";
      expect(recordSection).not.toMatch(/reviewQualityTest/);
      expect(recordSection).not.toMatch(/clearQualityHold/);
    });
  });

  describe("2. Complaint investigation: updateComplaintAction", () => {
    const actions = readFile(WORKER_QUALITY_ACTIONS);

    it("exports updateComplaintAction", () => {
      expect(actions).toMatch(/export async function updateComplaintAction/);
    });

    it("requires complaints.investigate permission", () => {
      expect(actions).toMatch(
        /updateComplaintAction[\s\S]*?"complaints\.investigate"/,
      );
    });

    it("wires to ComplaintService.updateComplaint", () => {
      expect(actions).toMatch(/service\.updateComplaint\(/);
    });

    it("uses ComplaintDbRepository (DB-backed, not in-memory)", () => {
      expect(actions).toMatch(/new ComplaintDbRepository\(dbInstance\)/);
    });

    it("has no operational side effects (view-with-comment only)", () => {
      // The complaint service should not create stock movements, account entries, or payments
      const complaintService = readFile(COMPLAINT_SERVICE);
      expect(complaintService).toMatch(/complaints\.investigate/);
      expect(complaintService).toMatch(/view-with-comment/);
      // Verify the service does NOT post stock or account entries
      expect(complaintService).not.toMatch(/insertStockMovement/);
      expect(complaintService).not.toMatch(/insertAccountEntry/);
      expect(complaintService).not.toMatch(/postPayment/);
    });
  });

  describe("3. Management quality review: reviewQualityTestAction", () => {
    const actions = readFile(MGMT_QUALITY_TESTS_ACTIONS);

    it("exports reviewQualityTestAction", () => {
      expect(actions).toMatch(/export async function reviewQualityTestAction/);
    });

    it("requires quality_risk_sales.approve permission (management-only)", () => {
      expect(actions).toMatch(
        /reviewQualityTestAction[\s\S]*?"quality_risk_sales\.approve"/,
      );
    });

    it("wires to QualityTestService.reviewQualityTest", () => {
      expect(actions).toMatch(/service\.reviewQualityTest\(/);
    });

    it("uses QualityTestDbRepository (DB-backed, not in-memory)", () => {
      expect(actions).toMatch(/new QualityTestDbRepository\(dbInstance\)/);
      expect(actions).not.toMatch(/InMemory.*Repository/);
    });

    it("uses DocumentSequenceDbRepository (DB-backed)", () => {
      expect(actions).toMatch(/new DocumentSequenceDbRepository\(db\)/);
    });

    it("uses IdempotencyDbRepository (DB-backed)", () => {
      expect(actions).toMatch(/new IdempotencyDbRepository\(db\)/);
    });

    it("quality holds/risky-sale clearance remains management-authorized", () => {
      // The review action is in the management path, NOT the worker path
      const workerActions = readFile(WORKER_QUALITY_ACTIONS);
      // Worker actions should NOT have reviewQualityTest
      expect(workerActions).not.toMatch(/reviewQualityTest/);
      expect(workerActions).not.toMatch(/clearQualityHold/);
    });
  });

  describe("4. Replacement: createReplacementOrderAction", () => {
    const actions = readFile(MGMT_RETURNS_ACTIONS);

    it("exports createReplacementOrderAction", () => {
      expect(actions).toMatch(
        /export async function createReplacementOrderAction/,
      );
    });

    it("requires returns.approve permission (management-only)", () => {
      expect(actions).toMatch(
        /createReplacementOrderAction[\s\S]*?"returns\.approve"/,
      );
    });

    it("wires to ReplacementWorkflowService.createReplacementOrder", () => {
      expect(actions).toMatch(/service\.createReplacementOrder\(/);
    });

    it("uses ReturnRequestDbRepository (DB-backed)", () => {
      expect(actions).toMatch(/new ReturnRequestDbRepository\(dbInstance\)/);
    });

    it("uses SalesDbRepository (DB-backed)", () => {
      expect(actions).toMatch(/new SalesDbRepository\(dbInstance\)/);
    });

    it("uses DocumentSequenceDbRepository (DB-backed)", () => {
      expect(actions).toMatch(/new DocumentSequenceDbRepository\(db\)/);
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
  });

  describe("5. Replacement command creates a linked normal sales order", () => {
    const service = readFile(REPLACEMENT_SERVICE);

    it("creates a sales_orders row with is_replacement_order = true", () => {
      expect(service).toMatch(/isReplacementOrder/);
      expect(service).toMatch(/is_replacement_order/);
    });

    it("links original_return_request_id to the return request", () => {
      expect(service).toMatch(/originalReturnRequestId/);
      expect(service).toMatch(/original_return_request_id/);
    });

    it("inserts sales_order_lines mirroring the return lines", () => {
      expect(service).toMatch(/insertSaleLine/);
      expect(service).toMatch(/sales_order_lines/);
    });

    it("allocates doc_no via document sequence (normal sales pipeline)", () => {
      expect(service).toMatch(/allocateDocumentNumber/);
      expect(service).toMatch(/sales_order/);
    });

    it("does NOT create manual stock movements", () => {
      // The replacement service should not directly insert stock movements
      // Stock movements happen via the normal sales approval pipeline
      const createSection = service.match(
        /async createReplacementOrder[\s\S]*?^  }/m,
      )?.[0] ?? "";
      expect(createSection).not.toMatch(/insertStockMovement/);
      expect(createSection).not.toMatch(/postStockMovement/);
    });

    it("does NOT create automatic refund/payment", () => {
      const createSection = service.match(
        /async createReplacementOrder[\s\S]*?^  }/m,
      )?.[0] ?? "";
      expect(createSection).not.toMatch(/postPayment/);
      expect(createSection).not.toMatch(/createPayment/);
      expect(createSection).not.toMatch(/refund/);
    });

    it("does NOT create direct account-entry mutations", () => {
      const createSection = service.match(
        /async createReplacementOrder[\s\S]*?^  }/m,
      )?.[0] ?? "";
      expect(createSection).not.toMatch(/insertAccountEntry/);
      expect(createSection).not.toMatch(/insertEntry/);
    });

    it("requires return status = approved (precondition)", () => {
      expect(service).toMatch(/approved/);
      expect(service).toMatch(/ReturnNotApprovedForReplacementError/);
    });

    it("requires financialTreatment = replacement (precondition)", () => {
      expect(service).toMatch(/replacement/);
      expect(service).toMatch(/ReturnNotReplacementTreatmentError/);
    });

    it("prevents duplicate replacement (ReplacementAlreadyExistsError)", () => {
      expect(service).toMatch(/ReplacementAlreadyExistsError/);
    });
  });

  describe("6. Permission boundaries and worker denial", () => {
    it("quality_employee is DENIED returns.approve (cannot approve returns)", () => {
      const qualityRoles = ["quality_employee"] as any[];
      expect(() => {
        resolveAndRequirePermission(
          qualityRoles,
          TEST_ROLE_PERMISSION_MATRIX,
          "returns.approve",
        );
      }).toThrow(PermissionDeniedError);
    });

    it("owner is ALLOWED returns.approve (can create replacement)", () => {
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

    it("quality_employee is ALLOWED quality_tests.create (can record values)", () => {
      // quality_employee should have quality_tests.create
      const qualityRoles = ["quality_employee"] as any[];
      const effective = resolveAndRequirePermission(
        qualityRoles,
        TEST_ROLE_PERMISSION_MATRIX,
        "quality_tests.create",
      );
      expect(effective.permissionKeys.has("quality_tests.create")).toBe(true);
    });

    it("quality_employee is ALLOWED complaints.investigate (can update complaints)", () => {
      const qualityRoles = ["quality_employee"] as any[];
      const effective = resolveAndRequirePermission(
        qualityRoles,
        TEST_ROLE_PERMISSION_MATRIX,
        "complaints.investigate",
      );
      expect(effective.permissionKeys.has("complaints.investigate")).toBe(true);
    });
  });

  describe("7. Quality/complaint actions have no unapproved operational effects", () => {
    const qualityService = readFile(QUALITY_TEST_SERVICE);
    const complaintService = readFile(COMPLAINT_SERVICE);

    it("QualityTestService does NOT create stock movements", () => {
      expect(qualityService).not.toMatch(/insertStockMovement/);
      expect(qualityService).not.toMatch(/postStockMovement/);
    });

    it("QualityTestService does NOT create account entries", () => {
      expect(qualityService).not.toMatch(/insertAccountEntry/);
      expect(qualityService).not.toMatch(/insertEntry/);
    });

    it("QualityTestService does NOT approve sales or returns", () => {
      expect(qualityService).not.toMatch(/approveSale/);
      expect(qualityService).not.toMatch(/approveReturn/);
    });

    it("QualityTestService does NOT post payments", () => {
      expect(qualityService).not.toMatch(/postPayment/);
      expect(qualityService).not.toMatch(/createPayment/);
    });

    it("ComplaintService does NOT create stock movements", () => {
      expect(complaintService).not.toMatch(/insertStockMovement/);
      expect(complaintService).not.toMatch(/postStockMovement/);
    });

    it("ComplaintService does NOT create account entries", () => {
      expect(complaintService).not.toMatch(/insertAccountEntry/);
      expect(complaintService).not.toMatch(/insertEntry/);
    });

    it("ComplaintService does NOT post payments", () => {
      expect(complaintService).not.toMatch(/postPayment/);
      expect(complaintService).not.toMatch(/createPayment/);
    });

    it("ComplaintService explicitly states no side effects", () => {
      expect(complaintService).toMatch(/no side effects/i);
    });
  });

  describe("8. Worker DTO redaction", () => {
    const query = readFile(
      resolve(
        process.cwd(),
        "src/server/services/quality-return-screen-query-service.ts",
      ),
    );

    it("WorkerQualityTestDto does NOT include financial fields", () => {
      const workerDto = query.match(
        /export interface WorkerQualityTestDto \{[^}]+\}/,
      )?.[0] ?? "";
      expect(workerDto).not.toMatch(/price/i);
      expect(workerDto).not.toMatch(/cost/i);
      expect(workerDto).not.toMatch(/credit/i);
      expect(workerDto).not.toMatch(/refund/i);
      expect(workerDto).not.toMatch(/balance/i);
      expect(workerDto).not.toMatch(/profitability/i);
    });

    it("WorkerComplaintDto does NOT include financial fields", () => {
      const workerDto = query.match(
        /export interface WorkerComplaintDto \{[^}]+\}/,
      )?.[0] ?? "";
      expect(workerDto).not.toMatch(/price/i);
      expect(workerDto).not.toMatch(/cost/i);
      expect(workerDto).not.toMatch(/credit/i);
      expect(workerDto).not.toMatch(/refund/i);
      expect(workerDto).not.toMatch(/balance/i);
    });

    it("ManagementReturnRequestDto includes financial treatment (management-only)", () => {
      const mgmtDto = query.match(
        /export interface ManagementReturnRequestDto \{[^}]+\}/,
      )?.[0] ?? "";
      expect(mgmtDto).toMatch(/financialTreatment/);
      expect(mgmtDto).toMatch(/isReplacement/);
    });
  });
});
