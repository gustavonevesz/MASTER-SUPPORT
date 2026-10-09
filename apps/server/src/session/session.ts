import type { CapabilityDescriptor } from "../contracts.js";

export type SessionState = "connecting" | "active" | "disconnected" | "closed" | "expired" | "revoked";

export type Session = {
  readonly id: string;
  readonly agentInstanceId: string;
  readonly protocolVersion: "1.0";
  readonly capabilities: readonly CapabilityDescriptor[];
  readonly createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  state: SessionState;
  readonly authenticated?: boolean;
  readonly resumeToken: string;
  readonly processedMessageIds: Set<string>;
  readonly messageOrder: string[];
};

export type PublicSession = Omit<Session, "resumeToken" | "processedMessageIds" | "messageOrder">;
