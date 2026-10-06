import { randomUUID } from "node:crypto";
import type { Clock } from "../session/clock.js";
import type { SessionStore } from "../session/store.js";
import { logEvent } from "../logger.js";
import type { ActiveConnectionRegistry } from "../realtime/connection-registry.js";
import { InMemoryAuditStore } from "./audit.js";
import { MetricsRegistry } from "./metrics.js";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";
import { ObservationReconciler, type ReconciliationEnvelope } from "./reconciler.js";
import { terminalObservationStates, type ObservationRequestRecord, type ObservationState, type ObservationStore } from "./store.js";

export const runtimeSummaryCapability = Object.freeze({ id: "system.runtime.summary", version: "1.0" });
export type ObservationOptions = Readonly<{ timeoutMs: number; maxPayloadBytes: number; maxActivePerSession: number;
  maxActivePerAgent: number; maxActivePerCapability: number; rateLimit: number; rateWindowMs: number }>;
type Pending = { promise: Promise<ObservationRequestRecord>; resolve(record: ObservationRequestRecord): void; timer: NodeJS.Timeout };
type ObservationEnvelope = ReconciliationEnvelope & { payload?: unknown };

export class ObservationService {
  private readonly pending = new Map<string, Pending>();
  private readonly reconciler: ObservationReconciler;
  private readonly limiter: SlidingWindowRateLimiter;
  public readonly options: ObservationOptions;
  public constructor(
    private readonly sessions: SessionStore, private readonly connections: ActiveConnectionRegistry,
    private readonly store: ObservationStore, private readonly clock: Clock,
    options: Partial<ObservationOptions> = {}, public readonly metrics = new MetricsRegistry(),
    public readonly audit = new InMemoryAuditStore(),
  ) {
    this.options = { timeoutMs: 5_000, maxPayloadBytes: 16 * 1024, maxActivePerSession: 2, maxActivePerAgent: 2,
      maxActivePerCapability: 1, rateLimit: 5, rateWindowMs: 10_000, ...options };
    this.reconciler = new ObservationReconciler(sessions);
    this.limiter = new SlidingWindowRateLimiter(this.options.rateLimit, this.options.rateWindowMs);
  }

  public start(sessionId: string, capabilityId: string, requestedDeadline?: Date): ObservationRequestRecord {
    const session = this.sessions.get(sessionId);
    if (!session || session.state !== "active") return this.rejectStart("session_not_active");
    const capability = session.capabilities.find(item => item.id === capabilityId);
    if (!capability) return this.rejectStart("capability_not_negotiated");
    const now = this.clock.now();
    const deadline = requestedDeadline ?? new Date(now.getTime() + this.options.timeoutMs);
    if (deadline.getTime() <= now.getTime()) return this.rejectStart("deadline_expired");
    if (!this.limiter.accept(`${sessionId}:${capabilityId}`, now.getTime())) {
      this.metrics.increment("rate_limit_rejections"); return this.rejectStart("rate_limit_exceeded");
    }
    const active = this.store.list().filter(record => !terminalObservationStates.has(record.state));
    if (active.filter(record => record.sessionId === sessionId).length >= this.options.maxActivePerSession ||
        active.filter(record => record.agentInstanceId === session.agentInstanceId).length >= this.options.maxActivePerAgent ||
        active.filter(record => record.sessionId === sessionId && record.capabilityId === capabilityId).length >= this.options.maxActivePerCapability)
      return this.rejectStart("concurrency_limit_exceeded");

    const requestId = randomUUID();
    const record: ObservationRequestRecord = { requestId, sessionId, agentInstanceId: session.agentInstanceId,
      capabilityId, capabilityVersion: capability.version, createdAt: now.toISOString(), deadline: deadline.toISOString(),
      state: "created", lifecycle: ["created"], lateOutcomes: [] };
    this.store.save(record);
    let resolve!: (record: ObservationRequestRecord) => void;
    const promise = new Promise<ObservationRequestRecord>(done => { resolve = done; });
    const delay = Math.max(1, deadline.getTime() - now.getTime());
    const timer = setTimeout(() => this.timeout(requestId), delay); timer.unref();
    this.pending.set(requestId, { promise, resolve, timer });
    const message = { protocolVersion: "1.0", messageId: randomUUID(), messageType: "observation.request", sessionId,
      correlationId: requestId, timestamp: now.toISOString(), payload: { requestId, capabilityId,
        capabilityVersion: capability.version, timeoutMs: this.options.timeoutMs, maxPayloadBytes: this.options.maxPayloadBytes,
        deadline: deadline.toISOString() } };
    try {
      if (!this.connections.send(sessionId, message)) { this.fail(record, "connection_unavailable", "Agent connection is unavailable."); return record; }
    } catch (error) {
      this.metrics.increment("backpressure_rejections");
      this.fail(record, error instanceof Error ? error.message : "backpressure_limit", "Observation could not be dispatched.");
      return record;
    }
    this.metrics.increment("observations_started"); this.auditEvent(record, "observation.requested", "created");
    logEvent("info", "observation_requested", { sessionId, requestId, capabilityId, status: "created" });
    return record;
  }

