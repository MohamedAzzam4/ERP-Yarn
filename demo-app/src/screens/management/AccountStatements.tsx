import { Link, useParams } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BidiValue } from "@/components/shared/BidiValue";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/shared/EmptyState";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDemoStore } from "@/store/DemoStoreContext";
import { formatDate, formatEgp } from "@/lib/utils";
import type { ApprovalStatus } from "@/types";

export default function AccountStatements() {
  const { partyType, partyId } = useParams<{ partyType: string; partyId: string }>();
  const { state } = useDemoStore();

  const party =
    partyType === "customer"
      ? state.customers.find((c) => c.id === partyId)
      : partyType === "supplier"
        ? state.suppliers.find((s) => s.id === partyId)
        : state.factories.find((f) => f.id === partyId);

  if (!party) {
    return (
      <div className="space-y-6">
        <PageHeader title="الطرف غير موجود" />
        <EmptyState
          title="لم يتم العثور على الطرف"
          action={
            <Button asChild>
              <Link to="/management/payments">العودة للمدفوعات</Link>
            </Button>
          }
        />
      </div>
    );
  }

  const entries = state.subledgerEntries.filter(
    (e) => e.partyType === partyType && e.partyId === partyId,
  );
  const debit = entries.filter((e) => e.direction === "debit").reduce((s, e) => s + e.amountEgp, 0);
  const credit = entries
    .filter((e) => e.direction === "credit")
    .reduce((s, e) => s + e.amountEgp, 0);
  const balance = debit - credit;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`كشف حساب — ${party.nameAr}`}
        description={`النوع: ${partyType === "customer" ? "عميل" : partyType === "supplier" ? "مورد" : "مصنع"}. القيود تجريبية وغير مُلتزِمة.`}
        breadcrumbs={[
          { label: "المدفوعات", href: "/management/payments" },
          { label: party.nameAr },
        ]}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link to="/management/payments">
              <ArrowRight className="h-4 w-4" aria-hidden /> رجوع
            </Link>
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">إجمالي مدين</p>
            <p className="font-heading text-xl font-bold text-foreground">
              <BidiValue numeric>{formatEgp(debit)}</BidiValue>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">إجمالي دائن</p>
            <p className="font-heading text-xl font-bold text-foreground">
              <BidiValue numeric>{formatEgp(credit)}</BidiValue>
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1 p-4">
            <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
            <p className="font-heading text-xl font-bold text-foreground">
              <BidiValue numeric>{formatEgp(balance)}</BidiValue>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>القيود</CardTitle>
        </CardHeader>
        <CardContent>
          <Table ariaLabel="قيود كشف الحساب">
            <TableHeader>
              <TableRow>
                <TableHead>التاريخ</TableHead>
                <TableHead>الاتجاه</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>المصدر</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <BidiValue size="xs">{formatDate(e.date)}</BidiValue>
                  </TableCell>
                  <TableCell>
                    <Badge variant={e.direction === "debit" ? "info" : "success"}>
                      {e.direction === "debit" ? "مدين" : "دائن"}
                    </Badge>
                  </TableCell>
                  <TableCell className="numeric-cell">
                    <BidiValue numeric size="xs">
                      {formatEgp(e.amountEgp)}
                    </BidiValue>
                  </TableCell>
                  <TableCell>
                    <BidiValue size="xs">{e.reference}</BidiValue>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {e.sourceSaleId
                      ? `بيع ${e.sourceSaleId}`
                      : e.sourcePaymentId
                        ? `دفعة ${e.sourcePaymentId}`
                        : "—"}
                  </TableCell>
                </TableRow>
              ))}
              {entries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    لا توجد قيود.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// Avoid unused-import warning for ApprovalStatus (kept for type-only re-export).
export type { ApprovalStatus };
