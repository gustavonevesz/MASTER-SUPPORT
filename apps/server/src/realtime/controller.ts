import { randomUUID } from "node:crypto";
import type { AgentHello } from "../contracts.js";
import { validateAgentHello, validateSessionMessage } from "../contracts.js";
import { logEvent } from "../logger.js";
import { createAuthenticatedServerHello, createServerHello } from "../messages.js";
import type { Clock } from "../session/clock.js";
import type { SessionService } from "../session/service.js";
import type { MessageTransport } from "../transport/message-transport.js";
import type { ActiveConnectionRegistry } from "./connection-registry.js";
import type { ObservationService } from "../observation/service.js";
import type { DurablePersistence } from "../persistence/models.js";
import type { EphemeralTicketStore, TicketClaims } from "../trust/tickets.js";

type IncomingEnvelope = { protocolVersion?: unknown; messageId?: unknown; messageType?: unknown; sessionId?: unknown; payload?: unknown };

export class RealtimeSessionController {
  private sessionId: string | undefined;
  private endedCleanly = false;
  private processing = Promise.resolve();
  public constructor(
    private readonly transport: MessageTransport,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
    private readonly connections: ActiveConnectionRegistry,
    private readonly observations: ObservationService,
    private readonly durability?: DurablePersistence,
    private readonly authentication?: { claims: TicketClaims; tickets: EphemeralTicketStore },
  ) {}
  public start(): void {
    logEvent("info", "agent_connection_opened");
    this.transport.onMessage(message => {
      this.processing = this.processing.then(() => this.receive(message)).catch(() => {
        this.observations.metrics.increment("db_operation_failures"); this.transport.close(1011, "processing_failed");
      });
    });
    this.transport.onClose(() => this.disconnected());
  }
  private async receive(text: string): Promise<void> {
    let raw: IncomingEnvelope;
    try { raw = JSON.parse(text) as IncomingEnvelope; }
    catch { this.reject("invalid_message", "Message is not valid JSON."); return; }
    if (typeof raw.messageType !== "string") { this.reject("invalid_message", "messageType is required."); return; }
    if (!this.sessionId) {
      if (raw.messageType === "agent.hello") await this.handleHello(raw);
      else if (raw.messageType === "session.resume.request") await this.handleResume(raw);
      else this.reject("invalid_message", "Handshake or resume is required.");
      return;
    }
    const validation = validateSessionMessage(raw.messageType, raw);
    if (!validation.valid) { this.reject("invalid_message", "Message does not match its schema.", raw.messageId); return; }
    if (raw.sessionId !== this.sessionId) { this.reject("session_not_active", "Session does not match this connection.", raw.messageId); return; }
    if (raw.messageType === "heartbeat") await this.handleHeartbeat(raw);
    else if (raw.messageType === "session.close") await this.handleClose(raw);
    else if (raw.messageType.startsWith("observation.")) await this.observations.handleDurable(raw.messageType, raw);
    else this.reject("invalid_message", "Unsupported session message.", raw.messageId);
  }
  private async handleHello(raw: IncomingEnvelope): Promise<void> {
    const validation = validateAgentHello(raw);
    if (!validation.valid) {
      this.reject(raw.protocolVersion !== "1.0" ? "unsupported_protocol" : "invalid_message", "AgentHello is incompatible or invalid.", raw.messageId);
      return;
    }
    const hello: AgentHello = validation.value;
    const announced = hello.payload.supportedCapabilities.filter(capability =>
      this.sessions.options.supportedCapabilities.some(supported => supported.id === capability.id && supported.version === capability.version));
    if (this.authentication && (this.authentication.claims.kind !== "connection" ||
      this.authentication.claims.agentInstanceId !== hello.payload.agentInstanceId ||
      JSON.stringify(this.authentication.claims.capabilities) !== JSON.stringify(announced))) {
      this.reject("authentication_mismatch", "Authenticated AgentInstance does not match handshake.", hello.messageId); return;
    }
    if (hello.payload.agentVersion !== "0.1.0") {
      this.reject("incompatible_agent", "Agent version is not supported.", hello.messageId);
      return;
    }
    logEvent("info", "agent_hello_received", { messageId: hello.messageId });
    const session = this.sessions.create(hello, !this.durability);
    if (this.durability) {
      try {
        await this.durability.persistSessionCreated({ ...session, state: "active" });
        this.sessions.activate(session.id); this.observations.metrics.setDatabaseConnected(true);
      }
      catch { this.observations.metrics.setDatabaseConnected(false); this.observations.metrics.increment("db_operation_failures");
        try { this.sessions.revoke(session.id); } catch { /* no authority was issued */ }
        this.reject("database_unavailable", "Session durability is unavailable.", hello.messageId); return; }
    }
    this.sessionId = session.id;
    this.connections.register(session.id, this.transport);
    logEvent("info", "session_created", { sessionId: session.id, agentInstanceId: session.agentInstanceId });
    if (this.authentication) {
      const resume = this.authentication.tickets.issue({ kind: "resume", agentInstanceId: session.agentInstanceId,
        sessionId: session.id, capabilities: session.capabilities });
      this.transport.send(createAuthenticatedServerHello(hello, session, this.sessions.options.heartbeatIntervalMs / 1000, resume));
      if (this.durability) void this.durability.appendAudit({ eventId: randomUUID(), occurredAt: this.clock.now().toISOString(),
        eventType: "session.authenticated", sessionId: session.id, requestId: "", capabilityId: "", status: "active" });
    } else this.transport.send(createServerHello(hello, session, this.sessions.options.heartbeatIntervalMs / 1000));
  }
  private async handleResume(raw: IncomingEnvelope): Promise<void> {
    const validation = validateSessionMessage("session.resume.request", raw);
    if (!validation.valid) { this.reject("invalid_message", "Resume request is invalid.", raw.messageId); return; }
    const payload = raw.payload as { agentInstanceId: string; resumeToken?: string };
    const authenticated = this.authentication?.claims.kind === "resume" && this.authentication.claims.sessionId === raw.sessionId &&
      this.authentication.claims.agentInstanceId === payload.agentInstanceId;
    const session = authenticated ? this.sessions.resumeAuthenticated(String(raw.sessionId), payload.agentInstanceId) :
      this.sessions.resume(String(raw.sessionId), payload.agentInstanceId, payload.resumeToken ?? "");
    if (!session) { this.reject("resume_rejected", "Session cannot be resumed.", raw.messageId); return; }
    this.sessionId = session.id;
    this.connections.register(session.id, this.transport);
    if (this.durability) {
      await this.durability.persistSessionState(session);
      await this.durability.appendAudit({ eventId: randomUUID(), occurredAt: this.clock.now().toISOString(), eventType: "session.resumed",
        sessionId: session.id, requestId: "", capabilityId: "", status: "active" });
    }
    logEvent("info", "session_resumed", { sessionId: session.id, agentInstanceId: session.agentInstanceId });
    const next = authenticated ? this.authentication!.tickets.issue({ kind: "resume", agentInstanceId: session.agentInstanceId,
      sessionId: session.id, capabilities: session.capabilities }) : undefined;
    this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "session.resume.result", sessionId: session.id,
      correlationId: raw.messageId, timestamp: this.clock.now().toISOString(), expiresAt: session.expiresAt.toISOString(),
      payload: next ? { accepted: true, developmentOnly: false, authentication: "support_invitation", resumeTicket: next.ticket,
        resumeTicketExpiresAt: next.expiresAt.toISOString() } : { accepted: true, developmentOnly: true } });
  }
  private async handleHeartbeat(raw: IncomingEnvelope): Promise<void> {
    try {
      const result = this.sessions.heartbeat(this.sessionId!, String(raw.messageId));
      if (this.durability && !result.duplicate) await this.durability.persistSessionState(result.session);
      if (!result.duplicate) logEvent("info", "heartbeat_received", { sessionId: result.session.id, messageId: String(raw.messageId) });
      this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "heartbeat.ack", sessionId: result.session.id,
        correlationId: raw.messageId, timestamp: this.clock.now().toISOString(), expiresAt: result.session.expiresAt.toISOString(), payload: {} });
    } catch { this.reject("session_not_active", "Session is not active.", raw.messageId); }
  }
  private async handleClose(raw: IncomingEnvelope): Promise<void> {
    try {
      await this.observations.authorityLostDurable(this.sessionId!, "session_closed");
      const session = this.sessions.close(this.sessionId!);
      this.authentication?.tickets.revokeSession(session.id);
      if (this.durability) await this.durability.persistSessionState(session, "closed");
      this.endedCleanly = true;
      logEvent("info", "session_closed", { sessionId: session.id });
      this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "session.closed", sessionId: session.id,
        correlationId: raw.messageId, timestamp: this.clock.now().toISOString(), payload: {} });
      this.transport.close(1000, "session_closed");
    } catch { this.reject("session_not_active", "Session is not active.", raw.messageId); }
  }
  private disconnected(): void {
    if (this.sessionId) this.connections.unregister(this.sessionId, this.transport);
    if (!this.endedCleanly && this.sessionId) {
      const session = this.sessions.disconnect(this.sessionId);
      if (session) { if (this.durability) void this.observations.authorityLostDurable(session.id, "disconnected");
        else this.observations.authorityLost(session.id, "disconnected");
        if (this.durability) void this.durability.persistSessionState(session).catch(() => this.observations.metrics.increment("db_operation_failures"));
        logEvent("info", "session_disconnected", { sessionId: session.id }); }
    }
  }
  private reject(code: string, message: string, correlationId?: unknown): void {
    this.observations.metrics.increment("messages_rejected");
    logEvent("error", "protocol_message_rejected", typeof correlationId === "string" ? { correlationId } : {});
    this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "protocol.error",
      ...(typeof correlationId === "string" ? { correlationId } : {}), timestamp: this.clock.now().toISOString(), payload: { code, message } });
    if (!this.sessionId || code === "session_not_active" || code === "resume_rejected") this.transport.close(1008, "protocol_error");
  }
}
