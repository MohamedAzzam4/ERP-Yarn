/**
 * Migration Batch Detail page — WP-08-01F.
 *
 * Route: /management/admin/migration/[batchId]
 * Contract 10 §9: Historical Migration Screens.
 *
 * UX milestone: surfaces the already-implemented production migration
 * commands on the real batch-detail UI with:
 *   - Real template selector (5 templates, Arabic description, columns, rules)
 *   - Upload form with useActionState/useFormStatus (pending, dedup, feedback)
 *   - File version list with metadata (template, size, checksum, uploader,
 *     date, current/superseded, replacement link, protected download)
 *   - Server-side paginated staging preview with lineage
 *   - Validation summary + cell-level finding details with filters + CSV export
 *   - Lifecycle-gated action buttons matching the server-side guard matrix
 *   - Loading / empty / denied / validation error / upload error / success states
 *   - Responsive Arabic RTL accessible UI (no page-level overflow at 360px)
 *
 * No metadata-only manual file registration on this page — users must upload
 * real bytes. The backend `registerFileAction` server action remains for
 * internal/import tooling, but is not surfaced on the end-user UI.
 */
import Link from "next/link";
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { ManagementShell } from "@/components/shells/management-shell";
import { getManagementNavForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { MigrationScreenQueryService } from "@/server/services/migration-screen-query-service";
import {
  uploadAndParseCsvAction,
  replaceMigrationFileAction,
  finalizeStagingAction,
  finalizeCutoverManifestAction,
  runValidationAction,
  runReconciliationAction,
  recordReviewDecisionAction,
  submitMigrationForApprovalAction,
  reopenBatchForReworkAction,
  recordOwnerMigrationApprovalAction,
  recordAccountantMigrationApprovalAction,
  recordBackupEvidenceAction,
  commitBatchAction,
  createCorrectionRequestAction,
  approveCorrectionAsOwnerAction,
  approveCorrectionAsAccountantAction,
  executeCorrectionAction,
} from "../actions";
import { getAvailableTemplates } from "@/server/services/migration-templates";
import {
  getActionMatrix,
  visibleApprovalControls,
  visibleCorrectionApprovalControls,
  canReplaceMigrationFile,
  type MigrationBatchState,
} from "@/server/services/migration-lifecycle-predicates";
import { TemplateSelectorAndUploadForm } from "./_components/template-selector-and-upload-form";
import { ValidationFindingsPanel } from "./_components/validation-findings-panel";
import { StagingPagination } from "./_components/staging-pagination";
import { ReplacementUploadForm } from "./_components/replacement-upload-form";
import { StagingVersionSelector } from "./_components/staging-version-selector";

const DEFAULT_PAGE_SIZE = 20;

export default async function MigrationBatchDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ batchId: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { batchId } = await params;
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  // Worker denial — workers never see migration data (Contract 11 §8).
  const managementRole = authResult.roles.find((r) =>
    r === "owner" || r === "accountant",
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  // Collect ALL management roles so role-specific control visibility can be
  // applied (Owner-only sees only Owner control, Accountant-only sees only
  // Accountant control, multi-role may see both — service still prevents
  // same identity satisfying both slots per DEC-069).
  const userManagementRoles = authResult.roles.filter((r): r is "owner" | "accountant" =>
    r === "owner" || r === "accountant",
  );

  const navCategories = getManagementNavForRole(managementRole);

  // Parse pagination + filter query params.
  const sp = await searchParams;
  const stagingPageRaw = typeof sp.stagingPage === "string" ? parseInt(sp.stagingPage, 10) : 1;
  const stagingPage = Number.isFinite(stagingPageRaw) && stagingPageRaw > 0 ? stagingPageRaw : 1;
  const validationFilters = {
    severity: typeof sp.severity === "string" ? sp.severity : undefined,
    fileId: typeof sp.fileId === "string" ? sp.fileId : undefined,
    sheet: typeof sp.sheet === "string" ? sp.sheet : undefined,
    errorCode: typeof sp.errorCode === "string" ? sp.errorCode : undefined,
    q: typeof sp.q === "string" ? sp.q : undefined,
  };

  let detail: Awaited<
    ReturnType<MigrationScreenQueryService["getBatchDetail"]>
  > = null;
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new MigrationScreenQueryService(db);
      detail = await queryService.getBatchDetail(authResult.tenantId, batchId, {
        page: stagingPage,
        pageSize: DEFAULT_PAGE_SIZE,
      });
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  // Denied state: DB unavailable.
  if (!dbAvailable) {
    return (
      <ManagementShell
        userName={authResult.name || authResult.email}
        navCategories={navCategories}
        onSignOut={async () => {
          "use server";
          await signOut();
        }}
      >
        <Container>
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        </Container>
      </ManagementShell>
    );
  }

  // Denied state: batch not found / wrong tenant.
  if (!detail) {
    return (
      <ManagementShell
        userName={authResult.name || authResult.email}
        navCategories={navCategories}
        onSignOut={async () => {
          "use server";
          await signOut();
        }}
      >
        <Container>
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              الدفعة غير موجودة أو لا تنتمي إلى هذا المستأجر.
            </CardContent>
          </Card>
        </Container>
      </ManagementShell>
    );
  }

  const b = detail.batch;

  // Build lifecycle state for action matrix.
  const batchState: MigrationBatchState = {
    status: b.status as MigrationBatchState["status"],
    stagedRowCount: b.stagedRowCount,
    blockingErrorCount: b.blockingErrorCount,
    warningCount: b.warningCount,
    acceptedWarningCount: b.acceptedWarningCount,
    stagedDataHash: b.stagedDataHash,
    cutoverManifestHash: b.cutoverManifestHash,
    hasOwnerApproval: detail.approvals.some((a) => a.approverRole === "owner"),
    hasAccountantApproval: detail.approvals.some((a) => a.approverRole === "accountant"),
    hasBackupEvidence: detail.backupEvidence.length > 0,
  };
  const actionMatrix = getActionMatrix(batchState);
  const batchApprovalVisibility = visibleApprovalControls(userManagementRoles, batchState);

  // WP-08-01F R2 — The current (non-superseded) source file for the batch.
  // Used to populate the replacement form's "current file being replaced" display.
  const currentFile = detail.files.find((f) => f.isCurrent && f.fileType === "source") ?? null;

  // Apply validation filters on the server-rendered findings list.
  const filteredFindings = detail.validationFindings.filter((f) => {
    if (validationFilters.severity && f.severity !== validationFilters.severity) return false;
    if (validationFilters.fileId && f.fileId !== validationFilters.fileId) return false;
    if (validationFilters.sheet && f.sourceSheetName !== validationFilters.sheet) return false;
    if (validationFilters.errorCode && f.errorCode !== validationFilters.errorCode) return false;
    if (validationFilters.q) {
      const needle = validationFilters.q.toLowerCase();
      const hay = [f.message, f.errorCode, f.submittedValue ?? "", f.fileName ?? ""].join(" ").toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });

  // Pathname for pagination links (preserves all query params).
  const pathname = `/management/admin/migration/${batchId}`;

  return (
    <ManagementShell
      userName={authResult.name || authResult.email}
      navCategories={navCategories}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <Container>
        <div className="mb-4">
          <Link href="/management/admin/migration" className="text-sm text-muted-foreground hover:underline">
            ← العودة إلى قائمة الدفعات
          </Link>
        </div>
        <h1 className="text-2xl font-bold mb-6">
          <LtrValue>{b.batchNo}</LtrValue>
        </h1>

        {/* Batch summary */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>ملخص الدفعة</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 text-sm">
              <div>
                <dt className="text-muted-foreground">الحالة:</dt>
                <dd className="font-medium">{b.status}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">القالب:</dt>
                <dd className="font-medium">{b.templateName ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">إصدار القالب:</dt>
                <dd className="font-medium"><LtrValue>{b.templateVersion ?? "—"}</LtrValue></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">إصدار التعيين:</dt>
                <dd className="font-medium"><LtrValue>{b.mappingVersion ?? "—"}</LtrValue></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">الصفوف المجهزة:</dt>
                <dd className="font-medium"><LtrValue>{b.stagedRowCount}</LtrValue></dd>
              </div>
              <div>
                <dt className="text-muted-foreground">أخطاء مانعة:</dt>
                <dd className="font-medium">
                  {b.blockingErrorCount > 0 ? (
                    <span className="text-destructive"><LtrValue>{b.blockingErrorCount}</LtrValue></span>
                  ) : (
                    <LtrValue>0</LtrValue>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">تحذيرات:</dt>
                <dd className="font-medium">
                  {b.warningCount > 0 ? (
                    <span className="text-amber-600"><LtrValue>{b.warningCount}</LtrValue></span>
                  ) : (
                    <LtrValue>0</LtrValue>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">التحقق:</dt>
                <dd className="font-medium">{b.validationStatus ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">المطابقة:</dt>
                <dd className="font-medium">{b.reconciliationStatus ?? "—"}</dd>
              </div>
              {b.committedAt && (
                <div>
                  <dt className="text-muted-foreground">تاريخ الترحيل:</dt>
                  <dd className="font-medium">
                    <LtrValue>{new Date(b.committedAt).toLocaleDateString("ar")}</LtrValue>
                  </dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>

        {/* Validation summary — always visible once findings exist */}
        <Card className="mb-6">
          <CardHeader><CardTitle>ملخص التحقق</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className={`border rounded p-3 ${detail.validationSummary.blockingErrorCount > 0 ? "border-destructive/50 bg-destructive/5" : "border-muted bg-muted/30"}`}>
                <div className="text-xs text-muted-foreground">أخطاء مانعة</div>
                <div className={`text-2xl font-bold ${detail.validationSummary.blockingErrorCount > 0 ? "text-destructive" : ""}`}>
                  <LtrValue>{detail.validationSummary.blockingErrorCount}</LtrValue>
                </div>
              </div>
              <div className={`border rounded p-3 ${detail.validationSummary.warningCount > 0 ? "border-amber-500/50 bg-amber-50" : "border-muted bg-muted/30"}`}>
                <div className="text-xs text-muted-foreground">تحذيرات للمراجعة</div>
                <div className={`text-2xl font-bold ${detail.validationSummary.warningCount > 0 ? "text-amber-700" : ""}`}>
                  <LtrValue>{detail.validationSummary.warningCount}</LtrValue>
                </div>
              </div>
              <div className="border border-muted bg-muted/30 rounded p-3">
                <div className="text-xs text-muted-foreground">معلومات</div>
                <div className="text-2xl font-bold">
                  <LtrValue>{detail.validationSummary.informationalCount}</LtrValue>
                </div>
              </div>
            </div>
            <div
              role="status"
              className={`mt-3 p-3 rounded text-sm border flex items-center gap-2 ${
                detail.validationSummary.progressionBlocked
                  ? "border-destructive/50 text-destructive bg-destructive/5"
                  : "border-success/50 text-success bg-success/5"
              }`}
            >
              <span aria-hidden="true">{detail.validationSummary.progressionBlocked ? "⛔" : "✓"}</span>
              {detail.validationSummary.progressionBlocked
                ? "التقدم محظور: يوجد خطأ مانع. يجب حل جميع الأخطاء المانعة قبل إكمال المطابقة أو التقديم للاعتماد."
                : "لا توجد أخطاء مانعة. يمكن التقدم إلى مرحلة المطابقة / التقديم للاعتماد (راجع التحذيرات إن وجدت)."}
            </div>
          </CardContent>
        </Card>

        {/* Lifecycle action forms — only shown in valid states */}
        {!actionMatrix.createCorrectionRequest && (
          <Card className="mb-6">
            <CardHeader><CardTitle>إجراءات دورة الحياة</CardTitle></CardHeader>
            <CardContent className="space-y-4">

              {/* Template selector + upload form — only in preparation states.
                  Replaces the five independent template buttons with a real selector.
                  WP-08-01F R2: ordinary upload visible ONLY in draft/source_uploaded/normalized.
                  It disappears after staging finalization (actionMatrix.registerFile is false
                  in staged+ states). */}
              {actionMatrix.registerFile && (
                <TemplateSelectorAndUploadForm
                  batchId={b.id}
                  templates={getAvailableTemplates()}
                  uploadAction={uploadAndParseCsvAction}
                />
              )}

              {/* WP-08-01F R2 — Replacement upload form.
                  Visible only in contract-valid pre-commit rework states
                  (REPLACEMENT_ELIGIBLE_STATES: source_uploaded, normalized, staged,
                  validation_complete, review_required, pending_dual_approval,
                  approved_for_commit).
                  Excluded: draft (no file to replace), validation_in_progress,
                  reconciliation_in_progress, committing, committed, rejected, cancelled.
                  Requires a current file to exist. */}
              {canReplaceMigrationFile(batchState) && currentFile && (
                <ReplacementUploadForm
                  batchId={b.id}
                  currentFile={{
                    id: currentFile.id,
                    originalFileName: currentFile.originalFileName,
                    fileHashRedacted: currentFile.fileHashRedacted,
                    fileVersion: currentFile.fileVersion,
                    createdAt: currentFile.createdAt,
                  }}
                  templateType={b.templateName}
                  templateVersion={b.templateVersion}
                  replaceAction={replaceMigrationFileAction}
                />
              )}

              {/* WP-08-01F R2 — After replacement, show the next required step.
                  The batch is now in source_uploaded state; the user must finalize staging. */}
              {b.status === "source_uploaded" && detail.files.filter((f) => !f.isCurrent).length > 0 && (
                <div role="status" className="border border-info/50 text-info bg-info/5 rounded p-3 text-sm flex items-start gap-2">
                  <span aria-hidden="true">ℹ</span>
                  <div>
                    <div className="font-semibold">الخطوة التالية المطلوبة: إنهاء التجهيز</div>
                    <div className="text-xs mt-1">
                      تم استبدال الملف بنجاح. يجب الآن إنهاء التجهيز لإعادة حساب بصمة البيانات،
                      ثم إعادة التحقق والمطابقة والاعتماد المزدوج.
                    </div>
                  </div>
                </div>
              )}

              {/* No metadata-only manual file registration on the end-user UI.
                  The backend registerFileAction server action remains for
                  internal/import tooling, but users must NOT be able to
                  create a file record without actual stored bytes. */}

              {/* Insert staging row — NOT exposed on the end-user UI.
                  The canonical path for staging rows is uploading a CSV via the
                  template selector above. Manual staging insertion is intentionally
                  omitted to prevent bypassing the file-upload lineage requirement.
                  The server action `insertStagingRowAction` remains for internal
                  tooling but is not surfaced here. */}

              {/* Finalize staging — only in source_uploaded / normalized */}
              {(b.status === "source_uploaded" || b.status === "normalized") && (
                <form data-action="finalize-staging" action={finalizeStagingAction} className="border rounded p-3 flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`finalize-staging-${crypto.randomUUID()}`} />
                  <div className="flex-1 text-sm">
                    <span className="font-medium">إنهاء التجهيز</span>
                    <p className="text-xs text-muted-foreground">سيتم حساب بصمة البيانات المجهزة (stagedDataHash) تلقائياً وتغيير الحالة إلى staged.</p>
                  </div>
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>إنهاء التجهيز</button>
                </form>
              )}

              {/* Finalize cutover manifest — only when staged+ and no manifest yet */}
              {(b.status === "staged" || b.status === "validation_complete" || b.status === "reconciliation_in_progress" || b.status === "review_required") && !b.cutoverManifestHash && (
                <form data-action="finalize-cutover-manifest" action={finalizeCutoverManifestAction} className="border rounded p-3 space-y-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`finalize-manifest-${crypto.randomUUID()}`} />
                  <div className="text-sm">
                    <span className="font-medium">إنهاء بيان الترحيل (Cutover Manifest)</span>
                    <p className="text-xs text-muted-foreground">سيتم حساب بصمة البيان تلقائياً من البيانات المخزنة. لا تقم بإدخال بصمة يدوياً.</p>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">المجال (Domain):</span>
                      <input type="text" name="domain" required placeholder="inventory" defaultValue="inventory" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">تاريخ القطع:</span>
                      <input type="date" name="cutoffDate" required className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">تغطية المصدر:</span>
                      <input type="text" name="sourceCoverage" placeholder="all" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">أساس الرصيد الافتتاحي:</span>
                      <input type="text" name="openingBalanceBasis" placeholder="audit" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                    </label>
                  </div>
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>إنهاء بيان الترحيل</button>
                </form>
              )}

              {/* Run validation — only when staging exists */}
              {actionMatrix.runValidation && (
                <form data-action="run-validation" action={runValidationAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`val-${crypto.randomUUID()}`} />
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>تشغيل التحقق</button>
                  {detail.validationSummary.progressionBlocked && (
                    <span className="text-xs text-destructive">⚠ يوجد خطأ مانع — يُنصح بحله قبل المتابعة</span>
                  )}
                </form>
              )}

              {/* Run reconciliation — only after validation.
                  Disabled when progression is blocked (UI matches server). */}
              {actionMatrix.runReconciliation && (
                <form data-action="run-reconciliation" action={runReconciliationAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`recon-${crypto.randomUUID()}`} />
                  <button
                    type="submit"
                    className="px-4 py-2 border rounded text-sm hover:bg-muted disabled:opacity-60"
                    style={{ minHeight: "44px" }}
                    disabled={detail.validationSummary.progressionBlocked}
                    aria-disabled={detail.validationSummary.progressionBlocked}
                    title={detail.validationSummary.progressionBlocked ? "محظور بسبب وجود خطأ مانع" : undefined}
                  >
                    تشغيل المطابقة
                  </button>
                  {detail.validationSummary.progressionBlocked && (
                    <span className="text-xs text-destructive">
                      محظور: يجب حل جميع الأخطاء المانعة أولاً
                    </span>
                  )}
                </form>
              )}

              {/* Review decisions — only for unresolved review items */}
              {actionMatrix.recordReviewDecision && detail.reviewItems.filter((r) => r.status === "pending").length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">عناصر المراجعة غير المحلولة</h3>
                  {detail.reviewItems.filter((r) => r.status === "pending").map((item) => (
                    <form key={item.id} data-action="record-review-decision" action={recordReviewDecisionAction} className="flex flex-wrap gap-2 items-center border rounded p-2">
                      <input type="hidden" name="reviewItemId" value={item.id} />
                      <input type="hidden" name="batchId" value={b.id} />
                      <input type="hidden" name="idempotencyKey" value={`review-${item.id}-${crypto.randomUUID()}`} />
                      <span className="text-sm flex-1">{item.reviewReason}</span>
                      <select name="decision" required className="px-2 py-1 border rounded text-sm bg-background" style={{ minHeight: "44px" }}>
                        <option value="">— قرار —</option>
                        <option value="accepted">قبول</option>
                        <option value="rejected">رفض</option>
                        <option value="resolved">حل</option>
                      </select>
                      <input type="text" name="decisionNotes" placeholder="ملاحظات" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                      <button type="submit" className="px-3 py-1 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>حفظ</button>
                    </form>
                  ))}
                </div>
              )}

              {/* Submit for approval — review_required → pending_dual_approval.
                  Disabled when progression is blocked. */}
              {actionMatrix.submitForApproval && (
                <form data-action="submit-migration-for-approval" action={submitMigrationForApprovalAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`submit-${crypto.randomUUID()}`} />
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                    <span className="text-muted-foreground">ملخص قبول التحذيرات (مطلوب عند وجود تحذيرات):</span>
                    <input type="text" name="warningSummary" placeholder="تمت مراجعة جميع التحذيرات وقبولها للأسباب التالية..." className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <div className="sm:col-span-2 flex items-center gap-3">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold disabled:opacity-60"
                      style={{ minHeight: "44px" }}
                      disabled={detail.validationSummary.progressionBlocked}
                      aria-disabled={detail.validationSummary.progressionBlocked}
                    >
                      تقديم للاعتماد المزدوج
                    </button>
                    {detail.validationSummary.progressionBlocked && (
                      <span className="text-xs text-destructive">محظور: يوجد خطأ مانع</span>
                    )}
                  </div>
                </form>
              )}

              {/* APPROVAL CONTROLS — only when pending_dual_approval AND user has the role
                  AND the slot is not yet filled. approved_for_commit shows EVIDENCE ONLY
                  (no new approval buttons) per the lifecycle gating matrix. */}
              {batchState.status === "pending_dual_approval" && (
                <>
                  {batchApprovalVisibility.owner && !batchState.hasOwnerApproval && (
                    <form data-action="record-owner-approval" action={recordOwnerMigrationApprovalAction} className="flex gap-3 items-center">
                      <input type="hidden" name="batchId" value={b.id} />
                      <input type="hidden" name="idempotencyKey" value={`appr-owner-${crypto.randomUUID()}`} />
                      <input type="text" name="reason" placeholder="سبب الاعتماد" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                      <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold" style={{ minHeight: "44px" }}>اعتماد المالك</button>
                    </form>
                  )}
                  {batchApprovalVisibility.accountant && !batchState.hasAccountantApproval && (
                    <form data-action="record-accountant-approval" action={recordAccountantMigrationApprovalAction} className="flex gap-3 items-center">
                      <input type="hidden" name="batchId" value={b.id} />
                      <input type="hidden" name="idempotencyKey" value={`appr-acct-${crypto.randomUUID()}`} />
                      <input type="text" name="reason" placeholder="سبب الاعتماد" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                      <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold" style={{ minHeight: "44px" }}>اعتماد المحاسب</button>
                    </form>
                  )}
                  {/* When both approvals already exist in pending_dual_approval (rare race),
                      show evidence-only — same as approved_for_commit. */}
                  {batchState.hasOwnerApproval && batchState.hasAccountantApproval && (
                    <div role="status" className="border border-success/50 text-success bg-success/5 rounded p-3 text-sm flex items-center gap-2">
                      <span aria-hidden="true">✓</span>
                      تم تسجيل اعتماد المالك والمحاسب. في انتظار انتقال الحالة إلى approved_for_commit.
                    </div>
                  )}
                </>
              )}

              {/* approved_for_commit — EVIDENCE ONLY, no new approval buttons. */}
              {batchState.status === "approved_for_commit" && (
                <div role="status" className="border border-success/50 text-success bg-success/5 rounded p-3 text-sm flex items-center gap-2">
                  <span aria-hidden="true">✓</span>
                  اكتمل الاعتماد المزدوج. الدفعة جاهزة للترحيل النهائي.
                </div>
              )}

              {/* Record backup evidence — only in pre-commit states */}
              {actionMatrix.recordBackupEvidence && !batchState.hasBackupEvidence && (
                <form data-action="record-backup-evidence" action={recordBackupEvidenceAction} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`backup-${crypto.randomUUID()}`} />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">نوع النسخة:</span>
                    <input type="text" name="backupType" required placeholder="full" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">موقع النسخة (خاص):</span>
                    <input type="text" name="backupLocation" required placeholder="s3://bucket/backup" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">بصمة النسخة:</span>
                    <input type="text" name="backupHash" required placeholder="sha256:..." className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>تسجيل دليل النسخ الاحتياطي</button>
                  </div>
                </form>
              )}

              {/* Atomic commit — only when fully eligible */}
              {actionMatrix.commitBatch && (
                <form data-action="commit-batch" action={commitBatchAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`commit-${crypto.randomUUID()}`} />
                  <button type="submit" className="px-4 py-2 bg-destructive text-destructive-foreground rounded text-sm font-semibold" style={{ minHeight: "44px" }}>ترحيل نهائي (غير قابل للتراجع)</button>
                </form>
              )}

              {/* Rework/reopen — Contract 08 §9 permitted branches */}
              {(b.status === "review_required" || b.status === "pending_dual_approval" || b.status === "approved_for_commit") && (
                <form data-action="reopen-batch-for-rework" action={reopenBatchForReworkAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t pt-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`rework-${crypto.randomUUID()}`} />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">الحالة المستهدفة:</span>
                    <select name="targetState" required className="px-2 py-1 border rounded text-sm bg-background" style={{ minHeight: "44px" }}>
                      {b.status === "review_required" && (
                        <>
                          <option value="normalized">normalized (إعادة تجهيز)</option>
                          <option value="staged">staged (إعادة تحقق)</option>
                          <option value="validation_in_progress">validation_in_progress (إعادة مطابقة)</option>
                        </>
                      )}
                      {(b.status === "pending_dual_approval" || b.status === "approved_for_commit") && (
                        <option value="review_required">review_required (إعادة مراجعة)</option>
                      )}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">سبب إعادة العمل:</span>
                    <input type="text" name="reason" required placeholder="سبب إعادة فتح الدفعة..." className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <div className="sm:col-span-2">
                    <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>إعادة فتح للعمل</button>
                  </div>
                </form>
              )}

            </CardContent>
          </Card>
        )}

        {/* Committed batch — correction workflow only */}
        {b.status === "committed" && (
          <Card className="mb-6">
            <CardHeader><CardTitle>التصحيحات</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div role="status" className="text-sm text-muted-foreground">
                هذه الدفعة مُرحَّلة ومقفولة. لا يمكن تعديل البيانات المرحَّلة.
                يمكن طلب تصحيح من خلال المسؤول.
              </div>
              <form data-action="create-correction-request" action={createCorrectionRequestAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input type="hidden" name="batchId" value={b.id} />
                <input type="hidden" name="idempotencyKey" value={`corr-${crypto.randomUUID()}`} />
                <input type="hidden" name="correctionType" value="adjustment" />
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">نوع الكيان:</span>
                  <input type="text" name="originalEntityType" required placeholder="stock_movement" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  <span className="text-muted-foreground">معرف الكيان:</span>
                  <input type="text" name="originalEntityId" required placeholder="uuid" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                </label>
                <label className="flex flex-col gap-1 text-sm sm:col-span-2">
                  <span className="text-muted-foreground">السبب:</span>
                  <input type="text" name="reason" required placeholder="سبب التصحيح" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                </label>
                <div className="sm:col-span-2">
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>طلب تصحيح</button>
                </div>
              </form>

              {/* Correction requests list with approval forms */}
              {detail.corrections.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">طلبات التصحيح</h3>
                  {detail.corrections.map((corr) => {
                    const corrVis = visibleCorrectionApprovalControls(
                      userManagementRoles,
                      corr.status,
                      Boolean(corr.ownerApprovedBy),
                      Boolean(corr.accountantApprovedBy),
                    );
                    return (
                    <div key={corr.id} className="border rounded p-3 text-sm space-y-2">
                      <div className="flex justify-between">
                        <span className="font-medium"><LtrValue>{corr.docNo}</LtrValue></span>
                        <span>{corr.status}</span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        النوع: {corr.correctionType} | الكيان: <LtrValue>{corr.originalEntityType}</LtrValue>
                      </div>
                      <p>{corr.reason}</p>

                      {corrVis.owner && (
                        <form data-action="approve-correction-owner" action={approveCorrectionAsOwnerAction} className="flex gap-2 items-center">
                          <input type="hidden" name="correctionRequestId" value={corr.id} />
                          <input type="hidden" name="batchId" value={b.id} />
                          <input type="hidden" name="idempotencyKey" value={`corr-owner-${corr.id}-${crypto.randomUUID()}`} />
                          <button type="submit" className="px-3 py-1 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>اعتماد المالك</button>
                        </form>
                      )}

                      {corrVis.accountant && (
                        <form data-action="approve-correction-accountant" action={approveCorrectionAsAccountantAction} className="flex gap-2 items-center">
                          <input type="hidden" name="correctionRequestId" value={corr.id} />
                          <input type="hidden" name="batchId" value={b.id} />
                          <input type="hidden" name="idempotencyKey" value={`corr-acct-${corr.id}-${crypto.randomUUID()}`} />
                          <button type="submit" className="px-3 py-1 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>اعتماد المحاسب</button>
                        </form>
                      )}

                      {corr.status === "approved" && !corr.correctedEntityId && (
                        <div className="text-xs text-muted-foreground">
                          تم الاعتماد من المالك والمحاسب. جاهز للتنفيذ.
                        </div>
                      )}

                      {corr.status === "approved" && !corr.correctedEntityId && (
                        <form data-action="execute-correction" action={executeCorrectionAction} className="flex gap-2 items-center">
                          <input type="hidden" name="correctionRequestId" value={corr.id} />
                          <input type="hidden" name="batchId" value={b.id} />
                          <input type="hidden" name="idempotencyKey" value={`exec-${corr.id}-${crypto.randomUUID()}`} />
                          <button type="submit" className="px-4 py-2 bg-destructive text-destructive-foreground rounded text-sm font-semibold" style={{ minHeight: "44px" }}>
                            تنفيذ التصحيح (تأثير عكسي)
                          </button>
                        </form>
                      )}

                      {corr.status === "approved" && corr.correctedEntityId && (
                        <div className="text-xs text-green-600 border border-green-300 rounded p-2">
                          تم تنفيذ التصحيح. الكيان المصحح: <LtrValue>{corr.correctedEntityType}</LtrValue> / <LtrValue>{corr.correctedEntityId}</LtrValue>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* File version list — immutable version history with all metadata + protected download */}
        <Card className="mb-6">
          <CardHeader><CardTitle>سجل إصدارات الملفات (غير قابل للتعديل)</CardTitle></CardHeader>
          <CardContent>
            {detail.files.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                لا توجد ملفات مرفوعة بعد. استخدم نموذج الرفع أعلاه لإضافة ملف CSV.
              </div>
            ) : (
              <div className="space-y-3">
                {/* WP-08-01F R2 — Old/new comparison summary (when multiple versions exist) */}
                {detail.files.length > 1 && (
                  <div className="border rounded p-3 bg-muted/20 text-xs space-y-2">
                    <div className="font-semibold text-foreground">مقارنة الإصدارات:</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-muted-foreground">الإصدار الحالي:</div>
                        <div>الملف: <LtrValue>{currentFile?.originalFileName ?? "—"}</LtrValue></div>
                        <div>الإصدار: <LtrValue>v{currentFile?.fileVersion ?? "—"}</LtrValue></div>
                        <div>الصفوف الحالية: <LtrValue>{detail.stagingPagination.totalRows}</LtrValue></div>
                        <div>التحقق: {b.validationStatus ?? "—"}</div>
                        <div>المطابقة: {b.reconciliationStatus ?? "—"}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground">الإصدارات الملغاة:</div>
                        <div>العدد: <LtrValue>{detail.files.filter((f) => !f.isCurrent).length}</LtrValue></div>
                        <div>آخر استبدال: <LtrValue>{detail.files.filter((f) => !f.isCurrent).sort((a, b2) => (b2.supersededAt ?? "").localeCompare(a.supersededAt ?? ""))[0]?.supersededAt ? new Date(detail.files.filter((f) => !f.isCurrent).sort((a, b2) => (b2.supersededAt ?? "").localeCompare(a.supersededAt ?? ""))[0]!.supersededAt!).toLocaleDateString("ar") : "—"}</LtrValue></div>
                        <div className="text-amber-700">يحتاج إعادة اعتماد مزدوج: {detail.approvals.filter((a) => a.approverRole === "owner").length === 0 || detail.approvals.filter((a) => a.approverRole === "accountant").length === 0 ? "نعم" : "لا"}</div>
                      </div>
                    </div>
                  </div>
                )}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">اسم الملف</th>
                        <th className="py-2 px-3">القالب / الإصدار</th>
                        <th className="py-2 px-3">إصدار الملف</th>
                        <th className="py-2 px-3">الحجم</th>
                        <th className="py-2 px-3">البصمة</th>
                        <th className="py-2 px-3">الرافع</th>
                        <th className="py-2 px-3">تاريخ الرفع</th>
                        <th className="py-2 px-3">الحالة</th>
                        <th className="py-2 px-3">سبب الإلغاء</th>
                        <th className="py-2 px-3">التنزيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.files.map((f) => (
                        <tr key={f.id} className={`border-b ${f.isCurrent ? "" : "bg-muted/10"}`}>
                          <td className="py-2 px-3"><LtrValue>{f.originalFileName}</LtrValue></td>
                          <td className="py-2 px-3 text-xs">
                            {f.templateType ? <LtrValue>{f.templateType}</LtrValue> : "—"}
                            {" / v"}
                            {f.templateVersion ? <LtrValue>{f.templateVersion}</LtrValue> : "—"}
                          </td>
                          <td className="py-2 px-3 text-xs">
                            <LtrValue>v{f.fileVersion}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            {f.fileSizeBytes ? <LtrValue>{(f.fileSizeBytes / 1024).toFixed(1)} KB</LtrValue> : "—"}
                          </td>
                          <td className="py-2 px-3"><LtrValue>{f.fileHashRedacted}</LtrValue></td>
                          <td className="py-2 px-3 text-xs text-muted-foreground">
                            {f.uploaderUserId ? <LtrValue>{f.uploaderUserId.substring(0, 8)}…</LtrValue> : "—"}
                          </td>
                          <td className="py-2 px-3 text-xs">
                            <LtrValue>{new Date(f.createdAt).toLocaleDateString("ar")}</LtrValue>
                          </td>
                          <td className="py-2 px-3">
                            {f.isCurrent ? (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-success/50 text-success bg-success/5 font-semibold">
                                <span aria-hidden="true">✓</span> حالي
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border border-amber-500/50 text-amber-700 bg-amber-50 font-semibold">
                                <span aria-hidden="true">↩</span> ملغى
                                {f.supersededById && (
                                  <span className="text-xs ml-1" dir="ltr">
                                    (← <LtrValue>{f.supersededById.substring(0, 8)}…</LtrValue>)
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-xs text-muted-foreground max-w-[200px]">
                            {f.supersededReason ? (
                              <span className="break-words">{f.supersededReason}</span>
                            ) : (
                              <span>—</span>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <a
                              href={`/management/admin/migration/${b.id}/files/${f.id}/download`}
                              className="text-primary hover:underline inline-flex items-center"
                              aria-label={`تنزيل ${f.originalFileName} (إصدار ${f.fileVersion})`}
                              style={{ minHeight: "44px", display: "inline-flex", alignItems: "center" }}
                            >
                              تنزيل
                            </a>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {/* Storage paths are NEVER exposed — only protected download links */}
                <div className="text-xs text-muted-foreground mt-2">
                  لا يتم عرض مسارات التخزين أو الروابط الموقعة. التنزيل محمي بتحقق الملكية والصلاحية.
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Staging preview — paginated with lineage + version selector */}
        <Card className="mb-6">
          <CardHeader><CardTitle>معاينة البيانات المجهزة</CardTitle></CardHeader>
          <CardContent>
            {/* WP-08-01F R2 — Staging version selector.
                Lets the user switch between current and historical superseded versions.
                Historical versions are read-only and visually marked as superseded.
                Never mixes rows/findings from different versions. */}
            {detail.files.length > 1 && (
              <StagingVersionSelector
                files={detail.files.map((f) => ({
                  id: f.id,
                  originalFileName: f.originalFileName,
                  fileVersion: f.fileVersion,
                  isCurrent: f.isCurrent,
                  fileHashRedacted: f.fileHashRedacted,
                  createdAt: f.createdAt,
                  supersededReason: f.supersededReason,
                }))}
                selectedFileId={typeof sp.fileVersion === "string" ? sp.fileVersion : null}
                pathname={pathname}
                preserveParams={{
                  severity: validationFilters.severity,
                  fileId: validationFilters.fileId,
                  sheet: validationFilters.sheet,
                  errorCode: validationFilters.errorCode,
                  q: validationFilters.q,
                  stagingPage: stagingPage > 1 ? String(stagingPage) : undefined,
                }}
              />
            )}
            {detail.stagingRows.length === 0 && detail.stagingPagination.totalRows === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                لا توجد صفوف مجهزة بعد. ارفع ملف CSV وإنهاء التجهيز لرؤية البيانات هنا.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-right">
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">الملف / الورقة / الصف</th>
                        <th className="py-2 px-3">القالب</th>
                        <th className="py-2 px-3">البيانات</th>
                        <th className="py-2 px-3">حالة التحقق</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.stagingRows.map((row, idx) => {
                        const linkedFile = detail.files.find((f) => f.id === row.importFileId);
                        return (
                          <tr key={row.id} className="border-b">
                            <td className="py-2 px-3">
                              <LtrValue>
                                {(detail.stagingPagination.page - 1) * detail.stagingPagination.pageSize + idx + 1}
                              </LtrValue>
                            </td>
                            <td className="py-2 px-3 text-xs text-muted-foreground">
                              {linkedFile && <div className="truncate max-w-[200px]"><LtrValue>{linkedFile.originalFileName}</LtrValue></div>}
                              {row.sourceSheetName && row.sourceSheetName !== linkedFile?.originalFileName && (
                                <div><LtrValue>{row.sourceSheetName}</LtrValue></div>
                              )}
                              {row.sourceRowNumber != null && <div>صف: <LtrValue>{row.sourceRowNumber}</LtrValue></div>}
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {row.templateName ? <LtrValue>{row.templateName}</LtrValue> : "—"}
                            </td>
                            <td className="py-2 px-3 text-xs">
                              {row.transformedRowJson ? (
                                <details>
                                  <summary
                                    className="cursor-pointer hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    style={{ minHeight: "44px", display: "flex", alignItems: "center" }}
                                  >
                                    عرض البيانات (القيم المُرسلة + المُطبَّعة)
                                  </summary>
                                  <pre className="mt-1 p-2 bg-muted rounded text-xs overflow-x-auto" dir="ltr">
                                    {JSON.stringify(row.transformedRowJson, null, 2)}
                                  </pre>
                                </details>
                              ) : (
                                <span className="text-muted-foreground">—</span>
                              )}
                            </td>
                            <td className="py-2 px-3">
                              {row.validationStatus ? <LtrValue>{row.validationStatus}</LtrValue> : "—"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <StagingPagination
                  page={detail.stagingPagination.page}
                  pageSize={detail.stagingPagination.pageSize}
                  totalRows={detail.stagingPagination.totalRows}
                  totalPages={detail.stagingPagination.totalPages}
                  hasNextPage={detail.stagingPagination.hasNextPage}
                  hasPrevPage={detail.stagingPagination.hasPrevPage}
                  pathname={pathname}
                  preserveParams={{
                    severity: validationFilters.severity,
                    fileId: validationFilters.fileId,
                    sheet: validationFilters.sheet,
                    errorCode: validationFilters.errorCode,
                    q: validationFilters.q,
                  }}
                />
              </>
            )}
          </CardContent>
        </Card>

        {/* Validation findings — with filters + CSV export */}
        <Card className="mb-6">
          <CardHeader><CardTitle>نتائج التحقق — التفاصيل على مستوى الخلية</CardTitle></CardHeader>
          <CardContent>
            {detail.validationFindings.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">
                لا توجد نتائج تحقق بعد. شغّل التحقق لرؤية النتائج هنا.
              </div>
            ) : (
              <ValidationFindingsPanel
                batchId={b.id}
                findings={filteredFindings}
                files={detail.files}
                currentFilters={validationFilters}
                stagingPage={stagingPage}
              />
            )}
          </CardContent>
        </Card>

        {/* Reconciliation results */}
        {detail.reconciliationResults.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>نتائج المطابقة</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">الإصدار</th>
                      <th className="py-2 px-3">المقياس</th>
                      <th className="py-2 px-3">المتوقع</th>
                      <th className="py-2 px-3">المُجهز</th>
                      <th className="py-2 px-3">الفرق</th>
                      <th className="py-2 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.reconciliationResults.map((r) => (
                      <tr key={r.id} className="border-b">
                        <td className="py-2 px-3"><LtrValue>v{r.reportVersion}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{r.metricKey}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{r.expectedValue ?? "—"}</LtrValue></td>
                        <td className="py-2 px-3"><LtrValue>{r.stagedValue ?? "—"}</LtrValue></td>
                        <td className="py-2 px-3">
                          {r.differenceValue && r.differenceValue !== "0" ? (
                            <span className="text-amber-600"><LtrValue>{r.differenceValue}</LtrValue></span>
                          ) : (
                            <LtrValue>{r.differenceValue ?? "—"}</LtrValue>
                          )}
                        </td>
                        <td className="py-2 px-3">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Approvals — evidence-only display, no new approval buttons here */}
        {detail.approvals.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>الاعتمادات المسجلة</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {detail.approvals.map((a) => (
                  <div key={a.id} className="border rounded p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">
                        {a.approverRole === "owner" ? "المالك" : "المحاسب"}
                      </span>
                      <LtrValue>{new Date(a.approvedAt).toLocaleDateString("ar")}</LtrValue>
                    </div>
                    {a.reason && <p className="text-muted-foreground mt-1">{a.reason}</p>}
                    <div className="text-xs text-muted-foreground mt-1">
                      بصمة البيانات: <LtrValue>{a.stagedDataHash.substring(0, 16)}…</LtrValue>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Backup evidence */}
        {detail.backupEvidence.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>أدلة النسخ الاحتياطي</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {detail.backupEvidence.map((be) => (
                  <div key={be.id} className="border rounded p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{be.backupType}</span>
                      <LtrValue>{be.backupLocationRedacted}</LtrValue>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      البصمة: <LtrValue>{be.backupHash.substring(0, 16)}…</LtrValue>
                    </div>
                    {be.verifiedAt && (
                      <div className="text-xs text-muted-foreground">
                        تم التحقق: <LtrValue>{new Date(be.verifiedAt).toLocaleDateString("ar")}</LtrValue>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Active locks */}
        {detail.activeLocks.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>أقفال الترحيل النشطة</CardTitle></CardHeader>
            <CardContent>
              <div className="space-y-2">
                {detail.activeLocks.filter((l) => !l.releasedAt).map((l) => (
                  <div key={l.id} className="border rounded p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{l.lockScope}</span>
                      <LtrValue>{new Date(l.acquiredAt).toLocaleString("ar")}</LtrValue>
                    </div>
                    {l.expiresAt && (
                      <div className="text-xs text-muted-foreground">
                        ينتهي: <LtrValue>{new Date(l.expiresAt).toLocaleString("ar")}</LtrValue>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </Container>
    </ManagementShell>
  );
}
