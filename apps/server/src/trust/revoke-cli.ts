import { systemClock } from "../session/clock.js";
import { SupportInvitationRepository, SupportInvitationService } from "./invitation.js";

const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
const invitationId = process.argv[2];
if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
if (!invitationId) throw new Error("Usage: npm run support:revoke-invite -- <invitation-id>");
const repository = await SupportInvitationRepository.start(databaseUrl);
try {
  const revoked = await new SupportInvitationService(repository, systemClock, 1).revoke(invitationId);
  process.stdout.write(revoked ? "Support invitation revoked\n" : "Invitation is not active\n");
  process.exitCode = revoked ? 0 : 1;
} finally { await repository.close(); }
