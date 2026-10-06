import assert from "node:assert/strict";
import { test } from "node:test";
import { buildApp } from "../src/app.js";

test("GET /health reports the skeleton and protocol version", async (context) => {
  const { app } = buildApp();
  context.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/health" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    status: "ok",
    service: "master-support-server",
    version: "0.1.0",
    protocolVersions: ["1.0"],
  });
});

test("development session listing can be disabled for non-loopback configuration", async (context) => {
  const { app } = buildApp({ exposeDevelopmentSessions: false });
  context.after(() => app.close());
  const response = await app.inject({ method: "GET", url: "/dev/sessions" });
  assert.equal(response.statusCode, 404);
});
