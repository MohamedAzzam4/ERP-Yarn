import { useMemo } from "react";
import { ManagementListScreen, useSearchFilter } from "@/screen-utils/ManagementListScreen";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { useDemoStore } from "@/store/DemoStoreContext";
import { canSeeFinancials } from "@/lib/permissions";
import { formatEgp, formatNumber } from "@/lib/utils";

export default function InventoryBalances() {
  const { state } = useDemoStore();
  const role = state.currentRole;
  const seeFinancials = canSeeFinancials(role);

  const { query, setQuery, filtered } = useSearchFilter(state.balances, (b, q) => {
    const loc = state.locations.find((l) => l.id === b.locationId);
    const item = state.items.find((i) => i.id === b.itemId);
    return `${loc?.code} ${loc?.nameAr} ${item?.code} ${item?.nameAr} ${b.batchOrLotId}`
      .toLowerCase()
      .includes(q.toLowerCase());
  });

  const totals = useMemo(() => {
    return filtered.reduce(
      (acc, b) => {
        acc.onHand += b.onHandKg;
        acc.reserved += b.reservedKg;
        acc.blocked += b.blockedKg;
        acc.returned += b.returnedKg;
        return acc;
      },
      { onHand: 0, reserved: 0, blocked: 0, returned: 0 },
    );
  }, [filtered]);

  return (
    <ManagementListScreen
      title="أرصدة المخزون"
      description="أرصدة المخزون حسب الموقع والصنف والرسالة/اللوت. القيم تجريبية ولا تمثّل قيمة المخزون المالي."
      searchValue={query}
      onSearchChange={setQuery}
      searchPlaceholder="ابحث بالموقع أو الصنف أو الرسالة..."
      kpis={[
        { label: "إجمالي الكميات (كجم)", value: formatNumber(totals.onHand) },
        { label: "محجوز (كجم)", value: formatNumber(totals.reserved) },
        { label: "محظور (كجم)", value: formatNumber(totals.blocked) },
        { label: "مرتجع (كجم)", value: formatNumber(totals.returned) },
      ]}
      totalLabel="عدد البنود المعروضة"
      total={filtered.length}
    >
      <Card>
        <CardHeader>
          <CardTitle>أرصدة حسب الموقع</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="أرصدة المخزون">
            <TableHeader>
              <TableRow>
                <TableHead>الموقع</TableHead>
                <TableHead>الصنف</TableHead>
                <TableHead>الرسالة/اللوت</TableHead>
                <TableHead>الكمية المتاحة</TableHead>
                <TableHead>محجوز</TableHead>
                <TableHead>محظور</TableHead>
                <TableHead>مرتجع</TableHead>
                {seeFinancials ? <TableHead>القيمة التقديرية</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((b, i) => {
                const loc = state.locations.find((l) => l.id === b.locationId);
                const item = state.items.find((i2) => i2.id === b.itemId);
                return (
                  <TableRow key={i}>
                    <TableCell>
                      <BidiValue size="xs">{loc?.code}</BidiValue>
                      <span className="block text-xs text-muted-foreground">{loc?.nameAr}</span>
                    </TableCell>
                    <TableCell>
                      <BidiValue size="xs">{item?.code}</BidiValue>
                      <span className="block text-xs text-muted-foreground">{item?.nameAr}</span>
                    </TableCell>
                    <TableCell>
                      <BidiValue size="xs">{b.batchOrLotId}</BidiValue>
                    </TableCell>
                    <TableCell className="numeric-cell">{formatNumber(b.onHandKg)} كجم</TableCell>
                    <TableCell className="numeric-cell">{formatNumber(b.reservedKg)}</TableCell>
                    <TableCell className="numeric-cell">{formatNumber(b.blockedKg)}</TableCell>
                    <TableCell className="numeric-cell">{formatNumber(b.returnedKg)}</TableCell>
                    {seeFinancials ? (
                      <TableCell className="numeric-cell text-muted-foreground">
                        <Badge variant="muted">تقديري</Badge>{" "}
                        <BidiValue numeric size="xs">
                          {formatEgp(b.onHandKg * 50)}
                        </BidiValue>
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })}
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={seeFinancials ? 8 : 7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    لا توجد أرصدة مطابقة.
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
