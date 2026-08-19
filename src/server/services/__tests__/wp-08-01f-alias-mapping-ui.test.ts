/**
 * WP-08-01F DEFECT 1 — UI tests for the minimal alias mapping panel.
 *
 * Tests:
 *   - Server action wiring: approveAliasMappingAction + createAliasExceptionAction
 *     are correctly exported from the migration actions module.
 *   - Permission checks: both actions call authenticateAndRequirePermission
 *     with "migration.review" (Owner/Accountant). Worker denied.
 *   - The AliasMappingPanel component renders unresolved aliases (status
 *     != 'approved' OR targetMasterId is null) with the approval form.
 *   - The AliasMappingPanel renders approved aliases with the remap form
 *     (the same approve action with a different target triggers remap).
 *   - The AliasMappingPanel renders exceptions/subgroups separately with
 *     exceptionSourceRowIds visible.
 *   - The AliasMappingPanel shows the "No valid master exists yet" hint
 *     when no target is entered.
 *   - The page wires detail.aliasMappings → AliasMappingPanel.
 *
 * Since @testing-library/react is not installed, we test by reading the
 * source file content and verifying the structural rendering contracts.
 * This is the same pattern as wp-08-01f-r2-behavioral-ui.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ACTIONS_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/actions.ts");
const PAGE_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/[batchId]/page.tsx");
const PANEL_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/[batchId]/_components/alias-mapping-panel.tsx");

function readFile(path: string): string {
  return readFileSync(path, "utf-8");
}

describe("WP-08-01F DEFECT 1 — Alias mapping UI tests", () => {

  // -------------------------------------------------------------------------
  // Server action wiring
  // -------------------------------------------------------------------------

  describe("Server action wiring", () => {
    const actionsSource = readFile(ACTIONS_PATH);

    it("approveAliasMappingAction is exported", () => {
      expect(actionsSource).toMatch(/export\s+async\s+function\s+approveAliasMappingAction/);
    });

    it("createAliasExceptionAction is exported (DEFECT 3)", () => {
      expect(actionsSource).toMatch(/export\s+async\s+function\s+createAliasExceptionAction/);
    });

    it("approveAliasMappingAction requires migration.review permission (Owner/Accountant — Worker denied)", () => {
      // Locate the approveAliasMappingAction function body and verify it
      // calls authenticateAndRequirePermission("migration.review").
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(actionMatch, "approveAliasMappingAction function block must be present").not.toBeNull();
      expect(actionMatch![0]).toContain('authenticateAndRequirePermission("migration.review")');
    });

    it("createAliasExceptionAction requires migration.review permission (Owner/Accountant — Worker denied)", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+createAliasExceptionAction[\s\S]*?\n\}/);
      expect(actionMatch, "createAliasExceptionAction function block must be present").not.toBeNull();
      expect(actionMatch![0]).toContain('authenticateAndRequirePermission("migration.review")');
    });

    it("approveAliasMappingAction does not accept approverRole from the form (server-derived only)", () => {
      // Contract 08 §11.7: request bodies cannot claim role. The role
      // must come from the authenticated context, not the form data.
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      // The action should NOT read formData.get("approverRole") — that
      // would let the browser claim a role.
      expect(actionMatch![0]).not.toMatch(/formData\.get\(["']approverRole["']\)/);
    });

    it("approveAliasMappingAction reads status from formData and validates 'approved' or 'rejected'", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      expect(actionMatch![0]).toMatch(/statusRaw !== "approved" && statusRaw !== "rejected"/);
    });

    it("approveAliasMappingAction requires targetMasterId when status='approved'", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      expect(actionMatch![0]).toMatch(/targetMasterId is required when status='approved'/);
    });

    it("createAliasExceptionAction reads defaultAliasMappingId, exceptionSourceLabel, targetMasterId, exceptionSourceRowIds, idempotencyKey from formData", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+createAliasExceptionAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      expect(actionMatch![0]).toContain('parseRequiredString(formData, "defaultAliasMappingId")');
      expect(actionMatch![0]).toContain('parseRequiredString(formData, "exceptionSourceLabel")');
      expect(actionMatch![0]).toContain('parseRequiredString(formData, "targetMasterId")');
      expect(actionMatch![0]).toContain('parseRequiredString(formData, "idempotencyKey")');
      expect(actionMatch![0]).toMatch(/exceptionSourceRowIds/);
    });

    it("approveAliasMappingAction catches known business errors and redirects to ?error=alias&code=...", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      // Must handle all known business error codes.
      const codes = [
        "ALIAS_MAPPING_NOT_FOUND",
        "ALIAS_NOT_CURRENT",
        "INVALID_ALIAS_TARGET",
        "ALIAS_ALREADY_APPROVED",
        "CONFIGURATION_ERROR",
        "IDEMPOTENCY_CONFLICT",
        "OPERATION_IN_PROGRESS",
        "VALIDATION_FAILED",
      ];
      for (const code of codes) {
        expect(actionMatch![0]).toContain(code);
      }
      expect(actionMatch![0]).toMatch(/redirect\(`\/management\/admin\/migration\/\$\{batchId\}\?error=alias&code=/);
    });

    it("createAliasExceptionAction catches known business errors and redirects to ?error=alias-exception&code=...", () => {
      const actionMatch = actionsSource.match(/export\s+async\s+function\s+createAliasExceptionAction[\s\S]*?\n\}/);
      expect(actionMatch).not.toBeNull();
      expect(actionMatch![0]).toContain("ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT");
      expect(actionMatch![0]).toMatch(/redirect\(`\/management\/admin\/migration\/\$\{batchId\}\?error=alias-exception&code=/);
    });

    it("both actions call revalidatePath on the batch detail page after success", () => {
      const approveMatch = actionsSource.match(/export\s+async\s+function\s+approveAliasMappingAction[\s\S]*?\n\}/);
      expect(approveMatch).not.toBeNull();
      expect(approveMatch![0]).toMatch(/revalidatePath\(`\/management\/admin\/migration\/\$\{batchId\}`\)/);

      const exceptionMatch = actionsSource.match(/export\s+async\s+function\s+createAliasExceptionAction[\s\S]*?\n\}/);
      expect(exceptionMatch).not.toBeNull();
      expect(exceptionMatch![0]).toMatch(/revalidatePath\(`\/management\/admin\/migration\/\$\{batchId\}`\)/);
    });
  });

  // -------------------------------------------------------------------------
  // AliasMappingPanel component contracts
  // -------------------------------------------------------------------------

  describe("AliasMappingPanel component contracts", () => {
    const panelSource = readFile(PANEL_PATH);

    it("renders an empty state when aliasMappings is empty", () => {
      expect(panelSource).toMatch(/aliasMappings\.length === 0/);
      expect(panelSource).toMatch(/لا توجد تعيينات أسماء/);
    });

    it("groups alias mappings by groupId (null groupId → singleton fallback)", () => {
      expect(panelSource).toMatch(/const key = a\.groupId \?\? a\.id/);
    });

    it("renders the source label, entity type, and status for each alias", () => {
      expect(panelSource).toMatch(/alias\.sourceLabel/);
      expect(panelSource).toMatch(/alias\.entityType/);
      expect(panelSource).toMatch(/alias\.status/);
    });

    it("renders the occurrence count for the group", () => {
      expect(panelSource).toMatch(/occurrenceCount/);
    });

    it("renders the target master id when approved (truncated to 8 chars)", () => {
      expect(panelSource).toMatch(/target_master_id|targetMasterId/);
      expect(panelSource).toMatch(/\.substring\(0, 8\)/);
    });

    it("renders approvedBy (truncated) and approvedAt for approved aliases", () => {
      expect(panelSource).toMatch(/approvedBy/);
      expect(panelSource).toMatch(/approvedAt/);
    });

    it("renders the exceptionSourceRowIds for exception aliases", () => {
      expect(panelSource).toMatch(/exceptionSourceRowIds/);
      expect(panelSource).toMatch(/exception_source_row_ids|exceptionSourceRowIds/);
    });

    it("shows the 'No valid master exists yet' hint when no target is entered", () => {
      expect(panelSource).toMatch(/لا يوجد Master صالح بعد/);
    });

    it("renders the approval form for unresolved aliases (status != approved OR target null)", () => {
      // The form is shown when isUnresolved (status !== "approved" || targetMasterId === null).
      expect(panelSource).toMatch(/const isUnresolved = alias\.status !== "approved" \|\| alias\.targetMasterId === null/);
      expect(panelSource).toMatch(/ApprovalForm/);
    });

    it("renders the remap form for approved aliases (permits remap through the backend command)", () => {
      // Approved aliases also render an ApprovalForm for remap (with a
      // different target). The remap is handled by the same server action.
      expect(panelSource).toMatch(/isRemap/);
      expect(panelSource).toMatch(/معتمد. يمكن إعادة التعيين/);
    });

    it("renders the exception creation form when a default group alias exists", () => {
      expect(panelSource).toMatch(/ExceptionForm/);
      expect(panelSource).toMatch(/إنشاء استثناء\/مجموعة فرعية/);
    });

    it("wires the approveAliasAction server action to the form", () => {
      expect(panelSource).toMatch(/approveAliasAction/);
      expect(panelSource).toMatch(/name="aliasMappingId"/);
      expect(panelSource).toMatch(/name="batchId"/);
      expect(panelSource).toMatch(/name="targetMasterId"/);
      expect(panelSource).toMatch(/name="status"/);
      expect(panelSource).toMatch(/name="mappingVersion"/);
      expect(panelSource).toMatch(/name="idempotencyKey"/);
    });

    it("wires the createAliasExceptionAction server action to the exception form", () => {
      expect(panelSource).toMatch(/createAliasExceptionAction/);
      expect(panelSource).toMatch(/name="defaultAliasMappingId"/);
      expect(panelSource).toMatch(/name="exceptionSourceLabel"/);
      expect(panelSource).toMatch(/name="exceptionSourceRowIds"/);
    });

    it("uses crypto.randomUUID for per-call idempotency keys (dedup)", () => {
      expect(panelSource).toMatch(/crypto\.randomUUID\(\)/);
    });

    it("uses useActionState for pending/dedup/feedback", () => {
      expect(panelSource).toMatch(/useActionState/);
    });

    it("uses useFormStatus for the submit button pending state", () => {
      expect(panelSource).toMatch(/useFormStatus/);
    });

    it("uses min-height 44px for touch targets", () => {
      expect(panelSource).toMatch(/minHeight: "44px"/);
    });

    it("renders backend validation error codes as Arabic labels", () => {
      expect(panelSource).toMatch(/ALIAS_MAPPING_NOT_FOUND/);
      expect(panelSource).toMatch(/INVALID_ALIAS_TARGET/);
      expect(panelSource).toMatch(/ALIAS_NOT_CURRENT/);
      expect(panelSource).toMatch(/ALIAS_ALREADY_APPROVED/);
      expect(panelSource).toMatch(/ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT/);
      expect(panelSource).toMatch(/VALIDATION_FAILED/);
    });

    it("shows the explicit errorCode passed via the ?code=... query param at the top of the panel", () => {
      expect(panelSource).toMatch(/errorCode/);
      expect(panelSource).toMatch(/role="alert"/);
    });
  });

  // -------------------------------------------------------------------------
  // Page wiring — the page passes detail.aliasMappings to the AliasMappingPanel
  // -------------------------------------------------------------------------

  describe("Page wiring", () => {
    const pageSource = readFile(PAGE_PATH);

    it("imports the AliasMappingPanel component", () => {
      expect(pageSource).toMatch(/import \{ AliasMappingPanel \} from "\.\/_components\/alias-mapping-panel"/);
    });

    it("imports the approveAliasMappingAction and createAliasExceptionAction server actions", () => {
      expect(pageSource).toMatch(/approveAliasMappingAction/);
      expect(pageSource).toMatch(/createAliasExceptionAction/);
    });

    it("renders the AliasMappingPanel inside a Card with the Arabic title", () => {
      expect(pageSource).toMatch(/<AliasMappingPanel/);
      expect(pageSource).toMatch(/تعيينات الأسماء \(Alias Mappings\)/);
    });

    it("passes detail.aliasMappings to the panel (mapped to the panel's DTO shape)", () => {
      expect(pageSource).toMatch(/aliasMappings=\{detail\.aliasMappings\.map/);
    });

    it("passes the batch's mappingVersion to the panel (for the binding check display)", () => {
      expect(pageSource).toMatch(/batchMappingVersion=\{b\.mappingVersion\}/);
    });

    it("passes the approveAliasAction + createAliasExceptionAction props", () => {
      expect(pageSource).toMatch(/approveAliasAction=\{approveAliasMappingAction\}/);
      expect(pageSource).toMatch(/createAliasExceptionAction=\{createAliasExceptionAction\}/);
    });

    it("passes the errorCode from the ?code=... query param to the panel", () => {
      expect(pageSource).toMatch(/errorCode=\{typeof sp\.code === "string" \? sp\.code : null\}/);
    });
  });

  // -------------------------------------------------------------------------
  // Permission checks — worker denial
  // -------------------------------------------------------------------------

  describe("Permission checks (worker denial)", () => {
    const pageSource = readFile(PAGE_PATH);

    it("page denies workers by redirecting to /worker when no owner/accountant role is found", () => {
      // The page's existing pattern: workers never see migration data.
      // This is the same pattern the rest of the page uses, so the
      // alias mapping panel inherits the worker denial.
      expect(pageSource).toMatch(/redirect\("\/worker"\)/);
    });

    it("page requires management role (owner or accountant) before rendering", () => {
      expect(pageSource).toMatch(/r === "owner" \|\| r === "accountant"/);
    });
  });
});
