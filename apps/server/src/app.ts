import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logEvent } from "./logger.js";
import { RealtimeSessionController } from "./realtime/controller.js";
import { ActiveConnectionRegistry } from "./realtime/connection-registry.js";
import { InMemoryObservationStore, sanitizeObservation, type ObservationStore } from "./observation/store.js";
import { ObservationService, runtimeSummaryCapability } from "./observation/service.js";
import type { Clock } from "./session/clock.js";
import { systemClock } from "./session/clock.js";
import { SessionService, type SessionOptions } from "./session/service.js";
import { InMemorySessionStore, sanitizeSession, type SessionStore } from "./session/store.js";
import { WebSocketServerTransport } from "./transport/websocket-transport.js";
import { productVersion, supportedProtocolVersions } from "./versions.js";

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
  const observations = new ObservationService(store, connections, observationStore, clock, options.observationTimeoutMs);
  app.get("/health", async () => ({ status: "ok", service: "master-support-server", version: productVersion, protocolVersions: supportedProtocolVersions }));
  app.get("/version", async () => ({ productVersion, protocolVersions: supportedProtocolVersions }));
  if (options.exposeDevelopmentSessions !== false) {
    app.get("/dev/sessions", async () => ({ developmentOnly: true, sessions: store.list().map(sanitizeSession) }));
    app.get("/dev/sessions/:sessionId/observations", async request => {
      const { sessionId } = request.params as { sessionId: string };
      return { developmentOnly: true, observations: observationStore.listForSession(sessionId).map(sanitizeObservation) };
    });
    app.post("/dev/sessions/:sessionId/observations", async (request, reply) => {
      const { sessionId } = request.params as { sessionId: string };
      const body = request.body as { capabilityId?: unknown } | undefined;
      if (!body || body.capabilityId !== runtimeSummaryCapability.id || Object.keys(body).length !== 1) {
        return reply.code(400).send({ code: "invalid_capability", message: "Only the allowlisted capabilityId is accepted." });
      }
      try {
        const record = await observations.request(sessionId, body.capabilityId);
        return reply.code(record.state === "result" ? 200 : 502).send({ developmentOnly: true, request: sanitizeObservation(record) });
      } catch (error) {
        const code = error instanceof Error ? error.message : "observation_rejected";
        return reply.code(409).send({ code });
      }
    });
  }
  app.register(async realtime => {
    await realtime.register(websocket, { options: { maxPayload: 64 * 1024 } });
    realtime.get("/session", { websocket: true }, socket => {
      new RealtimeSessionController(new WebSocketServerTransport(socket), sessions, clock, connections, observations).start();
    });
  });

  const expirationTimer = setInterval(() => {
    for (const session of sessions.expireDueSessions()) logEvent("info", "session_expired", { sessionId: session.id });
  }, 500);
  expirationTimer.unref();
  app.addHook("onClose", async () => clearInterval(expirationTimer));
  return {
    app, sessions, store, observationStore, observations,
    revokeSession(sessionId: string): void {
      const session = sessions.revoke(sessionId);
      logEvent("info", "session_revoked", { sessionId: session.id });
      connections.close(sessionId);
    },
  };
}
