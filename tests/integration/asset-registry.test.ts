import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { AssetRegistryConflict, AssetRegistryRepository } from "../../apps/server/src/asset/repository.js";
import { AssetReviewService } from "../../apps/server/src/asset/service.js";
import { MetricsRegistry } from "../../apps/server/src/observation/metrics.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { FakeClock } from "../../apps/server/src/session/clock.js";

test("Preflight creates only separate unreviewed ObservedEndpoints; equal hostnames never auto-correlate",async()=>isolated(async url=>{
  const seeded=await seed(url,["PC-DEMO-001","PC-DEMO-001"]);const repo=await AssetRegistryRepository.start(url);
  try{const pending=await repo.listUnreviewed();assert.equal(pending.length,2);assert.notEqual(pending[0]!.observedEndpointId,pending[1]!.observedEndpointId);
    assert.equal((await repo.listAssets()).length,0);assert.equal(pending[0]!.latestPreflight?.factsByCapability["windows.os.summary"]!==undefined,true);
    assert.doesNotMatch(JSON.stringify(pending),/RAW_SECRET_MARKER/);assert.deepEqual(new Set(pending.map(item=>item.observedMachineName)),new Set(["PC-DEMO-001"]));
  }finally{await repo.close();}void seeded;
}));

test("explicit HumanReview creates UUID Asset, optional inventory id, link, audit, metrics and safe current view atomically",async()=>isolated(async url=>{
  const [endpoint]=await seed(url,["PC-DEMO-001"]);const repo=await AssetRegistryRepository.start(url);const metrics=new MetricsRegistry();const service=new AssetReviewService(repo,new FakeClock(new Date("2026-10-13T12:00:00Z")),metrics);
  try{await assert.rejects(service.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"Demo",review:{actorType:"local_operator",confirmationMethod:"automatic" as "HumanReview"}}),/explicit_human_review/);
    const made=await service.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"Endpoint Demo",review:AssetReviewService.localReview()});
    assert.match(made.asset.assetId,/^[0-9a-f-]{36}$/);assert.equal(made.asset.assetId.includes("PC-DEMO"),false);assert.equal(made.asset.externalInventoryId,undefined);
    assert.equal(made.link.confirmationMethod,"HumanReview");assert.equal(made.link.confirmedBy,"local_operator");assert.equal((await service.listUnreviewed()).length,0);
    const current=await service.currentView(made.asset.assetId);assert.equal(current?.["observed_endpoint_id"],endpoint);assert.equal(current?.["preflight_status"],"completed");
    const events=await repo.auditEvents(made.asset.assetId);assert.deepEqual(events.map(e=>e["event_type"]),["asset.created","asset.endpoint_linked"]);
    assert.doesNotMatch(JSON.stringify(events),/RAW_SECRET_MARKER/);const snapshot=metrics.snapshot(0,0);assert.equal(snapshot.assets_created,1);assert.equal(snapshot.asset_links_created,1);assert.equal(snapshot.unreviewed_endpoints,0);
  }finally{await repo.close();}
}));

test("ExternalInventoryId is operator-provided, case-insensitively unique, and failed create leaves no partial Asset",async()=>isolated(async url=>{
  const [a,b]=await seed(url,["A","B"]);const repo=await AssetRegistryRepository.start(url);const service=new AssetReviewService(repo,new FakeClock(new Date()),new MetricsRegistry());
  try{await service.createAssetFromObservedEndpoint({observedEndpointId:a!,displayName:"A",externalInventoryId:"LAB-PC-001",review:AssetReviewService.localReview()});
    await assert.rejects(service.createAssetFromObservedEndpoint({observedEndpointId:b!,displayName:"B",externalInventoryId:"lab-pc-001",review:AssetReviewService.localReview()}),
      (error:unknown)=>error instanceof AssetRegistryConflict&&error.code==="external_inventory_id_conflict");assert.equal((await service.listAssets()).length,1);
    await assert.rejects(service.createAssetFromObservedEndpoint({observedEndpointId:crypto.randomUUID(),displayName:"Orphan",review:AssetReviewService.localReview()}),/observed_endpoint_not_found/);
    assert.equal((await service.listAssets()).length,1);
  }finally{await repo.close();}
}));

