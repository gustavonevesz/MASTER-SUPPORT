export type ConnectionState = "open" | "closing" | "closed";

export interface MessageTransport {
  readonly state: ConnectionState;
  send(message: unknown): void;
  close(code?: number, reason?: string): void;
  onMessage(handler: (message: string) => void): void;
  onClose(handler: () => void): void;
}
