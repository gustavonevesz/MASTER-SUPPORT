import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";
import { buildApp } from "../../apps/server/src/app.js";
import { createAgentHello } from "../../apps/server/src/messages.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const agentDll = join(root, "apps", "agent", "src", "bin", "Debug", "net10.0", "MasterSupport.Agent.dll");

async function server(sessionOptions: { leaseDurationMs: number; heartbeatIntervalMs: number } = { leaseDurationMs: 3_000, heartbeatIntervalMs: 1_000 }) {
  const context = buildApp({ sessionOptions });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const address = context.app.server.address();
  if (!address || typeof address === "string") throw new Error("Dynamic port unavailable.");
  return { ...context, url: `ws://127.0.0.1:${address.port}/session` };
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function receive(socket: WebSocket): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    socket.once("message", data => resolve(JSON.parse(data.toString()) as Record<string, any>));
    socket.once("error", reject);
  });
}

test("real WebSocket performs handshake, heartbeat correlation and clean close", async context => {
  const running = await server({ leaseDurationMs: 1_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const socket = await connect(running.url);
  const hello = createAgentHello();
  socket.send(JSON.stringify(hello));
  const serverHello = await receive(socket);
  assert.equal(serverHello["messageType"], "server.hello");
  assert.equal(serverHello["correlationId"], hello.messageId);
  const heartbeatId = crypto.randomUUID();
  socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: heartbeatId, messageType: "heartbeat",
    sessionId: serverHello["sessionId"], timestamp: new Date().toISOString(), payload: {} }));
  const ack = await receive(socket);
  assert.equal(ack["messageType"], "heartbeat.ack");
  assert.equal(ack["correlationId"], heartbeatId);
  const closeId = crypto.randomUUID();
  socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: closeId, messageType: "session.close",
    sessionId: serverHello["sessionId"], timestamp: new Date().toISOString(), payload: {} }));
  assert.equal((await receive(socket))["messageType"], "session.closed");
  assert.equal(running.store.get(String(serverHello["sessionId"]))?.state, "closed");
});

test("invalid protocol, schema and message type are rejected", async context => {
  const running = await server();
  context.after(() => running.app.close());
  for (const invalid of [
    { ...createAgentHello(), protocolVersion: "99.0" },
    { ...createAgentHello(), payload: { ...createAgentHello().payload, agentVersion: "99.0.0" } },
    { protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "agent.hello", timestamp: new Date().toISOString(), payload: {} },
    { protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "unexpected", timestamp: new Date().toISOString(), payload: {} },
  ]) {
    const socket = await connect(running.url);
    socket.send(JSON.stringify(invalid));
    assert.equal((await receive(socket))["messageType"], "protocol.error");
  }
});

test("disconnect can resume inside lease but not after terminal expiration", async context => {
  const running = await server({ leaseDurationMs: 1_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const first = await connect(running.url);
  const hello = createAgentHello();
  first.send(JSON.stringify(hello));
  const serverHello = await receive(first);
  first.terminate();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(running.store.get(String(serverHello["sessionId"]))?.state, "disconnected");

  const resumed = await connect(running.url);
  const resumeId = crypto.randomUUID();
  resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: resumeId, messageType: "session.resume.request",
    sessionId: serverHello["sessionId"], timestamp: new Date().toISOString(), payload: {
      agentInstanceId: hello.payload.agentInstanceId, resumeToken: serverHello["payload"].resumeToken,
    } }));
  assert.equal((await receive(resumed))["payload"].accepted, true);
  resumed.terminate();
  await new Promise(resolve => setTimeout(resolve, 1_100));
  running.sessions.expireDueSessions();
  const late = await connect(running.url);
  late.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "session.resume.request",
    sessionId: serverHello["sessionId"], timestamp: new Date().toISOString(), payload: {
      agentInstanceId: hello.payload.agentInstanceId, resumeToken: serverHello["payload"].resumeToken,
    } }));
  assert.equal((await receive(late))["payload"].code, "resume_rejected");
});