test("one Asset accepts multiple manually selected endpoints despite renamed hostname and preserves navigable history",async()=>isolated(async url=>{
  const [first,renamed]=await seed(url,["PC-DEMO-001","PC-DEMO-RENAMED"]);const repo=await AssetRegistryRepository.start(url);const service=new AssetReviewService(repo,new FakeClock(new Date()));
  try{const made=await service.createAssetFromObservedEndpoint({observedEndpointId:first!,displayName:"Endpoint Demo",externalInventoryId:"LAB-PC-001",review:AssetReviewService.localReview()});
    await service.linkObservedEndpoint({assetId:made.asset.assetId,observedEndpointId:renamed!,review:AssetReviewService.localReview()});
    const history=await service.history(made.asset.assetId);assert.equal(new Set(history.map(row=>row["observed_endpoint_id"])).size,2);
    assert.equal(history.every(row=>row["session_id"]&&row["preflight_run_id"]&&row["observation_id"]),true);assert.equal((await service.listUnreviewed()).length,0);
  }finally{await repo.close();}
}));

test("two concurrent local operators reviewing one endpoint produce one winner and one explicit conflict",async()=>isolated(async url=>{
  const [endpoint]=await seed(url,["RACE"]);const left=await AssetRegistryRepository.start(url),right=await AssetRegistryRepository.start(url);
  const clock=new FakeClock(new Date());const a=new AssetReviewService(left,clock),b=new AssetReviewService(right,clock);
  try{const settled=await Promise.allSettled([a.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"Left",review:AssetReviewService.localReview()}),
    b.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"Right",review:AssetReviewService.localReview()})]);
    assert.equal(settled.filter(item=>item.status==="fulfilled").length,1);const rejected=settled.find(item=>item.status==="rejected");
    assert.ok(rejected&&rejected.status==="rejected"&&rejected.reason instanceof AssetRegistryConflict);assert.equal(rejected.reason.code,"observed_endpoint_already_linked");
    assert.equal((await left.listAssets()).length,1);
  }finally{await left.close();await right.close();}
}));

test("manual correction revokes old link, creates new link, preserves history and emits sanitized audits transactionally",async()=>isolated(async url=>{
  const [one,two]=await seed(url,["ONE","TWO"]);const repo=await AssetRegistryRepository.start(url);const metrics=new MetricsRegistry();const service=new AssetReviewService(repo,new FakeClock(new Date()),metrics);
  try{const a=await service.createAssetFromObservedEndpoint({observedEndpointId:one!,displayName:"A",review:AssetReviewService.localReview()});
    const b=await service.createAssetFromObservedEndpoint({observedEndpointId:two!,displayName:"B",review:AssetReviewService.localReview()});
    const corrected=await service.correctLink({observedEndpointId:one!,newAssetId:b.asset.assetId,reason:"Operator corrected target",review:AssetReviewService.localReview()});
    assert.equal(corrected.revoked.status,"Revoked");assert.equal(corrected.linked.status,"Active");assert.notEqual(corrected.revoked.linkId,corrected.linked.linkId);
    assert.equal((await service.history(a.asset.assetId))[0]?.["link_status"],"Revoked");assert.equal(metrics.snapshot(0,0).asset_links_corrected,1);
    assert.deepEqual((await repo.auditEvents(b.asset.assetId)).map(e=>e["event_type"]),["asset.created","asset.endpoint_linked","asset.endpoint_relinked"]);
  }finally{await repo.close();}
}));

test("Retired Asset remains queryable and rejects every new active link",async()=>isolated(async url=>{
  const [one,two]=await seed(url,["ONE","TWO"]);const repo=await AssetRegistryRepository.start(url);const metrics=new MetricsRegistry();const service=new AssetReviewService(repo,new FakeClock(new Date()),metrics);
  try{const made=await service.createAssetFromObservedEndpoint({observedEndpointId:one!,displayName:"Retire me",review:AssetReviewService.localReview()});
    assert.equal((await service.retireAsset({assetId:made.asset.assetId,reason:"Lifecycle ended",review:AssetReviewService.localReview()})).status,"Retired");
    assert.equal((await service.listAssets()).find(a=>a.assetId===made.asset.assetId)?.status,"Retired");
    await assert.rejects(service.linkObservedEndpoint({assetId:made.asset.assetId,observedEndpointId:two!,review:AssetReviewService.localReview()}),
      (error:unknown)=>error instanceof AssetRegistryConflict&&error.code==="asset_retired");assert.equal(metrics.snapshot(0,0).assets_retired,1);
  }finally{await repo.close();}
}));

