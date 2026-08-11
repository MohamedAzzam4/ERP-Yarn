/**
 * Migration Batch Detail page — WP-08-01F.
 *
 * Route: /management/admin/migration/[batchId]
 * Contract 10 §9: Historical Migration Screens.
 *
 * Shows batch lifecycle, files, staging preview, validation findings,
 * alias mappings, review items, reconciliation results, approvals,
 * backup evidence, active locks, and cutover manifests.
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
  registerFileAction,
  insertStagingRowAction,
  runValidationAction,
  runReconciliationAction,
  recordReviewDecisionAction,
  recordApprovalAction,
  recordBackupEvidenceAction,
  commitBatchAction,
  createCorrectionRequestAction,
  approveCorrectionAction,
} from "../actions";
import {
  getActionMatrix,
  type MigrationBatchState,
} from "@/server/services/migration-lifecycle-predicates";

export default async function MigrationBatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const { batchId } = await params;
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const managementRole = authResult.roles.find((r) =>
    r === "owner" || r === "accountant",
  ) as RoleCode | undefined;
  if (!managementRole) redirect("/worker");

  const navCategories = getManagementNavForRole(managementRole);

  let detail: Awaited<
    ReturnType<MigrationScreenQueryService["getBatchDetail"]>
  > = null;
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new MigrationScreenQueryService(db);
      detail = await queryService.getBatchDetail(authResult.tenantId, batchId);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  if (dbAvailable && !detail) {
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
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        </Container>
      </ManagementShell>
    );
  }

  const b = detail.batch;

  // Build lifecycle state for action matrix (TASK 2)
  const batchState: MigrationBatchState = {
    status: b.status as MigrationBatchState["status"],
    stagedRowCount: b.stagedRowCount,
    blockingErrorCount: b.blockingErrorCount,
    warningCount: b.warningCount,
    acceptedWarningCount: b.acceptedWarningCount,
    stagedDataHash: b.stagedDataHash,
    cutoverManifestHash: b.cutoverManifestHash,
    hasOwnerApproval: detail.approvals.some(a => a.approverRole === "owner"),
    hasAccountantApproval: detail.approvals.some(a => a.approverRole === "accountant"),
    hasBackupEvidence: detail.backupEvidence.length > 0,
  };
  const actionMatrix = getActionMatrix(batchState);

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

        {/* Lifecycle action forms — shown only in valid states (TASK 2: action matrix) */}
        {!actionMatrix.createCorrectionRequest && (
          <Card className="mb-6">
            <CardHeader><CardTitle>إجراءات دورة الحياة</CardTitle></CardHeader>
            <CardContent className="space-y-4">

              {/* Register file — only in preparation states */}
              {actionMatrix.registerFile && (
                <form data-action="register-file" action={registerFileAction} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`file-${crypto.randomUUID()}`} />
                  <input type="hidden" name="fileType" value="source" />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">اسم الملف:</span>
                    <input type="text" name="originalFileName" required placeholder="data.xlsx" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">مسار التخزين (خاص):</span>
                    <input type="text" name="storagePath" required placeholder="s3://bucket/key" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">بصمة الملف (SHA-256):</span>
                    <input type="text" name="fileHash" required placeholder="sha256:..." className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>تسجيل ملف</button>
                  </div>
                </form>
              )}

              {/* Insert staging row — only in preparation states */}
              {actionMatrix.insertStagingRow && detail.files.length > 0 && (
                <form data-action="insert-staging-row" action={insertStagingRowAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`stage-${crypto.randomUUID()}`} />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">الملف:</span>
                    <select name="importFileId" required className="px-2 py-1 border rounded text-sm bg-background" style={{ minHeight: "44px" }}>
                      <option value="">— اختر الملف —</option>
                      {detail.files.map((f) => (
                        <option key={f.id} value={f.id}>{f.originalFileName}</option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">رقم الصف:</span>
                    <input type="number" name="sourceRowNumber" placeholder="1" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">البيانات المحولة (JSON):</span>
                    <input type="text" name="transformedRowJson" placeholder='{"key":"value"}' className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  </label>
                  <div className="sm:col-span-2">
                    <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>إضافة صف تجهيز</button>
                  </div>
                </form>
              )}

              {/* Run validation — only when staging exists */}
              {actionMatrix.runValidation && (
                <form data-action="run-validation" action={runValidationAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`val-${crypto.randomUUID()}`} />
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>تشغيل التحقق</button>
                </form>
              )}

              {/* Run reconciliation — only after validation */}
              {actionMatrix.runReconciliation && (
                <form data-action="run-reconciliation" action={runReconciliationAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="idempotencyKey" value={`recon-${crypto.randomUUID()}`} />
                  <button type="submit" className="px-4 py-2 border rounded text-sm hover:bg-muted" style={{ minHeight: "44px" }}>تشغيل المطابقة</button>
                </form>
              )}

              {/* Review decisions — only for unresolved review items */}
              {actionMatrix.recordReviewDecision && detail.reviewItems.filter(r => r.status === "pending").length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">عناصر المراجعة غير المحلولة</h3>
                  {detail.reviewItems.filter(r => r.status === "pending").map((item) => (
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

              {/* Owner approval — only when prerequisites met */}
              {actionMatrix.recordOwnerApproval && !batchState.hasOwnerApproval && (
                <form data-action="record-owner-approval" action={recordApprovalAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="approverRole" value="owner" />
                  <input type="hidden" name="idempotencyKey" value={`appr-owner-${crypto.randomUUID()}`} />
                  <input type="text" name="reason" placeholder="سبب الاعتماد" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm" style={{ minHeight: "44px" }}>اعتماد المالك</button>
                </form>
              )}

              {/* Accountant approval — only when prerequisites met */}
              {actionMatrix.recordAccountantApproval && !batchState.hasAccountantApproval && (
                <form data-action="record-accountant-approval" action={recordApprovalAction} className="flex gap-3 items-center">
                  <input type="hidden" name="batchId" value={b.id} />
                  <input type="hidden" name="approverRole" value="accountant" />
                  <input type="hidden" name="idempotencyKey" value={`appr-acct-${crypto.randomUUID()}`} />
                  <input type="text" name="reason" placeholder="سبب الاعتماد" className="px-2 py-1 border rounded text-sm" style={{ minHeight: "44px" }} />
                  <button type="submit" className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm" style={{ minHeight: "44px" }}>اعتماد المحاسب</button>
                </form>
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

            </CardContent>
          </Card>
        )}

        {/* Committed batch — correction workflow only (TASK 6) */}
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

              {/* Correction approval forms — for pending correction requests */}
              {/* TASK 1: approveCorrectionAction with role-bound selectors */}
              {/* Note: correction requests are listed via the query service.
                  For now, we show a placeholder. In production, correction
                  requests would be fetched and rendered here. */}
              <div role="alert" className="text-sm text-amber-600 border border-amber-300 rounded p-3">
                <p className="font-semibold">تنفيذ التصحيح غير متاح حالياً</p>
                <p className="mt-1">لا يمكن تنفيذ التصحيح حتى يتم تعريف آلية ربط المجال الإنتاجي (CorrectionDomainHook).
                  طلبات التصحيح والاعتمادات متاحة، لكن التنفيذ معلق.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Files */}
        {detail.files.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>الملفات</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">اسم الملف</th>
                      <th className="py-2 px-3">النوع</th>
                      <th className="py-2 px-3">الحجم</th>
                      <th className="py-2 px-3">البصمة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.files.map((f) => (
                      <tr key={f.id} className="border-b">
                        <td className="py-2 px-3"><LtrValue>{f.originalFileName}</LtrValue></td>
                        <td className="py-2 px-3">{f.fileType}</td>
                        <td className="py-2 px-3">
                          {f.fileSizeBytes ? <LtrValue>{(f.fileSizeBytes / 1024).toFixed(1)} KB</LtrValue> : "—"}
                        </td>
                        <td className="py-2 px-3"><LtrValue>{f.fileHashRedacted}</LtrValue></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Validation findings */}
        {detail.validationFindings.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>نتائج التحقق</CardTitle></CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-right">
                      <th className="py-2 px-3">الخطورة</th>
                      <th className="py-2 px-3">الرمز</th>
                      <th className="py-2 px-3">الرسالة</th>
                      <th className="py-2 px-3">الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.validationFindings.map((v) => (
                      <tr key={v.id} className="border-b">
                        <td className="py-2 px-3">
                          {v.severity === "blocking_error" && <span className="text-destructive font-semibold">خطأ مانع</span>}
                          {v.severity === "review_required_warning" && <span className="text-amber-600 font-semibold">تحذير للمراجعة</span>}
                          {v.severity === "informational" && <span className="text-muted-foreground">معلومة</span>}
                        </td>
                        <td className="py-2 px-3"><LtrValue>{v.errorCode}</LtrValue></td>
                        <td className="py-2 px-3">{v.message}</td>
                        <td className="py-2 px-3">{v.resolutionStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

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

        {/* Approvals */}
        {detail.approvals.length > 0 && (
          <Card className="mb-6">
            <CardHeader><CardTitle>الاعتمادات</CardTitle></CardHeader>
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
                {detail.backupEvidence.map((b) => (
                  <div key={b.id} className="border rounded p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="font-medium">{b.backupType}</span>
                      <LtrValue>{b.backupLocationRedacted}</LtrValue>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      البصمة: <LtrValue>{b.backupHash.substring(0, 16)}…</LtrValue>
                    </div>
                    {b.verifiedAt && (
                      <div className="text-xs text-muted-foreground">
                        تم التحقق: <LtrValue>{new Date(b.verifiedAt).toLocaleDateString("ar")}</LtrValue>
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
                {detail.activeLocks.filter(l => !l.releasedAt).map((l) => (
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
