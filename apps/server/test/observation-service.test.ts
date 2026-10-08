import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentHello } from "../src/messages.js";
import { ObservationService, runtimeSummaryCapability, type ObservationOptions } from "../src/observation/service.js";
import { InMemoryObservationStore } from "../src/observation/store.js";
import { ActiveConnectionRegistry } from "../src/realtime/connection-registry.js";
import { FakeClock } from "../src/session/clock.js";
import { SessionService } from "../src/session/service.js";
import { InMemorySessionStore } from "../src/session/store.js";
import type { MessageTransport } from "../src/transport/message-transport.js";
import type { DurablePersistence } from "../src/persistence/models.js";

class FakeTransport implements MessageTransport {
  public state = "open" as const; public readonly sent: Record<string, any>[] = []; public closed = false; public rejectSend = false;
  public send(message: unknown): void { if (this.rejectSend) throw new Error("backpressure_limit"); this.sent.push(message as Record<string, any>); }
  public close(): void { this.closed = true; } public onMessage(): void {} public onClose(): void {}
}
function setup(options: Partial<ObservationOptions> = {}, durability?: DurablePersistence) {
  const clock = new FakeClock(new Date("2026-10-06T12:00:00Z")); const sessionsStore = new InMemorySessionStore();
  const sessions = new SessionService(sessionsStore, clock, { leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000,
    deduplicationCapacity: 10, supportedCapabilities: [runtimeSummaryCapability] });
  const hello = createAgentHello();
  const session = sessions.create({ ...hello, payload: { ...hello.payload, supportedCapabilities: [runtimeSummaryCapability] } });
  const connections = new ActiveConnectionRegistry(); const transport = new FakeTransport(); connections.register(session.id, transport);
  const store = new InMemoryObservationStore();
  const observations = new ObservationService(sessionsStore, connections, store, clock,
    { timeoutMs: 5_000, maxPayloadBytes: 16 * 1024, rateLimit: 100, ...options }, undefined, undefined, durability);
  return { clock, session, sessionsStore, sessions, connections, transport, store, observations };
}
function resultPayload(requestId: string, marker = "Windows", capabilityId: string = runtimeSummaryCapability.id) {
  const evidenceId = crypto.randomUUID();
  const runtime = { osPlatform: marker, osDescription: "Windows", osArchitecture: "x64", processArchitecture: "x64",
    dotnetRuntime: ".NET 10", agentVersion: "0.1.0", productVersion: "0.1.0", protocolVersion: "1.0", supportSessionMode: "temporary-development" };
  return { requestId, evidence: { evidenceId, capabilityId, capabilityVersion: "1.0", collectedAt: new Date().toISOString(),
    source: "agent.native-runtime-api", dataHandlingState: "RAW", payload: runtime }, observation: {
      observationId: crypto.randomUUID(), evidenceId, observedAt: new Date().toISOString(), kind: "runtime-summary-collected",
      statement: "The temporary Agent runtime has the reported platform and architecture properties.", facts: runtime } };
}
function envelope(fixture: ReturnType<typeof setup>, requestId: string, type = "observation.result", payload: unknown = resultPayload(requestId), messageId = crypto.randomUUID()) {
  return { protocolVersion: "1.0", messageId, messageType: type, sessionId: fixture.session.id,
    correlationId: requestId, timestamp: fixture.clock.now().toISOString(), payload };
}
function accept(fixture: ReturnType<typeof setup>, requestId: string): void {
  fixture.observations.handle("observation.accepted", envelope(fixture, requestId, "observation.accepted", { requestId }));
}
function complete(fixture: ReturnType<typeof setup>, requestId: string, messageId = crypto.randomUUID()): void {
  accept(fixture, requestId); fixture.observations.handle("observation.result", envelope(fixture, requestId, "observation.result", resultPayload(requestId), messageId));
}

test("normal request is reconciled into distinct Evidence and Observation", async () => {
  const fixture = setup(); const pending = fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id);
  const requestId = String(fixture.transport.sent[0]!.payload.requestId); accept(fixture, requestId); fixture.clock.advance(12);
  fixture.observations.handle("observation.result", envelope(fixture, requestId)); const record = await pending;
  assert.deepEqual(record.lifecycle, ["created", "accepted", "executing", "completed"]);
  assert.notEqual(record.evidence?.evidenceId, record.observation?.observationId); assert.equal(record.durationMs, 12);
});