test("registry survives repository restart without creating Assets or links on startup",async()=>isolated(async url=>{
  const [endpoint]=await seed(url,["RESTART"]);let repo=await AssetRegistryRepository.start(url);const service=new AssetReviewService(repo,new FakeClock(new Date()));
  const made=await service.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"Durable",review:AssetReviewService.localReview()});await repo.close();
  repo=await AssetRegistryRepository.start(url);try{assert.equal((await repo.listAssets())[0]?.assetId,made.asset.assetId);assert.equal((await repo.listUnreviewed()).length,0);
    assert.equal((await repo.history(made.asset.assetId)).length,1);}finally{await repo.close();}
}));

test("malicious names, reasons and identifiers are rejected as data; no credentials or prohibited fields enter registry schema",async()=>isolated(async url=>{
  const [endpoint]=await seed(url,["SAFE"]);const repo=await AssetRegistryRepository.start(url);const service=new AssetReviewService(repo,new FakeClock(new Date()));
  try{await assert.rejects(service.createAssetFromObservedEndpoint({observedEndpointId:endpoint!,displayName:"bad\u001bname",review:AssetReviewService.localReview()}),/invalid_display_name/);
    const pool=new Pool({connectionString:url});try{const columns=await pool.query<{column_name:string}>(`SELECT column_name FROM information_schema.columns WHERE table_schema=current_schema()
      AND table_name IN ('assets','asset_endpoint_links')`);const names=columns.rows.map(r=>r.column_name).join(" ");assert.doesNotMatch(names,/payload|secret|token|username|sid|email/i);}
    finally{await pool.end();}
  }finally{await repo.close();}
}));

async function seed(url:string,names:string[]):Promise<string[]>{const pool=new Pool({connectionString:url});const server=crypto.randomUUID();const endpoints:string[]=[];
  try{await pool.query("INSERT INTO server_instances(server_instance_id,started_at) VALUES($1,now())",[server]);for(const name of names){const session=crypto.randomUUID(),endpoint=crypto.randomUUID(),request=crypto.randomUUID(),evidence=crypto.randomUUID(),observation=crypto.randomUUID(),preflight=crypto.randomUUID();endpoints.push(endpoint);
    await pool.query(`INSERT INTO session_records(session_id,agent_instance_id,protocol_version,server_instance_id,created_at,last_seen_at,historical_status,capabilities,authenticated)
      VALUES($1,$2,'1.0',$3,now(),now(),'closed','[]',true)`,[session,crypto.randomUUID(),server]);
    await pool.query(`INSERT INTO observed_endpoints VALUES($1,$2,$3,'Windows',now(),now())`,[endpoint,session,name]);
    await pool.query(`INSERT INTO observation_requests(request_id,session_id,server_instance_id,capability_id,capability_version,created_at,deadline,state,completed_at)
      VALUES($1,$2,$3,'windows.os.summary','1.0',now(),now(),'completed',now())`,[request,session,server]);
    await pool.query(`INSERT INTO evidence_metadata VALUES($1,$2,'windows.os.summary','1.0',now(),'agent.windows.os','RAW',17)`,[evidence,request]);
    await pool.query(`INSERT INTO observations VALUES($1,$2,$3,now(),'windows-os-summary-collected','Safe minimized statement','MINIMIZED',$4::jsonb)`,[observation,request,evidence,JSON.stringify({machineName:name,osDescription:"Windows Demo"})]);
    await pool.query(`INSERT INTO preflight_runs(preflight_run_id,session_id,server_instance_id,observed_endpoint_id,created_at,started_at,completed_at,status,duration_ms)
      VALUES($1,$2,$3,$4,now(),now(),now(),'completed',1)`,[preflight,session,server,endpoint]);
    await pool.query(`INSERT INTO preflight_observations VALUES($1,'windows.os.summary',$2)`,[preflight,request]);
    await pool.query(`INSERT INTO preflight_snapshots VALUES($1,now(),'0.1.0','1.0',100,'INTERNAL','{}','[]')`,[preflight]);}
    return endpoints;
  }finally{await pool.end();}}

async function isolated(work:(url:string)=>Promise<void>):Promise<void>{const configured=process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];if(!configured)throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");
  requireSafeTestDatabase(configured);const schema=`ms_test_${crypto.randomUUID().replaceAll("-","")}`;const admin=new Pool({connectionString:configured});await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed=new URL(configured);parsed.searchParams.set("options",`-csearch_path=${schema}`);try{const pool=new Pool({connectionString:parsed.toString()});try{await migrate(pool);}finally{await pool.end();}await work(parsed.toString());}
  finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}
