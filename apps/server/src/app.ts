import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { logEvent } from "./logger.js";
import { RealtimeSessionController } from "./realtime/controller.js";
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
  revokeSession(sessionId: string): void;
}>;

export function buildApp(options: {
  clock?: Clock;
  sessionOptions?: Partial<SessionOptions>;
  store?: SessionStore;
  exposeDevelopmentSessions?: boolean;
} = {}): ServerContext {
  const app = Fastify({ logger: false });
  const clock = options.clock ?? systemClock;
  const store = options.store ?? new InMemorySessionStore();
  const sessions = new SessionService(store, clock, {
    leaseDurationMs: 15_000,
    heartbeatIntervalMs: 3_000,
    deduplicationCapacity: 100,
    supportedCapabilities: [],
    ...options.sessionOptions,
  });
  app.get("/health", async () => ({ status: "ok", service: "master-support-server", version: productVersion, protocolVersions: supportedProtocolVersions }));
  app.get("/version", async () => ({ productVersion, protocolVersions: supportedProtocolVersions }));
  if (options.exposeDevelopmentSessions !== false) {
    app.get("/dev/sessions", async () => ({ developmentOnly: true, sessions: store.list().map(sanitizeSession) }));
  }
  app.register(async realtime => {
    await realtime.register(websocket, { options: { maxPayload: 64 * 1024 } });
    realtime.get("/session", { websocket: true }, socket => {
      new RealtimeSessionController(new WebSocketServerTransport(socket), sessions, clock).start();
    });
  });

  const expirationTimer = setInterval(() => {
    for (const session of sessions.expireDueSessions()) logEvent("info", "session_expired", { sessionId: session.id });
  }, 500);
  expirationTimer.unref();
  app.addHook("onClose", async () => clearInterval(expirationTimer));
  return {
    app, sessions, store,
    revokeSession(sessionId: string): void {
      const session = sessions.revoke(sessionId);
      logEvent("info", "session_revoked", { sessionId: session.id });
    },
  };
}
