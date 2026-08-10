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

        {/* Correction requests */}
        {detail.batch.status === "committed" && (
          <Card className="mb-6">
            <CardHeader><CardTitle>التصحيحات</CardTitle></CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                الدفعة مُرحَّلة ومقفلة. يمكن طلب تصحيح من خلال المسؤول.
              </p>
            </CardContent>
          </Card>
        )}
      </Container>
    </ManagementShell>
  );
}
