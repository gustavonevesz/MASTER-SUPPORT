import type { SessionStore } from "../session/store.js";
import { terminalObservationStates, type ObservationRequestRecord } from "./store.js";
export type ReconciliationDecision = Readonly<{ decision: "accept" | "reject" | "late" | "duplicate"; reason: string }>;
export type ReconciliationEnvelope = { messageId?: unknown; messageType?: unknown; sessionId?: unknown; correlationId?: unknown; payload?: unknown };
export class ObservationReconciler {
  public constructor(private readonly sessions: SessionStore) {}
  public reconcile(record: ObservationRequestRecord | undefined, raw: ReconciliationEnvelope, now: Date): ReconciliationDecision {
    if (!record) return { decision: "reject", reason: "unknown_request" };
    const payload = raw.payload as Record<string, unknown> | undefined;
    if (raw.sessionId !== record.sessionId) return { decision: "reject", reason: "session_mismatch" };
    if (raw.correlationId !== record.requestId || payload?.requestId !== record.requestId) return { decision: "reject", reason: "correlation_mismatch" };
    if (terminalObservationStates.has(record.state)) {
      if (raw.messageId === record.outcomeMessageId) return { decision: "duplicate", reason: "outcome_already_reconciled" };
      if (record.state === "cancelled" && raw.messageType === "observation.cancelled")
        return { decision: "duplicate", reason: "cancellation_acknowledged" };
      return { decision: "late", reason: `request_already_${record.state}` };
    }
    const session = this.sessions.get(record.sessionId);
    if (!session || session.state !== "active") return { decision: "late", reason: `session_${session?.state ?? "missing"}` };
    if (now.getTime() > new Date(record.deadline).getTime()) return { decision: "late", reason: "deadline_exceeded" };
    if (raw.messageType === "observation.result") {
      const evidence = payload?.evidence as Record<string, unknown> | undefined;
      if (evidence?.capabilityId !== record.capabilityId || evidence.capabilityVersion !== record.capabilityVersion)
        return { decision: "reject", reason: "capability_mismatch" };
    }
    return { decision: "accept", reason: "valid_active_outcome" };
  }
}
