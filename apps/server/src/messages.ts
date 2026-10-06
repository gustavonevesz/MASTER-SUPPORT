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

export function createServerHello(agentHello: AgentHello): ServerHello {
  const timestamp = new Date();
  return {
    protocolVersion: "1.0",
    messageId: randomUUID(),
    messageType: "server.hello",
    sessionId: randomUUID(),
    correlationId: agentHello.messageId,
    timestamp: timestamp.toISOString(),
    expiresAt: new Date(timestamp.getTime() + 15 * 60_000).toISOString(),
    payload: {
      serverVersion: productVersion,
      selectedProtocolVersion: "1.0",
      compatibility: "compatible",
      developmentOnly: true,
    },
  };
}
