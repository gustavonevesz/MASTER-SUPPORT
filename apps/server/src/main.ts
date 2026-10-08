import { buildApp } from "./app.js";
import { logEvent } from "./logger.js";
import { PostgresPersistence } from "./persistence/postgres.js";

const host = process.env["MASTER_SUPPORT_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MASTER_SUPPORT_PORT"] ?? "3000");
try {
  const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
  if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required; refusing non-durable operation.");
  const durability = await PostgresPersistence.start(databaseUrl);
  const reconciled = await durability.reconcileRestart();
  const { app, observations } = buildApp({ exposeDevelopmentSessions: host === "127.0.0.1", durability });
  observations.metrics.increment("restart_reconciliations");
  for (let index = 0; index < reconciled.observations; index++) observations.metrics.increment("abandoned_after_restart");
  if (host !== "127.0.0.1") logEvent("error", "server.non_loopback_development_override");
  await app.listen({ host, port });
  logEvent("info", "server.started", { serverInstanceId: durability.serverInstanceId,
    restartSessions: reconciled.sessions, restartObservations: reconciled.observations });
} catch (error: unknown) {
  logEvent("error", "server.start_failed");
  process.stderr.write(`${error instanceof Error ? error.message : "Server startup failed."}\n`);
  process.exitCode = 1;
}
