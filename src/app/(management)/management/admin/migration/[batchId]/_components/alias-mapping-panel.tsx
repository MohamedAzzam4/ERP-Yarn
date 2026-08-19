"use client";

/**
 * WP-08-01F DEFECT 1 — Minimal alias mapping panel.
 *
 * Shows the current alias mapping groups extracted by runValidation with:
 *   - source alias (sourceLabel), entity type, status, occurrence count
 *   - current target if approved + approval metadata (approvedBy/approvedAt)
 *   - explicit exceptions/subgroups (separate current alias rows sharing
 *     the same groupId but a different targetMasterId and explicit
 *     exceptionSourceRowIds)
 *   - backend validation errors
 *
 * For unresolved aliases (status='candidate' / 'needs_review' / 'rejected'
 * OR status='approved' but targetMasterId is null):
 *   - form to select an existing master (by ID) and approve via the
 *     `approveAliasMappingAction` server action
 *   - if no valid master exists, the form shows the explicit "No valid
 *     master exists yet. Create it through Master Data, then return here."
 *
 * For approved mappings:
 *   - shows the current target, approvedBy/approvedAt
 *   - permits remap through the backend command (the same
 *     approveAliasMappingAction with a different targetMasterId triggers
 *     the material-remap path in the service — the old row is superseded
 *     and a new current row is inserted)
 *
 * For exceptions (separate rows with the same groupId but a different
 * targetMasterId and explicit exceptionSourceRowIds):
 *   - shows the exception row separately with its source row IDs
 *   - permits creating a new exception via `createAliasExceptionAction`
 *     (requires a distinct sourceLabel and a non-empty exceptionSourceRowIds
 *     list)
 *
 * UX follows the page's existing patterns: client component for forms,
 * server action wiring, useActionState/useFormStatus for pending/dedup/
 * feedback, 44px min touch targets, responsive Arabic RTL layout.
 */
import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LtrValue } from "@/components/ui/ltr-value";

export interface AliasMappingDto {
  id: string;
  entityType: string;
  sourceLabel: string;
  normalizedName: string;
  targetMasterId: string | null;
  mappingVersion: string | null;
  confidenceScore: string | null;
  status: string;
  approvedBy: string | null;
  approvedAt: string | null;
  groupId: string | null;
  occurrenceCount: number;
  exceptionSourceRowIds: number[] | null;
  isCurrent: boolean;
}

interface AliasMappingPanelProps {
  batchId: string;
  /** Current alias mappings for this batch (current rows only — the
   * parent page filters out superseded rows server-side. */
  aliasMappings: AliasMappingDto[];
  /** The batch's current mappingVersion (for the binding check display). */
  batchMappingVersion: string | null;
  /** Server action: (formData) => Promise<void>. Throws on error. */
  approveAliasAction: (formData: FormData) => Promise<void>;
  /** Server action for creating an exception/subgroup alias. */
  createAliasExceptionAction: (formData: FormData) => Promise<void>;
  /** The current request's error code (from ?error=alias&code=...).
   * Shown at the top of the panel when present. */
  errorCode?: string | null;
}

interface ApproveFormState {
  ok: boolean;
  error?: string;
  errorCode?: string;
}

const IDLE_STATE: ApproveFormState = { ok: false };

function ApproveSubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      aria-busy={pending}
      className="px-3 py-1 border rounded text-sm hover:bg-muted disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-1"
      style={{ minHeight: "44px" }}
    >
      {pending && (
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {pending ? "جاري الاعتماد..." : "اعتماد"}
    </button>
  );
}

function ExceptionSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="px-3 py-1 border rounded text-sm hover:bg-muted disabled:opacity-60 disabled:cursor-wait inline-flex items-center gap-1"
      style={{ minHeight: "44px" }}
    >
      {pending && (
        <span
          className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
          aria-hidden="true"
        />
      )}
      {pending ? "جاري الإنشاء..." : "إنشاء استثناء"}
    </button>
  );
}

