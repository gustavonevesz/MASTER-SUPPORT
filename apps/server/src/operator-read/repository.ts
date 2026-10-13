import { Pool } from "pg";
import { validateCurrentSchema } from "../persistence/migrations.js";
import type { AssetDetailDto, AssetSummaryDto, EndpointSummaryDto, Page, PreflightSummaryDto, SessionSummaryDto, TimelineEventDto, UnreviewedEndpointDto } from "./dtos.js";

type Paging={page:number;pageSize:number};
export class OperatorReadRepository {
  private constructor(private readonly pool:Pool){}
  public static async start(databaseUrl:string):Promise<OperatorReadRepository>{const pool=new Pool({connectionString:databaseUrl,max:5,connectionTimeoutMillis:3_000});
    try{await validateCurrentSchema(pool);return new OperatorReadRepository(pool);}catch(error){await pool.end().catch(()=>undefined);throw error;}}

  public async listAssets(input:Paging&{search:string}):Promise<Page<AssetSummaryDto>>{const offset=(input.page-1)*input.pageSize;
    const values=[input.search,input.pageSize,offset];const result=await this.pool.query<Record<string,unknown>>(`WITH filtered AS (
      SELECT a.* FROM assets a WHERE $1='' OR a.display_name ILIKE '%'||$1||'%' OR COALESCE(a.external_inventory_id,'') ILIKE '%'||$1||'%'
    ), counted AS (SELECT count(*)::integer total FROM filtered)
    SELECT f.asset_id,f.display_name,f.external_inventory_id,f.asset_type,f.status,current.last_observed_at,current.preflight_status,
      current.facts_by_capability,(SELECT total FROM counted) total FROM filtered f
    LEFT JOIN LATERAL (${currentEndpointSql("f.asset_id")}) current ON true ORDER BY f.display_name,f.asset_id LIMIT $2 OFFSET $3`,values);
    const total=Number(result.rows[0]?.["total"]??0);return page(result.rows.map(mapAssetSummary),input,total);}

  public async assetDetail(assetId:string):Promise<AssetDetailDto|undefined>{const assetResult=await this.pool.query<Record<string,unknown>>(`SELECT a.asset_id,a.display_name,
    a.external_inventory_id,a.asset_type,a.status,current.last_observed_at,current.preflight_status,current.facts_by_capability
    FROM assets a LEFT JOIN LATERAL (${currentEndpointSql("a.asset_id")}) current ON true WHERE a.asset_id=$1`,[assetId]);
    const row=assetResult.rows[0];if(!row)return undefined;const endpointRows=await this.pool.query<Record<string,unknown>>(`SELECT e.observed_endpoint_id,e.observed_machine_name,e.platform,
      e.first_observed_at,e.last_observed_at,l.status link_status,l.confirmation_method,e.session_id FROM asset_endpoint_links l JOIN observed_endpoints e USING(observed_endpoint_id)
      WHERE l.asset_id=$1 ORDER BY e.last_observed_at DESC,l.confirmed_at DESC`,[assetId]);const endpoints=endpointRows.rows.map(mapEndpoint);
    const latestPreflight=(await this.preflights(assetId,{page:1,pageSize:1})).items[0];return {asset:mapAssetSummary(row),identity:{state:"Confirmed Asset",method:"HumanReview"},
      ...(endpoints[0]?{latestObservedEndpoint:endpoints[0]}:{}),...(latestPreflight?{latestPreflight}:{}),endpoints};}

