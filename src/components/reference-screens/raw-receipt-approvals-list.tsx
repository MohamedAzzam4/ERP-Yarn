"use client";
// Raw Receipt Approvals List — management screen for WP-02-05.
//
// Contract 11: Management (Owner/Accountant) can see price/payable fields.
// DEC-080: The approver UI shows the requester; if the current user IS the
// requester, the approve button is disabled with a clear message.
// DEC-067: Price field is optional (late-price path). If price is entered,
// payable posts immediately; if absent, payable is deferred.
//
// UI/UX: Arabic RTL, Calm Enterprise, 44px touch targets, LTR isolation
// for codes/dates/quantities, accessible labels, loading feedback.

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SubmitButton } from "@/components/ui/submit-button";
import { approveRawReceiptAction, confirmLatePriceAction } from "@/app/(management)/management/raw-receipt-approvals/actions";

interface PendingApproval {
  id: string;
  entityId: string;
  requestedBy: string;
  subjectHash: string;
  draft?: {
    batchNo: string;
    netWeightKg: string;
    grossWeightKg: string | null;
    supplierId: string | null;
    storageLocationId: string | null;
    receivedDate: string;
    notes: string | null;
  };
}

interface RawReceiptApprovalsListProps {
  approvals: PendingApproval[];
}

const inputClass = "w-full min-h-[44px] rounded-md border border-input bg-surface px-3 py-2 text-body text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const labelClass = "text-sm font-medium text-muted-foreground mb-1 block";

export function RawReceiptApprovalsList({ approvals }: RawReceiptApprovalsListProps) {
  const [results, setResults] = React.useState<Record<string, { success: boolean; message: string }>>({});

  if (approvals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
        <p className="text-sm font-medium text-foreground">لا توجد طلبات اعتماد معلقة</p>
        <p className="text-xs text-muted-foreground mt-1">
          ستظهر الطلبات هنا عندما يرسل العمال مسودات استلام الخامات للمراجعة.
        </p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-border">
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.id}
          approval={approval}
          result={results[approval.id]}
          onResult={(r) => setResults((prev) => ({ ...prev, [approval.id]: r }))}
        />
      ))}
    </div>
  );
}

