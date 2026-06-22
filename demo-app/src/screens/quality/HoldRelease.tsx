import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { QualityStatusBadge } from "@/components/shared/StatusBadge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatNumber } from "@/lib/utils";

export default function HoldRelease() {
  const { state, dispatch } = useDemoStore();
  const held = [
    ...state.rawBatches.filter((b) => b.qualityStatus !== "accepted"),
    ...state.yarnLots.filter((l) => l.qualityStatus !== "accepted"),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="حجز/رفع HOLD"
        description="عرض المخزون المحتاج لمراجعة أو المحجوز. عامل الجودة يمكنه رفع الحجز بعد المراجعة — لا يمكنه الموافقة على بيع بمخاطرة جودة."
        breadcrumbs={[{ label: "حجز/رفع HOLD" }]}
      />
      {held.length === 0 ? (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            لا توجد رسائل/أ لوت محجوزة.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>المخزون المحتاج لمراجعة</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {held.map((item) => {
                const isBatch = "receiptDate" in item;
                const code = isBatch ? item.code : item.code;
                const itemId = isBatch ? item.itemId : item.itemId;
                const sku = state.items.find((i) => i.id === itemId);
                return (
                  <li
                    key={item.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        <BidiValue>{code}</BidiValue> — {sku?.nameAr ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground" dir="rtl">
                        النوع: {isBatch ? "رسالة خام" : "لوت"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <QualityStatusBadge status={item.qualityStatus} />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          // Local demo action only — not a posting.
                          dispatch({
                            type: "ADD_ACTIVITY",
                            payload: {
                              id: `act-${Math.random().toString(36).slice(2, 9)}`,
                              timestamp: "2026-06-22T10:00:00",
                              actorAr: "عامل الجودة — خالد",
                              actionAr: `رفع HOLD عن ${code} بعد المراجعة.`,
                              category: "quality",
                              reference: code,
                            },
                          });
                        }}
                      >
                        رفع HOLD (عرض)
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent className="p-4 text-xs text-muted-foreground">
          الإجمالي المحتاج لمراجعة: <BidiValue numeric>{formatNumber(held.length)}</BidiValue>.
        </CardContent>
      </Card>
    </div>
  );
}
