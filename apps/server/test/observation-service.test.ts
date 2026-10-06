import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentHello } from "../src/messages.js";
import { ObservationService, runtimeSummaryCapability } from "../src/observation/service.js";
import { InMemoryObservationStore } from "../src/observation/store.js";
import { ActiveConnectionRegistry } from "../src/realtime/connection-registry.js";
import { FakeClock } from "../src/session/clock.js";
import { SessionService } from "../src/session/service.js";
import { InMemorySessionStore } from "../src/session/store.js";
import type { MessageTransport } from "../src/transport/message-transport.js";

class FakeTransport implements MessageTransport {
  public state = "open" as const;
  public readonly sent: Record<string, any>[] = [];
  public closed = false;
  public send(message: unknown): void { this.sent.push(message as Record<string, any>); }
  public close(): void { this.closed = true; }
  public onMessage(): void {}
  public onClose(): void {}
}

function setup(timeoutMs = 50) {
  const clock = new FakeClock(new Date("2026-10-06T12:00:00Z"));
  const sessionsStore = new InMemorySessionStore();
  const sessions = new SessionService(sessionsStore, clock, {
    leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000, deduplicationCapacity: 10,
    supportedCapabilities: [runtimeSummaryCapability],
  });
  const hello = createAgentHello();
  const session = sessions.create({ ...hello, payload: { ...hello.payload, supportedCapabilities: [runtimeSummaryCapability] } });
  const connections = new ActiveConnectionRegistry();
  const transport = new FakeTransport();
  connections.register(session.id, transport);
  const store = new InMemoryObservationStore();
  const observations = new ObservationService(sessionsStore, connections, store, clock, timeoutMs, 16 * 1024);
  return { clock, session, sessionsStore, sessions, connections, transport, store, observations };
}

function resultPayload(requestId: string, marker = "Windows") {
  const evidenceId = crypto.randomUUID();
  const runtime = { osPlatform: marker, osDescription: "Windows", osArchitecture: "x64", processArchitecture: "x64",
    dotnetRuntime: ".NET 10", agentVersion: "0.1.0", productVersion: "0.1.0", protocolVersion: "1.0", supportSessionMode: "temporary-development" };
  return {
    requestId,
    evidence: {
      evidenceId, capabilityId: "system.runtime.summary", capabilityVersion: "1.0",
      collectedAt: new Date().toISOString(), source: "agent.native-runtime-api", dataHandlingState: "RAW",
      payload: runtime,
    },
    observation: {
      observationId: crypto.randomUUID(), evidenceId, observedAt: new Date().toISOString(),
      kind: "runtime-summary-collected", statement: "The temporary Agent runtime has the reported platform and architecture properties.", facts: runtime,
    },
  };
}

test("observation lifecycle preserves distinct Evidence and Observation", async () => {
  const fixture = setup();
  const pending = fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id);
  const request = fixture.transport.sent[0]!;
  const requestId = String(request.payload.requestId);
  fixture.observations.handle("observation.accepted", { sessionId: fixture.session.id, correlationId: requestId, payload: { requestId } });
  fixture.clock.advance(12);
  fixture.observations.handle("observation.result", { sessionId: fixture.session.id, correlationId: requestId, payload: resultPayload(requestId) });
  const record = await pending;
  assert.deepEqual(record.lifecycle, ["created", "accepted", "executing", "result"]);
  assert.notEqual(record.evidence?.evidenceId, record.observation?.observationId);
  assert.equal(record.observation?.evidenceId, record.evidence?.evidenceId);
  assert.equal(record.durationMs, 12);
});

test("inactive terminal and disconnected sessions cannot receive observations", () => {
  for (const state of ["disconnected", "closed", "expired", "revoked"] as const) {
    const fixture = setup();
    fixture.session.state = state;
    assert.throws(() => fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id), /session_not_active/);
    assert.equal(fixture.transport.sent.length, 0);
  }
});

test("unknown or unnegotiated capability is rejected without dispatch", () => {
  const fixture = setup();
  assert.throws(() => fixture.observations.request(fixture.session.id, "unknown.capability"), /capability_not_negotiated/);
  assert.equal(fixture.transport.sent.length, 0);
});

test("observation timeout is terminal and an oversized result fails", async () => {
  const timed = setup(5);
  const timedRecord = await timed.observations.request(timed.session.id, runtimeSummaryCapability.id);
  assert.equal(timedRecord.state, "timeout");
  assert.equal(timedRecord.failure?.code, "timeout");

  const large = setup();
  const pending = large.observations.request(large.session.id, runtimeSummaryCapability.id);
  const requestId = String(large.transport.sent[0]!.payload.requestId);
  const payload = resultPayload(requestId, "x".repeat(17 * 1024));
  large.observations.handle("observation.result", { sessionId: large.session.id, correlationId: requestId, payload });
  assert.equal((await pending).failure?.code, "payload_too_large");
});

test("logs contain observation metadata but never raw evidence payload", async () => {
  const fixture = setup();
  let output = "";
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => { output += chunk.toString(); return true; }) as typeof process.stdout.write;
  try {
    const pending = fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id);
    const requestId = String(fixture.transport.sent[0]!.payload.requestId);
    fixture.observations.handle("observation.result", { sessionId: fixture.session.id, correlationId: requestId, payload: resultPayload(requestId, "RAW_SECRET_MARKER") });
    await pending;
  } finally {
    process.stdout.write = original;
  }
  assert.match(output, /payloadSize/);
  assert.doesNotMatch(output, /RAW_SECRET_MARKER/);
});

test("proactive revocation closes registered connection and a fresh store loses observations", async () => {
  const fixture = setup();
  fixture.store.save({ requestId: crypto.randomUUID(), sessionId: fixture.session.id, capabilityId: runtimeSummaryCapability.id,
    capabilityVersion: runtimeSummaryCapability.version, createdAt: new Date().toISOString(), state: "result", lifecycle: ["created", "result"] });
  assert.equal(fixture.store.listForSession(fixture.session.id).length, 1);
  fixture.sessions.revoke(fixture.session.id);
  assert.equal(fixture.connections.close(fixture.session.id), true);
  assert.equal(fixture.transport.closed, true);
  assert.throws(() => fixture.observations.request(fixture.session.id, runtimeSummaryCapability.id), /session_not_active/);
  assert.equal(new InMemoryObservationStore().listForSession(fixture.session.id).length, 0);
});
