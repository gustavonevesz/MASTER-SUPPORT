import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../../apps/server/src/app.js";
import { AssetRegistryRepository } from "../../apps/server/src/asset/repository.js";
import { AssetReviewService } from "../../apps/server/src/asset/service.js";
import { OperatorReadRepository } from "../../apps/server/src/operator-read/repository.js";
import { OperatorReadService } from "../../apps/server/src/operator-read/service.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { FakeClock } from "../../apps/server/src/session/clock.js";

test("read-only operator API exposes paged, sanitized operational views",async()=>isolated(async url=>{
  const seeded=await seed(url,["SHARED-HOST","SHARED-HOST","PENDING-HOST"]);
  const registry=await AssetRegistryRepository.start(url);
  const review=new AssetReviewService(registry,new FakeClock(new Date("2026-10-13T12:30:00Z")));
  const first=await review.createAssetFromObservedEndpoint({observedEndpointId:seeded[0]!.endpointId,displayName:"Finance workstation",externalInventoryId:"PC000049",review:AssetReviewService.localReview()});
  const second=await review.createAssetFromObservedEndpoint({observedEndpointId:seeded[1]!.endpointId,displayName:"Retired workstation",review:AssetReviewService.localReview()});
  await review.retireAsset({assetId:second.asset.assetId,reason:"Lifecycle ended",review:AssetReviewService.localReview()});
  await registry.close();

  const repository=await OperatorReadRepository.start(url);
  const context=buildApp({operatorRead:new OperatorReadService(repository),exposeDevelopmentSessions:false});
  try{
    const list=await context.app.inject({method:"GET",url:"/api/assets?page=1&pageSize=1&search=workstation"});
    assert.equal(list.statusCode,200);assert.equal(list.headers["x-content-type-options"],"nosniff");assert.match(String(list.headers["content-security-policy"]),/default-src 'none'/);
    const firstPage=list.json<{items:Array<Record<string,unknown>>;total:number;totalPages:number}>();assert.equal(firstPage.items.length,1);assert.equal(firstPage.total,2);assert.equal(firstPage.totalPages,2);

    const all=(await context.app.inject({method:"GET",url:"/api/assets?pageSize=20"})).json<{items:Array<{assetId:string;status:string;displayName:string}>}>();
    assert.equal(all.items.length,2);assert.equal(all.items.find(item=>item.assetId===second.asset.assetId)?.status,"Retired");
    assert.equal(new Set(all.items.map(item=>item.assetId)).size,2,"equal observed hostnames remain distinct Assets");

    const detailResponse=await context.app.inject({method:"GET",url:`/api/assets/${first.asset.assetId}`});
    assert.equal(detailResponse.statusCode,200);const detail=detailResponse.json<Record<string,unknown>>();const serialized=JSON.stringify(detail);
    assert.match(serialized,/Finance workstation/);assert.match(serialized,/SHARED-HOST/);assert.match(serialized,/Windows 11 Pro/);assert.match(serialized,/HumanReview/);
    assert.doesNotMatch(serialized,/RAW_SECRET_MARKER|connectionTicket|resumeTicket|invitationSecret|secretHash/i);

    const preflights=await context.app.inject({method:"GET",url:`/api/assets/${first.asset.assetId}/preflights?page=1&pageSize=1`});
    assert.equal(preflights.statusCode,200);assert.equal(preflights.json<{items:unknown[];total:number}>().total,1);assert.doesNotMatch(preflights.body,/RAW_SECRET_MARKER/);
    const timeline=await context.app.inject({method:"GET",url:`/api/assets/${first.asset.assetId}/timeline?page=1&pageSize=20`});
    assert.equal(timeline.statusCode,200);assert.match(timeline.body,/Asset created after human review|Observed endpoint linked to Asset/);assert.doesNotMatch(timeline.body,/RAW_SECRET_MARKER|SELECT |node_modules/i);

    const session=await context.app.inject({method:"GET",url:`/api/sessions/${seeded[0]!.sessionId}`});
    assert.equal(session.statusCode,200);assert.match(session.body,/Finance workstation/);assert.doesNotMatch(session.body,/ticket|secret|invitation/i);
    const pending=await context.app.inject({method:"GET",url:"/api/unreviewed-endpoints?page=1&pageSize=20"});
    assert.equal(pending.statusCode,200);assert.match(pending.body,/PENDING-HOST/);assert.match(pending.body,/Pending human review/);

    assert.equal((await context.app.inject({method:"GET",url:"/api/assets/not-a-uuid"})).statusCode,400);
    assert.equal((await context.app.inject({method:"GET",url:`/api/assets/${crypto.randomUUID()}`})).statusCode,404);
    assert.equal((await context.app.inject({method:"GET",url:"/api/assets?page=0"})).statusCode,400);
    assert.equal((await context.app.inject({method:"POST",url:"/api/assets",payload:{}})).statusCode,404);
    assert.equal((await context.app.inject({method:"PUT",url:`/api/assets/${first.asset.assetId}`,payload:{}})).statusCode,404);
    assert.equal((await context.app.inject({method:"DELETE",url:`/api/assets/${first.asset.assetId}`})).statusCode,404);
  }finally{await context.app.close();await repository.close();}
}));

