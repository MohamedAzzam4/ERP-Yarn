/**
 * Worker Quality Entry page — WP-08-01E.
 *
 * Route: /worker/quality-entry
 * Task-first Worker Task Mode for quality employees.
 * Records quality test facts and complaint investigation notes only.
 * No financial treatment, refund, credit, or replacement authorization.
 *
 * Contract 10 §7.3: Quality Employee Screens.
 * Contract 11 §8: Workers redacted from financial fields.
 *
 * Forbidden actions (per Contract 10 §7.3):
 *   - Financial treatment, risky-sale approval
 *   - Stock posting/reversal
 *   - Returned-stock resale authorization
 */
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { WorkerShell } from "@/components/shells/worker-shell";
import { getWorkerTasksForRole } from "@/components/shells/nav-config";
import { signOut } from "@/app/login/actions";
import type { RoleCode } from "@/server/security/role-codes";
import { Container } from "@/components/ui/container";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LtrValue } from "@/components/ui/ltr-value";
import { db } from "@/server/db/client";
import { QualityReturnScreenQueryService } from "@/server/services/quality-return-screen-query-service";
import { createQualityTestAction, createComplaintAction, recordQualityTestValueAction, updateComplaintAction } from "./actions";

export default async function WorkerQualityEntryPage() {
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult.authenticated) redirect("/login");
  if (authResult.roles.length === 0) redirect("/login?error=no_role");

  const workerRole = authResult.roles.find(
    (r) => r !== "owner" && r !== "accountant",
  ) as RoleCode | undefined;
  if (!workerRole) redirect("/management");

  // Only quality employees can access this page
  if (workerRole !== "quality_employee") {
    redirect("/worker");
  }

  const tasks = getWorkerTasksForRole(workerRole);

  let qualityTests: Awaited<
    ReturnType<
      QualityReturnScreenQueryService["listQualityTestsForWorker"]
    >
  > = [];
  let complaints: Awaited<
    ReturnType<QualityReturnScreenQueryService["listComplaintsForWorker"]>
  > = [];
  let dbAvailable = false;

  if (db) {
    try {
      const queryService = new QualityReturnScreenQueryService(db);
      qualityTests = await queryService.listQualityTestsForWorker(
        authResult.tenantId,
      );
      complaints = await queryService.listComplaintsForWorker(
        authResult.tenantId,
      );
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  }

  return (
    <WorkerShell
      userName={authResult.name || authResult.email}
      tasks={tasks}
      onSignOut={async () => {
        "use server";
        await signOut();
      }}
    >
      <Container>
        <h1 className="text-2xl font-bold mb-6">تسجيل الجودة</h1>

        {!dbAvailable && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              قاعدة البيانات غير متاحة.
            </CardContent>
          </Card>
        )}

        {dbAvailable && (
          <>
            {/* Create quality test form */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>تسجيل اختبار جودة جديد</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  action={createQualityTestAction}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                >
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={`quality-test-${crypto.randomUUID()}`}
                  />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      تاريخ الاختبار:
                    </span>
                    <input
                      type="date"
                      name="testDate"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      نوع الكيان المرتبط:
                    </span>
                    <select
                      name="linkedEntityType"
                      required
                      defaultValue="inventory_item"
                      className="px-2 py-1 border rounded text-sm bg-background"
                      style={{ minHeight: "44px" }}
                    >
                      <option value="inventory_item">صنف مخزون</option>
                      <option value="raw_material_batch">دفعة خام</option>
                      <option value="yarn_lot">لوط خيوط</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      معرّف الكيان:
                    </span>
                    <input
                      type="text"
                      name="linkedEntityId"
                      required
                      placeholder="UUID"
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      حالة الاختبار:
                    </span>
                    <select
                      name="testStatus"
                      defaultValue="needs_review"
                      className="px-2 py-1 border rounded text-sm bg-background"
                      style={{ minHeight: "44px" }}
                    >
                      <option value="needs_review">بحاجة لمراجعة</option>
                      <option value="accepted">مقبول</option>
                      <option value="rejected">مرفوض</option>
                      <option value="reprocess">إعادة معالجة</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      تصنيف المخاطر:
                    </span>
                    <select
                      name="riskClassification"
                      defaultValue="none"
                      className="px-2 py-1 border rounded text-sm bg-background"
                      style={{ minHeight: "44px" }}
                    >
                      <option value="none">لا توجد</option>
                      <option value="needs_review">بحاجة لمراجعة</option>
                      <option value="sellable_with_discount">
                        قابل للبيع بخصم
                      </option>
                      <option value="blocked">محظور</option>
                      <option value="reprocess_required">
                        يتطلب إعادة معالجة
                      </option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">ملاحظات:</span>
                    <input
                      type="text"
                      name="notes"
                      placeholder="ملاحظات الاختبار"
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                      style={{ minHeight: "44px" }}
                    >
                      تسجيل الاختبار
                    </button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Create complaint form */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle>تسجيل شكوى جديدة</CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  action={createComplaintAction}
                  className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                >
                  <input
                    type="hidden"
                    name="idempotencyKey"
                    value={`complaint-${crypto.randomUUID()}`}
                  />
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">
                      تاريخ الشكوى:
                    </span>
                    <input
                      type="date"
                      name="complaintDate"
                      required
                      defaultValue={new Date().toISOString().slice(0, 10)}
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">الموضوع:</span>
                    <input
                      type="text"
                      name="subject"
                      required
                      placeholder="موضوع الشكوى"
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-muted-foreground">الأولوية:</span>
                    <select
                      name="priority"
                      defaultValue="normal"
                      className="px-2 py-1 border rounded text-sm bg-background"
                      style={{ minHeight: "44px" }}
                    >
                      <option value="low">منخفضة</option>
                      <option value="normal">عادية</option>
                      <option value="high">عالية</option>
                      <option value="urgent">عاجلة</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
                    <span className="text-muted-foreground">الوصف:</span>
                    <textarea
                      name="description"
                      placeholder="وصف الشكوى"
                      className="px-2 py-1 border rounded text-sm"
                      style={{ minHeight: "44px" }}
                    />
                  </label>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <button
                      type="submit"
                      className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                      style={{ minHeight: "44px" }}
                    >
                      تسجيل الشكوى
                    </button>
                  </div>
                </form>
              </CardContent>
            </Card>

            {/* Record quality test value form */}
            {qualityTests.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>تسجيل قيمة اختبار</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action={recordQualityTestValueAction}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                  >
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={`quality-value-${crypto.randomUUID()}`}
                    />
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        اختبار الجودة:
                      </span>
                      <select
                        name="qualityTestId"
                        required
                        className="px-2 py-1 border rounded text-sm bg-background"
                        style={{ minHeight: "44px" }}
                      >
                        {qualityTests.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.testNo} — {t.testStatus}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        اسم المعامل:
                      </span>
                      <input
                        type="text"
                        name="parameterName"
                        required
                        placeholder="اسم المعامل"
                        className="px-2 py-1 border rounded text-sm"
                        style={{ minHeight: "44px" }}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        رمز المعامل:
                      </span>
                      <input
                        type="text"
                        name="parameterCode"
                        required
                        placeholder="رمز المعامل"
                        className="px-2 py-1 border rounded text-sm"
                        style={{ minHeight: "44px" }}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        القيمة المقاسة:
                      </span>
                      <input
                        type="text"
                        name="measuredValue"
                        inputMode="decimal"
                        placeholder="0.00"
                        className="px-2 py-1 border rounded text-sm"
                        style={{ minHeight: "44px" }}
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">
                        حالة القيمة:
                      </span>
                      <select
                        name="valueStatus"
                        defaultValue="pending"
                        className="px-2 py-1 border rounded text-sm bg-background"
                        style={{ minHeight: "44px" }}
                      >
                        <option value="pending">بانتظار</option>
                        <option value="pass">نجاح</option>
                        <option value="fail">فشل</option>
                        <option value="review">مراجعة</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">ملاحظات:</span>
                      <input
                        type="text"
                        name="notes"
                        placeholder="ملاحظات القيمة"
                        className="px-2 py-1 border rounded text-sm"
                        style={{ minHeight: "44px" }}
                      />
                    </label>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                        style={{ minHeight: "44px" }}
                      >
                        تسجيل القيمة
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Update complaint form */}
            {complaints.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>تحديث الشكوى</CardTitle>
                </CardHeader>
                <CardContent>
                  <form
                    action={updateComplaintAction}
                    className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
                  >
                    <input
                      type="hidden"
                      name="idempotencyKey"
                      value={`complaint-update-${crypto.randomUUID()}`}
                    />
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">الشكوى:</span>
                      <select
                        name="complaintId"
                        required
                        className="px-2 py-1 border rounded text-sm bg-background"
                        style={{ minHeight: "44px" }}
                      >
                        {complaints.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.complaintNo} — {c.subject}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">الحالة:</span>
                      <select
                        name="status"
                        defaultValue="investigating"
                        className="px-2 py-1 border rounded text-sm bg-background"
                        style={{ minHeight: "44px" }}
                      >
                        <option value="open">مفتوحة</option>
                        <option value="investigating">قيد التحقيق</option>
                        <option value="resolved">تم الحل</option>
                        <option value="closed">مغلقة</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-muted-foreground">الأولوية:</span>
                      <select
                        name="priority"
                        defaultValue="normal"
                        className="px-2 py-1 border rounded text-sm bg-background"
                        style={{ minHeight: "44px" }}
                      >
                        <option value="low">منخفضة</option>
                        <option value="normal">عادية</option>
                        <option value="high">عالية</option>
                        <option value="urgent">عاجلة</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm sm:col-span-2 lg:col-span-3">
                      <span className="text-muted-foreground">
                        ملاحظات التحقيق:
                      </span>
                      <textarea
                        name="investigationNotes"
                        placeholder="ملاحظات التحقيق"
                        className="px-2 py-1 border rounded text-sm"
                        style={{ minHeight: "44px" }}
                      />
                    </label>
                    <div className="sm:col-span-2 lg:col-span-3">
                      <button
                        type="submit"
                        className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm"
                        style={{ minHeight: "44px" }}
                      >
                        تحديث الشكوى
                      </button>
                    </div>
                  </form>
                </CardContent>
              </Card>
            )}

            {/* Recent quality tests */}
            {qualityTests.length > 0 && (
              <Card className="mb-6">
                <CardHeader>
                  <CardTitle>اختبارات الجودة الأخيرة</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">رقم الاختبار</th>
                          <th className="py-2 px-3">التاريخ</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3">المخاطر</th>
                          <th className="py-2 px-3">ملاحظات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {qualityTests.map((t) => (
                          <tr key={t.id} className="border-b">
                            <td className="py-2 px-3">
                              <LtrValue>{t.testNo}</LtrValue>
                            </td>
                            <td className="py-2 px-3">
                              <LtrValue>{t.testDate}</LtrValue>
                            </td>
                            <td className="py-2 px-3">{t.testStatus}</td>
                            <td className="py-2 px-3">
                              {t.riskClassification}
                            </td>
                            <td className="py-2 px-3">{t.notes ?? "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Recent complaints */}
            {complaints.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>الشكاوى الأخيرة</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-right">
                          <th className="py-2 px-3">رقم الشكوى</th>
                          <th className="py-2 px-3">التاريخ</th>
                          <th className="py-2 px-3">الموضوع</th>
                          <th className="py-2 px-3">الحالة</th>
                          <th className="py-2 px-3">الأولوية</th>
                        </tr>
                      </thead>
                      <tbody>
                        {complaints.map((c) => (
                          <tr key={c.id} className="border-b">
                            <td className="py-2 px-3">
                              <LtrValue>{c.complaintNo}</LtrValue>
                            </td>
                            <td className="py-2 px-3">
                              <LtrValue>{c.complaintDate}</LtrValue>
                            </td>
                            <td className="py-2 px-3">{c.subject}</td>
                            <td className="py-2 px-3">{c.status}</td>
                            <td className="py-2 px-3">{c.priority}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Container>
    </WorkerShell>
  );
}
