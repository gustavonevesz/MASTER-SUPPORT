import type { OperationalAuditEvent } from "../observation/audit.js";
import type { ObservationRequestRecord } from "../observation/store.js";
import type { Session } from "../session/session.js";
import type { PreflightRun } from "../preflight/models.js";

export interface DurablePersistence {
  readonly serverInstanceId: string;
  readonly connected: boolean;
  persistSessionCreated(session: Session): Promise<void>;
  persistSessionState(session: Session, endReason?: string): Promise<void>;
  persistObservationBeforeDispatch(record: ObservationRequestRecord): Promise<void>;
  persistObservation(record: ObservationRequestRecord, event?: OperationalAuditEvent): Promise<void>;
  appendAudit(event: OperationalAuditEvent): Promise<void>;
  sessionHistory(sessionId: string): Promise<Record<string, unknown> | undefined>;
  observationHistory(requestId: string): Promise<Record<string, unknown> | undefined>;
  persistPreflightStarted(run: PreflightRun): Promise<void>;
  persistPreflightFinished(run: PreflightRun): Promise<void>;
  preflightHistory(preflightRunId: string): Promise<Record<string, unknown> | undefined>;
  listPreflightHistory(sessionId: string): Promise<readonly Record<string, unknown>[]>;
  reconcileRestart(): Promise<{ sessions: number; observations: number }>;
  finish(): Promise<void>;
}
