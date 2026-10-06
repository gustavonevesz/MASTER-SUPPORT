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

test("server revocation is terminal and rejects continued authority", async context => {
  const running = await server();
  context.after(() => running.app.close());
  const socket = await connect(running.url);
  socket.send(JSON.stringify(createAgentHello()));
  const hello = await receive(socket);
  const sessionId = String(hello["sessionId"]);
  running.revokeSession(sessionId);
  socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "heartbeat",
    sessionId, timestamp: new Date().toISOString(), payload: {} }));
  const error = await receive(socket);
  assert.equal(error["payload"].code, "session_not_active");
  assert.equal(running.store.get(sessionId)?.state, "revoked");
  socket.terminate();
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
