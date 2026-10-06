import { randomUUID } from "node:crypto";
import type { Clock } from "../session/clock.js";
import type { SessionStore } from "../session/store.js";
import { logEvent } from "../logger.js";
import type { ActiveConnectionRegistry } from "../realtime/connection-registry.js";
import type { ObservationRequestRecord, ObservationStore } from "./store.js";

export const runtimeSummaryCapability = Object.freeze({ id: "system.runtime.summary", version: "1.0" });

type Pending = { resolve(record: ObservationRequestRecord): void; timer: NodeJS.Timeout };
type ObservationEnvelope = { sessionId?: unknown; correlationId?: unknown; payload?: unknown };

export class ObservationService {
  private readonly pending = new Map<string, Pending>();
  public constructor(
    private readonly sessions: SessionStore,
    private readonly connections: ActiveConnectionRegistry,
    private readonly store: ObservationStore,
    private readonly clock: Clock,
    private readonly timeoutMs = 5_000,
    private readonly maxPayloadBytes = 16 * 1024,
  ) {}

  public request(sessionId: string, capabilityId: string): Promise<ObservationRequestRecord> {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "active") throw new Error("session_not_active");
    const capability = session.capabilities.find(item => item.id === capabilityId);
    if (!capability) throw new Error("capability_not_negotiated");
    const requestId = randomUUID();
    const createdAt = this.clock.now();
    const record: ObservationRequestRecord = {
      requestId, sessionId, capabilityId, capabilityVersion: capability.version,
      createdAt: createdAt.toISOString(), state: "created", lifecycle: ["created"],
    };
    this.store.save(record);
    const message = {
      protocolVersion: "1.0", messageId: randomUUID(), messageType: "observation.request", sessionId,
      correlationId: requestId, timestamp: createdAt.toISOString(),
      payload: { requestId, capabilityId, capabilityVersion: capability.version, timeoutMs: this.timeoutMs, maxPayloadBytes: this.maxPayloadBytes },
    };
    if (!this.connections.send(sessionId, message)) {
      this.fail(record, "failure", "connection_unavailable", "Agent connection is unavailable.");
      return Promise.resolve(record);
    }
    logEvent("info", "observation_requested", { sessionId, requestId, capabilityId, status: "created" });
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(requestId)) return;
        this.fail(record, "timeout", "timeout", "Observation timed out.");
        resolve(record);
      }, this.timeoutMs + 250);
      timer.unref();
      this.pending.set(requestId, { resolve, timer });
    });
  }

  public handle(messageType: string, raw: ObservationEnvelope): void {
    const payload = raw.payload as Record<string, unknown>;
    const requestId = String(payload.requestId ?? "");
    const record = this.store.get(requestId);
    if (!record || raw.sessionId !== record.sessionId || raw.correlationId !== requestId) return;
    if (messageType === "observation.accepted") {
      if (record.state !== "created") return;
      this.transition(record, "accepted");
      this.transition(record, "executing");
      logEvent("info", "observation_accepted", { sessionId: record.sessionId, requestId, capabilityId: record.capabilityId, status: "executing" });
      return;
    }
    if (record.state === "result" || record.state === "failure" || record.state === "timeout") return;
    if (messageType === "observation.result") {
      const serializedPayload = JSON.stringify(payload);
      if (Buffer.byteLength(serializedPayload, "utf8") > this.maxPayloadBytes) {
        this.fail(record, "failure", "payload_too_large", "Observation result exceeds the payload limit.");
      } else {
        record.evidence = payload.evidence as Record<string, unknown>;
        record.observation = payload.observation as Record<string, unknown>;
        this.transition(record, "result");
        this.complete(record);
      }
    } else if (messageType === "observation.failed") {
      this.fail(record, "failure", String(payload.code), String(payload.message));
    }
    const pending = this.pending.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.resolve(record);
    }
  }

  private fail(record: ObservationRequestRecord, state: "failure" | "timeout", code: string, message: string): void {
    record.failure = { code, message };
    this.transition(record, state);
    this.complete(record);
  }

  private transition(record: ObservationRequestRecord, state: ObservationRequestRecord["state"]): void {
    record.state = state;
    record.lifecycle.push(state);
  }

  private complete(record: ObservationRequestRecord): void {
    record.completedAt = this.clock.now().toISOString();
    record.durationMs = Math.max(0, this.clock.now().getTime() - new Date(record.createdAt).getTime());
    const evidenceId = typeof record.evidence?.evidenceId === "string" ? record.evidence.evidenceId : undefined;
    const observationId = typeof record.observation?.observationId === "string" ? record.observation.observationId : undefined;
    const payloadSize = record.evidence ? Buffer.byteLength(JSON.stringify(record.evidence.payload), "utf8") : undefined;
    logEvent(record.state === "result" ? "info" : "error", "observation_completed", {
      sessionId: record.sessionId, requestId: record.requestId, capabilityId: record.capabilityId,
      status: record.state, durationMs: record.durationMs,
      ...(evidenceId ? { evidenceId } : {}),
      ...(observationId ? { observationId } : {}),
      ...(payloadSize === undefined ? {} : { payloadSize }),
    });
  }
}
