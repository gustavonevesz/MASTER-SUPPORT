import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { buildApp } from "../../apps/server/src/app.js";
import { HarnessOperatorAuthProvider } from "../../apps/server/src/operator-auth/provider.js";
import { requireSafeOperatorAuthConfiguration } from "../../apps/server/src/operator-auth/config.js";
import { OperatorAuthRepository, hash } from "../../apps/server/src/operator-auth/repository.js";
import { OperatorAuthService } from "../../apps/server/src/operator-auth/service.js";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { FakeClock } from "../../apps/server/src/session/clock.js";

test("operator authentication, durable sessions, authorization and security controls",async()=>isolated(async url=>{
  const clock=new FakeClock(new Date("2026-10-15T12:00:00Z"));const repository=await OperatorAuthRepository.start(url);const service=new OperatorAuthService(repository,clock,60_000,180_000);
  const identity={provider:"test-oidc",providerSubject:"stable-subject-1",displayName:"Gustavo Teste"};const operator=await service.provision(identity);
  const provider=new HarnessOperatorAuthProvider("test-oidc",identity);const runtime={service,provider,clock,publicOrigin:"http://127.0.0.1:4173",secureCookie:false,developmentProvider:false,rateLimit:100};
  const context=buildApp({operatorAuth:runtime,exposeDevelopmentSessions:false});
  try{
    assert.equal((await context.app.inject({method:"GET",url:"/api/auth/session"})).statusCode,401);
    assert.equal((await context.app.inject({method:"GET",url:"/auth/login?returnUrl=https%3A%2F%2Fevil.example"})).statusCode,400);
    assert.equal((await context.app.inject({method:"GET",url:"/auth/login?returnUrl=%2F%2Fevil.example"})).statusCode,400);
    const start=await context.app.inject({method:"GET",url:"/auth/login?returnUrl=%2Fassets"});assert.equal(start.statusCode,302);
    const callbackUrl=new URL(String(start.headers.location));const callback=await context.app.inject({method:"GET",url:`${callbackUrl.pathname}${callbackUrl.search}`});assert.equal(callback.statusCode,302);assert.equal(callback.headers.location,"/assets");
    const setCookie=String(callback.headers["set-cookie"]);assert.match(setCookie,/HttpOnly/);assert.match(setCookie,/SameSite=Strict/);assert.doesNotMatch(setCookie,/Secure/);const cookie=setCookie.split(";",1)[0]!;const token=cookie.split("=",2)[1]!;
    assert.equal((await context.app.inject({method:"GET",url:`${callbackUrl.pathname}${callbackUrl.search}`})).statusCode,401,"callback is single-use");
    const session=await context.app.inject({method:"GET",url:"/api/auth/session",headers:{cookie}});assert.equal(session.statusCode,200);const body=session.json<{csrfToken:string;operator:{permissions:string[];displayName:string}}>();assert.deepEqual(body.operator.permissions,["console.read"]);assert.equal(body.operator.displayName,"Gustavo Teste");
    const pool=new Pool({connectionString:url});try{const stored=await pool.query<{token_hash:string}>("SELECT token_hash FROM operator_sessions");assert.equal(stored.rows.length,1);assert.equal(stored.rows[0]!.token_hash,hash(token));assert.doesNotMatch(JSON.stringify(stored.rows),new RegExp(token));
      const events=await pool.query<{event_type:string;reason:string|null}>("SELECT event_type,reason FROM operator_security_events");assert.ok(events.rows.some(x=>x.event_type==="operator.authentication_succeeded"));assert.doesNotMatch(JSON.stringify(events.rows),/stable-subject-1|authorization code|cookie|pkce/i);
    }finally{await pool.end();}
    assert.equal((await context.app.inject({method:"POST",url:"/api/auth/logout",headers:{cookie,origin:"http://evil.example","x-csrf-token":body.csrfToken}})).statusCode,403);
    assert.equal((await context.app.inject({method:"POST",url:"/api/auth/logout",headers:{cookie,origin:runtime.publicOrigin,"x-csrf-token":"wrong"}})).statusCode,403);
    assert.equal((await context.app.inject({method:"POST",url:"/api/auth/logout",headers:{cookie,origin:runtime.publicOrigin,"x-csrf-token":body.csrfToken}})).statusCode,204);
    assert.equal((await service.authorize(token)).status,401,"logout revokes server-side");

    const active=await service.authenticate(identity);clock.advance(60_001);assert.equal((await service.authorize(active.token)).status,401,"idle TTL expires");
    const absolute=await service.authenticate(identity);clock.advance(50_000);assert.equal((await service.authorize(absolute.token)).status,200);clock.advance(50_000);assert.equal((await service.authorize(absolute.token)).status,200);clock.advance(80_001);assert.equal((await service.authorize(absolute.token)).status,401,"absolute TTL expires");
    const revoked=await service.authenticate(identity);assert.equal(await service.setStatus(operator.operatorId,"Disabled"),true);assert.equal((await service.authorize(revoked.token)).status,401);await assert.rejects(service.authenticate(identity),/operator_disabled/);
    await assert.rejects(service.authenticate({provider:"test-oidc",providerSubject:"unknown",displayName:"Unknown"}),/operator_not_provisioned/);
  }finally{await context.app.close();await repository.close();}

  const restarted=await OperatorAuthRepository.start(url);try{const restartedService=new OperatorAuthService(restarted,clock,60_000,180_000);await restartedService.setStatus(operator.operatorId,"Active");const issued=await restartedService.authenticate(identity);const nextRepository=await OperatorAuthRepository.start(url);try{const nextService=new OperatorAuthService(nextRepository,clock,60_000,180_000);assert.equal((await nextService.authorize(issued.token)).status,200,"OperatorSession survives restart");
      const pool=new Pool({connectionString:url});try{await pool.query("UPDATE operators SET role=NULL WHERE operator_id=$1",[operator.operatorId]);}finally{await pool.end();}assert.equal((await nextService.authorize(issued.token)).status,403,"authenticated operator without permission is forbidden");
    }finally{await nextRepository.close();}}finally{await restarted.close();}
}));

