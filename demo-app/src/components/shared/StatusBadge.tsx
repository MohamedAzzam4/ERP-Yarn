import { AlertCircle, CheckCircle2, Clock, XCircle, Ban, PauseCircle } from "lucide-react";
import type { ApprovalStatus, QualityStatus } from "@/types";
import { Badge } from "@/components/ui/badge";

const approvalMap: Record<
  ApprovalStatus,
  { labelAr: string; variant: React.ComponentProps<typeof Badge>["variant"]; icon: React.ReactNode }
> = {
  draft: { labelAr: "مسودة", variant: "muted", icon: <Clock className="h-3 w-3" aria-hidden /> },
  pending: {
    labelAr: "بانتظار الاعتماد",
    variant: "pending",
    icon: <Clock className="h-3 w-3" aria-hidden />,
  },
  approved: {
    labelAr: "معتمد",
    variant: "approved",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  },
  rejected: {
    labelAr: "مرفوض",
    variant: "rejected",
    icon: <XCircle className="h-3 w-3" aria-hidden />,
  },
  cancelled: {
    labelAr: "ملغي",
    variant: "muted",
    icon: <Ban className="h-3 w-3" aria-hidden />,
  },
};

const qualityMap: Record<
  QualityStatus,
  { labelAr: string; variant: React.ComponentProps<typeof Badge>["variant"]; icon: React.ReactNode }
> = {
  accepted: {
    labelAr: "مقبول",
    variant: "approved",
    icon: <CheckCircle2 className="h-3 w-3" aria-hidden />,
  },
  needs_review: {
    labelAr: "يحتاج مراجعة",
    variant: "needsReview",
    icon: <AlertCircle className="h-3 w-3" aria-hidden />,
  },
  blocked: {
    labelAr: "محجوز",
    variant: "blocked",
    icon: <PauseCircle className="h-3 w-3" aria-hidden />,
  },
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const m = approvalMap[status];
  return (
    <Badge variant={m.variant}>
      {m.icon}
      <span>{m.labelAr}</span>
    </Badge>
  );
}

export function QualityStatusBadge({ status }: { status: QualityStatus }) {
  const m = qualityMap[status];
  return (
    <Badge variant={m.variant}>
      {m.icon}
      <span>{m.labelAr}</span>
    </Badge>
  );
}

export function WarningBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="needsReview">
      <AlertCircle className="h-3 w-3" aria-hidden />
      <span>{children}</span>
    </Badge>
  );
}
