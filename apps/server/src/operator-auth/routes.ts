import { randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Clock } from "../session/clock.js";
import { BootstrapRateLimiter } from "../trust/rate-limit.js";
import type { OperatorAuthProvider } from "./provider.js";
import { csrf, OperatorAuthService } from "./service.js";

const cookieName="ms_operator_session";
type Transaction={state:string;nonce:string;redirectUri:string;returnUrl:string;context:unknown;expiresAt:number};
export type OperatorAuthRuntime=Readonly<{service:OperatorAuthService;provider:OperatorAuthProvider;clock:Clock;publicOrigin:string;secureCookie:boolean;developmentProvider:boolean;rateLimit?:number}>;

export function registerOperatorAuthRoutes(app:FastifyInstance,runtime:OperatorAuthRuntime):void{
  const transactions=new Map<string,Transaction>();const limiter=new BootstrapRateLimiter(runtime.clock,runtime.rateLimit??20,60_000);
  app.addHook("onSend",securityHeaders);
  app.get("/auth/login",async(request,reply)=>{if(!limiter.allow(request.ip,"login"))return reply.code(429).send({code:"rate_limited"});const returnUrl=safeReturnUrl(query(request)["returnUrl"]);
    if(!returnUrl)return reply.code(400).send({code:"invalid_return_url"});const state=randomBytes(32).toString("base64url"),nonce=randomBytes(32).toString("base64url"),redirectUri=`${runtime.publicOrigin}/auth/callback`;
    try{const started=await runtime.provider.begin({state,nonce,redirectUri});transactions.set(state,{state,nonce,redirectUri,returnUrl,context:started.context,expiresAt:runtime.clock.now().getTime()+5*60_000});await runtime.service.repository.audit("operator.authentication_started",runtime.clock.now(),"accepted",undefined,undefined,runtime.provider.id,undefined,request.ip);return reply.redirect(started.redirectUrl);}
    catch{await runtime.service.repository.audit("operator.authentication_failed",runtime.clock.now(),"rejected",undefined,undefined,runtime.provider.id,"provider_start_failed",request.ip);return reply.code(401).send({code:"authentication_failed"});}});
  app.get("/auth/callback",async(request,reply)=>{if(!limiter.allow(request.ip,"callback"))return reply.code(429).send({code:"rate_limited"});const state=query(request)["state"]??"",transaction=transactions.get(state);transactions.delete(state);
    if(!transaction||transaction.expiresAt<=runtime.clock.now().getTime())return authFailure(runtime,request,reply,"invalid_or_replayed_callback");
    try{const callbackUrl=new URL(request.url,runtime.publicOrigin).href;const identity=await runtime.provider.complete({callbackUrl,state:transaction.state,nonce:transaction.nonce,redirectUri:transaction.redirectUri,context:transaction.context});const session=await runtime.service.authenticate(identity);
      reply.header("Set-Cookie",serializeCookie(session.token,runtime.secureCookie));return reply.redirect(transaction.returnUrl);}
    catch(error){const reason=error instanceof Error&&["operator_not_provisioned","operator_disabled"].includes(error.message)?error.message:"provider_callback_failed";return authFailure(runtime,request,reply,reason);}});
  app.get("/api/auth/session",async(request,reply)=>{const auth=await runtime.service.authorize(readCookie(request));if(auth.status!==200)return reply.code(auth.status).send({code:auth.status===401?"authentication_required":"forbidden"});return {operator:auth.session.operator,csrfToken:auth.csrfToken,developmentProvider:runtime.developmentProvider};});
  app.post("/api/auth/logout",async(request,reply)=>{const token=readCookie(request);if(!token)return reply.code(401).send({code:"authentication_required"});const origin=request.headers.origin??refererOrigin(request.headers.referer);if(origin!==runtime.publicOrigin)return reply.code(403).send({code:"csrf_origin_rejected"});const supplied=header(request,"x-csrf-token");if(!safeEqual(supplied,csrf(token)))return reply.code(403).send({code:"csrf_token_rejected"});await runtime.service.logout(token);reply.header("Set-Cookie",clearCookie(runtime.secureCookie));return reply.code(204).send();});
}
export async function requireConsoleRead(request:FastifyRequest,reply:FastifyReply,runtime:OperatorAuthRuntime):Promise<void>{const auth=await runtime.service.authorize(readCookie(request));if(auth.status!==200)await reply.code(auth.status).send({code:auth.status===401?"authentication_required":"forbidden"});}
async function securityHeaders(request:FastifyRequest,reply:FastifyReply,payload:unknown){if(request.url.startsWith("/api/")||request.url.startsWith("/auth/")){reply.header("Content-Security-Policy","default-src 'none'; frame-ancestors 'none'; base-uri 'none'");reply.header("X-Content-Type-Options","nosniff");reply.header("Referrer-Policy","no-referrer");reply.header("X-Frame-Options","DENY");reply.header("Cache-Control","no-store");}return payload;}
async function authFailure(runtime:OperatorAuthRuntime,request:FastifyRequest,reply:FastifyReply,reason:string){await runtime.service.repository.audit("operator.authentication_failed",runtime.clock.now(),"rejected",undefined,undefined,runtime.provider.id,reason,request.ip);return reply.code(401).type("text/html; charset=utf-8").send("<!doctype html><title>MASTER SUPPORT</title><h1>Acesso não autorizado</h1><p>Não foi possível autenticar o operador.</p><a href='/'>Voltar</a>");}
function query(request:FastifyRequest):Record<string,string>{const q=request.query&&typeof request.query==="object"?request.query as Record<string,unknown>:{};return Object.fromEntries(Object.entries(q).filter((e):e is [string,string]=>typeof e[1]==="string"));}
export function safeReturnUrl(value:string|undefined):string|undefined{const candidate=value??"/assets";return /^\/(?!\/)[A-Za-z0-9/_?=&.%-]*$/.test(candidate)&&!candidate.includes("\\")?candidate:undefined;}
function readCookie(request:FastifyRequest):string|undefined{for(const part of (request.headers.cookie??"").split(";")){const [name,...rest]=part.trim().split("=");if(name===cookieName){const value=rest.join("=");return /^[A-Za-z0-9_-]{43}$/.test(value)?value:undefined;}}return undefined;}
function serializeCookie(token:string,secure:boolean):string{return `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure?"; Secure":""}`;}
function clearCookie(secure:boolean):string{return `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure?"; Secure":""}`;}
function refererOrigin(value:string|undefined):string|undefined{try{return value?new URL(value).origin:undefined;}catch{return undefined;}}
function header(request:FastifyRequest,name:string):string{const value=request.headers[name];return typeof value==="string"?value:"";}
function safeEqual(a:string,b:string):boolean{const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);}
