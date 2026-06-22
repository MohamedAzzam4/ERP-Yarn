import { useState, type ReactNode } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { FilterBar } from "@/components/shared/FilterBar";
import { BidiValue } from "@/components/shared/BidiValue";
import { formatNumber } from "@/lib/utils";

/**
 * ManagementListScreen — shared template for management list pages.
 * Composes PageHeader + optional KPI strip + FilterBar + content.
 */
export interface ManagementListScreenProps {
  title: string;
  description?: string;
  /** Optional KPI strip cards. */
  kpis?: { label: string; value: ReactNode; tone?: string }[];
  /** Optional filter bar (search input + custom children). */
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  filterChildren?: ReactNode;
  children: ReactNode;
  /** Total row count for the footer. */
  totalLabel?: string;
  total?: number;
}

export function ManagementListScreen({
  title,
  description,
  kpis,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  filterChildren,
  children,
  totalLabel,
  total,
}: ManagementListScreenProps) {
  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {kpis && kpis.length > 0 ? (
        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((kpi, i) => (
            <Card key={i}>
              <CardContent className="space-y-1 p-4">
                <p className="text-xs text-muted-foreground">{kpi.label}</p>
                <p className="font-heading text-xl font-bold text-foreground">
                  {typeof kpi.value === "string" || typeof kpi.value === "number" ? (
                    <BidiValue numeric>{formatNumber(Number(kpi.value))}</BidiValue>
                  ) : (
                    kpi.value
                  )}
                </p>
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}

      {onSearchChange || filterChildren ? (
        <FilterBar
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          searchPlaceholder={searchPlaceholder}
        >
          {filterChildren}
        </FilterBar>
      ) : null}

      {children}

      {totalLabel && total !== undefined ? (
        <p className="text-xs text-muted-foreground">
          {totalLabel}: <BidiValue numeric>{formatNumber(total)}</BidiValue>
        </p>
      ) : null}
    </div>
  );
}

/** Convenience hook for a search + filter state. */
export function useSearchFilter<T>(items: T[], predicate: (item: T, q: string) => boolean) {
  const [query, setQuery] = useState("");
  const filtered = query.trim() === "" ? items : items.filter((i) => predicate(i, query));
  return { query, setQuery, filtered };
}
