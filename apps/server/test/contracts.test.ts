import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readJson,
  repositoryPath,
  validateAgentHello,
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
  assert.equal(validateServerHello(JSON.parse(JSON.stringify(createServerHello(validatedAgent.value)))).valid, true);
});
