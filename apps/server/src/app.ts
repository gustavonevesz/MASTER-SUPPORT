import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logEvent } from "./logger.js";
import { RealtimeSessionController } from "./realtime/controller.js";
import { ActiveConnectionRegistry } from "./realtime/connection-registry.js";
import { InMemoryObservationStore, sanitizeObservation, type ObservationStore } from "./observation/store.js";
import { ObservationService, runtimeSummaryCapability, type ObservationOptions } from "./observation/service.js";
import type { Clock } from "./session/clock.js";
import { systemClock } from "./session/clock.js";
import { SessionService, type SessionOptions } from "./session/service.js";
import { InMemorySessionStore, sanitizeSession, type SessionStore } from "./session/store.js";
import { WebSocketServerTransport } from "./transport/websocket-transport.js";
import { productVersion, supportedProtocolVersions } from "./versions.js";
import type { DurablePersistence } from "./persistence/models.js";

export type ServerContext = Readonly<{
  app: FastifyInstance;
  sessions: SessionService;
  store: SessionStore;
  observationStore: ObservationStore;
  observations: ObservationService;
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
} = {}): ServerContext {
  const app = Fastify({ logger: false });
  const clock = options.clock ?? systemClock;
  const store = options.store ?? new InMemorySessionStore();
  const sessions = new SessionService(store, clock, {
    leaseDurationMs: 15_000,
    heartbeatIntervalMs: 3_000,
    deduplicationCapacity: 100,
    supportedCapabilities: [runtimeSummaryCapability],
    ...options.sessionOptions,
  });
  const connections = new ActiveConnectionRegistry();
  const observationStore = options.observationStore ?? new InMemoryObservationStore();
  const observations = new ObservationService(store, connections, observationStore, clock, {
    ...(options.observationTimeoutMs === undefined ? {} : { timeoutMs: options.observationTimeoutMs }),
    ...options.observationOptions,
  }, undefined, undefined, options.durability);
  app.get("/health", async () => ({ status: "ok", service: "master-support-server", version: productVersion, protocolVersions: supportedProtocolVersions }));
  app.get("/version", async () => ({ productVersion, protocolVersions: supportedProtocolVersions }));
  if (options.exposeDevelopmentSessions !== false) {
    app.get("/dev/sessions", async () => ({ developmentOnly: true, sessions: store.list().map(sanitizeSession) }));
    app.get("/dev/sessions/:sessionId/observations", async request => {
      const { sessionId } = request.params as { sessionId: string };
      return { developmentOnly: true, observations: observationStore.listForSession(sessionId).map(sanitizeObservation) };
    });
    app.get("/dev/metrics", async () => ({ developmentOnly: true, metrics: observations.metrics.snapshot(
      store.list().filter(session => session.state === "active").length, observations.activeCount()) }));
    app.get("/dev/audit", async () => ({ developmentOnly: true, events: observations.audit.list() }));
    if (options.durability) {
      app.get("/dev/history/sessions/:sessionId", async (request, reply) => {
        const { sessionId } = request.params as { sessionId: string }; const history = await options.durability!.sessionHistory(sessionId);
        return history ? { developmentOnly: true, session: history } : reply.code(404).send({ code: "not_found" });
      });
      app.get("/dev/history/observations/:requestId", async (request, reply) => {
        const { requestId } = request.params as { requestId: string }; const history = await options.durability!.observationHistory(requestId);
        return history ? { developmentOnly: true, observation: history } : reply.code(404).send({ code: "not_found" });
      });
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
    realtime.get("/session", { websocket: true }, socket => {
      new RealtimeSessionController(new WebSocketServerTransport(socket), sessions, clock, connections, observations, options.durability).start();
    });
  });

  const expirationTimer = setInterval(() => {
    if (options.durability) void observations.expireDueRequestsDurable(); else observations.expireDueRequests();
    for (const session of sessions.expireDueSessions()) {
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
    app, sessions, store, observationStore, observations,
    revokeSession(sessionId: string): void {
      if (options.durability) void observations.authorityLostDurable(sessionId, "session_revoked");
      else observations.authorityLost(sessionId, "session_revoked");
      const session = sessions.revoke(sessionId);
      if (options.durability) void options.durability.persistSessionState(session, "revoked").catch(() => observations.metrics.increment("db_operation_failures"));
      logEvent("info", "session_revoked", { sessionId: session.id });
      connections.close(sessionId);
    },
  };
}
