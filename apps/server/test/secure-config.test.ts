import assert from "node:assert/strict";
import { test } from "node:test";
import { FakeClock } from "../src/session/clock.js";
import { validateOperationalMode } from "../src/trust/config.js";
import { BootstrapRateLimiter } from "../src/trust/rate-limit.js";

test("development mode is explicit and loopback-only", () => {
  assert.throws(() => validateOperationalMode(undefined, "127.0.0.1"));
  assert.throws(() => validateOperationalMode("development", "0.0.0.0"), /loopback/);
  assert.doesNotThrow(() => validateOperationalMode("development", "::1"));
  assert.doesNotThrow(() => validateOperationalMode("secure", "0.0.0.0"));
});

test("bootstrap limiter is bounded and resets after its window", () => {
  const clock = new FakeClock(new Date()); const limiter = new BootstrapRateLimiter(clock, 2, 1_000, 10);
  assert.equal(limiter.allow("127.0.0.1", "one"), true); assert.equal(limiter.allow("127.0.0.1", "one"), true);
  assert.equal(limiter.allow("127.0.0.1", "one"), false); clock.advance(1_001); assert.equal(limiter.allow("127.0.0.1", "one"), true);
});
