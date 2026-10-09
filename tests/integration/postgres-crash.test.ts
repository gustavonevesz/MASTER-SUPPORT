import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { test } from "node:test";
import WebSocket from "ws";
import { createAgentHello } from "../../apps/server/src/messages.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("real crash after result arrival reconciles durable uncertainty without restoring authority or redispatching", async () => {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
  if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required for PostgreSQL integration tests");
  requireSafeTestDatabase(configured);
  const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: configured }); await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`); const url = parsed.toString();
  let first: ChildProcess | undefined; let second: ChildProcess | undefined;
  try {
    const migrationPool = new Pool({ connectionString: url }); await migrate(migrationPool); await migrationPool.end();
    first = startServer(url, true); const firstReady = await ready(first); const socket = await connect(firstReady.port);
    const baseHello = createAgentHello(); const hello = { ...baseHello, payload: { ...baseHello.payload,
      supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } };
    socket.send(JSON.stringify(hello)); const serverHello = await receive(socket);
    const sessionId = String(serverHello.sessionId);
    const requestReceived = receive(socket);
    const started = await fetch(`http://127.0.0.1:${firstReady.port}/dev/sessions/${sessionId}/observations`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ capabilityId: "system.runtime.summary" }) });
    const startedBody = await started.text(); assert.equal(started.status, 202, startedBody);
    const requestId = String((JSON.parse(startedBody) as any).request.requestId);
    const request = await requestReceived; assert.equal(request.messageType, "observation.request");
    socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "observation.accepted",
      sessionId, correlationId: requestId, timestamp: new Date().toISOString(), payload: { requestId } }));
    await waitDatabase(url, requestId, "executing");
    const resultWindow = waitForOutput(first, "HARNESS_RESULT_WINDOW");
    const evidenceId = crypto.randomUUID();
    socket.send(JSON.stringify({ protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "observation.result",
      sessionId, correlationId: requestId, timestamp: new Date().toISOString(), payload: { requestId,
        evidence: { evidenceId, capabilityId: "system.runtime.summary", capabilityVersion: "1.0", collectedAt: new Date().toISOString(),
          source: "agent.dotnet.runtime", dataHandlingState: "RAW", payload: runtimeFacts() },
        observation: { observationId: crypto.randomUUID(), evidenceId, observedAt: new Date().toISOString(),
          kind: "runtime-summary-collected", statement: "The temporary Agent runtime has the reported platform and architecture properties.",
          facts: runtimeFacts() } } }));
    await resultWindow;
    first.kill(); await exited(first); first = undefined;

    second = startServer(url); const secondReady = await ready(second);
    assert.notEqual(secondReady.serverInstanceId, firstReady.serverInstanceId);
    assert.deepEqual(secondReady.reconciled, { sessions: 1, observations: 1 });
    const pool = new Pool({ connectionString: url });
    try {
      const old = await pool.query("SELECT state,outcome_unknown FROM observation_requests WHERE request_id=$1", [requestId]);
      assert.deepEqual(old.rows[0], { state: "abandoned", outcome_unknown: true });
      const recovered = await pool.query("SELECT event_type FROM audit_events WHERE request_id=$1 AND event_type=$2", [requestId, "observation.reconciled_after_restart"]);
      assert.equal(recovered.rowCount, 1);
    } finally { await pool.end(); }

    const replacementBase = createAgentHello(); const replacement = await connect(secondReady.port);
    replacement.send(JSON.stringify({ ...replacementBase, payload: { ...replacementBase.payload,
      supportedCapabilities: [{ id: "system.runtime.summary", version: "1.0" }] } }));
    const replacementHello = await receive(replacement); assert.notEqual(replacementHello.sessionId, sessionId);
    const redispatched = await Promise.race([receive(replacement).then(() => true), new Promise<boolean>(resolve => setTimeout(() => resolve(false), 150))]);
    assert.equal(redispatched, false); replacement.terminate();
  } finally {
    if (first) { first.kill(); await exited(first); }
    if (second) { second.kill(); await exited(second); }
    if (!/^ms_test_[a-f0-9]{32}$/.test(schema)) throw new Error("unsafe_test_schema_cleanup");
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
});

function startServer(databaseUrl: string, crashAfterResult = false): ChildProcess { return spawn(process.execPath,
  ["--import", "tsx", "tests/fixtures/durable-server.ts"], { cwd: root,
    env: { ...process.env, MASTER_SUPPORT_DATABASE_URL: databaseUrl,
      ...(crashAfterResult ? { MASTER_SUPPORT_CRASH_AFTER_RESULT_HOOK: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"] }); }

function ready(child: ChildProcess): Promise<{ port: number; serverInstanceId: string; reconciled: { sessions: number; observations: number } }> {
  return new Promise((resolve, reject) => { let buffer = ""; let errors = "";
    const timer = setTimeout(() => reject(new Error(`durable server startup timeout: ${errors}`)), 10_000);
    child.stderr!.on("data", data => { errors += data.toString(); });
    child.stdout!.on("data", data => { buffer += data.toString(); const line = buffer.split(/\r?\n/).find(item => item.startsWith("HARNESS_READY "));
      if (line) { clearTimeout(timer); resolve(JSON.parse(line.slice("HARNESS_READY ".length))); } });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`durable server exited early (${code}): ${errors}`)); });
  });
}
function connect(port: number): Promise<WebSocket> { return new Promise((resolve, reject) => { const socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  socket.once("open", () => resolve(socket)); socket.once("error", reject); }); }
function receive(socket: WebSocket): Promise<Record<string, any>> { return new Promise((resolve, reject) => {
  socket.once("message", data => resolve(JSON.parse(data.toString()))); socket.once("error", reject); }); }
function waitForOutput(child: ChildProcess, marker: string): Promise<void> { return new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`child output marker timeout: ${marker}`)), 5_000);
  const listener = (data: Buffer) => { if (data.toString().includes(marker)) { clearTimeout(timer); child.stdout!.off("data", listener); resolve(); } };
  child.stdout!.on("data", listener);
}); }
function runtimeFacts(): Record<string, string> { return { osPlatform: "Windows", osDescription: "Windows", osArchitecture: "x64",
  processArchitecture: "x64", dotnetRuntime: ".NET 10", agentVersion: "0.1.0", productVersion: "0.1.0",
  protocolVersion: "1.0", supportSessionMode: "temporary-development" }; }
async function exited(child: ChildProcess): Promise<void> { if (child.exitCode !== null) return;
  await new Promise<void>(resolve => { const timer = setTimeout(resolve, 3_000); child.once("exit", () => { clearTimeout(timer); resolve(); }); }); }
async function waitDatabase(url: string, requestId: string, state: string): Promise<void> { const pool = new Pool({ connectionString: url });
  try { const deadline = Date.now() + 5_000; while (Date.now() < deadline) { const result = await pool.query("SELECT state FROM observation_requests WHERE request_id=$1", [requestId]);
      if (result.rows[0]?.state === state) return; await new Promise(resolve => setTimeout(resolve, 25)); } throw new Error("durable state timeout"); }
  finally { await pool.end(); } }