test("development sessions endpoint is sanitized", async context => {
  const running = await server();
  context.after(() => running.app.close());
  const socket = await connect(running.url);
  socket.send(JSON.stringify(createAgentHello()));
  await receive(socket);
  const response = await running.app.inject({ method: "GET", url: "/dev/sessions" });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.includes("resumeToken"), false);
  socket.terminate();
});

test("server revocation proactively closes the active socket and rejects resume or observation", async context => {
  const running = await server();
  context.after(() => running.app.close());
  const socket = await connect(running.url);
  socket.send(JSON.stringify(createAgentHello()));
  const hello = await receive(socket);
  const sessionId = String(hello["sessionId"]);
  const closed = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("revoked socket did not close")), 1_000);
    socket.once("close", () => { clearTimeout(timer); resolve(); });
  });
  running.revokeSession(sessionId);
  await closed;
  assert.equal(running.store.get(sessionId)?.state, "revoked");
  const observation = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations`, payload: { capabilityId: "system.runtime.summary" } });
  assert.equal(observation.statusCode, 409);

  const resumed = await connect(running.url);
  resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "session.resume.request",
    sessionId, timestamp: new Date().toISOString(), payload: {
      agentInstanceId: running.store.get(sessionId)!.agentInstanceId, resumeToken: hello["payload"].resumeToken,
    } }));
  assert.equal((await receive(resumed))["payload"].code, "resume_rejected");
});

test("real .NET Agent executes the one read-only observation and stops after revocation", async context => {
  const running = await server({ leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const child = spawn("dotnet", [agentDll, "connect-dev", running.url], { cwd: root });
  context.after(() => { if (!child.killed) child.kill(); });
  let output = "";
  let error = "";
  child.stdout.on("data", data => { output += data.toString(); });
  child.stderr.on("data", data => { error += data.toString(); });
  await waitUntil(() => running.store.list()[0]?.capabilities.some(item => item.id === "system.runtime.summary") === true);
  const session = running.store.list()[0]!;
  const response = await running.app.inject({ method: "POST", url: `/dev/sessions/${session.id}/observations`, payload: { capabilityId: "system.runtime.summary" } });
  assert.equal(response.statusCode, 202, response.body);
  await waitUntil(() => running.observationStore.listForSession(session.id)[0]?.state === "completed");
  const query = await running.app.inject({ method: "GET", url: `/dev/sessions/${session.id}/observations` });
  const body = query.json().observations[0];
  assert.equal(body.state, "completed");
  assert.equal(body.evidence.dataHandlingState, "RAW");
  assert.equal("payload" in body.evidence, false);
  assert.equal(body.observation.kind, "runtime-summary-collected");
  assert.equal(running.observationStore.listForSession(session.id).length, 1);
  assert.ok(running.observationStore.listForSession(session.id)[0]!.evidence?.payload);
  running.revokeSession(session.id);
  const exitCode = await new Promise<number | null>(resolve => child.once("exit", resolve));
  assert.equal(exitCode, 0, error);
  assert.match(output, /Observation requested/);
  assert.match(output, /Observation completed/);
  assert.match(output, /no further observation requests/);
  assert.equal(session.state, "revoked");
});

test("explicit cancel travels over WebSocket and is idempotent", async context => {
  const running = await server({ leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const socket = await connect(running.url); const base = createAgentHello();
  socket.send(JSON.stringify({ ...base, payload: { ...base.payload, supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } }));
  const hello = await receive(socket); const sessionId = String(hello.sessionId);
  const started = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations`, payload: { capabilityId: "system.runtime.summary" } });
  assert.equal(started.statusCode, 202); const request = await receive(socket); const requestId = String(request.payload.requestId);
  const cancelled = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations/${requestId}/cancel` });
  assert.equal(cancelled.statusCode, 200); assert.equal((await receive(socket)).messageType, "observation.cancel");
  const again = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations/${requestId}/cancel` });
  assert.equal(again.json().request.state, "cancelled"); socket.terminate();
});

