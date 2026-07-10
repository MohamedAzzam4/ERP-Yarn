/**
 * Drizzle-backed OperationalAlertRepository — the production DB repository.
 *
 * Contract: docs/contracts/03_database_schema_contract.md §7.9
 *   operational_alerts table.
 *
 * WP-03-04 scope: alert creation + reads only.
 */
import "server-only";
import { eq, and } from "drizzle-orm";
import { operationalAlerts } from "@/server/db/schema";
import type { db as DbType } from "@/server/db/client";
import type {
  OperationalAlertRepository,
  NewOperationalAlertInput,
} from "./operational-alert-repository";
import type { OperationalAlert } from "@/server/db/schema/operational-alerts";

type Db = NonNullable<typeof DbType>;

export class OperationalAlertDbRepository implements OperationalAlertRepository {
  constructor(private readonly db: Db) {}

  async insertAlert(row: NewOperationalAlertInput): Promise<OperationalAlert> {
    const [result] = await this.db
      .insert(operationalAlerts)
      .values({
        tenantId: row.tenantId,
        severity: row.severity,
        alertType: row.alertType,
        sourceEntityType: row.sourceEntityType,
        sourceEntityId: row.sourceEntityId,
        messageKey: row.messageKey,
        messageDetails: row.messageDetails,
        detectedBy: row.detectedBy,
      })
      .returning();
    return result!;
  }

  async findAlertsForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<OperationalAlert[]> {
    const results = await this.db
      .select()
      .from(operationalAlerts)
      .where(
        and(
          eq(operationalAlerts.tenantId, tenantId),
          eq(operationalAlerts.sourceEntityType, sourceEntityType),
          eq(operationalAlerts.sourceEntityId, sourceEntityId),
        ),
      );
    return results;
  }

  async findAlertById(tenantId: string, id: string): Promise<OperationalAlert | null> {
    const [result] = await this.db
      .select()
      .from(operationalAlerts)
      .where(
        and(
          eq(operationalAlerts.tenantId, tenantId),
          eq(operationalAlerts.id, id),
        ),
      )
      .limit(1);
    return result ?? null;
  }

  async findCriticalAlertForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
    alertType: string,
  ): Promise<OperationalAlert | null> {
    const [result] = await this.db
      .select()
      .from(operationalAlerts)
      .where(
        and(
          eq(operationalAlerts.tenantId, tenantId),
          eq(operationalAlerts.sourceEntityType, sourceEntityType),
          eq(operationalAlerts.sourceEntityId, sourceEntityId),
          eq(operationalAlerts.alertType, alertType),
          eq(operationalAlerts.severity, "critical"),
          eq(operationalAlerts.state, "open"),
        ),
      )
      .limit(1);
    return result ?? null;
  }
}

export function createOperationalAlertDbRepository(db: Db): OperationalAlertDbRepository {
  return new OperationalAlertDbRepository(db);
}
