import WebSocket from "ws";
import type { ConnectionState, MessageTransport } from "./message-transport.js";

export class WebSocketServerTransport implements MessageTransport {
  public constructor(private readonly socket: WebSocket) {}
  public get state(): ConnectionState {
    if (this.socket.readyState === WebSocket.OPEN) return "open";
    if (this.socket.readyState === WebSocket.CLOSING) return "closing";
    return "closed";
  }
  public send(message: unknown): void {
    if (this.socket.readyState !== WebSocket.OPEN) throw new Error("transport_not_open");
    this.socket.send(JSON.stringify(message));
  }
  public close(code = 1000, reason = "closed"): void { this.socket.close(code, reason); }
  public onMessage(handler: (message: string) => void): void { this.socket.on("message", data => handler(data.toString("utf8"))); }
  public onClose(handler: () => void): void { this.socket.on("close", handler); }
}
