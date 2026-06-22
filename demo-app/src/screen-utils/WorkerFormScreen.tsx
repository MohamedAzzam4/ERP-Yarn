import { useState, type ReactNode } from "react";
import { CheckCircle2, Save, Send } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

/**
 * WorkerFormScreen — shared template for the simpler worker task screens
 * (transfer, return, issue, single/twisted receipt, WIP return, quality
 * test entry). It composes the page header, form card, save/submit footer,
 * and confirmation dialog so individual screens stay short.
 */
export interface WorkerFormScreenProps {
  title: string;
  description: string;
  breadcrumbs?: { label: string }[];
  code: string;
  date: string;
  onDateChange: (date: string) => void;
  children: ReactNode;
  summary?: ReactNode;
  valid: boolean;
  invalidMessage?: string;
  /** Save draft vs submit for review. */
  onSaveDraft: () => void;
  onSubmitForReview: () => void;
  success?: string | null;
  prohibitedFields?: string[];
}

export function WorkerFormScreen({
  title,
  description,
  breadcrumbs,
  code,
  date,
  onDateChange,
  children,
  summary,
  valid,
  invalidMessage,
  onSaveDraft,
  onSubmitForReview,
  success,
  prohibitedFields,
}: WorkerFormScreenProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submit, setSubmit] = useState(false);

  const handleConfirm = () => {
    if (submit) onSubmitForReview();
    else onSaveDraft();
    setConfirmOpen(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={breadcrumbs ? [{ label: "وضع مهام العامل" }, ...breadcrumbs] : undefined}
      />

      {summary ? (
        <Card className="border-info/30 bg-info/5">
          <CardContent className="p-4 text-xs text-info-foreground">{summary}</CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="wfs-code">
                الرقم التعريفي
              </label>
              <input
                id="wfs-code"
                dir="ltr"
                readOnly
                value={code}
                className="flex h-10 w-full rounded-md border border-input bg-muted/40 px-3 py-2 text-left text-sm shadow-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="wfs-date">
                التاريخ <span className="text-danger">*</span>
              </label>
              <input
                id="wfs-date"
                type="date"
                dir="ltr"
                value={date}
                onChange={(e) => onDateChange(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>

          {children}

          {!valid && invalidMessage ? (
            <p role="alert" className="text-xs text-danger" dir="rtl">
              {invalidMessage}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="worker"
              disabled={!valid}
              onClick={() => {
                setSubmit(false);
                setConfirmOpen(true);
              }}
            >
              <Save className="h-4 w-4" aria-hidden /> حفظ كمسودة
            </Button>
            <Button
              type="button"
              variant="accent"
              size="worker"
              disabled={!valid}
              onClick={() => {
                setSubmit(true);
                setConfirmOpen(true);
              }}
            >
              <Send className="h-4 w-4" aria-hidden /> إرسال للمراجعة
            </Button>
          </div>
        </CardContent>
      </Card>

      {success ? (
        <Card className="border-success/30 bg-success/5">
          <CardContent className="flex items-start gap-3 p-4 text-sm">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
            <p className="text-success-foreground" dir="rtl">
              {success}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {prohibitedFields && prohibitedFields.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>حقول محظورة على هذه الشاشة</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            {prohibitedFields.map((f) => (
              <p key={f}>• {f}</p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={submit ? "تأكيد إرسال للمراجعة" : "تأكيد حفظ المسودة"}
        description={
          submit ? "سيصبح السجل للقراءة فقط بعد الإرسال." : "ستبقى المسودة قابلة للتعديل."
        }
        confirmLabel={submit ? "إرسال" : "حفظ"}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