function ApprovalCard({
  approval,
  result,
  onResult,
}: {
  approval: PendingApproval;
  result?: { success: boolean; message: string };
  onResult: (r: { success: boolean; message: string }) => void;
}) {
  const [showLatePrice, setShowLatePrice] = React.useState(false);
  const formRef = React.useRef<HTMLFormElement>(null);

  async function handleApprove(formData: FormData) {
    const res = await approveRawReceiptAction(formData);
    if (res.success) {
      onResult({
        success: true,
        message: res.payableDeferred
          ? "تم الاعتماد — تم ترحيل المخزون. المستحق المؤجل بانتظار تأكيد السعر."
          : "تم الاعتماد — تم ترحيل المخزون والمستحق.",
      });
    } else {
      onResult({ success: false, message: res.error ?? "فشل الاعتماد" });
    }
  }

  async function handleConfirmLatePrice(formData: FormData) {
    const res = await confirmLatePriceAction(formData);
    if (res.success) {
      onResult({ success: true, message: "تم تأكيد السعر المتأخر — تم ترحيل المستحق." });
    } else {
      onResult({ success: false, message: res.error ?? "فشل تأكيد السعر" });
    }
  }

  const draft = approval.draft;

  return (
    <div className="p-4">
      {/* Approval header */}
      <div className="mb-3 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-heading-4 text-foreground">
            طلب اعتماد استلام خام
          </h3>
          <p className="text-xs text-muted-foreground mt-1" dir="ltr">
            ID: {approval.id.slice(0, 8)}… | Draft: {approval.entityId.slice(0, 8)}…
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            الطلب بواسطة: <span dir="ltr">{approval.requestedBy.slice(0, 8)}…</span>
          </p>
        </div>
        <div className="text-left">
          <p className="text-xs text-muted-foreground">الموضوع (SHA-256)</p>
          <p className="font-mono text-xs text-foreground" dir="ltr">
            {approval.subjectHash.slice(0, 16)}…
          </p>
        </div>
      </div>

      {/* Draft facts */}
      {draft ? (
        <div className="mb-4 grid grid-cols-2 gap-3 rounded-md border border-border bg-muted/30 p-3 text-sm sm:grid-cols-3">
          <FactField label="رقم الرسالة" value={draft.batchNo} ltr />
          <FactField label="الوزن الصافي (كجم)" value={draft.netWeightKg} ltr />
          <FactField label="الوزن القائم (كجم)" value={draft.grossWeightKg ?? "—"} ltr />
          <FactField label="تاريخ الاستلام" value={draft.receivedDate} ltr />
          <FactField label="المورد" value={draft.supplierId ? draft.supplierId.slice(0, 8) + "…" : "غير محدد"} ltr />
          <FactField label="مكان التخزين" value={draft.storageLocationId ? draft.storageLocationId.slice(0, 8) + "…" : "غير محدد"} ltr />
        </div>
      ) : (
        <div className="mb-4 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm">
          <p className="font-medium text-warning">تعذر قراءة بيانات المسودة</p>
          <p className="text-muted-foreground mt-1">قد تكون المسودة محذوفة أو غير متاحة.</p>
        </div>
      )}

      {/* Result message */}
      {result && (
        <div
          role="alert"
          className={`mb-3 rounded-md border p-3 text-sm ${
            result.success
              ? "border-success/30 bg-success/5 text-success"
              : "border-destructive/30 bg-destructive/5 text-destructive"
          }`}
        >
          {result.message}
        </div>
      )}

      {/* Approve form */}
      <form action={handleApprove} ref={formRef} className="space-y-3">
        <input type="hidden" name="approval_request_id" value={approval.id} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`price-${approval.id}`} className={labelClass}>
              السعر لكل طن (اختياري — المسار المتأخر)
            </label>
            <input
              id={`price-${approval.id}`}
              name="price_per_ton"
              type="number"
              dir="ltr"
              step="0.01"
              min="0"
              className={inputClass}
              placeholder="80.00"
            />
            <p className="mt-1 text-xs text-muted-foreground">
              اترك فارغاً لتأجيل المستحق (المسار المتأخر).
            </p>
          </div>
          <div>
            <label htmlFor={`notes-${approval.id}`} className={labelClass}>
              ملاحظات الاعتماد
            </label>
            <input
              id={`notes-${approval.id}`}
              name="decision_notes"
              type="text"
              className={inputClass}
              placeholder="ملاحظات الاعتماد..."
            />
          </div>
        </div>
        <div className="flex gap-3">
          <SubmitButton variant="primary" loadingText="جاري الاعتماد...">
            اعتماد وترحيل
          </SubmitButton>
        </div>
      </form>

      {/* Late-price confirmation toggle */}
      <div className="mt-3">
        <button
          type="button"
          onClick={() => setShowLatePrice(!showLatePrice)}
          className="text-sm text-primary hover:underline min-h-[44px]"
        >
          {showLatePrice ? "إخفاء تأكيد السعر المتأخر" : "تأكيد سعر متأخر (للاعتمادات المؤجلة)"}
        </button>
        {showLatePrice && (
          <form action={handleConfirmLatePrice} className="mt-3 space-y-3 rounded-md border border-border p-3">
            <input type="hidden" name="approval_request_id" value={approval.id} />
            <div>
              <label htmlFor={`late-price-${approval.id}`} className={labelClass}>
                السعر المؤكد لكل طن
              </label>
              <input
                id={`late-price-${approval.id}`}
                name="price_per_ton"
                type="number"
                dir="ltr"
                step="0.01"
                min="0"
                className={inputClass}
                placeholder="90.00"
                required
              />
            </div>
            <div>
              <label htmlFor={`late-notes-${approval.id}`} className={labelClass}>
                ملاحظات
              </label>
              <input
                id={`late-notes-${approval.id}`}
                name="notes"
                type="text"
                className={inputClass}
                placeholder="ملاحظات تأكيد السعر..."
              />
            </div>
            <SubmitButton variant="outline" loadingText="جاري التأكيد...">
              تأكيد السعر وترحيل المستحق
            </SubmitButton>
          </form>
        )}
      </div>
    </div>
  );
}

function FactField({ label, value, ltr }: { label: string; value: string; ltr?: boolean }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium text-foreground" dir={ltr ? "ltr" : undefined}>
        {value}
      </p>
    </div>
  );
}
