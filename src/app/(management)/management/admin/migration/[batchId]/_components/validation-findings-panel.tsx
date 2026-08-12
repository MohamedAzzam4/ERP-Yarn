"use client";

/**
 * WP-08-01F UX milestone — Validation findings filters + detail disclosure.
 *
 * Provides:
 *   - Severity, file, sheet, error-code, free-text filters (URL-synced via
 *     a GET form so the link is shareable and back/forward works).
 *   - Click + keyboard-focusable disclosure for each finding detail.
 *     Hover is supplementary only — full details are reachable on mobile
 *     and via keyboard (not just mouse hover).
 *   - Icon + text for severity (never color alone).
 *   - Red state for blocking errors, amber state for warnings, neutral for info.
 *   - Arabic explanation, why-invalid, correction guidance, submitted value,
 *     affected file/sheet/row/column in the detail panel.
 *   - Download link to the CSV report route with the current filters preserved.
 */
import * as React from "react";
import { LtrValue } from "@/components/ui/ltr-value";
import type {
  MigrationValidationFindingDto,
  MigrationFileDto,
} from "@/server/services/migration-screen-query-service";

interface ValidationFindingsPanelProps {
  batchId: string;
  findings: MigrationValidationFindingDto[];
  files: MigrationFileDto[];
  /** Current filter values (echoed back from the server so the form stays in sync). */
  currentFilters: {
    severity?: string;
    fileId?: string;
    sheet?: string;
    errorCode?: string;
    q?: string;
  };
  /** Optional preserved staging pagination page (so filter submit doesn't reset it). */
  stagingPage?: number;
}

/**
 * Arabic explanations and correction guidance per error code.
 * Covers all required fixture codes plus the general fallback.
 *
 * The codes match what the HistoricalValidationService produces.
 */
const ERROR_CODE_GUIDANCE: Record<
  string,
  { arabicExplanation: string; whyInvalid: string; correctionGuidance: string }
> = {
  DUPLICATE_CODE: {
    arabicExplanation: "كود مكرر داخل نفس الدفعة.",
    whyInvalid: "تم العثور على نفس الكود في صف آخر داخل ملف الاستيراد. يجب أن تكون الأكواد فريدة.",
    correctionGuidance: "ابحث عن الصفوف التي تحتوي على نفس الكود واحذف التكرار أو عدّل الكود ليكون فريداً.",
  },
  INVALID_CURRENCY: {
    arabicExplanation: "عملة غير مدعومة في المرحلة الأولى.",
    whyInvalid: "العملة المُدخلة ليست EGP. المرحلة الأولى تقبل EGP فقط (Contract 08 §8.6).",
    correctionGuidance: "استبدل قيمة العملة بـ EGP، أو أزل صف العملة إن لم يكن مطلوباً للقالب.",
  },
  MISSING_DATE: {
    arabicExplanation: "التاريخ مفقود أو فارغ.",
    whyInvalid: "حقل التاريخ مطلوب ولا يمكن أن يكون فارغاً.",
    correctionGuidance: "أدخل تاريخاً صالحاً بصيغة YYYY-MM-DD في حقل التاريخ.",
  },
  INVALID_DATE: {
    arabicExplanation: "صيغة التاريخ غير صالحة أو تاريخ مستقبلي.",
    whyInvalid: "التاريخ لا يطابق الصيغة المطلوبة YYYY-MM-DD، أو يقع في المستقبل.",
    correctionGuidance: "استخدم صيغة ISO 8601 (YYYY-MM-DD) وتأكد من أن التاريخ ليس في المستقبل.",
  },
  INVALID_QUANTITY: {
    arabicExplanation: "الكمية غير صالحة.",
    whyInvalid: "الكمية ليست رقماً موجباً كما يتطلب القالب.",
    correctionGuidance: "أدخل رقماً عشرياً موجباً (مثال: 100.500) في حقل الكمية.",
  },
  INVALID_UNIT: {
    arabicExplanation: "وحدة قياس غير مقبولة.",
    whyInvalid: "الوحدة ليست ضمن قائمة الوحدات المقبولة للقالب.",
    correctionGuidance: "استخدم إحدى الوحدات المقبولة: kg أو ton (حسب القالب).",
  },
  UNRESOLVED_REFERENCE: {
    arabicExplanation: "مرجع غير محلول (صنف/عميل/مورد/موقع).",
    whyInvalid: "معرف UUID المُدخل لا يطابق أي سجل رئيسي موجود في النظام.",
    correctionGuidance: "تحقق من صحة معرف UUID، أو أنشئ السجل الرئيسي أولاً قبل إعادة الاستيراد.",
  },
  MISSING_REQUIRED: {
    arabicExplanation: "قيمة مطلوبة مفقودة.",
    whyInvalid: "حقل مطلوب تم تركه فارغاً في صف البيانات.",
    correctionGuidance: "أدخل قيمة في الحقل المطلوب أو أزل الصف إن لم يكن ضرورياً.",
  },
  MALFORMED_CSV_ROW: {
    arabicExplanation: "صف CSV غير منسق بشكل صحيح.",
    whyInvalid: "عدد الأعمدة في الصف لا يطابق عدد الأعمدة في رأس الملف.",
    correctionGuidance: "افتح الملف في محرر نصوص وصحح عدد الفواصل في الصف المعني.",
  },
  DUPLICATE_HEADER: {
    arabicExplanation: "رأس مكرر في ملف CSV.",
    whyInvalid: "تم العثور على نفس اسم العمود أكثر من مرة في رأس الملف.",
    correctionGuidance: "احذف العمود المكرر من الرأس وأعد رفع الملف.",
  },
  FORMULA_INJECTION: {
    arabicExplanation: "محتوى خطير محتمل (حقن صيغة).",
    whyInvalid: "تبدأ قيمة الخلية بحرف خطير (=، +، -، @، أو Tab).",
    correctionGuidance: "أزل الحرف الأول أو ضع علامة اقتباس واحدة قبل القيمة، ثم أعد الرفع.",
  },
};

