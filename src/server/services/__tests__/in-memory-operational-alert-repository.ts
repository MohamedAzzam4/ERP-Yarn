/**
 * In-memory OperationalAlertRepository for unit tests.
 * TEST-ONLY helper. NOT for production use.
 */
import type { OperationalAlert } from "@/server/db/schema/operational-alerts";
import type {
  OperationalAlertRepository,
  NewOperationalAlertInput,
} from "../operational-alert-repository";

const NOW = () => new Date("2026-07-01T00:00:00Z");
const nid = (p: string, n: number) => `${p}-${n.toString().padStart(6, "0")}`;

export class InMemoryOperationalAlertRepository implements OperationalAlertRepository {
  private alerts = new Map<string, OperationalAlert>();
  private counter = 0;

  /**
   * Snapshot the current state for transactional test rollback.
   * TEST-ONLY.
   */
  snapshot(): {
    alerts: Map<string, OperationalAlert>;
    counter: number;
  } {
    return {
      alerts: new Map([...this.alerts].map(([k, v]) => [k, { ...v }])),
      counter: this.counter,
    };
  }

  /**
   * Restore state from a snapshot. TEST-ONLY.
   */
  restore(snapshot: {
    alerts: Map<string, OperationalAlert>;
    counter: number;
  }): void {
    this.alerts = new Map([...snapshot.alerts].map(([k, v]) => [k, { ...v }]));
    this.counter = snapshot.counter;
  }

  async insertAlert(row: NewOperationalAlertInput): Promise<OperationalAlert> {
    this.counter++;
    const id = nid("alert", this.counter);
    const alert: OperationalAlert = {
      id,
      tenantId: row.tenantId,
      severity: row.severity,
      alertType: row.alertType,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
      messageKey: row.messageKey,
      messageDetails: row.messageDetails,
      state: "open",
      detectedBy: row.detectedBy,
      detectedAt: NOW(),
      resolvedBy: null,
      resolvedAt: null,
      resolutionReason: null,
      auditLogId: null,
      createdBy: null,
      createdAt: NOW(),
      updatedBy: null,
      updatedAt: null,
    };
    this.alerts.set(`${row.tenantId}:${id}`, alert);
    return alert;
  }

  async findAlertsForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
  ): Promise<OperationalAlert[]> {
    return [...this.alerts.values()].filter(
      (a) =>
        a.tenantId === tenantId &&
        a.sourceEntityType === sourceEntityType &&
        a.sourceEntityId === sourceEntityId,
    );
  }

  async findAlertById(tenantId: string, id: string): Promise<OperationalAlert | null> {
    return this.alerts.get(`${tenantId}:${id}`) ?? null;
  }

  async findCriticalAlertForSource(
    tenantId: string,
    sourceEntityType: string,
    sourceEntityId: string,
    alertType: string,
  ): Promise<OperationalAlert | null> {
    for (const a of this.alerts.values()) {
      if (
        a.tenantId === tenantId &&
        a.sourceEntityType === sourceEntityType &&
        a.sourceEntityId === sourceEntityId &&
        a.alertType === alertType &&
        a.severity === "critical" &&
        a.state === "open"
      ) {
        return a;
      }
    }
    return null;
  }
}