  public async preflights(assetId:string,input:Paging):Promise<Page<PreflightSummaryDto>>{const offset=(input.page-1)*input.pageSize;
    const result=await this.pool.query<Record<string,unknown>>(`WITH linked AS (SELECT DISTINCT observed_endpoint_id FROM asset_endpoint_links WHERE asset_id=$1),
      counted AS (SELECT count(*)::integer total FROM preflight_runs p JOIN linked USING(observed_endpoint_id))
      SELECT p.preflight_run_id,p.session_id,p.observed_endpoint_id,COALESCE(s.captured_at,p.completed_at,p.created_at) captured_at,p.status,s.completeness_percent,
      count(po.observation_request_id)::integer observation_count,COALESCE(jsonb_object_agg(po.capability_id,o.facts) FILTER(WHERE po.capability_id IS NOT NULL),'{}'::jsonb) facts_by_capability,
      (SELECT total FROM counted) total FROM preflight_runs p JOIN linked USING(observed_endpoint_id) LEFT JOIN preflight_snapshots s USING(preflight_run_id)
      LEFT JOIN preflight_observations po USING(preflight_run_id) LEFT JOIN observations o ON o.observation_request_id=po.observation_request_id
      GROUP BY p.preflight_run_id,s.captured_at,s.completeness_percent ORDER BY captured_at DESC LIMIT $2 OFFSET $3`,[assetId,input.pageSize,offset]);
    const total=Number(result.rows[0]?.["total"]??0);return page(result.rows.map(mapPreflight),input,total);}

  public async timeline(assetId:string,input:Paging):Promise<Page<TimelineEventDto>>{const offset=(input.page-1)*input.pageSize;
    const result=await this.pool.query<Record<string,unknown>>(`WITH endpoints AS (SELECT DISTINCT observed_endpoint_id FROM asset_endpoint_links WHERE asset_id=$1),
      sessions AS (SELECT session_id FROM observed_endpoints JOIN endpoints USING(observed_endpoint_id)), relevant AS (
        SELECT ae.* FROM audit_events ae WHERE ae.asset_id=$1 OR ae.observed_endpoint_id IN (SELECT observed_endpoint_id FROM endpoints) OR ae.session_id IN (SELECT session_id FROM sessions)
      ), counted AS (SELECT count(*)::integer total FROM relevant)
      SELECT event_id,occurred_at,event_type,status,reason,session_id,preflight_run_id,observed_endpoint_id,(SELECT total FROM counted) total
      FROM relevant ORDER BY occurred_at DESC,event_id LIMIT $2 OFFSET $3`,[assetId,input.pageSize,offset]);
    const total=Number(result.rows[0]?.["total"]??0);return page(result.rows.map(mapTimeline),input,total);}

  public async session(sessionId:string):Promise<SessionSummaryDto|undefined>{const result=await this.pool.query<Record<string,unknown>>(`SELECT s.session_id,s.historical_status,
      s.protocol_version,s.created_at,s.last_seen_at,s.ended_at,s.end_reason,e.observed_endpoint_id,e.observed_machine_name,a.asset_id,a.display_name,a.external_inventory_id,
      runtime.facts->>'agentVersion' agent_version FROM session_records s LEFT JOIN observed_endpoints e USING(session_id)
      LEFT JOIN asset_endpoint_links l ON l.observed_endpoint_id=e.observed_endpoint_id AND l.status='Active' LEFT JOIN assets a USING(asset_id)
      LEFT JOIN LATERAL (SELECT o.facts FROM observation_requests r JOIN observations o ON o.observation_request_id=r.request_id
        WHERE r.session_id=s.session_id AND r.capability_id='system.runtime.summary' AND r.state='completed' ORDER BY r.completed_at DESC LIMIT 1) runtime ON true
      WHERE s.session_id=$1`,[sessionId]);const row=result.rows[0];return row?mapSession(row):undefined;}

  public async unreviewed(input:Paging):Promise<Page<UnreviewedEndpointDto>>{const offset=(input.page-1)*input.pageSize;
    const result=await this.pool.query<Record<string,unknown>>(`WITH pending AS (SELECT e.* FROM observed_endpoints e LEFT JOIN asset_endpoint_links l ON l.observed_endpoint_id=e.observed_endpoint_id AND l.status='Active' WHERE l.link_id IS NULL),
      counted AS (SELECT count(*)::integer total FROM pending) SELECT p.observed_endpoint_id,p.observed_machine_name,p.platform,p.first_observed_at,p.last_observed_at,
      latest.preflight_run_id,latest.session_id,latest.captured_at,latest.preflight_status,latest.completeness_percent,latest.observation_count,latest.facts_by_capability,
      (SELECT total FROM counted) total FROM pending p LEFT JOIN LATERAL (${latestPreflightSql("p.observed_endpoint_id")}) latest ON true
      ORDER BY p.last_observed_at DESC,p.observed_endpoint_id LIMIT $1 OFFSET $2`,[input.pageSize,offset]);const total=Number(result.rows[0]?.["total"]??0);
    return page(result.rows.map(row=>({observedEndpointId:String(row["observed_endpoint_id"]),...optional("observedMachineName",row["observed_machine_name"]),
      platform:String(row["platform"]),firstObservedAt:iso(row["first_observed_at"]),lastObservedAt:iso(row["last_observed_at"]),reviewState:"Pending human review" as const,
      ...(row["preflight_run_id"]?{latestPreflight:mapPreflight(row)}:{})})),input,total);}
  public async close():Promise<void>{await this.pool.end();}
}