test("disconnect abandons in-flight request and resume never redispatches it", async context => {
  const running = await server({ leaseDurationMs: 5_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const first = await connect(running.url); const base = createAgentHello();
  const offered = { ...base, payload: { ...base.payload, supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } };
  first.send(JSON.stringify(offered)); const hello = await receive(first); const sessionId = String(hello.sessionId);
  const started = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations`, payload: { capabilityId: "system.runtime.summary" } });
  const requestId = String(started.json().request.requestId); await receive(first);
  first.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "observation.accepted",
    sessionId, correlationId: requestId, timestamp: new Date().toISOString(), payload: { requestId } }));
  await waitUntil(() => running.observationStore.get(requestId)?.state === "executing"); first.terminate();
  await waitUntil(() => running.observationStore.get(requestId)?.state === "abandoned");
  assert.equal(running.observationStore.get(requestId)?.outcomeUnknown, true);

  const resumed = await connect(running.url); resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(),
    messageType: "session.resume.request", sessionId, timestamp: new Date().toISOString(), payload: {
      agentInstanceId: offered.payload.agentInstanceId, resumeToken: hello.payload.resumeToken } }));
  assert.equal((await receive(resumed)).payload.accepted, true);
  const unexpected = await Promise.race([receive(resumed).then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 100))]);
  assert.equal(unexpected, false); assert.equal(running.observationStore.get(requestId)?.state, "abandoned"); resumed.terminate();
});

test("revocation cancels in-flight request before proactively closing socket", async context => {
  const running = await server({ leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 }); context.after(() => running.app.close());
  const socket = await connect(running.url); const base = createAgentHello();
  socket.send(JSON.stringify({ ...base, payload: { ...base.payload, supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } }));
  const hello = await receive(socket); const sessionId = String(hello.sessionId);
  const started = await running.app.inject({ method: "POST", url: `/dev/sessions/${sessionId}/observations`, payload: { capabilityId: "system.runtime.summary" } });
  const requestId = String(started.json().request.requestId); await receive(socket);
  const closed = new Promise<void>(resolve => socket.once("close", () => resolve())); running.revokeSession(sessionId); await closed;
  assert.equal(running.observationStore.get(requestId)?.state, "cancelled"); assert.equal(running.store.get(sessionId)?.state, "revoked");
});

test("real .NET Agent connects, heartbeats and closes cleanly", async context => {
  const running = await server();
  context.after(() => running.app.close());
  const child = spawn("dotnet", [agentDll, "connect-dev", running.url, "2"], { cwd: root });
  let output = "";
  let error = "";
  child.stdout.on("data", data => { output += data.toString(); });
  child.stderr.on("data", data => { error += data.toString(); });
  const exitCode = await new Promise<number | null>(resolve => child.once("exit", resolve));
  assert.equal(exitCode, 0, error);
  assert.match(output, /Connected/);
  assert.match(output, /Heartbeat OK/);
  assert.match(output, /Closing/);
  assert.equal(running.store.list()[0]?.state, "closed");
});

test("abrupt Agent death disconnects first and expires only after lease", async context => {
  const running = await server({ leaseDurationMs: 1_000, heartbeatIntervalMs: 1_000 });
  context.after(() => running.app.close());
  const child = spawn("dotnet", [agentDll, "connect-dev", running.url], { cwd: root });
  await waitUntil(() => running.store.list().length === 1);
  const session = running.store.list()[0]!;
  child.kill();
  await waitUntil(() => session.state === "disconnected");
  assert.equal(session.state, "disconnected");
  await new Promise(resolve => setTimeout(resolve, 1_100));
  running.sessions.expireDueSessions();
  assert.equal(session.state, "expired");
});

test("server restart forgets old authority and a new handshake creates a new session", async () => {
  const first = await server();
  const socket = await connect(first.url);
  socket.send(JSON.stringify(createAgentHello()));
  const oldHello = await receive(socket);
  socket.terminate();
  await first.app.close();

  const second = await server();
  try {
    assert.equal(second.store.list().length, 0);
    const newSocket = await connect(second.url);
    newSocket.send(JSON.stringify(createAgentHello()));
    const newHello = await receive(newSocket);
    assert.notEqual(newHello["sessionId"], oldHello["sessionId"]);
    newSocket.terminate();
  } finally {
    await second.app.close();
  }
});

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for integration state.");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
