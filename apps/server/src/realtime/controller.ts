import { randomUUID } from "node:crypto";
import type { AgentHello } from "../contracts.js";
import { validateAgentHello, validateSessionMessage } from "../contracts.js";
import { logEvent } from "../logger.js";
import { createServerHello } from "../messages.js";
import type { Clock } from "../session/clock.js";
import type { SessionService } from "../session/service.js";
import type { MessageTransport } from "../transport/message-transport.js";
import type { ActiveConnectionRegistry } from "./connection-registry.js";
import type { ObservationService } from "../observation/service.js";

type IncomingEnvelope = { protocolVersion?: unknown; messageId?: unknown; messageType?: unknown; sessionId?: unknown; payload?: unknown };

export class RealtimeSessionController {
  private sessionId: string | undefined;
  private endedCleanly = false;
  public constructor(
    private readonly transport: MessageTransport,
    private readonly sessions: SessionService,
    private readonly clock: Clock,
    private readonly connections: ActiveConnectionRegistry,
    private readonly observations: ObservationService,
  ) {}
  public start(): void {
    logEvent("info", "agent_connection_opened");
    this.transport.onMessage(message => this.receive(message));
    this.transport.onClose(() => this.disconnected());
  }
  private receive(text: string): void {
    let raw: IncomingEnvelope;
    try { raw = JSON.parse(text) as IncomingEnvelope; }
    catch { this.reject("invalid_message", "Message is not valid JSON."); return; }
    if (typeof raw.messageType !== "string") { this.reject("invalid_message", "messageType is required."); return; }
    if (!this.sessionId) {
      if (raw.messageType === "agent.hello") this.handleHello(raw);
      else if (raw.messageType === "session.resume.request") this.handleResume(raw);
      else this.reject("invalid_message", "Handshake or resume is required.");
      return;
    }
    const validation = validateSessionMessage(raw.messageType, raw);
    if (!validation.valid) { this.reject("invalid_message", "Message does not match its schema.", raw.messageId); return; }
    if (raw.sessionId !== this.sessionId) { this.reject("session_not_active", "Session does not match this connection.", raw.messageId); return; }
    if (raw.messageType === "heartbeat") this.handleHeartbeat(raw);
    else if (raw.messageType === "session.close") this.handleClose(raw);
    else if (raw.messageType.startsWith("observation.")) this.observations.handle(raw.messageType, raw);
    else this.reject("invalid_message", "Unsupported session message.", raw.messageId);
  }
  private handleHello(raw: IncomingEnvelope): void {
    const validation = validateAgentHello(raw);
    if (!validation.valid) {
      this.reject(raw.protocolVersion !== "1.0" ? "unsupported_protocol" : "invalid_message", "AgentHello is incompatible or invalid.", raw.messageId);
      return;
    }
    const hello: AgentHello = validation.value;
    if (hello.payload.agentVersion !== "0.1.0") {
      this.reject("incompatible_agent", "Agent version is not supported.", hello.messageId);
      return;
    }
    logEvent("info", "agent_hello_received", { messageId: hello.messageId });
    const session = this.sessions.create(hello);
    this.sessionId = session.id;
    this.connections.register(session.id, this.transport);
    logEvent("info", "session_created", { sessionId: session.id, agentInstanceId: session.agentInstanceId });
    this.transport.send(createServerHello(hello, session, this.sessions.options.heartbeatIntervalMs / 1000));
  }
  private handleResume(raw: IncomingEnvelope): void {
    const validation = validateSessionMessage("session.resume.request", raw);
    if (!validation.valid) { this.reject("invalid_message", "Resume request is invalid.", raw.messageId); return; }
    const payload = raw.payload as { agentInstanceId: string; resumeToken: string };
    const session = this.sessions.resume(String(raw.sessionId), payload.agentInstanceId, payload.resumeToken);
    if (!session) { this.reject("resume_rejected", "Session cannot be resumed.", raw.messageId); return; }
    this.sessionId = session.id;
    this.connections.register(session.id, this.transport);
    logEvent("info", "session_resumed", { sessionId: session.id, agentInstanceId: session.agentInstanceId });
    this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "session.resume.result", sessionId: session.id,
      correlationId: raw.messageId, timestamp: this.clock.now().toISOString(), expiresAt: session.expiresAt.toISOString(),
      payload: { accepted: true, developmentOnly: true } });
  }
  private handleHeartbeat(raw: IncomingEnvelope): void {
    try {
      const result = this.sessions.heartbeat(this.sessionId!, String(raw.messageId));
      if (!result.duplicate) logEvent("info", "heartbeat_received", { sessionId: result.session.id, messageId: String(raw.messageId) });
      this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "heartbeat.ack", sessionId: result.session.id,
        correlationId: raw.messageId, timestamp: this.clock.now().toISOString(), expiresAt: result.session.expiresAt.toISOString(), payload: {} });
    } catch { this.reject("session_not_active", "Session is not active.", raw.messageId); }
  }
  private handleClose(raw: IncomingEnvelope): void {
    try {
      const session = this.sessions.close(this.sessionId!);
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
      if (session) logEvent("info", "session_disconnected", { sessionId: session.id });
    }
  }
  private reject(code: string, message: string, correlationId?: unknown): void {
    logEvent("error", "protocol_message_rejected", typeof correlationId === "string" ? { correlationId } : {});
    this.transport.send({ protocolVersion: "1.0", messageId: randomUUID(), messageType: "protocol.error",
      ...(typeof correlationId === "string" ? { correlationId } : {}), timestamp: this.clock.now().toISOString(), payload: { code, message } });
    if (!this.sessionId || code === "session_not_active" || code === "resume_rejected") this.transport.close(1008, "protocol_error");
  }
}