function currentEndpointSql(asset:string):string{return `SELECT e.last_observed_at,p.preflight_status,p.facts_by_capability FROM asset_endpoint_links l JOIN observed_endpoints e USING(observed_endpoint_id)
  LEFT JOIN LATERAL (${latestPreflightSql("e.observed_endpoint_id")}) p ON true WHERE l.asset_id=${asset} AND l.status='Active' ORDER BY e.last_observed_at DESC LIMIT 1`;}
function latestPreflightSql(endpoint:string):string{return `SELECT pr.preflight_run_id,pr.session_id,COALESCE(ps.captured_at,pr.completed_at,pr.created_at) captured_at,pr.status preflight_status,
  ps.completeness_percent,count(po.observation_request_id)::integer observation_count,COALESCE(jsonb_object_agg(po.capability_id,o.facts) FILTER(WHERE po.capability_id IS NOT NULL),'{}'::jsonb) facts_by_capability
  FROM preflight_runs pr LEFT JOIN preflight_snapshots ps USING(preflight_run_id) LEFT JOIN preflight_observations po USING(preflight_run_id)
  LEFT JOIN observations o ON o.observation_request_id=po.observation_request_id WHERE pr.observed_endpoint_id=${endpoint}
  GROUP BY pr.preflight_run_id,ps.captured_at,ps.completeness_percent ORDER BY captured_at DESC LIMIT 1`;}
function page<T>(items:readonly T[],input:Paging,total:number):Page<T>{return {items,page:input.page,pageSize:input.pageSize,total,totalPages:Math.ceil(total/input.pageSize)};}
function mapAssetSummary(row:Record<string,unknown>):AssetSummaryDto{const facts=object(row["facts_by_capability"]);const os=object(facts["windows.os.summary"]);return {assetId:String(row["asset_id"]),displayName:String(row["display_name"]),
  ...optional("externalInventoryId",row["external_inventory_id"]),assetType:"WindowsEndpoint",status:row["status"] as "Active"|"Retired",...optionalIso("lastObservedAt",row["last_observed_at"]),
  ...optional("latestPreflightStatus",row["preflight_status"]),...optional("knownState",os["osDescription"])};}
function mapEndpoint(row:Record<string,unknown>):EndpointSummaryDto{return {observedEndpointId:String(row["observed_endpoint_id"]),...optional("observedMachineName",row["observed_machine_name"]),
  platform:String(row["platform"]),firstObservedAt:iso(row["first_observed_at"]),lastObservedAt:iso(row["last_observed_at"]),linkStatus:row["link_status"] as "Active"|"Revoked",
  confirmationMethod:"HumanReview",sessionId:String(row["session_id"])};}
function mapPreflight(row:Record<string,unknown>):PreflightSummaryDto{return {preflightRunId:String(row["preflight_run_id"]),sessionId:String(row["session_id"]),
  observedEndpointId:String(row["observed_endpoint_id"]??""),capturedAt:iso(row["captured_at"]),status:String(row["preflight_status"]??row["status"]),
  ...optionalNumber("completenessPercent",row["completeness_percent"]),observationCount:Number(row["observation_count"]??0),factsByCapability:operatorFacts(row["facts_by_capability"])};}
