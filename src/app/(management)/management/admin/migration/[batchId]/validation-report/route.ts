/**
 * WP-08-01F UX milestone — Validation-error CSV report route.
 *
 * Contract 08 §9 + §11.7 + Design System §"CSV export safety".
 *
 * Returns a downloadable CSV of validation findings for a batch:
 *   - Authenticated (Owner/Accountant only — migration.review permission)
 *   - Tenant/batch scoped — server-side filter on tenantId + batchId
 *   - Filters honored: severity, fileId, sheet, errorCode, q (free-text)
 *   - UTF-8 BOM for Arabic Excel compatibility
 *   - Formula-injection neutralization AFTER trimming leading
 *     whitespace/control characters (protects against =, +, -, @, tab, CR, LF)
 *   - Cache-Control: no-store
 *
 * Contract 08 §11.7: "Request bodies cannot claim role, actor, tenant, or
 *   calculated approval eligibility." — all authorization is server-side.
 */
import { NextRequest, NextResponse } from "next/server";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { db } from "@/server/db/client";
import { MigrationScreenQueryService } from "@/server/services/migration-screen-query-service";
import type { MigrationValidationFindingDto } from "@/server/services/migration-screen-query-service";
import { csvEscape } from "@/server/services/migration-csv-export";

// Re-export for backwards compatibility / direct test imports.
export { neutralizeFormulaInjection } from "@/server/services/migration-csv-export";

/**
 * Apply user-supplied filters to the findings list.
 * Filter parameters come from the URL query string and are validated here.
 *
 * - severity: blocking_error | review_required_warning | informational
 * - fileId: file ID (exact match)
 * - sheet: sheet name (exact match)
 * - errorCode: error code (exact match)
 * - q: free-text case-insensitive substring on message, errorCode, submittedValue
 */
function applyFilters(
  findings: MigrationValidationFindingDto[],
  filters: {
    severity?: string | null;
    fileId?: string | null;
    sheet?: string | null;
    errorCode?: string | null;
    q?: string | null;
  },
): MigrationValidationFindingDto[] {
  let result = findings;
  if (filters.severity) {
    result = result.filter((f) => f.severity === filters.severity);
  }
  if (filters.fileId) {
    result = result.filter((f) => f.fileId === filters.fileId);
  }
  if (filters.sheet) {
    result = result.filter((f) => f.sourceSheetName === filters.sheet);
  }
  if (filters.errorCode) {
    result = result.filter((f) => f.errorCode === filters.errorCode);
  }
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    result = result.filter((f) => {
      const hay = [
        f.message ?? "",
        f.errorCode ?? "",
        f.submittedValue ?? "",
        f.fileName ?? "",
      ].join(" ").toLowerCase();
      return hay.includes(needle);
    });
  }
  return result;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> },
) {
  // Authenticate
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult?.authenticated) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (authResult.roles.length === 0) {
    return new NextResponse("No role assigned", { status: 403 });
  }

  // Require migration.review permission using DB-backed matrix (Owner/Accountant only — workers denied).
  try {
    const matrix = await loadRolePermissionMatrixForTenant(authResult.tenantId);
    resolveAndRequirePermission(authResult.roles, matrix, "migration.review");
  } catch {
    return new NextResponse("Permission denied", { status: 403 });
  }

  const { batchId } = await params;

  if (!db) {
    return new NextResponse("Database not available", { status: 503 });
  }

  // Pull findings with cell-level lineage from the query service.
  // The service is tenant-scoped — it filters by tenantId internally.
  const queryService = new MigrationScreenQueryService(db);
  const allFindings = await queryService.listValidationFindings(authResult.tenantId, batchId);

  // Apply filters from the query string (default: export ALL findings).
  const sp = request.nextUrl.searchParams;
  const filtered = applyFilters(allFindings, {
    severity: sp.get("severity"),
    fileId: sp.get("fileId"),
    sheet: sp.get("sheet"),
    errorCode: sp.get("errorCode"),
    q: sp.get("q"),
  });

  // Build CSV. Columns are deterministic and documented for downstream tooling.
  // The "all vs filtered" choice is encoded in the filename so the user knows
  // exactly what they downloaded.
  const headers = [
    "severity",
    "error_code",
    "message",
    "file_name",
    "sheet",
    "row",
    "column",
    "submitted_value",
    "normalized_value",
    "is_blocking",
    "resolution_status",
  ];

  const lines = [headers.join(",")];
  for (const f of filtered) {
    lines.push([
      f.severity,
      f.errorCode,
      f.message ?? "",
      f.fileName ?? "",
      f.sourceSheetName ?? "",
      f.sourceRowNumber?.toString() ?? "",
      f.columnName ?? "",
      f.submittedValue ?? "",
      f.normalizedValue ?? "",
      f.isBlocking ? "true" : "false",
      f.resolutionStatus,
    ].map(csvEscape).join(","));
  }
  const csv = lines.join("\n") + "\n";

  // Prepend UTF-8 BOM for Arabic Excel compatibility (same as template-download).
  const bom = "\uFEFF";
  const csvWithBom = bom + csv;

  // Filename communicates the filter scope.
  const isFiltered = (sp.get("severity") || sp.get("fileId") || sp.get("sheet") || sp.get("errorCode") || sp.get("q"));
  const filename = isFiltered
    ? `migration-batch-${batchId}-validation-errors-filtered.csv`
    : `migration-batch-${batchId}-validation-errors-all.csv`;

  return new NextResponse(csvWithBom, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
