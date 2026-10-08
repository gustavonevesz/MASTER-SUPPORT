import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { test } from "node:test";
import { buildApp } from "../../apps/server/src/app.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { PostgresPersistence } from "../../apps/server/src/persistence/postgres.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const agentDll = join(root, "apps", "agent", "src", "bin", "Debug", "net10.0", "MasterSupport.Agent.dll");

test("real .NET Agent completes the only capability through a durable Server without persisting RAW", async () => {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
  if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required for PostgreSQL integration tests");
  requireSafeTestDatabase(configured); const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`;
  const admin = new Pool({ connectionString: configured }); await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`); const url = parsed.toString();
  const migrationPool = new Pool({ connectionString: url }); await migrate(migrationPool); await migrationPool.end();
  const persistence = await PostgresPersistence.start(url); await persistence.reconcileRestart();
  const context = buildApp({ durability: persistence, sessionOptions: { leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 } });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await context.app.listen({ host: "127.0.0.1", port: 0 }); const address = context.app.server.address();
    if (!address || typeof address === "string") throw new Error("dynamic_port_unavailable");
    child = spawn("dotnet", [agentDll, "connect-dev", `ws://127.0.0.1:${address.port}/session`], { cwd: root });
    let error = ""; child.stderr!.on("data", data => { error += data.toString(); });
    await waitUntil(() => context.store.list()[0]?.state === "active"); const session = context.store.list()[0]!;
    const response = await context.app.inject({ method: "POST", url: `/dev/sessions/${session.id}/observations`,
      payload: { capabilityId: "system.runtime.summary" } }); assert.equal(response.statusCode, 202, response.body);
    const requestId = String(response.json().request.requestId);
    await waitUntil(async () => (await persistence.observationHistory(requestId))?.["state"] === "completed");
    const history = await persistence.observationHistory(requestId); assert.equal(history?.["data_handling_state"], "MINIMIZED");
    assert.equal(JSON.stringify(history).includes('"payload"'), false);
    context.revokeSession(session.id); await new Promise<void>(resolve => child!.once("exit", () => resolve()));
    assert.equal(child.exitCode, 0, error);
  } finally {
    if (child?.exitCode === null) child.kill(); await context.app.close();
    if (!/^ms_test_[a-f0-9]{32}$/.test(schema)) throw new Error("unsafe_test_schema_cleanup");
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();
  }
});

async function waitUntil(predicate: () => boolean | Promise<boolean>): Promise<void> { const deadline = Date.now() + 10_000;
  while (!(await predicate())) { if (Date.now() >= deadline) throw new Error("durable Agent state timeout");
    await new Promise(resolve => setTimeout(resolve, 25)); } }
