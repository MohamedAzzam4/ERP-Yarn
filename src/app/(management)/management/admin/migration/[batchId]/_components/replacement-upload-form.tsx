"use client";

/**
 * WP-08-01F R2 — Replacement file upload form with explicit confirmation.
 *
 * Shows the Arabic action "رفع ملف مصحح واستبدال النسخة الحالية" with:
 *   - current file/version being replaced (read-only display)
 *   - replacement CSV file picker
 *   - matching template type/version (hidden, bound to batch's template)
 *   - mandatory rework reason (textarea)
 *   - explicit confirmation checkbox explaining consequences
 *   - pending indicator + dedup via useFormStatus
 *   - accessible success/error result
 *   - conflict/replay/lifecycle-rejection messages distinguishable
 *
 * Lifecycle gating: the parent page only renders this component in
 * contract-valid pre-commit rework states (REPLACEMENT_ELIGIBLE_STATES).
 */
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LtrValue } from "@/components/ui/ltr-value";

interface ReplacementUploadFormProps {
  batchId: string;
  /** The current file to be replaced. */
  currentFile: {
    id: string;
    originalFileName: string;
    fileHashRedacted: string;
    fileVersion: number;
    createdAt: string;
  };
  /** Template type/version bound to the batch. */
  templateType: string | null;
  templateVersion: string | null;
  /** Server action: (formData) => Promise<void>. Throws on error. */
  replaceAction: (formData: FormData) => Promise<void>;
}

interface ReplacementFormState {
  ok: boolean;
  error?: string;
  errorCode?: string;
}

const IDLE_STATE: ReplacementFormState = { ok: false };

