export type ObservationState = "created" | "accepted" | "executing" | "completed" | "failed" | "timed_out" | "cancelled" | "abandoned";
export const terminalObservationStates = new Set<ObservationState>(["completed", "failed", "timed_out", "cancelled", "abandoned"]);

export type LateOutcomeMetadata = { readonly messageType: string; readonly receivedAt: string; readonly decision: "late" | "duplicate" | "reject"; readonly reason: string };
export type ObservationRequestRecord = {
  readonly requestId: string; readonly sessionId: string; readonly agentInstanceId: string;
  readonly capabilityId: string; readonly capabilityVersion: string; readonly createdAt: string; readonly deadline: string;
  state: ObservationState; readonly lifecycle: ObservationState[]; completedAt?: string; durationMs?: number;
  outcomeUnknown?: boolean; outcomeMessageId?: string; evidence?: Record<string, unknown>; observation?: Record<string, unknown>;
  failure?: { code: string; message: string }; readonly lateOutcomes: LateOutcomeMetadata[];
};
export interface ObservationStore {
  save(record: ObservationRequestRecord): void; get(requestId: string): ObservationRequestRecord | undefined;
  list(): readonly ObservationRequestRecord[]; listForSession(sessionId: string): readonly ObservationRequestRecord[];
}
export class InMemoryObservationStore implements ObservationStore {
  private readonly records = new Map<string, ObservationRequestRecord>();
  public save(record: ObservationRequestRecord): void { this.records.set(record.requestId, record); }
  public get(id: string): ObservationRequestRecord | undefined { return this.records.get(id); }
  public list(): readonly ObservationRequestRecord[] { return [...this.records.values()]; }
  public listForSession(id: string): readonly ObservationRequestRecord[] { return this.list().filter(record => record.sessionId === id); }
}
export function sanitizeObservation(record: ObservationRequestRecord): Record<string, unknown> {
  const evidence = record.evidence;
  return {
    requestId: record.requestId, sessionId: record.sessionId, capabilityId: record.capabilityId,
    capabilityVersion: record.capabilityVersion, createdAt: record.createdAt, deadline: record.deadline,
    state: record.state, lifecycle: record.lifecycle, outcomeUnknown: record.outcomeUnknown ?? false,
    lateOutcomeCount: record.lateOutcomes.length,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
    ...(evidence ? { evidence: { evidenceId: evidence.evidenceId, capabilityId: evidence.capabilityId,
      capabilityVersion: evidence.capabilityVersion, collectedAt: evidence.collectedAt, source: evidence.source,
      dataHandlingState: evidence.dataHandlingState, payloadSize: Buffer.byteLength(JSON.stringify(evidence.payload), "utf8") } } : {}),
    ...(record.observation ? { observation: record.observation } : {}), ...(record.failure ? { failure: record.failure } : {}),
  };
}