test("inactive sessions and expired deadline never dispatch", () => {
  for (const state of ["disconnected", "closed", "expired", "revoked"] as const) {
    const fixture = setup(); fixture.session.state = state;
    assert.throws(() => fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id), /session_not_active/);
    assert.equal(fixture.transport.sent.length, 0);
  }
  const fixture = setup(); assert.throws(() => fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id,
    new Date(fixture.clock.now().getTime() - 1)), /deadline_expired/); assert.equal(fixture.transport.sent.length, 0);
});

test("explicit cancel is idempotent and late result cannot reopen terminal state", async () => {
  const fixture = setup(); const record = fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id);
  const first = fixture.observations.cancel(fixture.session.id, record.requestId); const second = fixture.observations.cancel(fixture.session.id, record.requestId);
  assert.equal(first, second); assert.equal(record.state, "cancelled");
  fixture.observations.handle("observation.result", envelope(fixture, record.requestId));
  assert.equal(record.state, "cancelled"); assert.equal(record.evidence, undefined); assert.equal(record.lateOutcomes[0]?.decision, "late");
  assert.equal((await fixture.observations.wait(record.requestId)).state, "cancelled");
});

test("timeout cancels authority and late result remains metadata only", () => {
  const fixture = setup(); const record = fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id);
  fixture.clock.advance(5_001); assert.deepEqual(fixture.observations.expireDueRequests().map(item => item.requestId), [record.requestId]);
  assert.equal(record.state, "timed_out"); fixture.observations.handle("observation.result", envelope(fixture, record.requestId));
  assert.equal(record.state, "timed_out"); assert.equal(record.evidence, undefined); assert.equal(record.lateOutcomes.length, 1);
});

test("revocation close expiration and disconnect terminate active requests with documented semantics", () => {
  for (const reason of ["session_revoked", "session_closed", "session_expired"] as const) {
    const fixture = setup(); const record = fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id);
    fixture.observations.authorityLost(fixture.session.id, reason); assert.equal(record.state, "cancelled"); assert.equal(record.outcomeUnknown, undefined);
  }
  const disconnected = setup(); const record = disconnected.observations.start(disconnected.session.id, runtimeSummaryCapability.id);
  accept(disconnected, record.requestId); disconnected.observations.authorityLost(disconnected.session.id, "disconnected");
  assert.equal(record.state, "abandoned"); assert.equal(record.outcomeUnknown, true);
});

test("late result after revocation and invalid correlation or capability are rejected", () => {
  const late = setup(); const lateRecord = late.observations.start(late.session.id, runtimeSummaryCapability.id);
  late.observations.authorityLost(late.session.id, "session_revoked"); late.session.state = "revoked";
  late.observations.handle("observation.result", envelope(late, lateRecord.requestId));
  assert.equal(lateRecord.state, "cancelled"); assert.equal(lateRecord.evidence, undefined);

  const invalid = setup(); const correlation = invalid.observations.start(invalid.session.id, runtimeSummaryCapability.id);
  const wrongCorrelation = envelope(invalid, correlation.requestId); wrongCorrelation.correlationId = crypto.randomUUID();
  invalid.observations.handle("observation.result", wrongCorrelation); assert.equal(correlation.state, "created");
  invalid.observations.handle("observation.result", envelope(invalid, correlation.requestId, "observation.result",
    resultPayload(correlation.requestId, "Windows", "spoofed.capability"))); assert.equal(correlation.state, "created");
});

test("duplicate outcome is classified without reopening or duplicating Evidence", () => {
  const fixture = setup(); const record = fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id);
  const messageId = crypto.randomUUID(); complete(fixture, record.requestId, messageId); const evidence = record.evidence;
  fixture.observations.handle("observation.result", envelope(fixture, record.requestId, "observation.result", resultPayload(record.requestId), messageId));
  assert.equal(record.state, "completed"); assert.equal(record.evidence, evidence); assert.equal(record.lateOutcomes[0]?.decision, "duplicate");
});

