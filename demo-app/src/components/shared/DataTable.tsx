import * as React from "react";
import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";

export interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyMessage?: string;
  pageSize?: number;
  /** Optional controlled global filter (search). */
  globalFilter?: string;
  onGlobalFilterChange?: (value: string) => void;
  /** Optional aria-label for the table. */
  ariaLabel?: string;
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = "لا توجد بيانات.",
  pageSize = 10,
  ariaLabel,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [pagination, setPagination] = React.useState({ pageIndex: 0, pageSize });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, pagination },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  });

  const rows = table.getRowModel().rows;

  return (
    <div className={cn("space-y-3", className)}>
      <div className="rounded-md border border-border">
        <Table aria-label={ariaLabel}>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id}>
                {hg.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} style={{ width: header.getSize() }}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-start"
                          onClick={header.column.getToggleSortingHandler()}
                          aria-label={`ترتيب حسب ${typeof header.column.columnDef.header === "string" ? header.column.columnDef.header : "هذا العمود"}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <ChevronsUpDown
                            className={cn(
                              "h-3 w-3 opacity-50",
                              sorted ? "opacity-100 text-foreground" : "",
                            )}
                            aria-hidden
                          />
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center text-muted-foreground"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {table.getPageCount() > 1 ? (
        <div className="flex items-center justify-between gap-2 text-sm">
          <span className="text-muted-foreground">
            صفحة <BidiLtr>{table.getState().pagination.pageIndex + 1}</BidiLtr> من{" "}
            <BidiLtr>{table.getPageCount()}</BidiLtr>
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="الصفحة السابقة"
            >
              <ChevronRight className="h-4 w-4" aria-hidden /> السابق
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="الصفحة التالية"
            >
              التالي <ChevronLeft className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BidiLtr({ children }: { children: React.ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}
