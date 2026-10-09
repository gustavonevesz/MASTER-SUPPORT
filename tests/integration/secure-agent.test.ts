import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../../apps/server/src/app.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { PostgresPersistence } from "../../apps/server/src/persistence/postgres.js";
import { systemClock } from "../../apps/server/src/session/clock.js";
import { SupportInvitationRepository, SupportInvitationService } from "../../apps/server/src/trust/invitation.js";

test("real .NET Agent bootstraps over HTTPS and establishes authenticated WSS", async () => isolated(async url => {
  const certs = await mkdtemp(join(tmpdir(), "master-support-tls-"));
  try {
    const agentDll = fileURLToPath(new URL("../../apps/agent/src/bin/Debug/net10.0/MasterSupport.Agent.dll", import.meta.url));
    const generated = await run("dotnet", [agentDll, "generate-test-certificates", certs]); assert.equal(generated.code, 0, generated.stderr);
    const durability = await PostgresPersistence.start(url); const repository = await SupportInvitationRepository.start(url);
    const invitations = new SupportInvitationService(repository, systemClock, 60_000);
    const context = buildApp({ mode: "secure", invitations, durability,
      https: { cert: await readFile(join(certs, "server-cert.pem")), key: await readFile(join(certs, "server-key.pem")) } });
    try {
      await context.app.listen({ host: "127.0.0.1", port: 0 });
      const address = context.app.server.address(); assert.ok(address && typeof address !== "string");
      const invitation = await invitations.create(); const code = `${invitation.invitationId}.${invitation.secret}`;
      const result = await run("dotnet", [agentDll, "connect", `https://localhost:${address.port}/`, "1"], code,
        { MASTER_SUPPORT_TEST_CA_CERT_PATH: join(certs, "ca.pem") });
      assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Connected/); assert.match(result.stdout, /Heartbeat OK/);
      const sessions = context.store.list(); assert.equal(sessions.length, 1); assert.equal(sessions[0]?.capabilities[0]?.id, "system.runtime.summary");
    } finally { await context.app.close(); await repository.close(); }
  } finally { await rm(certs, { recursive: true, force: true }); }
}));

function run(command: string, args: string[], stdin = "", extraEnv: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, windowsHide: true });
    let stdout = ""; let stderr = ""; child.stdout.on("data", chunk => stdout += String(chunk)); child.stderr.on("data", chunk => stderr += String(chunk));
    child.on("error", reject); child.on("close", code => resolvePromise({ code: code ?? -1, stdout, stderr }));
    if (stdin) child.stdin.end(`${stdin}\n`); else child.stdin.end();
  });
}

async function isolated(work: (url: string) => Promise<void>): Promise<void> {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"]; if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");
  requireSafeTestDatabase(configured); const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`; const admin = new Pool({ connectionString: configured });
  await admin.query(`CREATE SCHEMA "${schema}"`); const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`);
  try { const pool = new Pool({ connectionString: parsed.toString() }); try { await migrate(pool); } finally { await pool.end(); } await work(parsed.toString()); }
  finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
}
