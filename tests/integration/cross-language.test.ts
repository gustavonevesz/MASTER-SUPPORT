import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createAgentHello } from "../../apps/server/src/messages.js";
import { validateAgentHello } from "../../apps/server/src/contracts.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const agentDll = join(root, "apps", "agent", "src", "bin", "Debug", "net10.0", "MasterSupport.Agent.dll");

function runAgent(...args: string[]) {
  return spawnSync("dotnet", [agentDll, ...args], { cwd: root, encoding: "utf8" });
}

test("TypeScript output is consumed by C# and C# output is consumed by TypeScript", async () => {
  const directory = await mkdtemp(join(tmpdir(), "master-support-contracts-"));
  try {
    const tsOutput = join(directory, "typescript-agent-hello.json");
    await writeFile(tsOutput, JSON.stringify(createAgentHello()), "utf8");
    const csharpConsumes = runAgent("validate-agent-hello", tsOutput);
    assert.equal(csharpConsumes.status, 0, csharpConsumes.stderr);

    const csharpOutput = join(directory, "csharp-agent-hello.json");
    const csharpProduces = runAgent("emit-agent-hello", csharpOutput);
    assert.equal(csharpProduces.status, 0, csharpProduces.stderr);
    assert.equal(validateAgentHello(JSON.parse(await readFile(csharpOutput, "utf8")) as unknown).valid, true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