const ERROR_CODE_LABELS: Record<string, string> = {
  ALIAS_MAPPING_NOT_FOUND: "تعيين الاسم غير موجود",
  ALIAS_NOT_CURRENT: "تعيين الاسم ليس الحالي (تم استبداله)",
  INVALID_ALIAS_TARGET: "الهدف غير صالح — تحقق من معرف Master",
  ALIAS_ALREADY_APPROVED: "تعيين الاسم معتمد مسبقاً",
  CONFIGURATION_ERROR: "خطأ في الإعداد (Master Data Repository غير مُهيأ)",
  IDEMPOTENCY_CONFLICT: "تعارض في مفتاح التكرار",
  OPERATION_IN_PROGRESS: "العملية قيد التنفيذ",
  ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT: "اسم المصدر للاستثناء يجب أن يختلف عن الافتراضي",
  VALIDATION_FAILED: "فشل التحقق",
};

function ApprovalForm({
  alias,
  batchId,
  batchMappingVersion,
  approveAliasAction,
}: {
  alias: AliasMappingDto;
  batchId: string;
  batchMappingVersion: string | null;
  approveAliasAction: (formData: FormData) => Promise<void>;
}) {
  const [targetMasterId, setTargetMasterId] = React.useState("");
  const [state, formAction] = useActionState(async (_prev: ApproveFormState, formData: FormData) => {
    try {
      await approveAliasAction(formData);
      return { ok: true };
    } catch (e) {
      const err = e as Error;
      const message = err.message;
      let errorCode = "UNKNOWN";
      const codeMatch = message.match(/code=([A-Z_]+)/);
      if (codeMatch) {
        errorCode = codeMatch[1]!;
      } else if (/ALIAS_MAPPING_NOT_FOUND/.test(message)) errorCode = "ALIAS_MAPPING_NOT_FOUND";
      else if (/ALIAS_NOT_CURRENT/.test(message)) errorCode = "ALIAS_NOT_CURRENT";
      else if (/INVALID_ALIAS_TARGET/.test(message)) errorCode = "INVALID_ALIAS_TARGET";
      else if (/ALIAS_ALREADY_APPROVED/.test(message)) errorCode = "ALIAS_ALREADY_APPROVED";
      else if (/CONFIGURATION_ERROR/.test(message)) errorCode = "CONFIGURATION_ERROR";
      else if (/IDEMPOTENCY_CONFLICT/.test(message)) errorCode = "IDEMPOTENCY_CONFLICT";
      else if (/OPERATION_IN_PROGRESS/.test(message)) errorCode = "OPERATION_IN_PROGRESS";
      else if (/VALIDATION_FAILED/.test(message)) errorCode = "VALIDATION_FAILED";
      return { ok: false, error: message, errorCode };
    }
  }, IDLE_STATE);

  const showCreateMasterHint = !targetMasterId.trim();
  const isRemap = alias.status === "approved" && alias.targetMasterId !== null;

  return (
    <form action={formAction} className="border rounded p-3 space-y-2 bg-muted/10">
      <input type="hidden" name="aliasMappingId" value={alias.id} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="status" value="approved" />
      <input type="hidden" name="mappingVersion" value={batchMappingVersion ?? ""} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={`alias-approve-${alias.id}-${crypto.randomUUID()}`}
      />
      <div className="flex flex-col gap-1 text-sm">
        <label className="text-muted-foreground" htmlFor={`target-${alias.id}`}>
          {isRemap
            ? "معرف Master جديد (لإعادة التعيين — Remap):"
            : "معرف Master موجود (إدخال يدوي):"}
        </label>
        <input
          id={`target-${alias.id}`}
          type="text"
          name="targetMasterId"
          required
          value={targetMasterId}
          onChange={(e) => setTargetMasterId(e.target.value)}
          placeholder="uuid-of-master"
          className="px-2 py-1 border rounded text-sm font-mono"
          style={{ minHeight: "44px" }}
          dir="ltr"
        />
      </div>
      {showCreateMasterHint && (
        <div role="status" className="text-xs text-muted-foreground border border-info/40 bg-info/5 rounded p-2">
          لا يوجد Master صالح بعد. أنشئه عبر شاشة Master Data ثم عُد إلى هنا.
        </div>
      )}
      <div className="flex items-center gap-2">
        <ApproveSubmitButton disabled={false} />
        {state.ok && (
          <span role="status" className="text-xs text-success">
            تم الاعتماد بنجاح
          </span>
        )}
        {state.errorCode && (
          <span role="alert" className="text-xs text-destructive">
            {ERROR_CODE_LABELS[state.errorCode] ?? state.errorCode}
            {state.error ? ` — ${state.error.substring(0, 80)}` : ""}
          </span>
        )}
      </div>
    </form>
  );
}

