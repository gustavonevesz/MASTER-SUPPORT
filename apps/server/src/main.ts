import { buildApp } from "./app.js";
import { logEvent } from "./logger.js";
import { PostgresPersistence } from "./persistence/postgres.js";
import { readFile } from "node:fs/promises";
import { SupportInvitationRepository, SupportInvitationService } from "./trust/invitation.js";
import { systemClock } from "./session/clock.js";
import { validateOperationalMode } from "./trust/config.js";
import { requireLoopbackOperatorConsole } from "./operator-read/config.js";
import { OperatorReadRepository } from "./operator-read/repository.js";
import { OperatorReadService } from "./operator-read/service.js";

const host = process.env["MASTER_SUPPORT_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MASTER_SUPPORT_PORT"] ?? "3000");
try {
  const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
  if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required; refusing non-durable operation.");
  const mode = process.env["MASTER_SUPPORT_MODE"];
  validateOperationalMode(mode, host);
  const operatorConsole=process.env["MASTER_SUPPORT_OPERATOR_CONSOLE"]==="true";
  requireLoopbackOperatorConsole(operatorConsole,host);
  let https: { key: Buffer; cert: Buffer } | undefined;
  if (mode === "secure") {
    const certPath = process.env["MASTER_SUPPORT_TLS_CERT_PATH"]; const keyPath = process.env["MASTER_SUPPORT_TLS_KEY_PATH"];
    if (!certPath || !keyPath) throw new Error("secure mode requires MASTER_SUPPORT_TLS_CERT_PATH and MASTER_SUPPORT_TLS_KEY_PATH");
    https = { cert: await readFile(certPath), key: await readFile(keyPath) };
  }
  const durability = await PostgresPersistence.start(databaseUrl);
  const invitationRepository = mode === "secure" ? await SupportInvitationRepository.start(databaseUrl) : undefined;
  const operatorReadRepository=operatorConsole?await OperatorReadRepository.start(databaseUrl):undefined;
  const operatorRead=operatorReadRepository?new OperatorReadService(operatorReadRepository):undefined;
  const reconciled = await durability.reconcileRestart();
  const invitations = invitationRepository ? new SupportInvitationService(invitationRepository, systemClock,
    Number(process.env["MASTER_SUPPORT_INVITATION_TTL_MS"] ?? "600000")) : undefined;
  const { app, observations } = buildApp({ mode, ...(https ? { https } : {}), ...(invitations ? { invitations } : {}),...(operatorRead?{operatorRead}:{}), exposeDevelopmentSessions: mode === "development", durability,
    connectionTicketTtlMs: Number(process.env["MASTER_SUPPORT_CONNECTION_TICKET_TTL_MS"] ?? "60000"),
    resumeTicketTtlMs: Number(process.env["MASTER_SUPPORT_RESUME_TICKET_TTL_MS"] ?? "300000"),
    sessionOptions: { leaseDurationMs: Number(process.env["MASTER_SUPPORT_SESSION_LEASE_MS"] ?? "15000") } });
  if (invitationRepository) app.addHook("onClose", async () => invitationRepository.close());
  if(operatorReadRepository)app.addHook("onClose",async()=>operatorReadRepository.close());
  observations.metrics.increment("restart_reconciliations");
  for (let index = 0; index < reconciled.observations; index++) observations.metrics.increment("abandoned_after_restart");
  if (mode === "development") logEvent("error", "server.development_mode_loopback_only");
  await app.listen({ host, port });
  logEvent("info", "server.started", { serverInstanceId: durability.serverInstanceId,
    restartSessions: reconciled.sessions, restartObservations: reconciled.observations });
} catch (error: unknown) {
  logEvent("error", "server.start_failed");
  process.stderr.write(`${error instanceof Error ? error.message : "Server startup failed."}\n`);
  process.exitCode = 1;
}
