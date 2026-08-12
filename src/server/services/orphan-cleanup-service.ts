/**
 * WP-08-01F MILESTONE B4 — Orphan cleanup service.
 *
 * When object storage compensation fails (deleteIfOrphaned throws),
 * a durable DB-backed operational alert is created so the orphaned
 * object can be retried later. This is NOT just a console log —
 * it's a persistent record in the operational_alerts table.
 *
 * The retry command is idempotent and tenant-scoped.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { operationalAlerts } from "@/server/db/schema/operational-alerts";
import type { db as DbType } from "@/server/db/client";

type Db = NonNullable<typeof DbType>;

export interface OrphanCleanupRecord {
  alertId: string;
  tenantId: string;
  batchId: string;
  storagePath: string;
  correlationId: string;
  failureReason: string;
  state: string;
  attemptCount: number;
  createdAt: Date;
  updatedAt: Date | null;
}

/**
 * Create a durable orphan-cleanup alert in the operational_alerts table.
 * This persists the orphaned object metadata so it can be retried.
 */
export async function createOrphanCleanupAlert(
  db: Db,
  tenantId: string,
  batchId: string,
  storagePath: string,
  correlationId: string,
  failureReason: string,
): Promise<OrphanCleanupRecord> {
  const [alert] = await db.insert(operationalAlerts).values({
    tenantId,
    severity: "critical" as any,
    alertType: "orphaned_storage_object",
    sourceEntityType: "import_batch",
    sourceEntityId: batchId as any,
    messageKey: "ORPHAN_CLEANUP_FAILED",
    messageDetails: {
      storagePath,
      correlationId,
      failureReason,
      batchId,
      attemptCount: 0,
      retryStatus: "pending_cleanup",
    },
    state: "open" as any,
  }).returning();

  return {
    alertId: alert!.id,
    tenantId: alert!.tenantId,
    batchId,
    storagePath,
    correlationId,
    failureReason,
    state: alert!.state,
    attemptCount: 0,
    createdAt: alert!.detectedAt,
    updatedAt: alert!.updatedAt,
  };
}

/**
 * Find pending orphan-cleanup alerts for a tenant.
 */
export async function findPendingOrphanCleanupAlerts(
  db: Db,
  tenantId: string,
): Promise<OrphanCleanupRecord[]> {
  const alerts = await db
    .select()
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.tenantId, tenantId),
        eq(operationalAlerts.alertType, "orphaned_storage_object"),
        eq(operationalAlerts.state, "open"),
      ),
    );

  return alerts.map((a) => {
    const details = a.messageDetails as Record<string, unknown>;
    return {
      alertId: a.id,
      tenantId: a.tenantId,
      batchId: String(details?.batchId ?? ""),
      storagePath: String(details?.storagePath ?? ""),
      correlationId: String(details?.correlationId ?? ""),
      failureReason: String(details?.failureReason ?? ""),
      state: a.state,
      attemptCount: Number(details?.attemptCount ?? 0),
      createdAt: a.detectedAt,
      updatedAt: a.updatedAt,
    };
  });
}

/**
 * Retry orphan cleanup for a specific alert.
 * Idempotent: if the object is already deleted, marks as resolved.
 * Cross-tenant: verifies the alert belongs to the specified tenant.
 *
 * Returns the new state: "resolved" or "retry_failed".
 */
export async function retryOrphanCleanup(
  db: Db,
  tenantId: string,
  alertId: string,
  storage: { deleteIfOrphaned: (path: string) => Promise<void>; exists: (path: string) => Promise<boolean> },
): Promise<{ state: "resolved" | "retry_failed"; attemptCount: number }> {
  // Find the alert (tenant-scoped)
  const [alert] = await db
    .select()
    .from(operationalAlerts)
    .where(
      and(
        eq(operationalAlerts.id, alertId),
        eq(operationalAlerts.tenantId, tenantId),
        eq(operationalAlerts.alertType, "orphaned_storage_object"),
      ),
    )
    .limit(1);

  if (!alert) {
    throw new Error(`Orphan cleanup alert '${alertId}' not found for tenant '${tenantId}'.`);
  }

  const details = alert.messageDetails as Record<string, unknown>;
  const storagePath = String(details?.storagePath ?? "");
  const currentAttemptCount = Number(details?.attemptCount ?? 0);
  const newAttemptCount = currentAttemptCount + 1;

  try {
    // Check if object still exists
    const stillExists = await storage.exists(storagePath);
    if (!stillExists) {
      // Already cleaned — mark as resolved
      await db
        .update(operationalAlerts)
        .set({
          state: "resolved" as any,
          resolvedAt: new Date(),
          resolutionReason: "Object already deleted",
          messageDetails: { ...details, attemptCount: newAttemptCount, retryStatus: "cleaned" },
          updatedAt: new Date(),
        })
        .where(eq(operationalAlerts.id, alertId));
      return { state: "resolved", attemptCount: newAttemptCount };
    }

    // Attempt deletion
    await storage.deleteIfOrphaned(storagePath);

    // Verify deletion succeeded
    const stillThere = await storage.exists(storagePath);
    if (stillThere) {
      throw new Error("Object still exists after deleteIfOrphaned");
    }

    // Success — mark as resolved
    await db
      .update(operationalAlerts)
      .set({
        state: "resolved" as any,
        resolvedAt: new Date(),
        resolutionReason: "Object deleted successfully",
        messageDetails: { ...details, attemptCount: newAttemptCount, retryStatus: "cleaned" },
        updatedAt: new Date(),
      })
      .where(eq(operationalAlerts.id, alertId));
    return { state: "resolved", attemptCount: newAttemptCount };
  } catch (e) {
    // Retry failed — update attempt count and keep open
    await db
      .update(operationalAlerts)
      .set({
        messageDetails: {
          ...details,
          attemptCount: newAttemptCount,
          retryStatus: "retry_failed",
          lastRetryError: (e as Error).message,
          lastRetryAt: new Date().toISOString(),
        },
        updatedAt: new Date(),
      })
      .where(eq(operationalAlerts.id, alertId));
    return { state: "retry_failed", attemptCount: newAttemptCount };
  }
}
