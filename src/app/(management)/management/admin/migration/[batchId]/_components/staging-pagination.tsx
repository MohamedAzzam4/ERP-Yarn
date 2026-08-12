"use client";

/**
 * WP-08-01F UX milestone — Staging preview pagination controls.
 *
 * Renders prev/next + "page X of Y" controls that navigate via plain <a>
 * links to the same page URL with `?stagingPage=N` preserved alongside
 * any other existing query params (validation filters, etc.).
 *
 * Preserves filters by accepting the current pathname + a list of
 * additional query params that must be carried through. Server-side
 * pagination is enforced by the query service; this component only
 * renders controls for the page metadata it is given.
 */
import * as React from "react";
import { LtrValue } from "@/components/ui/ltr-value";

interface StagingPaginationProps {
  /** Current page (1-indexed). */
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  /** Current pathname (for building links). */
  pathname: string;
  /** Query params to preserve across pagination (e.g. validation filters). */
  preserveParams: Record<string, string | undefined>;
}

/**
 * Build a URL for a given staging page, preserving all other query params.
 */
function buildPageUrl(
  pathname: string,
  preserveParams: Record<string, string | undefined>,
  page: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(preserveParams)) {
    if (value !== undefined && value !== "") {
      params.set(key, value);
    }
  }
  if (page > 1) {
    params.set("stagingPage", String(page));
  } else {
    params.delete("stagingPage");
  }
  const qs = params.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function StagingPagination({
  page,
  pageSize,
  totalRows,
  totalPages,
  hasNextPage,
  hasPrevPage,
  pathname,
  preserveParams,
}: StagingPaginationProps) {
  if (totalRows === 0) return null;

  const startRow = (page - 1) * pageSize + 1;
  const endRow = Math.min(page * pageSize, totalRows);

  return (
    <nav
      aria-label="ترقيم صفوف المعاينة"
      className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t text-sm"
    >
      <div className="text-xs text-muted-foreground">
        عرض <LtrValue>{startRow}</LtrValue>–<LtrValue>{endRow}</LtrValue> من{" "}
        <LtrValue>{totalRows}</LtrValue> صف — صفحة <LtrValue>{page}</LtrValue> من{" "}
        <LtrValue>{totalPages}</LtrValue>
      </div>
      <div className="flex items-center gap-2">
        {hasPrevPage ? (
          <a
            href={buildPageUrl(pathname, preserveParams, page - 1)}
            className="px-3 py-2 border rounded text-sm hover:bg-muted inline-flex items-center gap-1"
            style={{ minHeight: "44px" }}
            aria-label="الصفحة السابقة"
            rel="prev"
          >
            <span aria-hidden="true">→</span> السابق
          </a>
        ) : (
          <span
            className="px-3 py-2 border rounded text-sm opacity-50 cursor-not-allowed inline-flex items-center gap-1"
            style={{ minHeight: "44px" }}
            aria-disabled="true"
          >
            <span aria-hidden="true">→</span> السابق
          </span>
        )}
        {hasNextPage ? (
          <a
            href={buildPageUrl(pathname, preserveParams, page + 1)}
            className="px-3 py-2 border rounded text-sm hover:bg-muted inline-flex items-center gap-1"
            style={{ minHeight: "44px" }}
            aria-label="الصفحة التالية"
            rel="next"
          >
            التالي <span aria-hidden="true">←</span>
          </a>
        ) : (
          <span
            className="px-3 py-2 border rounded text-sm opacity-50 cursor-not-allowed inline-flex items-center gap-1"
            style={{ minHeight: "44px" }}
            aria-disabled="true"
          >
            التالي <span aria-hidden="true">←</span>
          </span>
        )}
      </div>
    </nav>
  );
}