function ExceptionForm({
  defaultAlias,
  batchId,
  batchMappingVersion,
  createAliasExceptionAction,
}: {
  defaultAlias: AliasMappingDto;
  batchId: string;
  batchMappingVersion: string | null;
  createAliasExceptionAction: (formData: FormData) => Promise<void>;
}) {
  const [exceptionSourceLabel, setExceptionSourceLabel] = React.useState("");
  const [targetMasterId, setTargetMasterId] = React.useState("");
  const [exceptionSourceRowIds, setExceptionSourceRowIds] = React.useState("");
  const [state, formAction] = useActionState(async (_prev: ApproveFormState, formData: FormData) => {
    try {
      await createAliasExceptionAction(formData);
      return { ok: true };
    } catch (e) {
      const err = e as Error;
      const message = err.message;
      let errorCode = "UNKNOWN";
      const codeMatch = message.match(/code=([A-Z_]+)/);
      if (codeMatch) {
        errorCode = codeMatch[1]!;
      } else if (/ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT/.test(message)) errorCode = "ALIAS_EXCEPTION_SOURCE_LABEL_CONFLICT";
      else if (/ALIAS_MAPPING_NOT_FOUND/.test(message)) errorCode = "ALIAS_MAPPING_NOT_FOUND";
      else if (/ALIAS_NOT_CURRENT/.test(message)) errorCode = "ALIAS_NOT_CURRENT";
      else if (/INVALID_ALIAS_TARGET/.test(message)) errorCode = "INVALID_ALIAS_TARGET";
      else if (/ALIAS_ALREADY_APPROVED/.test(message)) errorCode = "ALIAS_ALREADY_APPROVED";
      else if (/CONFIGURATION_ERROR/.test(message)) errorCode = "CONFIGURATION_ERROR";
      else if (/IDEMPOTENCY_CONFLICT/.test(message)) errorCode = "IDEMPOTENCY_CONFLICT";
      else if (/OPERATION_IN_PROGRESS/.test(message)) errorCode = "OPERATION_IN_PROGRESS";
      else if (/VALIDATION_FAILED/.test(message)) errorCode = "VALIDATION_FAILED";
      return { ok: false, error: message, errorCode };
    }
  }, IDLE_STATE);

  return (
    <form action={formAction} className="border rounded p-3 space-y-2 bg-amber-50/50">
      <input type="hidden" name="defaultAliasMappingId" value={defaultAlias.id} />
      <input type="hidden" name="batchId" value={batchId} />
      <input type="hidden" name="mappingVersion" value={batchMappingVersion ?? ""} />
      <input
        type="hidden"
        name="idempotencyKey"
        value={`alias-exception-${defaultAlias.id}-${crypto.randomUUID()}`}
      />
      <div className="text-xs font-semibold text-amber-800">
        إنشاء استثناء/مجموعة فرعية (هدف مختلف لصفوف محددة)
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label className="text-muted-foreground" htmlFor={`exc-label-${defaultAlias.id}`}>
          اسم المصدر للاستثناء (يجب أن يختلف عن الافتراضي):
        </label>
        <input
          id={`exc-label-${defaultAlias.id}`}
          type="text"
          name="exceptionSourceLabel"
          required
          value={exceptionSourceLabel}
          onChange={(e) => setExceptionSourceLabel(e.target.value)}
          placeholder={`${defaultAlias.sourceLabel} (Row 7)`}
          className="px-2 py-1 border rounded text-sm"
          style={{ minHeight: "44px" }}
        />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label className="text-muted-foreground" htmlFor={`exc-target-${defaultAlias.id}`}>
          معرف Master الجديد للاستثناء:
        </label>
        <input
          id={`exc-target-${defaultAlias.id}`}
          type="text"
          name="targetMasterId"
          required
          value={targetMasterId}
          onChange={(e) => setTargetMasterId(e.target.value)}
          placeholder="uuid-of-exception-master"
          className="px-2 py-1 border rounded text-sm font-mono"
          style={{ minHeight: "44px" }}
          dir="ltr"
        />
      </div>
      <div className="flex flex-col gap-1 text-sm">
        <label className="text-muted-foreground" htmlFor={`exc-rows-${defaultAlias.id}`}>
          أرقام الصفوف المصدر المنفصلة (مفصولة بفواصل):
        </label>
        <input
          id={`exc-rows-${defaultAlias.id}`}
          type="text"
          name="exceptionSourceRowIds"
          required
          value={exceptionSourceRowIds}
          onChange={(e) => setExceptionSourceRowIds(e.target.value)}
          placeholder="7,12,18"
          className="px-2 py-1 border rounded text-sm"
          style={{ minHeight: "44px" }}
          dir="ltr"
        />
      </div>
      <div className="flex items-center gap-2">
        <ExceptionSubmitButton />
        {state.ok && (
          <span role="status" className="text-xs text-success">
            تم إنشاء الاستثناء بنجاح
          </span>
        )}
        {state.errorCode && (
          <span role="alert" className="text-xs text-destructive">
            {ERROR_CODE_LABELS[state.errorCode] ?? state.errorCode}
            {state.error ? ` — ${state.error.substring(0, 80)}` : ""}
          </span>
        )}
      </div>
    </form>
  );
}

