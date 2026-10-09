import { systemClock } from "../session/clock.js";
import { SupportInvitationRepository, SupportInvitationService } from "./invitation.js";

const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
const ttlMs = Number(process.env["MASTER_SUPPORT_INVITATION_TTL_MS"] ?? "600000");
const repository = await SupportInvitationRepository.start(databaseUrl);
try {
  const invitation = await new SupportInvitationService(repository, systemClock, ttlMs).create();
  process.stdout.write(`Support invitation created\nID: ${invitation.invitationId}\nExpires: ${invitation.expiresAt.toISOString()}\nCode: ${invitation.invitationId}.${invitation.secret}\n`);
} finally { await repository.close(); }