type Seeded=Readonly<{endpointId:string;sessionId:string}>;
async function seed(url:string,names:string[]):Promise<Seeded[]>{const pool=new Pool({connectionString:url});const server=crypto.randomUUID();const seeded:Seeded[]=[];
  try{await pool.query("INSERT INTO server_instances(server_instance_id,started_at) VALUES($1,now())",[server]);for(const name of names){const session=crypto.randomUUID(),endpoint=crypto.randomUUID(),request=crypto.randomUUID(),evidence=crypto.randomUUID(),observation=crypto.randomUUID(),preflight=crypto.randomUUID();seeded.push({endpointId:endpoint,sessionId:session});
    await pool.query(`INSERT INTO session_records(session_id,agent_instance_id,protocol_version,server_instance_id,created_at,last_seen_at,historical_status,capabilities,authenticated)
      VALUES($1,$2,'1.0',$3,now(),now(),'closed','[]',true)`,[session,crypto.randomUUID(),server]);
    await pool.query("INSERT INTO observed_endpoints VALUES($1,$2,$3,'Windows',now(),now())",[endpoint,session,name]);
    await pool.query(`INSERT INTO observation_requests(request_id,session_id,server_instance_id,capability_id,capability_version,created_at,deadline,state,completed_at)
      VALUES($1,$2,$3,'windows.os.summary','1.0',now(),now(),'completed',now())`,[request,session,server]);
    await pool.query("INSERT INTO evidence_metadata VALUES($1,$2,'windows.os.summary','1.0',now(),'agent.windows.os','RAW',17)",[evidence,request]);
    await pool.query(`INSERT INTO observations VALUES($1,$2,$3,now(),'windows-os-summary-collected','Safe minimized statement','MINIMIZED',$4::jsonb)`,
      [observation,request,evidence,JSON.stringify({machineName:name,osDescription:"Windows 11 Pro",windowsBuild:"26100",rawCanary:"RAW_SECRET_MARKER"})]);
    await pool.query(`INSERT INTO preflight_runs(preflight_run_id,session_id,server_instance_id,observed_endpoint_id,created_at,started_at,completed_at,status,duration_ms)
      VALUES($1,$2,$3,$4,now(),now(),now(),'completed',25)`,[preflight,session,server,endpoint]);
    await pool.query("INSERT INTO preflight_observations VALUES($1,'windows.os.summary',$2)",[preflight,request]);
    await pool.query("INSERT INTO preflight_snapshots VALUES($1,now(),'0.1.0','1.0',100,'MINIMIZED','{}','[]')",[preflight]);}
    return seeded;
  }finally{await pool.end();}}

async function isolated(work:(url:string)=>Promise<void>):Promise<void>{const configured=process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];if(!configured)throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");
  requireSafeTestDatabase(configured);const schema=`ms_test_${crypto.randomUUID().replaceAll("-","")}`;const admin=new Pool({connectionString:configured});await admin.query(`CREATE SCHEMA "${schema}"`);
  const parsed=new URL(configured);parsed.searchParams.set("options",`-csearch_path=${schema}`);try{const pool=new Pool({connectionString:parsed.toString()});try{await migrate(pool);}finally{await pool.end();}await work(parsed.toString());}
  finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}
