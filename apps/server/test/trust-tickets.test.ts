import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/session/clock.js";
import { EphemeralTicketStore } from "../src/trust/tickets.js";

test("connection tickets are opaque, bound, single-use, and expire", () => {
  const clock = new FakeClock(new Date("2026-10-09T12:00:00Z"));
  const store = new EphemeralTicketStore(clock, 1_000, 2_000);
  const claims = { kind: "connection" as const, agentInstanceId: crypto.randomUUID(), capabilities: [] };
  const issued = store.issue(claims);
  assert.ok(issued.ticket.length >= 80); assert.deepEqual(store.consume(issued.ticket, "connection"), claims);
  assert.equal(store.consume(issued.ticket, "connection"), undefined);
  const expired = store.issue(claims); clock.advance(1_001); assert.equal(store.consume(expired.ticket, "connection"), undefined);
});

test("resume tickets rotate by consumption and revocation destroys outstanding authority", () => {
  const clock = new FakeClock(new Date("2026-10-09T12:00:00Z")); const store = new EphemeralTicketStore(clock, 1_000, 2_000);
  const sessionId = crypto.randomUUID(); const claims = { kind: "resume" as const, sessionId, agentInstanceId: crypto.randomUUID(), capabilities: [] };
  const first = store.issue(claims); assert.deepEqual(store.consume(first.ticket, "resume"), claims);
  const rotated = store.issue(claims); assert.notEqual(rotated.ticket, first.ticket); assert.equal(store.consume(first.ticket, "resume"), undefined);
  store.revokeSession(sessionId); assert.equal(store.consume(rotated.ticket, "resume"), undefined);
});

test("ticket kind and secret tampering are rejected and consumed", () => {
  const clock = new FakeClock(new Date()); const store = new EphemeralTicketStore(clock, 1_000, 2_000);
  const issued = store.issue({ kind: "connection", agentInstanceId: crypto.randomUUID(), capabilities: [] });
  assert.equal(store.consume(issued.ticket, "resume"), undefined); assert.equal(store.consume(issued.ticket, "connection"), undefined);
  const tampered = store.issue({ kind: "connection", agentInstanceId: crypto.randomUUID(), capabilities: [] });
  assert.equal(store.consume(`${tampered.ticket}x`, "connection"), undefined);
});
