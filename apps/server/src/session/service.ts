import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { AgentHello, CapabilityDescriptor } from "../contracts.js";
import type { Clock } from "./clock.js";
import type { Session, SessionState } from "./session.js";
import type { SessionStore } from "./store.js";

export type SessionOptions = Readonly<{
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  deduplicationCapacity: number;
  supportedCapabilities: readonly CapabilityDescriptor[];
}>;

const terminalStates = new Set<SessionState>(["closed", "expired", "revoked"]);

export class SessionService {
  public constructor(
    private readonly store: SessionStore,
    private readonly clock: Clock,
    public readonly options: SessionOptions,
  ) {}

  public create(hello: AgentHello): Session {
    const now = this.clock.now();
    const supported = new Map(this.options.supportedCapabilities.map(capability => [`${capability.id}@${capability.version}`, capability]));
    const negotiated = hello.payload.supportedCapabilities
      .map(capability => supported.get(`${capability.id}@${capability.version}`))
      .filter((capability): capability is CapabilityDescriptor => capability !== undefined);
    const session: Session = {
      id: randomUUID(),
      agentInstanceId: hello.payload.agentInstanceId,
      protocolVersion: "1.0",
      capabilities: negotiated,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(now.getTime() + this.options.leaseDurationMs),
      state: "active",
      resumeToken: randomBytes(32).toString("base64url"),
      processedMessageIds: new Set(),
      messageOrder: [],
    };
    this.store.save(session);
    return session;
  }

  public heartbeat(sessionId: string, messageId: string): { session: Session; duplicate: boolean } {
    const session = this.requireActive(sessionId);
    if (session.processedMessageIds.has(messageId)) return { session, duplicate: true };
    this.remember(session, messageId);
    const now = this.clock.now();
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
    return { session, duplicate: false };
  }

  public disconnect(sessionId: string): Session | undefined {
    const session = this.store.get(sessionId);
    if (session?.state === "active") session.state = "disconnected";
    return session;
  }

  public resume(sessionId: string, agentInstanceId: string, token: string): Session | undefined {
    const session = this.store.get(sessionId);
    if (!session || terminalStates.has(session.state) || session.agentInstanceId !== agentInstanceId) return undefined;
    this.expireDueSessions();
    if (session.state !== "disconnected" || !secureEqual(session.resumeToken, token)) return undefined;
    const now = this.clock.now();
    session.state = "active";
    session.lastSeenAt = now;
    session.expiresAt = new Date(now.getTime() + this.options.leaseDurationMs);
    return session;
  }

  public close(sessionId: string): Session { return this.transitionTerminal(sessionId, "closed"); }
  public revoke(sessionId: string): Session { return this.transitionTerminal(sessionId, "revoked"); }

  public expireDueSessions(): readonly Session[] {
    const now = this.clock.now().getTime();
    const expired: Session[] = [];
    for (const session of this.store.list()) {
      if (!terminalStates.has(session.state) && session.expiresAt.getTime() <= now) {
        session.state = "expired";
        expired.push(session);
      }
    }
    return expired;
  }

  private requireActive(sessionId: string): Session {
    this.expireDueSessions();
    const session = this.store.get(sessionId);
    if (!session || session.state !== "active") throw new Error("session_not_active");
    return session;
  }

  private transitionTerminal(sessionId: string, state: "closed" | "revoked"): Session {
    this.expireDueSessions();
    const session = this.store.get(sessionId);
    if (!session || terminalStates.has(session.state)) throw new Error("session_not_active");
    session.state = state;
    return session;
  }

  private remember(session: Session, messageId: string): void {
    session.processedMessageIds.add(messageId);
    session.messageOrder.push(messageId);
    while (session.messageOrder.length > this.options.deduplicationCapacity) {
      const removed = session.messageOrder.shift();
      if (removed) session.processedMessageIds.delete(removed);
    }
  }
}

function secureEqual(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  return left.length === right.length && timingSafeEqual(left, right);
}
