import { useState } from "react";
import { ManagementListScreen, useSearchFilter } from "@/screen-utils/ManagementListScreen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BidiValue } from "@/components/shared/BidiValue";
import { ApprovalStatusBadge } from "@/components/shared/StatusBadge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatDate, formatNumber } from "@/lib/utils";
import type { InventoryMovementType } from "@/types";

const TYPE_LABELS_AR: Record<InventoryMovementType, string> = {
  raw_receipt: "استلام خام",
  transfer: "نقل",
  issue_to_production: "صرف للإنتاج",
  production_receipt: "استلام إنتاج",
  wip_return: "مرتجع ودائع",
  sale_issue: "صرف بيع",
  return_received: "استلام مرتجع",
  adjustment: "تسوية",
};

export default function InventoryMovements() {
  const { state } = useDemoStore();
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const { query, setQuery, filtered } = useSearchFilter(state.movements, (m, q) => {
    const item = state.items.find((i) => i.id === m.itemId);
    return `${m.reference} ${m.batchOrLotId} ${item?.code} ${item?.nameAr} ${TYPE_LABELS_AR[m.type]}`
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  const finalFiltered = filtered.filter((m) => typeFilter === "all" || m.type === typeFilter);

  return (
    <ManagementListScreen
      title="حركة المخازن"
      description="سجل حركة المخازن مع الفلاتر والبحث."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث بالمرجع أو الصنف أو النوع..."
      filterChildren={
        <>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger id="type-filter" className="w-[220px]" aria-label="تصفية حسب النوع">
              <SelectValue placeholder="كل الأنواع" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل الأنواع</SelectItem>
              {Object.entries(TYPE_LABELS_AR).map(([k, v]) => (
                <SelectItem key={k} value={k}>
                  {v}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      }
      totalLabel="عدد الحركات المعروضة"
      total={finalFiltered.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>الحركات ({finalFiltered.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="حركة المخازن">
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>الرسالة/اللوت</TableHead>
                <TableHead>من</TableHead>
                <TableHead>إلى</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {finalFiltered.map((m) => {
                const item = state.items.find((i) => i.id === m.itemId);
                const fromLoc = state.locations.find((l) => l.id === m.fromLocationId);
                const toLoc = state.locations.find((l) => l.id === m.toLocationId);
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <BidiValue size="xs">{formatDate(m.date)}</BidiValue>
                    </TableCell>
                    <TableCell>{TYPE_LABELS_AR[m.type]}</TableCell>
                    <TableCell>
                      <BidiValue size="xs">{item?.code}</BidiValue>
                      <span className="block text-xs text-muted-foreground">{item?.nameAr}</span>
                    </TableCell>
                    <TableCell>
                      <BidiValue size="xs">{m.batchOrLotId}</BidiValue>
                    </TableCell>
                    <TableCell className="text-xs">{fromLoc?.nameAr ?? "—"}</TableCell>
                    <TableCell className="text-xs">{toLoc?.nameAr ?? "—"}</TableCell>
                    <TableCell className="numeric-cell">{formatNumber(m.quantityKg)} كجم</TableCell>
                    <TableCell>
                      <BidiValue size="xs">{m.reference ?? "—"}</BidiValue>
                    </TableCell>
                    <TableCell>
                      <ApprovalStatusBadge status={m.approvalStatus} />
                    </TableCell>
                  </TableRow>
                );
              })}
              {finalFiltered.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                    لا توجد حركات مطابقة.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </ManagementListScreen>
  );
}
