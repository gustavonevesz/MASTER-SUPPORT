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
import { AssetRegistryRepository } from "../../apps/server/src/asset/repository.js";
import { AssetReviewService } from "../../apps/server/src/asset/service.js";
import { OperatorReadRepository } from "../../apps/server/src/operator-read/repository.js";
import { OperatorReadService } from "../../apps/server/src/operator-read/service.js";

test("real .NET Agent requires HumanReview across same-hostname Sessions and keeps Asset history over authenticated TLS/WSS", async () => isolated(async url => {
  const certs = await mkdtemp(join(tmpdir(), "master-support-tls-"));
  try {
    const agentDll = fileURLToPath(new URL("../../apps/agent/src/bin/Debug/net10.0/MasterSupport.Agent.dll", import.meta.url));
    const generated = await run("dotnet", [agentDll, "generate-test-certificates", certs]); assert.equal(generated.code, 0, generated.stderr);
    const durability = await PostgresPersistence.start(url); const repository = await SupportInvitationRepository.start(url);const assetRepository=await AssetRegistryRepository.start(url);const operatorRepository=await OperatorReadRepository.start(url);
    const assets=new AssetReviewService(assetRepository,systemClock);
    const invitations = new SupportInvitationService(repository, systemClock, 60_000);
    const context = buildApp({ mode: "secure", invitations, durability,operatorRead:new OperatorReadService(operatorRepository), exposeDevelopmentSessions: true,
      https: { cert: await readFile(join(certs, "server-cert.pem")), key: await readFile(join(certs, "server-key.pem")) } });
    try {
      await context.app.listen({ host: "127.0.0.1", port: 0 });
      const address = context.app.server.address(); assert.ok(address && typeof address !== "string");
      const invitation = await invitations.create(); const code = `${invitation.invitationId}.${invitation.secret}`;
      const running = run("dotnet", [agentDll, "connect", `https://localhost:${address.port}/`, "4"], code,
        { MASTER_SUPPORT_TEST_CA_CERT_PATH: join(certs, "ca.pem") });
      await waitFor(() => context.store.list()[0]?.state === "active");
      const session = context.store.list()[0]!; assert.equal(session.authenticated, true); assert.equal(session.capabilities.length, 5);
      const first = await context.preflights.start(session.id);assert.equal((await assets.listUnreviewed()).length,1);
      const reviewed=await assets.createAssetFromObservedEndpoint({observedEndpointId:first.observedEndpoint!.observedEndpointId,displayName:"Endpoint Demo",
        externalInventoryId:"LAB-PC-001",review:AssetReviewService.localReview()});
      const second = await context.preflights.start(session.id);
      assert.equal(first.status, "completed"); assert.equal(first.snapshot?.observationIds.length, 5); assert.equal(first.snapshot?.completenessPercent, 100);
      assert.ok(first.observedEndpoint); assert.notEqual(first.preflightRunId, second.preflightRunId);
      assert.equal(first.observedEndpoint?.observedEndpointId, second.observedEndpoint?.observedEndpointId);
      assert.equal((await durability.listPreflightHistory(session.id)).length, 2);
      assert.equal((await durability.preflightHistory(first.preflightRunId))?.status, "completed");
      const result = await running;
      assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /Connected/); assert.match(result.stdout, /Heartbeat OK/);
      assert.equal(context.store.list().length, 1); assert.equal(context.store.list()[0]?.capabilities[0]?.id, "system.runtime.summary");
      assert.equal(new Set((await assets.history(reviewed.asset.assetId)).map(row=>row["preflight_run_id"])).size,2);

      const nextInvitation=await invitations.create();const nextCode=`${nextInvitation.invitationId}.${nextInvitation.secret}`;
      const nextRunning=run("dotnet",[agentDll,"connect",`https://localhost:${address.port}/`,"4"],nextCode,{MASTER_SUPPORT_TEST_CA_CERT_PATH:join(certs,"ca.pem")});
      await waitFor(()=>context.store.list().filter(item=>item.state==="active").length===1);
      const nextSession=context.store.list().find(item=>item.state==="active")!;assert.notEqual(nextSession.id,session.id);
      const nextPreflight=await context.preflights.start(nextSession.id);assert.notEqual(nextPreflight.observedEndpoint?.observedEndpointId,first.observedEndpoint?.observedEndpointId);
      const pending=await assets.listUnreviewed();assert.equal(pending.length,1);assert.equal(pending[0]?.observedMachineName,first.observedEndpoint?.observedMachineName);
      assert.equal((await assets.listAssets()).length,1);
      await assets.linkObservedEndpoint({assetId:reviewed.asset.assetId,observedEndpointId:nextPreflight.observedEndpoint!.observedEndpointId,review:AssetReviewService.localReview()});
      assert.equal((await assets.listUnreviewed()).length,0);assert.equal(new Set((await assets.history(reviewed.asset.assetId)).map(row=>row["session_id"])).size,2);
      const webDetail=await context.app.inject({method:"GET",url:`/api/assets/${reviewed.asset.assetId}`});assert.equal(webDetail.statusCode,200);
      assert.match(webDetail.body,/Endpoint Demo/);assert.match(webDetail.body,/windows\.os\.summary/);assert.doesNotMatch(webDetail.body,/evidence|connectionTicket|resumeTicket|invitationSecret/i);
      const webTimeline=await context.app.inject({method:"GET",url:`/api/assets/${reviewed.asset.assetId}/timeline`});assert.equal(webTimeline.statusCode,200);assert.match(webTimeline.body,/Observed endpoint linked to Asset/);
      const nextResult=await nextRunning;assert.equal(nextResult.code,0,nextResult.stderr);assert.equal((await assets.listAssets()).length,1);
    } finally { await context.app.close(); await repository.close();await assetRepository.close();await operatorRepository.close(); }
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

async function waitFor(predicate:()=>boolean):Promise<void>{const deadline=Date.now()+10_000;while(!predicate()){if(Date.now()>deadline)throw new Error("session_start_timeout");await new Promise(resolve=>setTimeout(resolve,25));}}

async function isolated(work: (url: string) => Promise<void>): Promise<void> {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"]; if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");
  requireSafeTestDatabase(configured); const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`; const admin = new Pool({ connectionString: configured });
  await admin.query(`CREATE SCHEMA "${schema}"`); const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`);
  try { const pool = new Pool({ connectionString: parsed.toString() }); try { await migrate(pool); } finally { await pool.end(); } await work(parsed.toString()); }
  finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
}
