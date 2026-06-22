import { Link, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { Timeline } from "@/components/shared/Timeline";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials } from "@/lib/permissions";
import { formatEgp, formatDate, formatNumber } from "@/lib/utils";

const STATUS_LABEL_AR: Record<string, string> = {
  draft: "مسودة",
  in_progress: "قيد التنفيذ",
  completed: "مكتمل",
  wip_returned: "مُرجَّع ودائع",
};

export default function ProductionOrderDetail() {
  const { orderId } = useParams<{ orderId: string }>();
  const { state } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);

  const order = state.productionOrders.find((p) => p.id === orderId);
  if (!order) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="الأمر غير موجود"
          breadcrumbs={[{ label: "أوامر الإنتاج" }, { label: "غير موجود" }]}
        />
        <EmptyState
          title="لم يتم العثور على أمر الإنتاج"
          description="ربما تم حذفه أو أن الرابط غير صحيح."
          action={
            <Button asChild>
              <Link to="/management/production-orders">العودة لقائمة الأوامر</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const factory = state.factories.find((f) => f.id === order.factoryId);
  const outputItem = state.items.find((i) => i.id === order.outputItemId);
  const events = state.traceabilityEvents
    .filter((e) => e.relatedId?.includes(order.code) || e.relatedId === order.id)
    .map((e) => ({
      id: e.id,
      date: formatDate(e.date),
      titleAr: e.typeAr,
      descriptionAr: e.descriptionAr,
      reference: e.relatedId,
      quantityKg: e.quantityKg,
    }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`أمر إنتاج ${order.code}`}
        description={`نوع: ${order.type === "single_yarn" ? "فرد" : "زوى"} — الحالة: ${STATUS_LABEL_AR[order.status]}`}
        breadcrumbs={[
          { label: "أوامر الإنتاج", href: "/management/production-orders" },
          { label: order.code },
        ]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/management/production-orders">
              <ArrowRight className="h-4 w-4" aria-hidden /> رجوع
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>بيانات الأمر</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="الرمز">
              <BidiValue>{order.code}</BidiValue>
            </Row>
            <Row label="المصنع">{factory?.nameAr ?? "—"}</Row>
            <Row label="الصنف الناتج">{outputItem?.nameAr ?? "—"}</Row>
            <Row label="تاريخ البدء">
              <BidiValue>{formatDate(order.startDate)}</BidiValue>
            </Row>
            {order.endDate ? (
              <Row label="تاريخ الانتهاء">
                <BidiValue>{formatDate(order.endDate)}</BidiValue>
              </Row>
            ) : null}
            <Row label="الحالة">
              <Badge variant={order.status === "completed" ? "approved" : "info"}>
                {STATUS_LABEL_AR[order.status]}
              </Badge>
              {order.hasMissingCost ? (
                <Badge variant="needsReview" className="ms-1">
                  تكلفة ناقصة
                </Badge>
              ) : null}
            </Row>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>التسوية الكمية (ودائع)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="المخطط مصروف">
              <BidiValue numeric>{formatNumber(order.plannedInputKg)} كجم</BidiValue>
            </Row>
            <Row label="المصروف فعليًا">
              <BidiValue numeric>{formatNumber(order.issuedKg)} كجم</BidiValue>
            </Row>
            <Row label="المستهلَك">
              <BidiValue numeric>{formatNumber(order.consumedKg)} كجم</BidiValue>
            </Row>
            <Row label="الهالك">
              <BidiValue numeric>{formatNumber(order.wasteKg)} كجم</BidiValue>
            </Row>
            <Row label="المُنتَج">
              <BidiValue numeric>{formatNumber(order.outputKg)} كجم</BidiValue>
            </Row>
            <Row label="متبقي ودائع">
              <BidiValue numeric>{formatNumber(order.wipRemainingKg)} كجم</BidiValue>
            </Row>
          </CardContent>
        </Card>
      </div>

      {seeFinancials ? (
        <Card>
          <CardHeader>
            <CardTitle>التكلفة والمستحق (مرئي للمالك/المحاسب فقط)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="معدل التشغيل per ton">
              {order.factoryRatePerTonEgp !== undefined ? (
                <BidiValue numeric>{formatEgp(order.factoryRatePerTonEgp)}</BidiValue>
              ) : (
                <Badge variant="needsReview">غير مُثبَت</Badge>
              )}
            </Row>
            <Row label="المستحق على المصنع">
              {order.payableEgp !== undefined ? (
                <BidiValue numeric>{formatEgp(order.payableEgp)}</BidiValue>
              ) : (
                <Badge variant="needsReview">بانتظار التكلفة</Badge>
              )}
            </Row>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>الخط الزمني للأحداث</CardTitle>
        </CardHeader>
        <CardContent>
          <Timeline events={events} emptyMessage="لا توجد أحداث مسجّلة لهذا الأمر بعد." />
        </CardContent>
      </Card>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{children}</span>
    </div>
  );
}
