"use client";

/**
 * WP-08-01F UX milestone — Migration template selector + upload form.
 *
 * Replaces the five independent template-download buttons with a real
 * selector that:
 *   - Persists the user's selected template type/version in client state.
 *   - Shows the Arabic description, required/optional columns, accepted
 *     values/rules for the selected template.
 *   - Downloads the selected template via the authenticated route.
 *   - Submits the SAME selected type/version as hidden inputs in the upload
 *     form, so the server can reject schema-disagreeing uploads.
 *
 * Uses useActionState + useFormStatus for accessible pending state, dedup,
 * and success/error feedback. The selected template is preserved across
 * validation failures because the form is uncontrolled (the hidden inputs
 * are populated from React state, not from FormData echo-back).
 */
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import type { MigrationTemplateDefinition } from "@/server/services/migration-templates";
import { LtrValue } from "@/components/ui/ltr-value";

interface TemplateSelectorAndUploadFormProps {
  batchId: string;
  templates: MigrationTemplateDefinition[];
  /** Server action: (formData) => Promise<void>. Throws on error. */
  uploadAction: (formData: FormData) => Promise<void>;
}

interface UploadFormState {
  ok: boolean;
  error?: string;
}

const IDLE_STATE: UploadFormState = { ok: false };

/**
 * Submit button with pending state — uses useFormStatus so it must be
 * a child of the <form>. Disables itself while the action is in flight
 * to prevent duplicate submission. Shows an accessible spinner + Arabic
 * pending text, and aria-busy for screen readers.
 */
function UploadSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
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
      {pending ? "جاري الرفع والتحليل..." : "رفع وتحليل الملف"}
    </button>
  );
}

