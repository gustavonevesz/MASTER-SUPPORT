import assert from "node:assert/strict";
import { test } from "node:test";
import { MetricsRegistry } from "../src/observation/metrics.js";
import { preflightCapabilities } from "../src/observation/service.js";
import type { ObservationRequestRecord } from "../src/observation/store.js";
import { PreflightService } from "../src/preflight/service.js";
import { FakeClock } from "../src/session/clock.js";
import type { Session } from "../src/session/session.js";
import { InMemorySessionStore } from "../src/session/store.js";

type Outcome = "completed" | "failed" | "timed_out" | "cancelled";

class FakeObservations {
  public readonly metrics = new MetricsRegistry();
  private readonly records = new Map<string, ObservationRequestRecord>();
  public onWait?: (record: ObservationRequestRecord) => void;
  public constructor(private readonly outcomes: Record<string, Outcome> = {}) {}
  public async startDurable(sessionId: string, capabilityId: string): Promise<ObservationRequestRecord> {
    const requestId = crypto.randomUUID(); const state = this.outcomes[capabilityId] ?? "completed";
    const facts = factsFor(capabilityId); const evidenceId = crypto.randomUUID();
    const record: ObservationRequestRecord = { requestId, sessionId, agentInstanceId: crypto.randomUUID(), capabilityId,
      capabilityVersion: "1.0", createdAt: new Date().toISOString(), deadline: new Date(Date.now()+1000).toISOString(), state,
      lifecycle: ["created", state], lateOutcomes: [], ...(state === "completed" ? { evidence: { evidenceId, payload: facts },
        observation: { observationId: crypto.randomUUID(), evidenceId, facts } } : { failure: { code: state, message: state } }) };
    this.records.set(requestId, record); return record;
  }
  public async wait(requestId: string): Promise<ObservationRequestRecord> { const record=this.records.get(requestId)!;this.onWait?.(record);return record; }
  public getRecord(requestId: string): ObservationRequestRecord | undefined { return this.records.get(requestId); }
}

function session(authenticated=true, capabilities=preflightCapabilities): Session { const now=new Date(); return { id:crypto.randomUUID(),agentInstanceId:crypto.randomUUID(),
  protocolVersion:"1.0",capabilities:[...capabilities],createdAt:now,lastSeenAt:now,expiresAt:new Date(now.getTime()+60_000),state:"active",authenticated,
  resumeToken:"not-exposed",processedMessageIds:new Set(),messageOrder:[] }; }
function factsFor(id:string):Record<string,unknown>{ switch(id){
  case "system.runtime.summary": return {agentVersion:"0.1.0"};
  case "windows.os.summary": return {machineName:"TEST-HOST"};
  case "windows.memory.summary": return {totalPhysicalMemoryBytes:16,availablePhysicalMemoryBytes:8,usedPhysicalMemoryBytes:8};
  case "windows.storage.summary": return {volumes:[]};
  default:return {isElevated:false,executionMode:"SupportSession"};
} }
function fixture(outcomes:Record<string,Outcome>={}){const store=new InMemorySessionStore(),clock=new FakeClock(new Date("2026-10-09T12:00:00Z"));
  const observations=new FakeObservations(outcomes);return {store,clock,observations,service:new PreflightService(store,observations as never,clock)};}

test("authenticated active negotiated session produces completed bounded snapshot and observed endpoint",async()=>{const f=fixture(),s=session();f.store.save(s);
  const run=await f.service.start(s.id);assert.equal(run.status,"completed");assert.equal(run.observationIds.length,5);assert.equal(run.snapshot?.completenessPercent,100);
  assert.equal(run.observedEndpoint?.observedMachineName,"TEST-HOST");assert.equal(Object.hasOwn(run,"asset"),false);assert.equal(JSON.stringify(run.snapshot).includes("evidence"),false);
  assert.equal(f.observations.metrics.snapshot(1,0).preflight_completed,1);});

test("missing capability, unauthenticated session, and revoked session fail closed",async()=>{
  for(const s of [session(true,preflightCapabilities.slice(0,4)),session(false),session()]){const f=fixture();if(s.authenticated&&s.capabilities.length===5)s.state="revoked";f.store.save(s);
    await assert.rejects(f.service.start(s.id),/required_capability_missing|session_not_authenticated|session_not_active/);}
});

test("one capability failure is partial and total failure is failed",async()=>{const one=fixture({"windows.storage.summary":"failed"}),s1=session();one.store.save(s1);
  assert.equal((await one.service.start(s1.id)).status,"partial");const failures=Object.fromEntries(preflightCapabilities.map(c=>[c.id,"failed" as const]));const all=fixture(failures),s2=session();all.store.save(s2);
  const failed=await all.service.start(s2.id);assert.equal(failed.status,"failed");assert.equal(failed.snapshot,undefined);assert.equal(failed.observedEndpoint,undefined);});

test("authority loss cancels the workflow without inventing a complete snapshot",async()=>{const f=fixture(),s=session();f.store.save(s);let count=0;
  f.observations.onWait=()=>{if(++count===1)s.state="revoked";};const run=await f.service.start(s.id);assert.equal(run.status,"cancelled");assert.equal(run.observationIds.length,1);
  assert.ok((run.snapshot?.completenessPercent??100)<100);assert.equal(f.observations.metrics.snapshot(0,0).preflight_cancelled,1);});

test("same session reuses ObservedEndpoint but keeps runs; equal hostnames across sessions never correlate",async()=>{const f=fixture(),a=session(),b=session();f.store.save(a);f.store.save(b);
  const first=await f.service.start(a.id);f.clock.advance(1000);const second=await f.service.start(a.id);const other=await f.service.start(b.id);
  assert.notEqual(first.preflightRunId,second.preflightRunId);assert.notEqual(first.completedAt,second.completedAt);assert.equal(first.observedEndpoint?.observedEndpointId,second.observedEndpoint?.observedEndpointId);
  assert.equal(first.observedEndpoint?.preflightRunId,first.preflightRunId);assert.equal(second.observedEndpoint?.preflightRunId,second.preflightRunId);
  assert.notEqual(first.observedEndpoint?.observedEndpointId,other.observedEndpoint?.observedEndpointId);assert.equal(f.service.listForSession(a.id).length,2);
});

test("timeout and explicit capability cancellation remain capability failures, not fabricated facts",async()=>{for(const outcome of ["timed_out","cancelled"] as const){
  const f=fixture({"windows.storage.summary":outcome}),s=session();f.store.save(s);const run=await f.service.start(s.id);assert.equal(run.status,"partial");
  assert.equal(run.capabilityFailureCount,1);assert.equal(run.observationIds.length,4);}}
);