test("secure cookies and dev provider remain explicit and loopback-only",async()=>isolated(async url=>{const clock=new FakeClock(new Date("2026-10-15T12:00:00Z"));const repository=await OperatorAuthRepository.start(url);const service=new OperatorAuthService(repository,clock);const identity={provider:"development",providerSubject:"configured",displayName:"Configured Dev"};await service.provision(identity);const app=buildApp({operatorAuth:{service,provider:new HarnessOperatorAuthProvider("development",identity),clock,publicOrigin:"https://127.0.0.1:4173",secureCookie:true,developmentProvider:true},exposeDevelopmentSessions:false}).app;
  try{const start=await app.inject({method:"GET",url:"/auth/login"});const target=new URL(String(start.headers.location));const callback=await app.inject({method:"GET",url:`${target.pathname}${target.search}`});assert.match(String(callback.headers["set-cookie"]),/; Secure/);}finally{await app.close();await repository.close();}
  assert.doesNotThrow(()=>requireSafeOperatorAuthConfiguration({host:"127.0.0.1",provider:"development",developmentEnabled:true,publicOrigin:"http://127.0.0.1:4173"}));
  assert.throws(()=>requireSafeOperatorAuthConfiguration({host:"0.0.0.0",provider:"development",developmentEnabled:true,publicOrigin:"http://127.0.0.1:4173"}),/127\.0\.0\.1/);
  assert.throws(()=>requireSafeOperatorAuthConfiguration({host:"127.0.0.1",provider:"development",developmentEnabled:false,publicOrigin:"http://127.0.0.1:4173"}),/explicit_enablement/);
}));

async function isolated(work:(url:string)=>Promise<void>):Promise<void>{const configured=process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];if(!configured)throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");requireSafeTestDatabase(configured);const schema=`ms_test_${crypto.randomUUID().replaceAll("-","")}`;const admin=new Pool({connectionString:configured});await admin.query(`CREATE SCHEMA "${schema}"`);const parsed=new URL(configured);parsed.searchParams.set("options",`-csearch_path=${schema}`);try{const pool=new Pool({connectionString:parsed.toString()});try{await migrate(pool);}finally{await pool.end();}await work(parsed.toString());}finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}}
