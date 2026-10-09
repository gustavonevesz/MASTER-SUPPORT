import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { request } from "node:https";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Pool } from "pg";
import WebSocket from "ws";
import { buildApp } from "../../apps/server/src/app.js";
import { createAgentHello } from "../../apps/server/src/messages.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { PostgresPersistence } from "../../apps/server/src/persistence/postgres.js";
import { systemClock } from "../../apps/server/src/session/clock.js";
import { SupportInvitationRepository, SupportInvitationService } from "../../apps/server/src/trust/invitation.js";

test("authenticated WSS consumes connection ticket and rotates one-time resume tickets", async () => isolated(async url => {
  const certs = await mkdtemp(join(tmpdir(), "master-support-resume-"));
  try {
    const dll = fileURLToPath(new URL("../../apps/agent/src/bin/Debug/net10.0/MasterSupport.Agent.dll", import.meta.url));
    assert.equal(await exitCode("dotnet", [dll, "generate-test-certificates", certs]), 0);
    const ca = await readFile(join(certs, "ca.pem")); const durability = await PostgresPersistence.start(url);
    const repository = await SupportInvitationRepository.start(url); const invitations = new SupportInvitationService(repository, systemClock, 60_000);
    const context = buildApp({ mode: "secure", invitations, durability,
      https: { cert: await readFile(join(certs, "server-cert.pem")), key: await readFile(join(certs, "server-key.pem")) } });
    try {
      await context.app.listen({ host: "127.0.0.1", port: 0 }); const address = context.app.server.address(); assert.ok(address && typeof address !== "string");
      const baseHello = createAgentHello(); const hello = { ...baseHello, payload: { ...baseHello.payload,
        supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } };
      const invitation = await invitations.create();
      const boot = await post(address.port, ca, { invitationId: invitation.invitationId, invitationSecret: invitation.secret, agentHello: hello });
      assert.equal(boot.status, 201); const connectionTicket = String(boot.body["connectionTicket"]);
      const opened = await connect(address.port, ca, connectionTicket); opened.send(JSON.stringify(hello)); const serverHello = await next(opened);
      const sessionId = String(serverHello["sessionId"]); const firstResume = String((serverHello["payload"] as Record<string, unknown>)["resumeTicket"]);
      opened.terminate(); await delay(50);
      const resumed = await connect(address.port, ca, firstResume); resumed.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(),
        messageType: "session.resume.request", sessionId, timestamp: new Date().toISOString(), payload: { agentInstanceId: hello.payload.agentInstanceId } }));
      const result = await next(resumed); const secondResume = String((result["payload"] as Record<string, unknown>)["resumeTicket"]);
      assert.notEqual(secondResume, firstResume); resumed.terminate(); await delay(50);
      assert.equal(await rejected(address.port, ca, firstResume), true);
      const rotated = await connect(address.port, ca, secondResume); rotated.terminate(); context.revokeSession(sessionId);
      assert.equal(await rejected(address.port, ca, connectionTicket), true);
    } finally { await context.app.close(); await repository.close(); }
  } finally { await rm(certs, { recursive: true, force: true }); }
}));

function post(port: number, ca: Buffer, body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => { const payload = JSON.stringify(body); const req = request({ hostname: "localhost", port, path: "/support/bootstrap",
    method: "POST", ca, headers: { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } }, response => {
      let data = ""; response.on("data", chunk => data += String(chunk)); response.on("end", () => resolve({ status: response.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> }));
    }); req.on("error", reject); req.end(payload); });
}
function connect(port: number, ca: Buffer, ticket: string): Promise<WebSocket> { return new Promise((resolve, reject) => {
  const socket = new WebSocket(`wss://localhost:${port}/session`, { ca, headers: { Authorization: `Bearer ${ticket}` } }); socket.once("open", () => resolve(socket)); socket.once("error", reject); }); }
function next(socket: WebSocket): Promise<Record<string, unknown>> { return new Promise((resolve, reject) => {
  socket.once("message", data => resolve(JSON.parse(String(data)) as Record<string, unknown>)); socket.once("error", reject); }); }
function rejected(port: number, ca: Buffer, ticket: string): Promise<boolean> { return new Promise(resolve => {
  const socket = new WebSocket(`wss://localhost:${port}/session`, { ca, headers: { Authorization: `Bearer ${ticket}` } });
  socket.once("close", code => resolve(code === 1008)); socket.once("error", () => resolve(true)); }); }
function delay(ms: number): Promise<void> { return new Promise(resolve => setTimeout(resolve, ms)); }
function exitCode(command: string, args: string[]): Promise<number> { return new Promise((resolve, reject) => { const child = spawn(command, args, { windowsHide: true }); child.on("error", reject); child.on("close", code => resolve(code ?? -1)); }); }
async function isolated(work: (url: string) => Promise<void>): Promise<void> { const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
  if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required"); requireSafeTestDatabase(configured);
  const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`; const admin = new Pool({ connectionString: configured }); await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`);
  try { const pool = new Pool({ connectionString: parsed.toString() }); try { await migrate(pool); } finally { await pool.end(); } await work(parsed.toString()); }
  finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); } }
