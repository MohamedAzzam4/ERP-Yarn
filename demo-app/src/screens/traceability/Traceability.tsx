import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BidiValue } from "@/components/shared/BidiValue";
import { Timeline } from "@/components/shared/Timeline";
import { EmptyState } from "@/components/shared/EmptyState";
import { Input } from "@/components/ui/input";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials } from "@/lib/permissions";
import { formatDate, formatNumber } from "@/lib/utils";

export default function Traceability() {
  const { state } = useDemoStore();
  const seeFinancials = canSeeFinancials(state.currentRole);
  const [search, setSearch] = useState("");

  const matchedBatch =
    state.rawBatches.find((b) => b.code.toLowerCase().includes(search.toLowerCase())) ||
    state.yarnLots.find((l) => l.code.toLowerCase().includes(search.toLowerCase()));

  const events = matchedBatch
    ? state.traceabilityEvents.filter((e) => e.batchOrLotId === matchedBatch.id)
    : state.traceabilityEvents;

  const timelineEvents = events.map((e) => ({
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
        title="تتبّع سلسلة الدفعة/اللوت"
        description="تتبّع من الرسالة الخام إلى البيع/المرتجع/التصحيح. ابحث برمز رسالة خام أو لوت فرد أو لوت زوى أو بيع."
      />

      <Card>
        <CardHeader>
          <CardTitle>بحث</CardTitle>
        </CardHeader>
        <CardContent>
          <label htmlFor="search" className="sr-only">
            بحث برمز الدفعة أو اللوت
          </label>
          <Input
            id="search"
            type="search"
            dir="ltr"
            className="text-left"
            placeholder="مثال: RB-2026-0001 أو LOT-S-2026-0001"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <p className="mt-2 text-xs text-muted-foreground">
            اترك البحث فارغًا لعرض كل الأحداث. جرّب: <BidiValue size="xs">RB-2026-0001</BidiValue> —{" "}
            <BidiValue size="xs">LOT-S-2026-0001</BidiValue> —{" "}
            <BidiValue size="xs">LOT-T-2026-0001</BidiValue>
          </p>
        </CardContent>
      </Card>

      {matchedBatch ? (
        <Card>
          <CardHeader>
            <CardTitle>السجل المطابق</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="الرمز">
              <BidiValue>{matchedBatch.code}</BidiValue>
            </Row>
            <Row label="النوع">{"receiptDate" in matchedBatch ? "رسالة خام" : "لوت"}</Row>
            <Row label="الكمية">
              <BidiValue numeric>{formatNumber(matchedBatch.quantityKg)} كجم</BidiValue>
            </Row>
            {seeFinancials ? (
              <>
                <Row label="السعر/التكلفة">
                  {"pricePerTonEgp" in matchedBatch && matchedBatch.pricePerTonEgp ? (
                    <BidiValue numeric>
                      {matchedBatch.pricePerTonEgp.toLocaleString("en-US")} جنيه/طن
                    </BidiValue>
                  ) : "calculatedCostEgp" in matchedBatch && matchedBatch.calculatedCostEgp ? (
                    <BidiValue numeric>
                      {matchedBatch.calculatedCostEgp.toLocaleString("en-US")} جنيه
                    </BidiValue>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Row>
              </>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>الخط الزمني للأحداث</CardTitle>
        </CardHeader>
        <CardContent>
          {timelineEvents.length === 0 ? (
            <EmptyState title="لا توجد أحداث" description="جرّب رمزًا آخر أو اترك البحث فارغًا." />
          ) : (
            <Timeline events={timelineEvents} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 p-4 text-xs text-muted-foreground">
          <BidiValue size="xs">ملاحظة:</BidiValue>
          <p dir="rtl">
            التتبّع هنا عرض فقط — لا يسمح بالتعديل أو الترحيل من الخط الزمني. الأحداث المالية مرئية
            فقط للمالك/المحاسب.
          </p>
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