  public request(sessionId: string, capabilityId: string, deadline?: Date): Promise<ObservationRequestRecord> {
    const record = this.start(sessionId, capabilityId, deadline); return this.wait(record.requestId);
  }
  public wait(requestId: string): Promise<ObservationRequestRecord> {
    const record = this.store.get(requestId); if (!record) throw new Error("unknown_request");
    return this.pending.get(requestId)?.promise ?? Promise.resolve(record);
  }

  public handle(messageType: string, raw: ObservationEnvelope): void {
    const serializedSize = Buffer.byteLength(JSON.stringify(raw.payload ?? {}), "utf8");
    const payload = raw.payload as Record<string, unknown> | undefined;
    const requestId = String(payload?.requestId ?? "");
    const record = this.store.get(requestId);
    if (serializedSize > this.options.maxPayloadBytes) {
      this.metrics.increment("observations_rejected");
      if (record && !terminalObservationStates.has(record.state)) this.fail(record, "payload_too_large", "Observation result exceeds the payload limit.");
      return;
    }
    if (messageType === "observation.accepted") {
      if (!record || raw.sessionId !== record.sessionId || raw.correlationId !== requestId || record.state !== "created") {
        this.metrics.increment("observations_rejected"); return;
      }
      this.transition(record, "accepted"); this.transition(record, "executing");
      this.auditEvent(record, "observation.accepted", "executing");
      logEvent("info", "observation_accepted", { sessionId: record.sessionId, requestId, capabilityId: record.capabilityId, status: "executing" });
      return;
    }
    const decision = this.reconciler.reconcile(record, raw, this.clock.now());
    if (decision.decision !== "accept") {
      if (record && decision.decision === "late" && decision.reason === "deadline_exceeded") this.timeout(record.requestId);
      if (record) record.lateOutcomes.push({ messageType, receivedAt: this.clock.now().toISOString(), decision: decision.decision, reason: decision.reason });
      this.metrics.increment(decision.decision === "late" ? "observations_late" : "observations_rejected");
      if (record) this.auditEvent(record, decision.decision === "late" ? "observation.late_result" : "observation.rejected", record.state, decision.reason);
      logEvent("error", "observation_reconciled", { ...(record ? { sessionId: record.sessionId, requestId: record.requestId,
        capabilityId: record.capabilityId, status: decision.decision } : { status: decision.decision }) });
      return;
    }
    if (!record || !payload) return;
    if (typeof raw.messageId === "string") record.outcomeMessageId = raw.messageId;
    if (messageType === "observation.result") {
      record.evidence = payload.evidence as Record<string, unknown>; record.observation = payload.observation as Record<string, unknown>;
      this.transition(record, "completed"); this.finish(record, "observation.completed");
    } else if (messageType === "observation.failed") {
      this.fail(record, String(payload.code), String(payload.message));
    } else if (messageType === "observation.cancelled") {
      this.cancel(record.sessionId, record.requestId, "requested", false);
    }
  }

  public cancel(sessionId: string, requestId: string, reason = "requested", notifyAgent = true): ObservationRequestRecord {
    const record = this.store.get(requestId);
    if (!record || record.sessionId !== sessionId) throw new Error("unknown_request");
    if (terminalObservationStates.has(record.state)) return record;
    if (notifyAgent) this.sendCancel(record, reason);
    record.failure = { code: "cancelled", message: "Observation was cancelled." };
    this.transition(record, "cancelled"); this.finish(record, "observation.cancelled");
    return record;
  }

