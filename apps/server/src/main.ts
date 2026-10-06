import { buildApp } from "./app.js";
import { logEvent } from "./logger.js";

const host = process.env["MASTER_SUPPORT_HOST"] ?? "127.0.0.1";
const port = Number(process.env["MASTER_SUPPORT_PORT"] ?? "3000");
const { app } = buildApp({ exposeDevelopmentSessions: host === "127.0.0.1" });

try {
  if (host !== "127.0.0.1") logEvent("error", "server.non_loopback_development_override");
  await app.listen({ host, port });
  logEvent("info", "server.started");
} catch (error: unknown) {
  logEvent("error", "server.start_failed");
  app.log.error(error);
  process.exitCode = 1;
}
