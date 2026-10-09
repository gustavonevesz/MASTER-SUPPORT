import assert from "node:assert/strict";
import { test } from "node:test";
import { Pool } from "pg";
import { migrate, requireSafeTestDatabase } from "../../apps/server/src/persistence/migrations.js";
import { FakeClock } from "../../apps/server/src/session/clock.js";
import { createAgentHello } from "../../apps/server/src/messages.js";
import { SupportInvitationRepository, SupportInvitationService } from "../../apps/server/src/trust/invitation.js";

test("SupportInvitation stores only a hash, survives repository restart, and is single-use", async () => isolated(async url => {
  const clock = new FakeClock(new Date("2026-10-09T12:00:00Z")); let repository = await SupportInvitationRepository.start(url);
  const invitation = await new SupportInvitationService(repository, clock, 60_000).create(); const marker = invitation.secret;
  const stored = await repository.inspect(invitation.invitationId);
  assert.equal(JSON.stringify(stored).includes(marker), false); assert.equal(stored?.["status"], "active");
  await repository.close(); repository = await SupportInvitationRepository.start(url);
  const service = new SupportInvitationService(repository, clock, 60_000); const hello = createAgentHello();
  assert.deepEqual(await service.consume(invitation.invitationId, marker, hello), { accepted: true });
  assert.deepEqual(await service.consume(invitation.invitationId, marker, hello), { accepted: false, reason: "used" });
  await repository.close();
}));

test("expiration, revocation, invalid secrets, and atomic races are enforced", async () => isolated(async url => {
  const clock = new FakeClock(new Date("2026-10-09T12:00:00Z")); const repository = await SupportInvitationRepository.start(url);
  const service = new SupportInvitationService(repository, clock, 1_000); const hello = createAgentHello();
  const invalid = await service.create(); assert.deepEqual(await service.consume(invalid.invitationId, "x".repeat(43), hello), { accepted: false, reason: "invalid_secret" });
  const revoked = await service.create(); assert.equal(await service.revoke(revoked.invitationId), true);
  assert.deepEqual(await service.consume(revoked.invitationId, revoked.secret, hello), { accepted: false, reason: "revoked" });
  const expired = await service.create(); clock.advance(1_001);
  assert.deepEqual(await service.consume(expired.invitationId, expired.secret, hello), { accepted: false, reason: "expired" });
  const raced = await service.create(); const results = await Promise.all([service.consume(raced.invitationId, raced.secret, hello), service.consume(raced.invitationId, raced.secret, hello)]);
  assert.equal(results.filter(result => result.accepted).length, 1); await repository.close();
}));

async function isolated(work: (url: string) => Promise<void>): Promise<void> {
  const configured = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
  if (!configured) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required"); requireSafeTestDatabase(configured);
  const schema = `ms_test_${crypto.randomUUID().replaceAll("-", "")}`; const admin = new Pool({ connectionString: configured });
  await admin.query(`CREATE SCHEMA "${schema}"`); const parsed = new URL(configured); parsed.searchParams.set("options", `-csearch_path=${schema}`);
  try { const pool = new Pool({ connectionString: parsed.toString() }); try { await migrate(pool); } finally { await pool.end(); } await work(parsed.toString()); }
  finally { await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
}
