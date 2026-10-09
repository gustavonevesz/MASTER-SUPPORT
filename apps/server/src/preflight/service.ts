import { randomUUID } from "node:crypto";
import type { ObservationService } from "../observation/service.js";
import { preflightCapabilities } from "../observation/service.js";
import type { DurablePersistence } from "../persistence/models.js";
import type { Clock } from "../session/clock.js";
import type { SessionStore } from "../session/store.js";
import type { ObservedEndpoint, PreflightRun, PreflightSnapshot } from "./models.js";

export class PreflightService {
  private readonly runs=new Map<string,PreflightRun>(); private readonly activeBySession=new Set<string>(); private readonly endpoints=new Map<string,ObservedEndpoint>();
  public constructor(private readonly sessions:SessionStore,private readonly observations:ObservationService,private readonly clock:Clock,private readonly durability?:DurablePersistence){}
  public get(id:string):PreflightRun|undefined{return this.runs.get(id);}
  public listForSession(id:string):readonly PreflightRun[]{return [...this.runs.values()].filter(run=>run.sessionId===id);}
  public async start(sessionId:string):Promise<PreflightRun>{
    const session=this.sessions.get(sessionId); if(!session||session.state!=="active")throw new Error("session_not_active");
    if(session.authenticated!==true)throw new Error("session_not_authenticated");
    for(const required of preflightCapabilities)if(!session.capabilities.some(item=>item.id===required.id&&item.version===required.version))throw new Error("required_capability_missing");
    if(this.activeBySession.has(sessionId))throw new Error("preflight_already_running");
    const now=this.clock.now(); const run:PreflightRun={preflightRunId:randomUUID(),sessionId,createdAt:now.toISOString(),startedAt:now.toISOString(),status:"running",
      capabilityFailureCount:0,requestIds:[],observationIds:[],capabilityResults:[]}; this.runs.set(run.preflightRunId,run);this.activeBySession.add(sessionId);
    this.observations.metrics.increment("preflight_started");
    try{
      if(this.durability)await this.durability.persistPreflightStarted(run);
      for(const capability of preflightCapabilities){
        if(this.sessions.get(sessionId)?.state!=="active")break;
        try{const request=await this.observations.startDurable(sessionId,capability.id);run.requestIds.push(request.requestId);
          const result=await this.observations.wait(request.requestId);const observationId=typeof result.observation?.observationId==="string"?result.observation.observationId:undefined;
          run.capabilityResults.push({capabilityId:capability.id,requestId:request.requestId,...(observationId?{observationId}:{})});
          if(result.state==="completed"&&observationId)run.observationIds.push(observationId);else{run.capabilityFailureCount++;this.observations.metrics.increment("preflight_capability_failure");}
        }catch{run.capabilityFailureCount++;this.observations.metrics.increment("preflight_capability_failure");}
      }
      const current=this.sessions.get(sessionId); const completed=run.observationIds.length;
      run.status=current?.state!=="active"?"cancelled":completed===preflightCapabilities.length?"completed":completed>0?"partial":"failed";
      const finished=this.clock.now();run.completedAt=finished.toISOString();run.durationMs=Math.max(0,finished.getTime()-now.getTime());
      if(completed>0){const results=run.capabilityResults.map(item=>this.observationsStore(item.requestId)).filter(item=>item!==undefined);
        const runtime=results.find(item=>item!.capabilityId==="system.runtime.summary")?.observation?.facts as Record<string,unknown>|undefined;
        const os=results.find(item=>item!.capabilityId==="windows.os.summary")?.observation?.facts as Record<string,unknown>|undefined;
        const versions=Object.fromEntries(run.capabilityResults.filter(item=>item.observationId).map(item=>[item.capabilityId,"1.0"]));
        run.snapshot={preflightRunId:run.preflightRunId,capturedAt:finished.toISOString(),...(typeof runtime?.agentVersion==="string"?{agentVersion:runtime.agentVersion}:{}),
          protocolVersion:"1.0",capabilityVersions:versions,observationIds:[...run.observationIds],completenessPercent:Math.floor(completed*100/preflightCapabilities.length),dataClassification:"INTERNAL"};
        if(os&&typeof os.machineName==="string"){const existing=this.endpoints.get(sessionId);run.observedEndpoint=existing?
          {...existing,preflightRunId:run.preflightRunId,observedMachineName:os.machineName,lastObservedAt:finished.toISOString()}:
          {observedEndpointId:randomUUID(),sessionId,preflightRunId:run.preflightRunId,observedMachineName:os.machineName,
            firstObservedAt:finished.toISOString(),lastObservedAt:finished.toISOString(),platform:"Windows"};this.endpoints.set(sessionId,run.observedEndpoint);}
      }
      this.observations.metrics.increment(`preflight_${run.status}`);this.observations.metrics.observePreflightDuration(run.durationMs);
      if(this.durability)await this.durability.persistPreflightFinished(run);return run;
    }finally{this.activeBySession.delete(sessionId);}
  }
  private observationsStore(requestId:string){return this.observations.getRecord(requestId);}
}
