import type { MessageTransport } from "../transport/message-transport.js";

export class ActiveConnectionRegistry {
  private readonly connections = new Map<string, MessageTransport>();

  public register(sessionId: string, transport: MessageTransport): void {
    const previous = this.connections.get(sessionId);
    if (previous && previous !== transport) previous.close(1008, "connection_replaced");
    this.connections.set(sessionId, transport);
  }

  public unregister(sessionId: string, transport: MessageTransport): void {
    if (this.connections.get(sessionId) === transport) this.connections.delete(sessionId);
  }

  public send(sessionId: string, message: unknown): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection || connection.state !== "open") return false;
    connection.send(message);
    return true;
  }

  public close(sessionId: string, code = 1008, reason = "session_revoked"): boolean {
    const connection = this.connections.get(sessionId);
    if (!connection) return false;
    this.connections.delete(sessionId);
    connection.close(code, reason);
    return true;
  }
}