function mapTimeline(row:Record<string,unknown>):TimelineEventDto{const kind=String(row["event_type"]);const labels:Record<string,string>={"session.created":"Support Session authenticated",
  "preflight.started":"Preflight started","preflight.completed":"Preflight completed","preflight.partial":"Preflight completed with partial data","asset.created":"Asset created after human review",
  "asset.endpoint_linked":"Observed endpoint linked to Asset","asset.endpoint_link_revoked":"Endpoint link revoked","asset.endpoint_relinked":"Endpoint relinked after correction","asset.retired":"Asset retired"};
  return {eventId:String(row["event_id"]),occurredAt:iso(row["occurred_at"]),kind,title:labels[kind]??humanize(kind),...optional("detail",row["reason"]),
    ...optional("sessionId",row["session_id"]),...optional("preflightRunId",row["preflight_run_id"]),...optional("observedEndpointId",row["observed_endpoint_id"])};}
function mapSession(row:Record<string,unknown>):SessionSummaryDto{return {sessionId:String(row["session_id"]),historicalStatus:String(row["historical_status"]),
  ...optional("agentVersion",row["agent_version"]),protocolVersion:String(row["protocol_version"]),createdAt:iso(row["created_at"]),lastSeenAt:iso(row["last_seen_at"]),
  ...optionalIso("endedAt",row["ended_at"]),...optional("endReason",row["end_reason"]),...(row["observed_endpoint_id"]?{observedEndpoint:{observedEndpointId:String(row["observed_endpoint_id"]),
    ...optional("observedMachineName",row["observed_machine_name"])}}:{}),...(row["asset_id"]?{asset:{assetId:String(row["asset_id"]),displayName:String(row["display_name"]),
      ...optional("externalInventoryId",row["external_inventory_id"])}}:{})};}
function object(value:unknown):Record<string,unknown>{return value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function operatorFacts(value:unknown):Record<string,unknown>{const all=object(value),result:Record<string,unknown>={};
  const scalarFields:Record<string,readonly string[]>={
    "system.runtime.summary":["osPlatform","osDescription","osArchitecture","processArchitecture","dotnetRuntime","agentVersion","productVersion","protocolVersion","supportSessionMode"],
    "windows.os.summary":["osDescription","osVersion","windowsBuild","osArchitecture","processArchitecture","uptimeMilliseconds"],
    "windows.memory.summary":["totalPhysicalMemoryBytes","availablePhysicalMemoryBytes","usedPhysicalMemoryBytes"],
    "windows.execution-context.summary":["isElevated","is64BitProcess","is64BitOperatingSystem","executionMode","privilegeLevel"]};
  for(const [capability,fields] of Object.entries(scalarFields)){const source=object(all[capability]),safe:Record<string,unknown>={};for(const field of fields){const item=source[field];if(typeof item==="string"||typeof item==="number"||typeof item==="boolean")safe[field]=item;}if(Object.keys(safe).length)result[capability]=safe;}
  const storage=object(all["windows.storage.summary"]),volumes=storage["volumes"];
  if(Array.isArray(volumes)){result["windows.storage.summary"]={volumes:volumes.slice(0,32).map(item=>{const source=object(item),safe:Record<string,unknown>={};for(const field of ["root","driveType","fileSystem","totalBytes","freeBytes","availableBytes"]){const entry=source[field];if(typeof entry==="string"||typeof entry==="number")safe[field]=entry;}return safe;})};}
  return result;}
function optional<K extends string>(key:K,value:unknown):Record<K,string>{return value===null||value===undefined?{} as Record<K,string>:{[key]:String(value)} as Record<K,string>;}
function optionalIso<K extends string>(key:K,value:unknown):Record<K,string>{return value===null||value===undefined?{} as Record<K,string>:{[key]:iso(value)} as Record<K,string>;}
function optionalNumber<K extends string>(key:K,value:unknown):Record<K,number>{return value===null||value===undefined?{} as Record<K,number>:{[key]:Number(value)} as Record<K,number>;}
function iso(value:unknown):string{return value instanceof Date?value.toISOString():new Date(String(value)).toISOString();}
function humanize(value:string):string{return value.replaceAll("."," ").replace(/\b\w/g,letter=>letter.toUpperCase());}
