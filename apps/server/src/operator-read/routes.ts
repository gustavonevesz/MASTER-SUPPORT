import type { FastifyInstance } from "fastify";
import type { OperatorReadService } from "./service.js";
import type { OperatorAuthRuntime } from "../operator-auth/routes.js";
import { requireConsoleRead } from "../operator-auth/routes.js";

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function registerOperatorReadRoutes(app:FastifyInstance,service:OperatorReadService,auth:OperatorAuthRuntime):void{
  app.addHook("onSend",async(request,reply,payload)=>{if(request.url.startsWith("/api/")){reply.header("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("X-Content-Type-Options","nosniff");reply.header("Referrer-Policy","no-referrer");reply.header("X-Frame-Options","DENY");reply.header("Cache-Control","no-store");}return payload;});
  const protectedRoute={preHandler:(request:Parameters<typeof requireConsoleRead>[0],reply:Parameters<typeof requireConsoleRead>[1])=>requireConsoleRead(request,reply,auth)};
  app.get("/api/assets",protectedRoute,async(request,reply)=>{const parsed=parsePage(request.query,true);if("error" in parsed)return reply.code(400).send({code:parsed.error});return service.listAssets(parsed);});
  app.get("/api/assets/:assetId",protectedRoute,async(request,reply)=>{const id=validId(request.params);if(!id)return reply.code(400).send({code:"invalid_asset_id"});const value=await service.assetDetail(id);
    return value??reply.code(404).send({code:"asset_not_found"});});
  app.get("/api/assets/:assetId/preflights",protectedRoute,async(request,reply)=>{const id=validId(request.params);if(!id)return reply.code(400).send({code:"invalid_asset_id"});
    if(!await service.assetDetail(id))return reply.code(404).send({code:"asset_not_found"});const parsed=parsePage(request.query,false);if("error" in parsed)return reply.code(400).send({code:parsed.error});return service.preflights(id,parsed);});
  app.get("/api/assets/:assetId/timeline",protectedRoute,async(request,reply)=>{const id=validId(request.params);if(!id)return reply.code(400).send({code:"invalid_asset_id"});
    if(!await service.assetDetail(id))return reply.code(404).send({code:"asset_not_found"});const parsed=parsePage(request.query,false);if("error" in parsed)return reply.code(400).send({code:parsed.error});return service.timeline(id,parsed);});
  app.get("/api/unreviewed-endpoints",protectedRoute,async(request,reply)=>{const parsed=parsePage(request.query,false);if("error" in parsed)return reply.code(400).send({code:parsed.error});return service.unreviewed(parsed);});
  app.get("/api/sessions/:sessionId",protectedRoute,async(request,reply)=>{const id=validId(request.params,"sessionId");if(!id)return reply.code(400).send({code:"invalid_session_id"});const value=await service.session(id);
    return value??reply.code(404).send({code:"session_not_found"});});
}
function validId(params:unknown,key="assetId"):string|undefined{if(!params||typeof params!=="object")return undefined;const value=(params as Record<string,unknown>)[key];return typeof value==="string"&&uuid.test(value)?value:undefined;}
function parsePage(query:unknown,search:true):{page:number;pageSize:number;search:string}|{error:string};
function parsePage(query:unknown,search:false):{page:number;pageSize:number}|{error:string};
function parsePage(query:unknown,search:boolean):{page:number;pageSize:number;search:string}|{page:number;pageSize:number}|{error:string}{const source=query&&typeof query==="object"?query as Record<string,unknown>:{};
  const allowed=new Set(search?["page","pageSize","search"]:["page","pageSize"]);if(Object.keys(source).some(key=>!allowed.has(key)))return {error:"invalid_query"};
  const page=integer(source["page"]??"1"),pageSize=integer(source["pageSize"]??"20");if(!page||page<1||!pageSize||pageSize<1||pageSize>50)return {error:"invalid_pagination"};
  if(search){const value=source["search"]??"";if(typeof value!=="string"||value.length>100||/[\u0000-\u001f\u007f]/u.test(value))return {error:"invalid_search"};return {page,pageSize,search:value.trim()};}return {page,pageSize};}
function integer(value:unknown):number|undefined{if(typeof value!=="string"||!/^[0-9]+$/.test(value))return undefined;const result=Number(value);return Number.isSafeInteger(result)?result:undefined;}
