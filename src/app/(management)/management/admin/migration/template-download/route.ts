/**
 * WP-08-01F MILESTONE B — Template download route handler.
 *
 * Returns a real downloadable CSV response with:
 *   - Correct Content-Type (text/csv; charset=utf-8)
 *   - Content-Disposition: attachment
 *   - UTF-8 BOM for Arabic Excel compatibility
 *   - Authenticated access (Owner/Accountant only)
 *   - No tenant data included
 *   - No unauthenticated access
 */
import { NextRequest, NextResponse } from "next/server";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { loadRolePermissionMatrixForTenant } from "@/server/security/permission-loader";
import { findTemplate, generateTemplateCsv } from "@/server/services/migration-templates";

export async function GET(request: NextRequest) {
  // Authenticate
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult?.authenticated) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (authResult.roles.length === 0) {
    return new NextResponse("No role assigned", { status: 403 });
  }

  // Require migration.prepare permission using DB-backed matrix
  try {
    const matrix = await loadRolePermissionMatrixForTenant(authResult.tenantId);
    resolveAndRequirePermission(authResult.roles, matrix, "migration.prepare");
  } catch {
    return new NextResponse("Permission denied", { status: 403 });
  }

  // Get template type and version from query params
  const templateType = request.nextUrl.searchParams.get("templateType");
  const templateVersion = request.nextUrl.searchParams.get("templateVersion");

  if (!templateType || !templateVersion) {
    return new NextResponse("Missing templateType or templateVersion", { status: 400 });
  }

  const template = findTemplate(templateType, templateVersion);
  if (!template) {
    return new NextResponse(`Template '${templateType}' version '${templateVersion}' not found`, { status: 404 });
  }

  // Generate CSV with UTF-8 BOM for Arabic Excel compatibility
  const csv = generateTemplateCsv(template);
  const bom = "\uFEFF"; // UTF-8 BOM
  const csvWithBom = bom + csv;

  const filename = `${templateType}_v${templateVersion}.csv`;

  return new NextResponse(csvWithBom, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
