import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logEvent } from "./logger.js";
import { RealtimeSessionController } from "./realtime/controller.js";
import { ActiveConnectionRegistry } from "./realtime/connection-registry.js";
import { InMemoryObservationStore, sanitizeObservation, type ObservationStore } from "./observation/store.js";
import { ObservationService, preflightCapabilities, runtimeSummaryCapability, type ObservationOptions } from "./observation/service.js";
import type { Clock } from "./session/clock.js";
import { systemClock } from "./session/clock.js";
import { SessionService, type SessionOptions } from "./session/service.js";
import { InMemorySessionStore, sanitizeSession, type SessionStore } from "./session/store.js";
import { WebSocketServerTransport } from "./transport/websocket-transport.js";
import { productVersion, supportedProtocolVersions } from "./versions.js";
import type { DurablePersistence } from "./persistence/models.js";
import type { SupportInvitationService } from "./trust/invitation.js";
import { EphemeralTicketStore } from "./trust/tickets.js";
import { BootstrapRateLimiter } from "./trust/rate-limit.js";
import { validateAgentHello } from "./contracts.js";
import { randomUUID } from "node:crypto";
import { PreflightService } from "./preflight/service.js";
import type { OperatorReadService } from "./operator-read/service.js";
import { registerOperatorReadRoutes } from "./operator-read/routes.js";
import { registerOperatorAuthRoutes, type OperatorAuthRuntime } from "./operator-auth/routes.js";
import type { ActionService } from "./actions/service.js";
import { registerActionRoutes } from "./actions/routes.js";

export type ServerContext = Readonly<{
  app: FastifyInstance;
  sessions: SessionService;
  store: SessionStore;
  observationStore: ObservationStore;
  observations: ObservationService;
  preflights: PreflightService;
  revokeSession(sessionId: string): void;
}>;