export function AliasMappingPanel({
  batchId,
  aliasMappings,
  batchMappingVersion,
  approveAliasAction,
  createAliasExceptionAction,
  errorCode,
}: AliasMappingPanelProps) {
  if (aliasMappings.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-4">
        لا توجد تعيينات أسماء (alias mappings) بعد. شغّل التحقق لاستخراج المرشحين.
      </div>
    );
  }

  // Group by groupId (null groupId → treated as separate singletons).
  const groups = new Map<string, AliasMappingDto[]>();
  for (const a of aliasMappings) {
    const key = a.groupId ?? a.id; // singleton fallback
    const arr = groups.get(key) ?? [];
    arr.push(a);
    groups.set(key, arr);
  }

  return (
    <div className="space-y-4">
      {errorCode && (
        <div role="alert" className="border border-destructive/50 text-destructive bg-destructive/5 rounded p-3 text-sm">
          خطأ في عملية الاسم: {ERROR_CODE_LABELS[errorCode] ?? errorCode}
        </div>
      )}
      {batchMappingVersion && (
        <div className="text-xs text-muted-foreground">
          إصدار التعيين الحالي للدفعة: <LtrValue>{batchMappingVersion}</LtrValue>
        </div>
      )}
      {[...groups.entries()].map(([groupKey, aliases]) => {
        // Sort: default group first (no exceptionSourceRowIds), then exceptions.
        const sorted = [...aliases].sort((a, b) => {
          const aHas = Array.isArray(a.exceptionSourceRowIds) && a.exceptionSourceRowIds.length > 0 ? 1 : 0;
          const bHas = Array.isArray(b.exceptionSourceRowIds) && b.exceptionSourceRowIds.length > 0 ? 1 : 0;
          return aHas - bHas;
        });
        const defaultAlias = sorted.find(a => !(Array.isArray(a.exceptionSourceRowIds) && a.exceptionSourceRowIds.length > 0));
        const exceptions = sorted.filter(a => Array.isArray(a.exceptionSourceRowIds) && a.exceptionSourceRowIds.length > 0);
        return (
          <div key={groupKey} className="border rounded p-3 space-y-3 bg-background">
            <div className="text-xs text-muted-foreground">
              المجموعة: <LtrValue>{groupKey.substring(0, 8)}…</LtrValue>
              {defaultAlias && (
                <> — عدد التكرارات: <LtrValue>{defaultAlias.occurrenceCount}</LtrValue></>
              )}
            </div>
            {sorted.map((alias) => {
              const isException = Array.isArray(alias.exceptionSourceRowIds) && alias.exceptionSourceRowIds.length > 0;
              const isUnresolved = alias.status !== "approved" || alias.targetMasterId === null;
              return (
                <div key={alias.id} className={`border rounded p-3 space-y-2 ${isException ? "bg-amber-50/30 border-amber-300/50" : ""}`}>
                  <div className="flex justify-between text-sm">
                    <div className="font-medium">
                      <LtrValue>{alias.sourceLabel}</LtrValue>
                      {isException && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded border border-amber-500/50 text-amber-700 bg-amber-50 font-semibold">
                          استثناء
                        </span>
                      )}
                    </div>
                    <div className="text-xs">
                      <span className="text-muted-foreground">النوع:</span>{" "}
                      <LtrValue>{alias.entityType}</LtrValue>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">الحالة:</span>{" "}
                      <span className={
                        alias.status === "approved" ? "text-success font-medium" :
                        alias.status === "rejected" ? "text-destructive font-medium" :
                        "text-amber-700 font-medium"
                      }>{alias.status}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">الهدف:</span>{" "}
                      {alias.targetMasterId ? (
                        <LtrValue>{alias.targetMasterId.substring(0, 8)}…</LtrValue>
                      ) : "—"}
                    </div>
                    <div>
                      <span className="text-muted-foreground">الثقة:</span>{" "}
                      <LtrValue>{alias.confidenceScore ?? "—"}</LtrValue>
                    </div>
                    {alias.approvedBy && (
                      <div>
                        <span className="text-muted-foreground">المعتمِد:</span>{" "}
                        <LtrValue>{alias.approvedBy.substring(0, 8)}…</LtrValue>
                      </div>
                    )}
                    {alias.approvedAt && (
                      <div>
                        <span className="text-muted-foreground">الاعتماد:</span>{" "}
                        <LtrValue>{new Date(alias.approvedAt).toLocaleDateString("ar")}</LtrValue>
                      </div>
                    )}
                    {alias.mappingVersion && (
                      <div>
                        <span className="text-muted-foreground">إصدار التعيين:</span>{" "}
                        <LtrValue>{alias.mappingVersion}</LtrValue>
                      </div>
                    )}
                  </div>
                  {isException && alias.exceptionSourceRowIds && alias.exceptionSourceRowIds.length > 0 && (
                    <div className="text-xs border border-amber-300/50 bg-amber-50 rounded p-2">
                      <span className="text-muted-foreground">صفوف الاستثناء:</span>{" "}
                      <LtrValue>{alias.exceptionSourceRowIds.join(", ")}</LtrValue>
                    </div>
                  )}
                  {!alias.isCurrent && (
                    <div className="text-xs text-destructive border border-destructive/30 rounded p-2">
                      ⚠ هذا التعيين ليس الحالي (تم استبداله). لا يمكن اعتماده.
                    </div>
                  )}
                  {isUnresolved && alias.isCurrent && (
                    <ApprovalForm
                      alias={alias}
                      batchId={batchId}
                      batchMappingVersion={batchMappingVersion}
                      approveAliasAction={approveAliasAction}
                    />
                  )}
                  {!isUnresolved && alias.isCurrent && (
                    <div className="text-xs text-success border border-success/30 rounded p-2">
                      ✓ معتمد. يمكن إعادة التعيين (Remap) بإدخال معرف Master جديد أدناه.
                      <ApprovalForm
                        alias={alias}
                        batchId={batchId}
                        batchMappingVersion={batchMappingVersion}
                        approveAliasAction={approveAliasAction}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            {/* Exception creation form — only shown when there's a default group alias. */}
            {defaultAlias && defaultAlias.isCurrent && (
              <ExceptionForm
                defaultAlias={defaultAlias}
                batchId={batchId}
                batchMappingVersion={batchMappingVersion}
                createAliasExceptionAction={createAliasExceptionAction}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