function ReplaceSubmitButton({ confirmed }: { confirmed: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || !confirmed}
      aria-busy={pending}
      className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-semibold disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-2"
      style={{ minHeight: "44px" }}
    >
      {pending && (
        <span
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {pending ? "جاري الاستبدال..." : "رفع الملف المصحح واستبدال النسخة الحالية"}
    </button>
  );
}

export function ReplacementUploadForm({
  batchId,
  currentFile,
  templateType,
  templateVersion,
  replaceAction,
}: ReplacementUploadFormProps) {
  const [confirmed, setConfirmed] = React.useState(false);
  const [selectedFileName, setSelectedFileName] = React.useState<string>("");

  const [state, formAction] = useActionState(async (_prev: ReplacementFormState, formData: FormData) => {
    try {
      await replaceAction(formData);
      return { ok: true };
    } catch (e) {
      const err = e as Error;
      const message = err.message;
      // Distinguishable error codes
      let errorCode = "UNKNOWN";
      if (/CONCURRENT_VALIDATION/.test(message)) errorCode = "CONCURRENT_VALIDATION";
      else if (/CONCURRENT_RECONCILIATION/.test(message)) errorCode = "CONCURRENT_RECONCILIATION";
      else if (/CONCURRENT_COMMIT/.test(message)) errorCode = "CONCURRENT_COMMIT";
      else if (/COMMITTED_BATCH_IMMUTABLE/.test(message)) errorCode = "COMMITTED_BATCH_IMMUTABLE";
      else if (/BATCH_TERMINAL/.test(message)) errorCode = "BATCH_TERMINAL";
      else if (/SAME_HASH_CONFLICT/.test(message)) errorCode = "SAME_HASH_CONFLICT";
      else if (/IDEMPOTENCY_CONFLICT/.test(message)) errorCode = "IDEMPOTENCY_CONFLICT";
      else if (/OPERATION_IN_PROGRESS/.test(message)) errorCode = "OPERATION_IN_PROGRESS";
      else if (/FILE_ALREADY_SUPERSEDED/.test(message)) errorCode = "FILE_ALREADY_SUPERSEDED";
      else if (/LIFECYCLE_VIOLATION/.test(message)) errorCode = "LIFECYCLE_VIOLATION";
      else if (/CSV_PARSE_FAILED/.test(message)) errorCode = "CSV_PARSE_FAILED";
      else if (/VALIDATION_FAILED/.test(message)) errorCode = "VALIDATION_FAILED";
      return { ok: false, error: message, errorCode };
    }
  }, IDLE_STATE);

  return (
    <div className="border rounded p-4 space-y-4">
      <h3 className="text-sm font-semibold">
        رفع ملف مصحح واستبدال النسخة الحالية
      </h3>

      {/* Current file being replaced — read-only display */}
      <div className="bg-muted/30 border rounded p-3 text-xs space-y-1">
        <div className="font-semibold text-foreground">الملف الحالي المراد استبداله:</div>
        <div>الاسم: <LtrValue>{currentFile.originalFileName}</LtrValue></div>
        <div>الإصدار: <LtrValue>v{currentFile.fileVersion}</LtrValue></div>
        <div>البصمة: <LtrValue>{currentFile.fileHashRedacted}</LtrValue></div>
        <div>تاريخ الرفع: <LtrValue>{new Date(currentFile.createdAt).toLocaleDateString("ar")}</LtrValue></div>
      </div>

      {/* Template binding — read-only, passed as hidden inputs */}
      <div className="text-xs text-muted-foreground">
        القالب:{" "}
        <LtrValue>{templateType ?? "—"}</LtrValue>{" "}
        / الإصدار <LtrValue>{templateVersion ?? "—"}</LtrValue>
        (يجب أن يتطابق ملف الاستبدال مع هذا القالب)
      </div>

      <form action={formAction} encType="multipart/form-data" className="space-y-3">
        <input type="hidden" name="batchId" value={batchId} />
        <input type="hidden" name="replaceFileId" value={currentFile.id} />
        <input type="hidden" name="templateType" value={templateType ?? ""} />
        <input type="hidden" name="templateVersion" value={templateVersion ?? ""} />
        <input
          type="hidden"
          name="idempotencyKey"
          value={`replace-${batchId}-${currentFile.id}-${crypto.randomUUID()}`}
        />

        {/* File picker */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">اختر ملف CSV المصحح:</span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="px-2 py-1 border rounded text-sm"
            style={{ minHeight: "44px" }}
            aria-label="اختر ملف CSV المصحح للاستبدال"
            onChange={(e) => setSelectedFileName(e.target.files?.[0]?.name ?? "")}
          />
        </label>

        {/* Mandatory rework reason */}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">سبب إعادة العمل (إلزامي):</span>
          <textarea
            name="reworkReason"
            required
            rows={3}
            placeholder="اشرح بالتفصيل سبب استبدال الملف..."
            className="px-2 py-1 border rounded text-sm resize-y"
            style={{ minHeight: "44px" }}
            aria-label="سبب إعادة العمل"
          />
        </label>

        {/* Explicit confirmation checkbox */}
        <label className="flex items-start gap-2 text-xs text-foreground border rounded p-3 cursor-pointer hover:bg-muted/30">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
            style={{ minHeight: "44px", minWidth: "44px" }}
            aria-label="تأكيد فهم عواقب الاستبدال"
          />
          <div className="space-y-1">
            <div className="font-semibold">أؤكد فهمي لما يلي:</div>
            <ul className="list-disc pr-4 space-y-0.5 text-muted-foreground">
              <li>الملف القديم والأدلة المرتبطة به ستبقى محفوظة (لن تُحذف).</li>
              <li>نتائج التحقق والمطابقة الحالية ستصبح غير سارية.</li>
              <li>الاعتمادات الحالية ستصبح غير صالحة (يجب إعادة الاعتماد).</li>
              <li>يجب إعادة تشغيل التحقق والمطابقة بعد الاستبدال.</li>
              <li>يجب أن يعتمد المالك والمحاسب مرة أخرى بعد إعادة المراجعة.</li>
            </ul>
          </div>
        </label>

        <div className="flex items-center gap-3">
          <ReplaceSubmitButton confirmed={confirmed} />
          {!confirmed && (
            <span className="text-xs text-muted-foreground">
              يجب تأكيد فهم العواقب قبل التمكن من الإرسال
            </span>
          )}
        </div>

        {/* Accessible result feedback */}
        {state.ok && (
          <div
            role="status"
            className="border border-success/50 text-success bg-success/5 rounded p-3 text-sm flex items-center gap-2"
          >
            <span aria-hidden="true">✓</span>
            تم استبدال الملف بنجاح. تم إنشاء إصدار جديد وإلغاء صلاحية الإصدار القديم.
            يجب الآن إنهاء التجهيز، ثم إعادة التحقق والمطابقة والاعتماد المزدوج.
          </div>
        )}
        {!state.ok && state.error && (
          <div
            role="alert"
            className="border border-destructive/50 text-destructive bg-destructive/5 rounded p-3 text-sm flex items-start gap-2"
          >
            <span aria-hidden="true">⚠</span>
            <div className="flex-1">
              <div className="font-semibold">
                فشل الاستبدال
                {state.errorCode && state.errorCode !== "UNKNOWN" && (
                  <span className="text-xs ml-2" dir="ltr">({state.errorCode})</span>
                )}
              </div>
              <div className="text-xs mt-1 break-words" dir="ltr">
                <LtrValue>{state.error}</LtrValue>
              </div>
              {state.errorCode === "CONCURRENT_VALIDATION" && (
                <div className="text-xs mt-1">لا يمكن الاستبدال أثناء جاري التحقق. انتظر اكتمال التحقق ثم أعد المحاولة.</div>
              )}
              {state.errorCode === "CONCURRENT_RECONCILIATION" && (
                <div className="text-xs mt-1">لا يمكن الاستبدال أثناء جاري المطابقة. انتظر اكتمال المطابقة ثم أعد المحاولة.</div>
              )}
              {state.errorCode === "IDEMPOTENCY_CONFLICT" && (
                <div className="text-xs mt-1">تعارض مفتاح الإيديمبوتنسي — نفس المفتاح مع بيانات مختلفة. استخدم مفتاحاً جديداً.</div>
              )}
              {state.errorCode === "SAME_HASH_CONFLICT" && (
                <div className="text-xs mt-1">بصمة الملف الجديد تطابق الملف القديم — لا يوجد تغيير.</div>
              )}
              {state.errorCode === "LIFECYCLE_VIOLATION" && (
                <div className="text-xs mt-1">الحالة الحالية للدفعة لا تسمح بالاستبدال.</div>
              )}
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