  public authorityLost(sessionId: string, reason: "session_revoked" | "session_closed" | "session_expired" | "disconnected"): void {
    for (const record of this.store.listForSession(sessionId).filter(item => !terminalObservationStates.has(item.state))) {
      if (reason === "disconnected") {
        record.outcomeUnknown = record.state === "accepted" || record.state === "executing";
        record.failure = { code: "connection_lost", message: "Connection was lost before outcome reconciliation." };
        this.transition(record, "abandoned"); this.finish(record, "observation.abandoned");
      } else {
        this.sendCancel(record, reason); this.cancel(sessionId, record.requestId, reason, false);
      }
    }
  }

  public expireDueRequests(): readonly ObservationRequestRecord[] {
    const expired = this.store.list().filter(record => !terminalObservationStates.has(record.state) &&
      new Date(record.deadline).getTime() <= this.clock.now().getTime());
    for (const record of expired) this.timeout(record.requestId);
    return expired;
  }
  public activeCount(): number { return this.store.list().filter(record => !terminalObservationStates.has(record.state)).length; }

  private timeout(requestId: string): void {
    const record = this.store.get(requestId); if (!record || terminalObservationStates.has(record.state)) return;
    this.sendCancel(record, "deadline_exceeded"); record.failure = { code: "timeout", message: "Observation deadline expired." };
    this.transition(record, "timed_out"); this.finish(record, "observation.timed_out");
  }
  private sendCancel(record: ObservationRequestRecord, reason: string): void {
    try { this.connections.send(record.sessionId, { protocolVersion: "1.0", messageId: randomUUID(), messageType: "observation.cancel",
      sessionId: record.sessionId, correlationId: record.requestId, timestamp: this.clock.now().toISOString(),
      payload: { requestId: record.requestId, reason } }); } catch { this.metrics.increment("backpressure_rejections"); }
  }
  private fail(record: ObservationRequestRecord, code: string, message: string): void {
    if (terminalObservationStates.has(record.state)) return;
    record.failure = { code, message }; this.transition(record, "failed"); this.finish(record, "observation.failed");
  }
  private transition(record: ObservationRequestRecord, state: ObservationState): void {
    if (terminalObservationStates.has(record.state)) return; record.state = state; record.lifecycle.push(state);
  }
  private finish(record: ObservationRequestRecord, eventType: string): void {
    record.completedAt = this.clock.now().toISOString(); record.durationMs = Math.max(0, this.clock.now().getTime() - new Date(record.createdAt).getTime());
    const pending = this.pending.get(record.requestId); if (pending) { clearTimeout(pending.timer); this.pending.delete(record.requestId); pending.resolve(record); }
    const metric = record.state === "completed" ? "observations_completed" : record.state === "timed_out" ? "observations_timed_out"
      : record.state === "cancelled" ? "observations_cancelled" : record.state === "abandoned" ? "observations_abandoned" : "observations_failed";
    this.metrics.increment(metric); this.metrics.observeDuration(record.durationMs); this.auditEvent(record, eventType, record.state, record.failure?.code);
    const evidenceId = typeof record.evidence?.evidenceId === "string" ? record.evidence.evidenceId : undefined;
    const observationId = typeof record.observation?.observationId === "string" ? record.observation.observationId : undefined;
    const payloadSize = record.evidence ? Buffer.byteLength(JSON.stringify(record.evidence.payload), "utf8") : undefined;
    logEvent(record.state === "completed" ? "info" : "error", "observation_completed", { sessionId: record.sessionId,
      requestId: record.requestId, capabilityId: record.capabilityId, status: record.state, durationMs: record.durationMs,
      ...(evidenceId ? { evidenceId } : {}), ...(observationId ? { observationId } : {}),
      ...(payloadSize === undefined ? {} : { payloadSize }) });
  }
  private auditEvent(record: ObservationRequestRecord, eventType: string, status: string, reason?: string): void {
    this.audit.append({ eventId: randomUUID(), occurredAt: this.clock.now().toISOString(), eventType, sessionId: record.sessionId,
      requestId: record.requestId, capabilityId: record.capabilityId, status, ...(reason ? { reason } : {}) });
  }
  private rejectStart(code: string): never { this.metrics.increment("observations_rejected"); throw new Error(code); }
}
