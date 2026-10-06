import Fastify, { type FastifyInstance } from "fastify";
import { productVersion, supportedProtocolVersions } from "./versions.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/health", async () => ({
    status: "ok",
    service: "master-support-server",
    version: productVersion,
    protocolVersions: supportedProtocolVersions,
  }));

  app.get("/version", async () => ({
    productVersion,
    protocolVersions: supportedProtocolVersions,
  }));

  return app;
}
