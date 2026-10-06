export type ObservationState = "created" | "accepted" | "executing" | "result" | "failure" | "timeout";

export type ObservationRequestRecord = {
  readonly requestId: string;
  readonly sessionId: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly createdAt: string;
  state: ObservationState;
  readonly lifecycle: ObservationState[];
  completedAt?: string;
  durationMs?: number;
  evidence?: Record<string, unknown>;
  observation?: Record<string, unknown>;
  failure?: { code: string; message: string };
};

export interface ObservationStore {
  save(record: ObservationRequestRecord): void;
  get(requestId: string): ObservationRequestRecord | undefined;
  listForSession(sessionId: string): readonly ObservationRequestRecord[];
}

export class InMemoryObservationStore implements ObservationStore {
  private readonly records = new Map<string, ObservationRequestRecord>();
  public save(record: ObservationRequestRecord): void { this.records.set(record.requestId, record); }
  public get(requestId: string): ObservationRequestRecord | undefined { return this.records.get(requestId); }
  public listForSession(sessionId: string): readonly ObservationRequestRecord[] {
    return [...this.records.values()].filter(record => record.sessionId === sessionId);
  }
}

export function sanitizeObservation(record: ObservationRequestRecord): Record<string, unknown> {
  const evidence = record.evidence;
  return {
    requestId: record.requestId,
    sessionId: record.sessionId,
    capabilityId: record.capabilityId,
    capabilityVersion: record.capabilityVersion,
    createdAt: record.createdAt,
    state: record.state,
    lifecycle: record.lifecycle,
    ...(record.completedAt ? { completedAt: record.completedAt } : {}),
    ...(record.durationMs === undefined ? {} : { durationMs: record.durationMs }),
    ...(evidence ? { evidence: {
      evidenceId: evidence.evidenceId,
      capabilityId: evidence.capabilityId,
      capabilityVersion: evidence.capabilityVersion,
      collectedAt: evidence.collectedAt,
      source: evidence.source,
      dataHandlingState: evidence.dataHandlingState,
      payloadSize: Buffer.byteLength(JSON.stringify(evidence.payload), "utf8"),
    } } : {}),
    ...(record.observation ? { observation: record.observation } : {}),
    ...(record.failure ? { failure: record.failure } : {}),
  };
}
