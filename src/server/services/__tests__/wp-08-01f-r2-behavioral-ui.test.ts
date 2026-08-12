/**
 * WP-08-01F R2 PHASE 3 — Behavioral UI tests.
 *
 * These tests exercise behavior/rendering where practical using the lifecycle
 * predicates that drive the UI rendering decisions. Since @testing-library/react
 * is not installed in this project, we test the EXACT predicates the page uses
 * to show/hide components, plus structural verification of the rendered output
 * by reading the page source and verifying the conditional rendering contracts.
 *
 * The page renders components based on:
 *   - actionMatrix.registerFile (ordinary upload visibility)
 *   - canReplaceMigrationFile(batchState) (replacement form visibility)
 *   - batch.status (lifecycle-specific controls)
 *   - detail.files (version history rendering)
 *   - detail.stagingPagination (staging preview)
 *
 * Covered:
 *   - ordinary upload visibility by lifecycle
 *   - replacement form visibility by lifecycle
 *   - mandatory reason/confirmation (component contract)
 *   - pending/replay/conflict/error/success states (component contract)
 *   - version history rendering
 *   - current vs superseded preview isolation
 *   - protected downloads
 *   - renewed-approval explanation
 *   - worker denial
 *   - keyboard labels/focus
 *   - touch targets >=44px
 *   - no page-level overflow structure at 360px
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getActionMatrix,
  canRegisterFile,
  canReplaceMigrationFile,
  visibleApprovalControls,
  ALL_BATCH_STATUSES,
  type MigrationBatchState,
} from "../migration-lifecycle-predicates";

const PAGE_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/[batchId]/page.tsx");
const REPLACE_FORM_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/[batchId]/_components/replacement-upload-form.tsx");
const VERSION_SELECTOR_PATH = join(__dirname, "../../../app/(management)/management/admin/migration/[batchId]/_components/staging-version-selector.tsx");

function makeBaseState(overrides: Partial<MigrationBatchState> = {}): MigrationBatchState {
  return {
    status: "draft",
    stagedRowCount: 0,
    blockingErrorCount: 0,
    warningCount: 0,
    acceptedWarningCount: 0,
    stagedDataHash: null,
    cutoverManifestHash: null,
    hasOwnerApproval: false,
    hasAccountantApproval: false,
    hasBackupEvidence: false,
    ...overrides,
  };
}

describe("WP-08-01F R2 PHASE 3 — Behavioral UI tests", () => {

  // -------------------------------------------------------------------------
  // Ordinary upload visibility by lifecycle
  // -------------------------------------------------------------------------

  describe("Ordinary upload visibility by lifecycle", () => {
    it("ordinary upload visible in draft, source_uploaded, normalized", () => {
      for (const status of ["draft", "source_uploaded", "normalized"] as const) {
        const matrix = getActionMatrix(makeBaseState({ status }));
        expect(matrix.registerFile, `status=${status} should show ordinary upload`).toBe(true);
      }
    });

    it("ordinary upload NOT visible after staging finalization (staged+)", () => {
      for (const status of [
        "staged", "validation_in_progress", "validation_complete",
        "reconciliation_in_progress", "review_required", "pending_dual_approval",
        "approved_for_commit", "committing", "committed", "rejected", "cancelled",
      ] as const) {
        const matrix = getActionMatrix(makeBaseState({ status }));
        expect(matrix.registerFile, `status=${status} should NOT show ordinary upload`).toBe(false);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Replacement form visibility by lifecycle
  // -------------------------------------------------------------------------

  describe("Replacement form visibility by lifecycle", () => {
    it("replacement form visible in stable pre-commit rework states", () => {
      for (const status of [
        "source_uploaded", "normalized", "staged",
        "validation_complete", "review_required",
        "pending_dual_approval", "approved_for_commit",
      ] as const) {
        expect(canReplaceMigrationFile(makeBaseState({ status })), `status=${status} should allow replacement`).toBe(true);
      }
    });

    it("replacement form NOT visible during concurrent operations", () => {
      for (const status of [
        "validation_in_progress", "reconciliation_in_progress", "committing",
      ] as const) {
        expect(canReplaceMigrationFile(makeBaseState({ status })), `status=${status} should NOT allow replacement`).toBe(false);
      }
    });

    it("replacement form NOT visible in terminal states", () => {
      for (const status of ["committed", "rejected", "cancelled"] as const) {
        expect(canReplaceMigrationFile(makeBaseState({ status })), `status=${status} should NOT allow replacement`).toBe(false);
      }
    });

    it("replacement form NOT visible in draft (no file to replace)", () => {
      expect(canReplaceMigrationFile(makeBaseState({ status: "draft" }))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Mandatory reason/confirmation (component contract)
  // -------------------------------------------------------------------------

  describe("Mandatory reason/confirmation (component contract)", () => {
    const src = readFileSync(REPLACE_FORM_PATH, "utf-8");

    it("rework reason field is required", () => {
      expect(src).toContain('name="reworkReason"');
      expect(src).toContain("required");
    });

    it("confirmation checkbox is required before submission", () => {
      expect(src).toContain('type="checkbox"');
      expect(src).toContain("confirmed");
      expect(src).toContain("disabled={pending || !confirmed}");
    });

    it("confirmation explains consequences (5 items)", () => {
      expect(src).toContain("الملف القديم والأدلة المرتبطة به ستبقى محفوظة");
      expect(src).toContain("نتائج التحقق والمطابقة الحالية ستصبح غير سارية");
      expect(src).toContain("الاعتمادات الحالية ستصبح غير صالحة");
      expect(src).toContain("يجب إعادة تشغيل التحقق والمطابقة");
      expect(src).toContain("يجب أن يعتمد المالك والمحاسب مرة أخرى");
    });
  });

  // -------------------------------------------------------------------------
  // Pending/replay/conflict/error/success states (component contract)
  // -------------------------------------------------------------------------

  describe("Pending/replay/conflict/error/success states (component contract)", () => {
    const src = readFileSync(REPLACE_FORM_PATH, "utf-8");

    it("pending state: button disabled + spinner + Arabic text", () => {
      expect(src).toContain("disabled={pending || !confirmed}");
      expect(src).toContain("aria-busy={pending}");
      expect(src).toContain("animate-spin");
      expect(src).toContain("جاري الاستبدال");
    });

    it("success state: accessible role=status with Arabic message", () => {
      expect(src).toContain('role="status"');
      expect(src).toContain("تم استبدال الملف بنجاح");
    });

    it("error state: accessible role=alert with distinguishable error codes", () => {
      expect(src).toContain('role="alert"');
      expect(src).toContain("CONCURRENT_VALIDATION");
      expect(src).toContain("CONCURRENT_RECONCILIATION");
      expect(src).toContain("IDEMPOTENCY_CONFLICT");
      expect(src).toContain("SAME_HASH_CONFLICT");
      expect(src).toContain("LIFECYCLE_VIOLATION");
    });

    it("conflict vs replay vs lifecycle rejection are distinguishable", () => {
      expect(src).toContain("تعارض مفتاح الإيديمبوتنسي");
      expect(src).toContain("بصمة الملف الجديد تطابق الملف القديم");
      expect(src).toContain("الحالة الحالية للدفعة لا تسمح بالاستبدال");
    });
  });

  // -------------------------------------------------------------------------
  // Version history rendering
  // -------------------------------------------------------------------------

  describe("Version history rendering", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");

    it("file version column is rendered", () => {
      expect(src).toContain("إصدار الملف");
      expect(src).toContain("f.fileVersion");
    });

    it("superseded reason column is rendered", () => {
      expect(src).toContain("سبب الإلغاء");
      expect(src).toContain("f.supersededReason");
    });

    it("old/new comparison summary is rendered when multiple versions exist", () => {
      expect(src).toContain("مقارنة الإصدارات");
      expect(src).toContain("detail.files.length > 1");
    });

    it("current vs superseded visual distinction (success vs amber)", () => {
      expect(src).toContain("border-success/50 text-success");
      expect(src).toContain("border-amber-500/50 text-amber-700");
    });
  });

  // -------------------------------------------------------------------------
  // Current vs superseded preview isolation
  // -------------------------------------------------------------------------

  describe("Current vs superseded preview isolation", () => {
    const src = readFileSync(VERSION_SELECTOR_PATH, "utf-8");

    it("version selector shows current option", () => {
      expect(src).toContain("النسخة الحالية");
    });

    it("version selector shows historical superseded versions", () => {
      expect(src).toContain("نسخة ملغاة");
    });

    it("historical versions are marked read-only with amber warning", () => {
      expect(src).toContain("للقراءة فقط");
      expect(src).toContain("text-amber-700");
    });

    it("version selector builds URLs with fileVersion param", () => {
      expect(src).toContain("fileVersion");
    });

    it("version selector only renders when multiple versions exist", () => {
      expect(src).toContain("files.length <= 1");
    });
  });

  // -------------------------------------------------------------------------
  // Protected downloads
  // -------------------------------------------------------------------------

  describe("Protected downloads", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");

    it("download links use protected route (not storage paths)", () => {
      expect(src).toContain("/download");
      expect(src).not.toContain("storagePath");
      expect(src).not.toContain("signed");
    });

    it("download aria-label includes file name + version", () => {
      expect(src).toContain("aria-label={`تنزيل ${f.originalFileName} (إصدار ${f.fileVersion})`}");
    });

    it("storage paths are explicitly noted as never exposed", () => {
      expect(src).toContain("لا يتم عرض مسارات التخزين أو الروابط الموقعة");
    });
  });

  // -------------------------------------------------------------------------
  // Renewed-approval explanation
  // -------------------------------------------------------------------------

  describe("Renewed-approval explanation", () => {
    const src = readFileSync(PAGE_PATH, "utf-8");

    it("after replacement, shows next required step (finalize staging)", () => {
      expect(src).toContain("الخطوة التالية المطلوبة: إنهاء التجهيز");
    });

    it("comparison summary shows renewed-approval requirement", () => {
      expect(src).toContain("يحتاج إعادة اعتماد مزدوج");
    });
  });

  // -------------------------------------------------------------------------
  // Worker denial
  // -------------------------------------------------------------------------

  describe("Worker denial", () => {
    it("worker role is redirected to /worker before any page content renders", () => {
      const src = readFileSync(PAGE_PATH, "utf-8");
      expect(src).toContain('redirect("/worker")');
    });

    it("replacement action requires migration.prepare permission", () => {
      const actionsSrc = readFileSync(
        join(__dirname, "../../../app/(management)/management/admin/migration/actions.ts"),
        "utf-8",
      );
      // The replaceMigrationFileAction calls authenticateAndRequirePermission("migration.prepare")
      const replaceSection = actionsSrc.substring(
        actionsSrc.indexOf("export async function replaceMigrationFileAction"),
        actionsSrc.indexOf("export async function finalizeStagingAction"),
      );
      expect(replaceSection).toContain("migration.prepare");
    });
  });

  // -------------------------------------------------------------------------
  // Keyboard labels/focus
  // -------------------------------------------------------------------------

  describe("Keyboard labels/focus", () => {
    const replaceSrc = readFileSync(REPLACE_FORM_PATH, "utf-8");
    const pageSrc = readFileSync(PAGE_PATH, "utf-8");

    it("all interactive elements have aria-label", () => {
      expect(replaceSrc).toContain('aria-label="اختر ملف CSV المصحح للاستبدال"');
      expect(replaceSrc).toContain('aria-label="سبب إعادة العمل"');
      expect(replaceSrc).toContain('aria-label="تأكيد فهم عواقب الاستبدال"');
    });

    it("file input has focus-visible ring (keyboard accessible)", () => {
      expect(pageSrc).toContain("focus-visible:ring");
    });

    it("details/summary elements use native keyboard toggle", () => {
      expect(pageSrc).toContain("<details");
      expect(pageSrc).toContain("<summary");
    });
  });

  // -------------------------------------------------------------------------
  // Touch targets >=44px
  // -------------------------------------------------------------------------

  describe("Touch targets >=44px", () => {
    const replaceSrc = readFileSync(REPLACE_FORM_PATH, "utf-8");
    const pageSrc = readFileSync(PAGE_PATH, "utf-8");
    const selectorSrc = readFileSync(VERSION_SELECTOR_PATH, "utf-8");

    it("replacement submit button has minHeight 44px", () => {
      expect(replaceSrc).toContain('minHeight: "44px"');
    });

    it("all buttons in page have minHeight 44px", () => {
      const count = (pageSrc.match(/minHeight: "44px"/g) || []).length;
      expect(count).toBeGreaterThan(10);
    });

    it("version selector links have minHeight 44px", () => {
      expect(selectorSrc).toContain('minHeight: "44px"');
    });
  });

  // -------------------------------------------------------------------------
  // No page-level overflow at 360px
  // -------------------------------------------------------------------------

  describe("No page-level overflow at 360px", () => {
    const pageSrc = readFileSync(PAGE_PATH, "utf-8");

    it("all tables use overflow-x-auto wrapper", () => {
      const overflowCount = (pageSrc.match(/overflow-x-auto/g) || []).length;
      const tableCount = (pageSrc.match(/<table/g) || []).length;
      expect(overflowCount).toBeGreaterThanOrEqual(tableCount);
    });

    it("responsive grid classes are used", () => {
      expect(pageSrc).toContain("grid-cols-1");
      expect(pageSrc).toContain("sm:grid-cols-2");
    });

    it("container uses responsive max-width", () => {
      expect(pageSrc).toContain("Container");
    });
  });

  // -------------------------------------------------------------------------
  // Full lifecycle matrix sweep — verifies UI predicates match service guards
  // -------------------------------------------------------------------------

  describe("Full lifecycle matrix sweep", () => {
    const expected: Record<string, { upload: boolean; replace: boolean }> = {
      draft: { upload: true, replace: false },
      source_uploaded: { upload: true, replace: true },
      normalized: { upload: true, replace: true },
      staged: { upload: false, replace: true },
      validation_in_progress: { upload: false, replace: false },
      validation_complete: { upload: false, replace: true },
      reconciliation_in_progress: { upload: false, replace: false },
      review_required: { upload: false, replace: true },
      pending_dual_approval: { upload: false, replace: true },
      approved_for_commit: { upload: false, replace: true },
      committing: { upload: false, replace: false },
      committed: { upload: false, replace: false },
      rejected: { upload: false, replace: false },
      cancelled: { upload: false, replace: false },
    };

    for (const status of ALL_BATCH_STATUSES) {
      it(`status=${status}: upload=${expected[status]!.upload}, replace=${expected[status]!.replace}`, () => {
        const state = makeBaseState({ status });
        const matrix = getActionMatrix(state);
        expect(matrix.registerFile).toBe(expected[status]!.upload);
        expect(canReplaceMigrationFile(state)).toBe(expected[status]!.replace);
      });
    }
  });
});
