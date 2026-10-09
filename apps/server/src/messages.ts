import { randomUUID } from "node:crypto";
import type { AgentHello, ServerHello } from "./contracts.js";
import { productVersion } from "./versions.js";

export function createAgentHello(): AgentHello {
  return {
    protocolVersion: "1.0",
    messageId: randomUUID(),
    messageType: "agent.hello",
    timestamp: new Date().toISOString(),
    payload: {
      agentVersion: "0.1.0",
      agentInstanceId: randomUUID(),
      supportedProtocolVersions: ["1.0"],
      runtime: "Node.js fixture producer",
      os: "Synthetic",
      architecture: "x64",
      supportedCapabilities: [],
    },
  };
}

export function createServerHello(
  agentHello: AgentHello,
  session: { id: string; createdAt: Date; expiresAt: Date; resumeToken: string; capabilities: readonly { id: string; version: string }[] },
  heartbeatIntervalSeconds: number,
): ServerHello {
  const timestamp = new Date();
  return {
    protocolVersion: "1.0",
    messageId: randomUUID(),
    messageType: "server.hello",
    sessionId: session.id,
    correlationId: agentHello.messageId,
    timestamp: timestamp.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    payload: {
      serverVersion: productVersion,
      selectedProtocolVersion: "1.0",
      compatibility: "compatible",
      createdAt: session.createdAt.toISOString(),
      heartbeatIntervalSeconds,
      resumeToken: session.resumeToken,
      negotiatedCapabilities: session.capabilities,
      developmentOnly: true,
    },
  };
}

export function createAuthenticatedServerHello(
  agentHello: AgentHello,
  session: { id: string; createdAt: Date; expiresAt: Date; capabilities: readonly { id: string; version: string }[] },
  heartbeatIntervalSeconds: number,
  resume: { ticket: string; expiresAt: Date },
): ServerHello {
  const timestamp = new Date();
  return { protocolVersion: "1.0", messageId: randomUUID(), messageType: "server.hello", sessionId: session.id,
    correlationId: agentHello.messageId, timestamp: timestamp.toISOString(), expiresAt: session.expiresAt.toISOString(),
    payload: { serverVersion: productVersion, selectedProtocolVersion: "1.0", compatibility: "compatible",
      createdAt: session.createdAt.toISOString(), heartbeatIntervalSeconds, negotiatedCapabilities: session.capabilities,
      resumeTicket: resume.ticket, resumeTicketExpiresAt: resume.expiresAt.toISOString(), authentication: "support_invitation", developmentOnly: false } };
}