export function TemplateSelectorAndUploadForm({
  batchId,
  templates,
  uploadAction,
}: TemplateSelectorAndUploadFormProps) {
  // Default to the first template (opening_balance_inventory).
  const [selectedType, setSelectedType] = React.useState<string>(templates[0]?.templateType ?? "");
  const selectedTemplate = templates.find((t) => t.templateType === selectedType) ?? templates[0] ?? null;

  // useActionState gives us accessible result feedback after the action resolves.
  // The state is set to { ok: true } on success or { ok: false, error } on failure.
  // We wrap the simpler (formData) => Promise<void> action into the (prevState, formData) shape
  // required by useActionState.
  const [state, formAction] = useActionState(async (_prev: UploadFormState, formData: FormData) => {
    try {
      await uploadAction(formData);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }, IDLE_STATE);

  if (!selectedTemplate) {
    return (
      <div role="alert" className="border border-destructive/50 text-destructive bg-destructive/5 rounded p-3 text-sm">
        لا توجد قوالب متاحة. تواصل مع المسؤول.
      </div>
    );
  }

  const downloadUrl = `/management/admin/migration/template-download?templateType=${encodeURIComponent(selectedTemplate.templateType)}&templateVersion=${encodeURIComponent(selectedTemplate.templateVersion)}`;

  return (
    <div className="border rounded p-4 space-y-4">
      {/* Selector */}
      <div>
        <label
          htmlFor="template-type-select"
          className="block text-sm font-semibold mb-2"
        >
          اختر قالب الاستيراد
        </label>
        <select
          id="template-type-select"
          name="templateTypeSelector"
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-3 py-2 border rounded text-sm bg-background w-full sm:w-auto"
          style={{ minHeight: "44px" }}
          aria-describedby="template-description"
        >
          {templates.map((t) => (
            <option key={t.templateType} value={t.templateType}>
              {t.templateType.replace(/_/g, " ")} — الإصدار{" "}
              <LtrValue>{t.templateVersion}</LtrValue>
            </option>
          ))}
        </select>
      </div>

      {/* Arabic description + rules */}
      <div id="template-description" className="text-xs text-muted-foreground space-y-2">
        <p>{selectedTemplate.description}</p>
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          <span>
            <strong>تنسيق التاريخ:</strong>{" "}
            <LtrValue>{selectedTemplate.rules.dateFormat}</LtrValue>
          </span>
          <span>
            <strong>العملة المقبولة:</strong>{" "}
            <LtrValue>{selectedTemplate.rules.acceptedCurrency}</LtrValue>
          </span>
          {selectedTemplate.rules.acceptedUnits.length > 0 && (
            <span>
              <strong>الوحدات المقبولة:</strong>{" "}
              <LtrValue>{selectedTemplate.rules.acceptedUnits.join("، ")}</LtrValue>
            </span>
          )}
        </div>
        <p>
          تنسيق CSV فقط. الحد الأقصى: 10 ميجابايت / 10,000 صف. ترميز UTF-8 مع BOM.
        </p>
      </div>

      {/* Required / optional columns */}
      <details className="text-xs">
        <summary
          className="cursor-pointer font-semibold text-foreground hover:underline"
          style={{ minHeight: "44px", display: "flex", alignItems: "center" }}
        >
          الأعمدة المطلوبة والاختيارية ({selectedTemplate.columns.length} عمود)
        </summary>
        <div className="mt-2 space-y-1 overflow-x-auto">
          {selectedTemplate.columns.map((col) => (
            <div key={col.name} className="flex flex-wrap gap-x-2 gap-y-1">
              <span className="font-mono text-foreground">
                <LtrValue>{col.name}</LtrValue>
              </span>
              <span className={col.required ? "text-destructive font-semibold" : "text-muted-foreground"}>
                {col.required ? "✦ مطلوب" : "اختياري"}
              </span>
              <span className="text-muted-foreground">— {col.description}</span>
              {col.acceptedValues && col.acceptedValues.length > 0 && (
                <span className="text-muted-foreground">
                  (قيم مقبولة:{" "}
                  <LtrValue>{col.acceptedValues.join("، ")}</LtrValue>
                  )
                </span>
              )}
            </div>
          ))}
        </div>
      </details>

      {/* Download the selected template */}
      <div>
        <a
          href={downloadUrl}
          className="inline-flex items-center gap-2 px-3 py-2 border rounded text-sm hover:bg-muted"
          style={{ minHeight: "44px" }}
          aria-label={`تنزيل قالب ${selectedTemplate.templateType}`}
        >
          <span aria-hidden="true">⬇</span>
          تنزيل قالب{" "}
          <LtrValue>{selectedTemplate.templateType}</LtrValue>{" "}
          (v<LtrValue>{selectedTemplate.templateVersion}</LtrValue>)
        </a>
      </div>

      {/* Upload form — binds the selected template via hidden inputs */}
      <form action={formAction} encType="multipart/form-data" className="space-y-3 border-t pt-3">
        <input type="hidden" name="batchId" value={batchId} />
        {/* Server-generated idempotency key — keeps the upload attempt unique. */}
        <input
          type="hidden"
          name="idempotencyKey"
          value={`upload-${batchId}-${crypto.randomUUID()}`}
        />
        {/* Bind the selected template type/version so the server can reject
            schema-disagreeing uploads. The server's CSV parser independently
            validates the headers against the template's column definitions. */}
        <input type="hidden" name="templateType" value={selectedTemplate.templateType} />
        <input type="hidden" name="templateVersion" value={selectedTemplate.templateVersion} />

        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted-foreground">
            اختر ملف CSV لقالب{" "}
            <LtrValue>{selectedTemplate.templateType}</LtrValue>:
          </span>
          <input
            type="file"
            name="file"
            accept=".csv,text/csv"
            required
            className="px-2 py-1 border rounded text-sm"
            style={{ minHeight: "44px" }}
            aria-label={`اختر ملف CSV لقالب ${selectedTemplate.templateType}`}
          />
        </label>

        <div className="text-xs text-muted-foreground">
          سيتم تخزين الملف بشكل آمن، حساب البصمة (SHA-256) تلقائياً،
          تحليل الصفوف، وتجهيزها. يجب أن تتطابق رؤوس الأعمدة مع القالب المحدد.
        </div>

        <UploadSubmitButton />

        {/* Accessible result feedback — never color alone, always icon + text. */}
        {state.ok && (
          <div
            role="status"
            className="border border-success/50 text-success bg-success/5 rounded p-3 text-sm flex items-center gap-2"
          >
            <span aria-hidden="true">✓</span>
            تم رفع الملف وتحليله بنجاح. تم تجهيز الصفوف للمعاينة.
          </div>
        )}
        {!state.ok && state.error && (
          <div
            role="alert"
            className="border border-destructive/50 text-destructive bg-destructive/5 rounded p-3 text-sm flex items-start gap-2"
          >
            <span aria-hidden="true">⚠</span>
            <div className="flex-1">
              <div className="font-semibold">فشل الرفع / التحليل</div>
              <div className="text-xs mt-1 break-words" dir="ltr">
                <LtrValue>{state.error}</LtrValue>
              </div>
              <div className="text-xs mt-2">
                تم حفظ القالب المحدد. صحح الملف وأعد المحاولة — لن تضطر إلى إعادة اختيار القالب.
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
}