export function buildApp(options: {
  clock?: Clock;
  sessionOptions?: Partial<SessionOptions>;
  store?: SessionStore;
  exposeDevelopmentSessions?: boolean;
  observationStore?: ObservationStore;
  observationTimeoutMs?: number;
  observationOptions?: Partial<ObservationOptions>;
  durability?: DurablePersistence;
  mode?: "secure" | "development";
  https?: { key: string | Buffer; cert: string | Buffer };
  invitations?: SupportInvitationService;
  ticketStore?: EphemeralTicketStore;
  connectionTicketTtlMs?: number;
  resumeTicketTtlMs?: number;
  bootstrapRateLimit?: number;
  operatorRead?: OperatorReadService;
  operatorAuth?: OperatorAuthRuntime;
  actions?: ActionService;
} = {}): ServerContext {
  const mode = options.mode ?? "development";
  if (mode === "secure" && (!options.https || !options.invitations)) throw new Error("secure_mode_requires_tls_and_invitation_store");
  const app = Fastify({ logger: false, ...(options.https ? { https: options.https } : {}) });
  const clock = options.clock ?? systemClock;
  const store = options.store ?? new InMemorySessionStore();
  const sessions = new SessionService(store, clock, {
    leaseDurationMs: 15_000,
    heartbeatIntervalMs: 3_000,
    deduplicationCapacity: 100,
    supportedCapabilities: preflightCapabilities,
    ...options.sessionOptions,
  });
  const connections = new ActiveConnectionRegistry();
  const tickets = options.ticketStore ?? new EphemeralTicketStore(clock, options.connectionTicketTtlMs ?? 60_000, options.resumeTicketTtlMs ?? 300_000);
  const bootstrapLimiter = new BootstrapRateLimiter(clock, options.bootstrapRateLimit ?? 10, 60_000);
  const observationStore = options.observationStore ?? new InMemoryObservationStore();
  const observations = new ObservationService(store, connections, observationStore, clock, {
    ...(options.observationTimeoutMs === undefined ? {} : { timeoutMs: options.observationTimeoutMs }),
    ...options.observationOptions,
  }, undefined, undefined, options.durability);
  const preflights=new PreflightService(store,observations,clock,options.durability);
  app.get("/health", async () => ({ status: "ok", service: "master-support-server", version: productVersion, protocolVersions: supportedProtocolVersions }));
  app.get("/version", async () => ({ productVersion, protocolVersions: supportedProtocolVersions }));
  if(options.operatorRead&&!options.operatorAuth)throw new Error("operator_console_requires_authentication");
  if(options.operatorAuth)registerOperatorAuthRoutes(app,options.operatorAuth);
  if(options.operatorRead&&options.operatorAuth)registerOperatorReadRoutes(app,options.operatorRead,options.operatorAuth);
  if(options.actions&&!options.operatorAuth)throw new Error("action_orchestration_requires_operator_authentication");
  if(options.actions&&options.operatorAuth)registerActionRoutes(app,options.actions,options.operatorAuth);
  if (mode === "secure") app.post("/support/bootstrap", async (request, reply) => {
    const body = request.body as { invitationId?: unknown; invitationSecret?: unknown; agentHello?: unknown } | undefined;
    const invitationId = typeof body?.invitationId === "string" ? body.invitationId : "invalid";
    if (!bootstrapLimiter.allow(request.ip, invitationId)) {
      if (options.durability) void options.durability.appendAudit({ eventId: randomUUID(), occurredAt: clock.now().toISOString(),
        eventType: "bootstrap.rejected", sessionId: "", requestId: "", capabilityId: "", status: "rejected", reason: "rate_limited" });
      return reply.code(429).send({ code: "rate_limited" });
    }
    const hello = validateAgentHello(body?.agentHello);
    if (!body || typeof body.invitationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(body.invitationId) ||
      typeof body.invitationSecret !== "string" || body.invitationSecret.length < 32 || !hello.valid) {
      if (options.durability) void options.durability.appendAudit({ eventId: randomUUID(), occurredAt: clock.now().toISOString(),
        eventType: "bootstrap.rejected", sessionId: "", requestId: "", capabilityId: "", status: "rejected", reason: "invalid_request" });
      return reply.code(400).send({ code: "invalid_bootstrap" });
    }
    const consumed = await options.invitations!.consume(body.invitationId, body.invitationSecret, hello.value);
    if (!consumed.accepted) {
      if (options.durability) void options.durability.appendAudit({ eventId: randomUUID(), occurredAt: clock.now().toISOString(),
        eventType: "bootstrap.rejected", sessionId: "", requestId: "", capabilityId: "", status: "rejected", reason: consumed.reason });
      return reply.code(401).send({ code: "bootstrap_rejected" });
    }
    const supported = new Map(sessions.options.supportedCapabilities.map(item => [`${item.id}@${item.version}`, item]));
    const capabilities = hello.value.payload.supportedCapabilities.map(item => supported.get(`${item.id}@${item.version}`)).filter(item => item !== undefined);
    const issued = tickets.issue({ kind: "connection", agentInstanceId: hello.value.payload.agentInstanceId, capabilities });
    if (options.durability) void options.durability.appendAudit({ eventId: randomUUID(), occurredAt: clock.now().toISOString(),
      eventType: "bootstrap.accepted", sessionId: "", requestId: "", capabilityId: "", status: "accepted" });
    return reply.code(201).send({ connectionTicket: issued.ticket, expiresAt: issued.expiresAt.toISOString(), websocketUrl: "/session" });
  });
  const exposeDevelopmentRoutes = options.exposeDevelopmentSessions ?? mode === "development";
  if (exposeDevelopmentRoutes) {
    app.get("/dev/sessions", async () => ({ developmentOnly: true, sessions: store.list().map(sanitizeSession) }));
    app.get("/dev/sessions/:sessionId/observations", async request => {
      const { sessionId } = request.params as { sessionId: string };
      return { developmentOnly: true, observations: observationStore.listForSession(sessionId).map(sanitizeObservation) };
    });
    app.get("/dev/metrics", async () => ({ developmentOnly: true, metrics: observations.metrics.snapshot(
      store.list().filter(session => session.state === "active").length, observations.activeCount()) }));
    app.get("/dev/audit", async () => ({ developmentOnly: true, events: observations.audit.list() }));
    app.post("/dev/sessions/:sessionId/preflights",async(request,reply)=>{const {sessionId}=request.params as {sessionId:string};
      try{return reply.code(201).send({developmentOnly:true,preflight:await preflights.start(sessionId)});}
      catch(error){return reply.code(409).send({code:error instanceof Error?error.message:"preflight_rejected"});}});
    app.get("/dev/sessions/:sessionId/preflights",async request=>{const {sessionId}=request.params as {sessionId:string};return {developmentOnly:true,preflights:preflights.listForSession(sessionId)};});
    if (options.durability) {
      app.get("/dev/history/sessions/:sessionId", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string }; const history = await options.durability!.sessionHistory(sessionId);
        return history ? { developmentOnly: true, session: history } : reply.code(404).send({ code: "not_found" });
      });
      app.get("/dev/history/observations/:requestId", async (request, reply) => {
        const { requestId } = request.params as { requestId: string }; const history = await options.durability!.observationHistory(requestId);
        return history ? { developmentOnly: true, observation: history } : reply.code(404).send({ code: "not_found" });
      });
      app.get("/dev/history/preflights/:preflightRunId",async(request,reply)=>{const {preflightRunId}=request.params as {preflightRunId:string};
        const history=await options.durability!.preflightHistory(preflightRunId);return history?{developmentOnly:true,preflight:history}:reply.code(404).send({code:"not_found"});});
    }
    app.post("/dev/sessions/:sessionId/observations", async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { capabilityId?: unknown } | undefined;
      if (!body || body.capabilityId !== runtimeSummaryCapability.id || Object.keys(body).length !== 1) {
        return reply.code(400).send({ code: "invalid_capability", message: "Only the allowlisted capabilityId is accepted." });
      }
      try {
        const record = await observations.startDurable(sessionId, body.capabilityId);
        return reply.code(202).send({ developmentOnly: true, request: sanitizeObservation(record) });
      } catch (error) {
        const code = error instanceof Error ? error.message : "observation_rejected";
        return reply.code(409).send({ code });
      }
    });
    app.post("/dev/sessions/:sessionId/observations/:requestId/cancel", async (request, reply) => {
      const { sessionId, requestId } = request.params as { sessionId: string; requestId: string };
      try { return { developmentOnly: true, request: sanitizeObservation(await observations.cancelDurable(sessionId, requestId)) }; }
      catch (error) { return reply.code(404).send({ code: error instanceof Error ? error.message : "unknown_request" }); }
    });
  }
  app.register(async realtime => {
    await realtime.register(websocket, { options: { maxPayload: 64 * 1024 } });
    realtime.get("/session", { websocket: true }, (socket, request) => {
      if (mode === "secure") {
        const authorization = request.headers.authorization;
        const credential = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
        const claims = tickets.consumeAny(credential);
        if (!claims) {
          if (options.durability) void options.durability.appendAudit({ eventId: randomUUID(), occurredAt: clock.now().toISOString(),
            eventType: "session.replay_rejected", sessionId: "", requestId: "", capabilityId: "", status: "rejected" });
          socket.close(1008, "authentication_required"); return;
        }
        new RealtimeSessionController(new WebSocketServerTransport(socket), sessions, clock, connections, observations,
          options.durability, { claims, tickets }).start(); return;
      }
      new RealtimeSessionController(new WebSocketServerTransport(socket), sessions, clock, connections, observations, options.durability).start();
    });
  });

  const expirationTimer = setInterval(() => {
    if (options.durability) void observations.expireDueRequestsDurable(); else observations.expireDueRequests();
    for (const session of sessions.expireDueSessions()) {
      tickets.revokeSession(session.id);
      if (options.durability) void observations.authorityLostDurable(session.id, "session_expired");
      else observations.authorityLost(session.id, "session_expired");
      connections.close(session.id, 1008, "session_expired");
      if (options.durability) void options.durability.persistSessionState(session, "expired").catch(() => observations.metrics.increment("db_operation_failures"));
      logEvent("info", "session_expired", { sessionId: session.id });
    }
  }, 500);
  expirationTimer.unref();
  app.addHook("onClose", async () => {
    clearInterval(expirationTimer);
    if (options.durability) {
      for (const session of store.list().filter(item => item.state === "active" || item.state === "disconnected")) {
        await observations.authorityLostDurable(session.id, "session_closed");
        try { sessions.close(session.id); } catch { /* terminal transition raced shutdown */ }
        await options.durability.persistSessionState(session, "server_shutdown");
      }
      await options.durability.finish();
    }
  });
  return {
    app, sessions, store, observationStore, observations,preflights,
    revokeSession(sessionId: string): void {
      if (options.durability) void observations.authorityLostDurable(sessionId, "session_revoked");
      else observations.authorityLost(sessionId, "session_revoked");
      const session = sessions.revoke(sessionId);
      tickets.revokeSession(sessionId);
      if (options.durability) void options.durability.persistSessionState(session, "revoked").catch(() => observations.metrics.increment("db_operation_failures"));
      logEvent("info", "session_revoked", { sessionId: session.id });
      connections.close(sessionId);
    },
  };
}
