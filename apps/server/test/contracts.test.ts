import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readJson,
  repositoryPath,
  validateAgentHello,
  validateObservationRequest,
  validateSessionMessage,
  validateServerHello,
} from "../src/contracts.js";
import { createAgentHello, createServerHello } from "../src/messages.js";

const fixture = (name: string) => repositoryPath(`tests/fixtures/${name}`);

test("accepts canonical valid fixtures", async () => {
  assert.equal(validateAgentHello(await readJson(fixture("agent-hello.valid.json"))).valid, true);
  assert.equal(validateServerHello(await readJson(fixture("server-hello.valid.json"))).valid, true);
});

for (const name of [
  "agent-hello.invalid-missing-version.json",
  "agent-hello.invalid-message-type.json",
  "agent-hello.unsupported-protocol.json",
]) {
  test(`rejects ${name}`, async () => {
    assert.equal(validateAgentHello(await readJson(fixture(name))).valid, false);
  });
}

test("serializes messages that remain valid", () => {
  const agent = JSON.parse(JSON.stringify(createAgentHello())) as unknown;
  const validatedAgent = validateAgentHello(agent);
  assert.equal(validatedAgent.valid, true);
  if (!validatedAgent.valid) return;
  const now = new Date();
  assert.equal(validateServerHello(JSON.parse(JSON.stringify(createServerHello(validatedAgent.value, {
    id: "44444444-4444-4444-8444-444444444444", createdAt: now,
    expiresAt: new Date(now.getTime() + 15_000), resumeToken: "synthetic-development-token-0000000000000000",
    capabilities: [],
  }, 3)))).valid, true);
});

test("ObservationRequest and distinct Evidence/Observation result satisfy shared schemas", () => {
  const requestId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const request = { protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "observation.request", sessionId,
    correlationId: requestId, timestamp: new Date().toISOString(), payload: {
      requestId, capabilityId: "system.runtime.summary", capabilityVersion: "1.0", timeoutMs: 5_000, maxPayloadBytes: 16_384,
    } };
  assert.equal(validateObservationRequest(request).valid, true);
  const evidenceId = crypto.randomUUID();
  const result = { protocolVersion: "1.0", messageId: crypto.randomUUID(), messageType: "observation.result", sessionId,
    correlationId: requestId, timestamp: new Date().toISOString(), payload: { requestId,
      evidence: { evidenceId, capabilityId: "system.runtime.summary", capabilityVersion: "1.0", collectedAt: new Date().toISOString(),
        source: "agent.native-runtime-api", dataHandlingState: "RAW", payload: {
          osPlatform: "Windows", osDescription: "Windows 10", osArchitecture: "x64", processArchitecture: "x64",
          dotnetRuntime: ".NET 10", agentVersion: "0.1.0", productVersion: "0.1.0", protocolVersion: "1.0", supportSessionMode: "temporary-development",
        } },
      observation: { observationId: crypto.randomUUID(), evidenceId, observedAt: new Date().toISOString(),
        kind: "runtime-summary-collected", statement: "The temporary Agent runtime has the reported platform and architecture properties.",
        facts: { osPlatform: "Windows", osDescription: "Windows 10", osArchitecture: "x64", processArchitecture: "x64",
          dotnetRuntime: ".NET 10", agentVersion: "0.1.0", productVersion: "0.1.0", protocolVersion: "1.0", supportSessionMode: "temporary-development" } },
    } };
  assert.equal(validateSessionMessage("observation.result", result).valid, true);
  assert.notEqual(result.payload.evidence.evidenceId, result.payload.observation.observationId);
});