function guidanceFor(errorCode: string) {
  return (
    ERROR_CODE_GUIDANCE[errorCode] ?? {
      arabicExplanation: "خطأ تحقق غير مصنف.",
      whyInvalid: "لم يتم العثور على شرح مفصل لهذا الرمز.",
      correctionGuidance: "راجع رسالة الخطأ وتواصل مع المسؤول إذا لزم الأمر.",
    }
  );
}

/**
 * Severity badge — icon + text, never color alone. Color is supplementary.
 * - blocking_error: red background, ⛔ icon, "خطأ مانع"
 * - review_required_warning: amber background, ⚠ icon, "تحذير للمراجعة"
 * - informational: neutral background, ℹ icon, "معلومة"
 */
function SeverityBadge({ severity, isBlocking }: { severity: string; isBlocking: boolean }) {
  if (severity === "blocking_error" || isBlocking) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-destructive/50 text-destructive bg-destructive/5 text-xs font-semibold">
        <span aria-hidden="true">⛔</span>
        خطأ مانع
      </span>
    );
  }
  if (severity === "review_required_warning") {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-amber-500/50 text-amber-700 bg-amber-50 text-xs font-semibold">
        <span aria-hidden="true">⚠</span>
        تحذير للمراجعة
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 rounded border border-muted text-muted-foreground bg-muted/30 text-xs font-semibold">
      <span aria-hidden="true">ℹ</span>
      معلومة
    </span>
  );
}

/**
 * Detail disclosure for a single finding. Uses <details>/<summary> for
 * native keyboard focus + click toggle, so the same detail is reachable
 * on mobile (tap) and desktop (click / Enter / Space).
 */
function FindingDetail({
  finding,
  defaultOpen,
}: {
  finding: MigrationValidationFindingDto;
  defaultOpen?: boolean;
}) {
  const g = guidanceFor(finding.errorCode);
  return (
    <details
      className="border rounded text-sm"
      open={defaultOpen}
    >
      <summary
        className="cursor-pointer p-3 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ minHeight: "44px", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}
      >
        <SeverityBadge severity={finding.severity} isBlocking={finding.isBlocking} />
        <span className="font-mono text-xs" dir="ltr">
          <LtrValue>{finding.errorCode}</LtrValue>
        </span>
        <span className="text-muted-foreground text-xs flex-1 min-w-0 truncate">
          {finding.message}
        </span>
        {finding.fileName && (
          <span className="text-xs text-muted-foreground" dir="ltr">
            <LtrValue>{finding.fileName}</LtrValue>
            {finding.sourceRowNumber != null && (
              <>:#<LtrValue>{finding.sourceRowNumber}</LtrValue></>
            )}
          </span>
        )}
      </summary>
      <div className="p-3 border-t space-y-3 text-xs">
        <div>
          <div className="font-semibold text-foreground mb-1">الشرح بالعربية</div>
          <div className="text-muted-foreground">{g.arabicExplanation}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground mb-1">لماذا القيمة غير صالحة</div>
          <div className="text-muted-foreground">{g.whyInvalid}</div>
        </div>
        <div>
          <div className="font-semibold text-foreground mb-1">إرشاد التصحيح</div>
          <div className="text-muted-foreground">{g.correctionGuidance}</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <div className="font-semibold text-foreground mb-1">رمز الخطأ</div>
            <div className="font-mono text-foreground" dir="ltr">
              <LtrValue>{finding.errorCode}</LtrValue>
            </div>
          </div>
          <div>
            <div className="font-semibold text-foreground mb-1">القيمة المُرسلة</div>
            <div className="font-mono text-foreground break-all" dir="ltr">
              {finding.submittedValue ? <LtrValue>{finding.submittedValue}</LtrValue> : "—"}
            </div>
          </div>
          {finding.normalizedValue && (
            <div>
              <div className="font-semibold text-foreground mb-1">القيمة بعد التطبيع</div>
              <div className="font-mono text-foreground break-all" dir="ltr">
                <LtrValue>{finding.normalizedValue}</LtrValue>
              </div>
            </div>
          )}
          <div>
            <div className="font-semibold text-foreground mb-1">الملف</div>
            <div className="text-foreground break-all" dir="ltr">
              {finding.fileName ? <LtrValue>{finding.fileName}</LtrValue> : "—"}
            </div>
          </div>
          <div>
            <div className="font-semibold text-foreground mb-1">الورقة / الصف / العمود</div>
            <div className="text-foreground" dir="ltr">
              <LtrValue>
                {finding.sourceSheetName ?? "—"} / {finding.sourceRowNumber ?? "—"} /{" "}
                {finding.columnName ?? "—"}
              </LtrValue>
            </div>
          </div>
        </div>
      </div>
    </details>
  );
}