test("concurrency quota and rate limit reject without unbounded queue", () => {
  const quota = setup({ maxActivePerCapability: 1 }); quota.observations.start(quota.session.id, runtimeSummaryCapability.id);
  assert.throws(() => quota.observations.start(quota.session.id, runtimeSummaryCapability.id), /concurrency_limit_exceeded/);
  assert.equal(quota.observations.activeCount(), 1);

  const rate = setup({ rateLimit: 2, rateWindowMs: 1_000 });
  for (let index = 0; index < 2; index++) { const record = rate.observations.start(rate.session.id, runtimeSummaryCapability.id); complete(rate, record.requestId); }
  assert.throws(() => rate.observations.start(rate.session.id, runtimeSummaryCapability.id), /rate_limit_exceeded/);
  assert.equal(rate.observations.metrics.snapshot(1, 0).rate_limit_rejections, 1);
});

test("backpressure and oversized payload fail explicitly", async () => {
  const pressure = setup(); pressure.transport.rejectSend = true;
  const record = pressure.observations.start(pressure.session.id, runtimeSummaryCapability.id);
  assert.equal(record.state, "failed"); assert.equal(pressure.observations.metrics.snapshot(1, 0).backpressure_rejections, 1);

  const large = setup(); const pending = large.observations.request(large.session.id, runtimeSummaryCapability.id);
  const requestId = String(large.transport.sent[0]!.payload.requestId);
  large.observations.handle("observation.result", envelope(large, requestId, "observation.result", resultPayload(requestId, "x".repeat(17 * 1024))));
  assert.equal((await pending).failure?.code, "payload_too_large");
});

test("metrics audit and logs contain metadata but no RAW", async () => {
  const fixture = setup(); let output = ""; const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try { const pending = fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id);
    const requestId = String(fixture.transport.sent[0]!.payload.requestId); accept(fixture, requestId);
    fixture.observations.handle("observation.result", envelope(fixture, requestId, "observation.result", resultPayload(requestId, "RAW_SECRET_MARKER"))); await pending;
  } finally { process.stdout.write = original; }
  const serialized = JSON.stringify({ metrics: fixture.observations.metrics.snapshot(1, 0), audit: fixture.observations.audit.list() });
  assert.doesNotMatch(serialized, /RAW_SECRET_MARKER/); assert.doesNotMatch(output, /RAW_SECRET_MARKER/);
  assert.equal(fixture.observations.metrics.snapshot(1, 0).observations_completed, 1);
  assert.ok(fixture.observations.audit.list().some(event => event.eventType === "observation.completed"));
});

test("small deterministic load cleans active registry and restart loses state", () => {
  const fixture = setup({ rateLimit: 50, maxActivePerCapability: 1 });
  for (let index = 0; index < 20; index++) { const record = fixture.observations.start(fixture.session.id, runtimeSummaryCapability.id); complete(fixture, record.requestId); }
  assert.equal(fixture.observations.activeCount(), 0); assert.equal(fixture.store.list().length, 20);
  assert.equal(new InMemoryObservationStore().list().length, 0);
});

test("database failure before durable insert prevents dispatch", async () => {
  const durability = failingDurability(); const fixture = setup({}, durability);
  await assert.rejects(fixture.observations.startDurable(fixture.session.id, runtimeSummaryCapability.id), /database_unavailable/);
  assert.equal(fixture.transport.sent.length, 0); assert.equal(fixture.store.list()[0]?.state, "failed");
  assert.equal(fixture.observations.metrics.snapshot(1, 0).db_operation_failures, 1);
});

function failingDurability(): DurablePersistence { return {
  serverInstanceId: crypto.randomUUID(), connected: false,
  async persistSessionCreated() {}, async persistSessionState() {},
  async persistObservationBeforeDispatch() { throw new Error("database_unavailable"); }, async persistObservation() {},
  async appendAudit() {}, async sessionHistory() { return undefined; }, async observationHistory() { return undefined; },
  async reconcileRestart() { return { sessions: 0, observations: 0 }; }, async finish() {},
}; }
