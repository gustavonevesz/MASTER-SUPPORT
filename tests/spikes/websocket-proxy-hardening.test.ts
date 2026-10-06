import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { connect as connectTcp, type Socket } from "node:net";
import { test } from "node:test";
import WebSocket from "ws";
import { buildApp } from "../../apps/server/src/app.js";
import { createAgentHello } from "../../apps/server/src/messages.js";

async function proxy(targetPort: number) {
  const sockets = new Set<Socket>();
  const server = createServer();
  server.on("connection", socket => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.on("upgrade", (request: IncomingMessage, downstream: Socket, head: Buffer) => {
    downstream.on("error", () => downstream.destroy());
    const upstream = connectTcp(targetPort, "127.0.0.1", () => {
      const headers: string[] = [`GET ${request.url ?? "/"} HTTP/1.1`];
      for (let index = 0; index < request.rawHeaders.length; index += 2) headers.push(`${request.rawHeaders[index]}: ${request.rawHeaders[index + 1]}`);
      upstream.write(`${headers.join("\r\n")}\r\n\r\n`); if (head.length > 0) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
    upstream.on("error", () => { upstream.destroy(); downstream.destroy(); });
    sockets.add(upstream); upstream.on("close", () => sockets.delete(upstream));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("proxy port unavailable");
  return { url: `ws://127.0.0.1:${address.port}/session`, drop: async () => {
    for (const socket of sockets) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve()));
  } };
}
function open(url: string): Promise<WebSocket> { return new Promise((resolve, reject) => {
  const socket = new WebSocket(url); socket.once("open", () => resolve(socket)); socket.once("error", reject);
}); }
function receive(socket: WebSocket): Promise<Record<string, any>> { return new Promise((resolve, reject) => {
  socket.once("message", data => resolve(JSON.parse(data.toString()) as Record<string, any>)); socket.once("error", reject);
}); }
async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000; while (!predicate()) { if (Date.now() > deadline) throw new Error("proxy state timeout");
    await new Promise(resolve => setTimeout(resolve, 10)); }
}

test("local reverse proxy preserves upgrade heartbeat close drop and manual resume", async () => {
  const context = buildApp({ sessionOptions: { leaseDurationMs: 5_000, heartbeatIntervalMs: 500 } });
  await context.app.listen({ host: "127.0.0.1", port: 0 });
  const target = context.app.server.address(); if (!target || typeof target === "string") throw new Error("server port unavailable");
  const firstProxy = await proxy(target.port);
  try {
    const socket = await open(firstProxy.url); const hello = createAgentHello(); socket.send(JSON.stringify(hello));
    const serverHello = await receive(socket); const sessionId = String(serverHello.sessionId);
    const heartbeatId = crypto.randomUUID(); socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: heartbeatId,
      messageType: "heartbeat", sessionId, timestamp: new Date().toISOString(), payload: {} }));
    assert.equal((await receive(socket)).correlationId, heartbeatId);
    await firstProxy.drop(); await waitUntil(() => context.store.get(sessionId)?.state === "disconnected");

    const secondProxy = await proxy(target.port);
    try {
      const resumed = await open(secondProxy.url); resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(),
        messageType: "session.resume.request", sessionId, timestamp: new Date().toISOString(), payload: {
          agentInstanceId: hello.payload.agentInstanceId, resumeToken: serverHello.payload.resumeToken } }));
      assert.equal((await receive(resumed)).payload.accepted, true);
      const closeId = crypto.randomUUID(); resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: closeId,
        messageType: "session.close", sessionId, timestamp: new Date().toISOString(), payload: {} }));
      assert.equal((await receive(resumed)).messageType, "session.closed");
    } finally { await secondProxy.drop(); }
  } finally { await context.app.close(); }
});

test("proxy path still enforces the 64 KiB WebSocket input limit", async () => {
  const context = buildApp(); await context.app.listen({ host: "127.0.0.1", port: 0 });
  const target = context.app.server.address(); if (!target || typeof target === "string") throw new Error("server port unavailable");
  const localProxy = await proxy(target.port);
  try {
    const socket = await open(localProxy.url);
    socket.on("error", () => { /* connection reset is an acceptable explicit oversized-message failure */ });
    const closed = new Promise<number>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("oversized socket remained open")), 2_000);
      socket.once("close", code => { clearTimeout(timer); resolve(code); }); });
    socket.send("x".repeat(65 * 1024)); assert.notEqual(await closed, 1000);
  } finally { await localProxy.drop(); await context.app.close(); }
});