export function ValidationFindingsPanel({
  batchId,
  findings,
  files,
  currentFilters,
  stagingPage,
}: ValidationFindingsPanelProps) {
  // Derive unique filter options from the findings list itself so the
  // dropdowns stay accurate even when the server adds new codes.
  const sheetOptions = React.useMemo(
    () => Array.from(new Set(findings.map((f) => f.sourceSheetName).filter((s): s is string => s !== null))).sort(),
    [findings],
  );
  const errorCodeOptions = React.useMemo(
    () => Array.from(new Set(findings.map((f) => f.errorCode))).sort(),
    [findings],
  );

  // Build the CSV report URL with current filters preserved.
  const reportParams = new URLSearchParams();
  if (currentFilters.severity) reportParams.set("severity", currentFilters.severity);
  if (currentFilters.fileId) reportParams.set("fileId", currentFilters.fileId);
  if (currentFilters.sheet) reportParams.set("sheet", currentFilters.sheet);
  if (currentFilters.errorCode) reportParams.set("errorCode", currentFilters.errorCode);
  if (currentFilters.q) reportParams.set("q", currentFilters.q);
  const reportUrl = `/management/admin/migration/${batchId}/validation-report${reportParams.toString() ? `?${reportParams.toString()}` : ""}`;

  return (
    <div className="space-y-4">
      {/* Filter form — uses GET so the URL is shareable and back/forward works. */}
      <form method="get" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Preserve the staging page query param so filters don't reset pagination accidentally. */}
        {stagingPage && stagingPage > 1 && (
          <input type="hidden" name="stagingPage" value={String(stagingPage)} readOnly />
        )}
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">الخطورة</span>
          <select
            name="severity"
            defaultValue={currentFilters.severity ?? ""}
            className="px-2 py-1 border rounded bg-background"
            style={{ minHeight: "44px" }}
          >
            <option value="">— الكل —</option>
            <option value="blocking_error">خطأ مانع</option>
            <option value="review_required_warning">تحذير للمراجعة</option>
            <option value="informational">معلومة</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">الملف</span>
          <select
            name="fileId"
            defaultValue={currentFilters.fileId ?? ""}
            className="px-2 py-1 border rounded bg-background"
            style={{ minHeight: "44px" }}
          >
            <option value="">— الكل —</option>
            {files.map((f) => (
              <option key={f.id} value={f.id}>
                {f.originalFileName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">الورقة</span>
          <select
            name="sheet"
            defaultValue={currentFilters.sheet ?? ""}
            className="px-2 py-1 border rounded bg-background"
            style={{ minHeight: "44px" }}
          >
            <option value="">— الكل —</option>
            {sheetOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">رمز الخطأ</span>
          <select
            name="errorCode"
            defaultValue={currentFilters.errorCode ?? ""}
            className="px-2 py-1 border rounded bg-background"
            style={{ minHeight: "44px" }}
          >
            <option value="">— الكل —</option>
            {errorCodeOptions.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">بحث نصي</span>
          <input
            type="search"
            name="q"
            defaultValue={currentFilters.q ?? ""}
            placeholder="ابحث في الرسالة، الرمز، القيمة..."
            className="px-2 py-1 border rounded bg-background"
            style={{ minHeight: "44px" }}
          />
        </label>
        <div className="flex items-end gap-2">
          <button
            type="submit"
            className="px-3 py-2 border rounded text-sm hover:bg-muted"
            style={{ minHeight: "44px" }}
          >
            تطبيق الفلاتر
          </button>
          <a
            href={reportUrl}
            className="px-3 py-2 border rounded text-sm hover:bg-muted inline-flex items-center gap-1"
            style={{ minHeight: "44px" }}
            aria-label="تنزيل تقرير نتائج التحقق بصيغة CSV"
          >
            <span aria-hidden="true">⬇</span>
            تنزيل التقرير CSV
          </a>
        </div>
      </form>

      {/* Findings list — empty state has explicit messaging */}
      {findings.length === 0 ? (
        <div className="border rounded p-6 text-center text-sm text-muted-foreground">
          لا توجد نتائج تحقق مطابقة للفلاتر المحددة.
        </div>
      ) : (
        <div className="space-y-2">
          {findings.map((f) => (
            <FindingDetail key={f.id} finding={f} />
          ))}
        </div>
      )}
    </div>
  );
}
