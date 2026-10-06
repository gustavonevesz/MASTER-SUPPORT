import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentHello } from "../src/messages.js";
import { FakeClock } from "../src/session/clock.js";
import { SessionService } from "../src/session/service.js";
import { InMemorySessionStore } from "../src/session/store.js";

function setup(capabilities: readonly { id: string; version: string }[] = []) {
  const clock = new FakeClock(new Date("2026-10-06T12:00:00Z"));
  const store = new InMemorySessionStore();
  const service = new SessionService(store, clock, {
    leaseDurationMs: 10_000, heartbeatIntervalMs: 2_000, deduplicationCapacity: 2,
    supportedCapabilities: capabilities,
  });
  return { clock, store, service };
}

test("creates an active development session without Asset identity", () => {
  const { service } = setup();
  const session = service.create(createAgentHello());
  assert.equal(session.state, "active");
  assert.equal(session.protocolVersion, "1.0");
  assert.ok(session.resumeToken.length >= 32);
});

test("heartbeat renews lease and duplicate does not process twice", () => {
  const { service, clock } = setup();
  const session = service.create(createAgentHello());
  const original = session.expiresAt;
  clock.advance(1_000);
  assert.equal(service.heartbeat(session.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").duplicate, false);
  assert.ok(session.expiresAt > original);
  const renewed = session.expiresAt.getTime();
  clock.advance(1_000);
  assert.equal(service.heartbeat(session.id, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa").duplicate, true);
  assert.equal(session.expiresAt.getTime(), renewed);
});

test("deduplication memory is bounded", () => {
  const { service } = setup();
  const session = service.create(createAgentHello());
  service.heartbeat(session.id, "00000000-0000-4000-8000-000000000001");
  service.heartbeat(session.id, "00000000-0000-4000-8000-000000000002");
  service.heartbeat(session.id, "00000000-0000-4000-8000-000000000003");
  assert.equal(session.processedMessageIds.size, 2);
  assert.equal(session.processedMessageIds.has("00000000-0000-4000-8000-000000000001"), false);
});

test("missing heartbeat expires authority", () => {
  const { service, clock } = setup();
  const session = service.create(createAgentHello());
  clock.advance(10_001);
  assert.deepEqual(service.expireDueSessions().map(item => item.id), [session.id]);
  assert.equal(session.state, "expired");
  assert.throws(() => service.heartbeat(session.id, crypto.randomUUID()), /session_not_active/);
});

test("disconnect differs from close and valid resume restores active", () => {
  const { service } = setup();
  const session = service.create(createAgentHello());
  service.disconnect(session.id);
  assert.equal(session.state, "disconnected");
  assert.equal(service.resume(session.id, session.agentInstanceId, session.resumeToken), session);
  assert.equal(session.state, "active");
  service.close(session.id);
  assert.equal(session.state, "closed");
});

test("expired session cannot be resumed", () => {
  const { service, clock } = setup();
  const session = service.create(createAgentHello());
  service.disconnect(session.id);
  clock.advance(10_001);
  assert.equal(service.resume(session.id, session.agentInstanceId, session.resumeToken), undefined);
  assert.equal(session.state, "expired");
});

test("revocation prevents further heartbeat and resume", () => {
  const { service } = setup();
  const session = service.create(createAgentHello());
  service.revoke(session.id);
  assert.equal(session.state, "revoked");
  assert.throws(() => service.heartbeat(session.id, crypto.randomUUID()), /session_not_active/);
  assert.equal(service.resume(session.id, session.agentInstanceId, session.resumeToken), undefined);
});

test("unknown or incompatible capability is not negotiated", () => {
  const { service } = setup([{ id: "agent.hello", version: "1.0" }]);
  const hello = createAgentHello();
  const offered = { ...hello, payload: { ...hello.payload, supportedCapabilities: [
    { id: "agent.hello", version: "2.0" }, { id: "unknown.demo", version: "1.0" },
  ] } };
  assert.deepEqual(service.create(offered).capabilities, []);
});

test("matching runtime summary capability is negotiated into the session", () => {
  const capability = { id: "system.runtime.summary", version: "1.0" };
  const { service } = setup([capability]);
  const hello = createAgentHello();
  const offered = { ...hello, payload: { ...hello.payload, supportedCapabilities: [capability] } };
  assert.deepEqual(service.create(offered).capabilities, [capability]);
});

test("a new in-memory store has no sessions after restart", () => {
  const first = setup();
  first.service.create(createAgentHello());
  assert.equal(first.store.list().length, 1);
  assert.equal(setup().store.list().length, 0);
});
