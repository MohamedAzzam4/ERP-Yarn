/**
 * WP-08-01F MILESTONE B — Protected source-file download route.
 *
 * Contract 08 §8.1: "Source-file access uses private storage and server
 * authorization or short-lived signed URLs."
 *
 * Security:
 *   - Authenticated (Owner/Accountant only)
 *   - migration.prepare permission required
 *   - Tenant/batch/file ownership verified server-side
 *   - No permanent public URL
 *   - No signed URL persisted or logged
 *   - Streams file content through the protected route
 */
import { NextRequest, NextResponse } from "next/server";
import { redirect } from "next/navigation";
import { getErpAuthContextWithRoles } from "@/server/auth/erp-context";
import { resolveAndRequirePermission } from "@/server/security/guards";
import { TEST_ROLE_PERMISSION_MATRIX } from "@/server/security/role-fixtures";
import { db } from "@/server/db/client";
import { eq, and } from "drizzle-orm";
import { importFiles, importBatches } from "@/server/db/schema";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string; fileId: string }> },
) {
  // Authenticate
  const authResult = await getErpAuthContextWithRoles();
  if (!authResult?.authenticated) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  if (authResult.roles.length === 0) {
    return new NextResponse("No role assigned", { status: 403 });
  }

  // Require migration.prepare permission (Owner/Accountant only)
  try {
    resolveAndRequirePermission(authResult.roles, TEST_ROLE_PERMISSION_MATRIX, "migration.prepare");
  } catch {
    return new NextResponse("Permission denied", { status: 403 });
  }

  const { batchId, fileId } = await params;

  if (!db) {
    return new NextResponse("Database not available", { status: 503 });
  }

  // Verify tenant/batch/file ownership
  const [file] = await db
    .select()
    .from(importFiles)
    .where(
      and(
        eq(importFiles.id, fileId),
        eq(importFiles.importBatchId, batchId),
        eq(importFiles.tenantId, authResult.tenantId),
      ),
    )
    .limit(1);

  if (!file) {
    return new NextResponse("File not found", { status: 404 });
  }

  // Read file from private storage
  const { getPrivateFileStorage } = await import("@/server/services/private-file-storage");
  let storage;
  try {
    storage = getPrivateFileStorage();
  } catch {
    return new NextResponse("Storage not configured", { status: 503 });
  }

  const content = await storage.read(file.storagePath);
  if (!content) {
    return new NextResponse("File content not found in storage", { status: 404 });
  }

  // Stream the file content (no signed URL, no public URL)
  return new NextResponse(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": file.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${file.originalFileName}"`,
      "Content-Length": String(content.length),
      "Cache-Control": "no-store",
    },
  });
}
