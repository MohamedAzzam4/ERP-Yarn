import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  destructive?: boolean;
  /** Optional extra reason input for approval/reject flows. */
  reasonRequired?: boolean;
  reasonValue?: string;
  onReasonChange?: (value: string) => void;
  reasonLabel?: string;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "تأكيد",
  cancelLabel = "إلغاء",
  onConfirm,
  destructive = false,
  reasonRequired = false,
  reasonValue,
  onReasonChange,
  reasonLabel = "السبب",
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {reasonRequired ? (
          <div className="space-y-1.5">
            <label htmlFor="confirm-reason" className="text-sm font-medium text-foreground">
              {reasonLabel} <span className="text-danger">*</span>
            </label>
            <textarea
              id="confirm-reason"
              className="min-h-[80px] w-full rounded-md border border-input bg-surface px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              value={reasonValue ?? ""}
              onChange={(e) => onReasonChange?.(e.target.value)}
              dir="rtl"
            />
          </div>
        ) : null}
        <DialogFooter className="mt-4 flex-row-reverse gap-2">
          <Button
            variant={destructive ? "danger" : "default"}
            onClick={onConfirm}
            disabled={reasonRequired && !reasonValue?.trim()}
          >
            {confirmLabel}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
