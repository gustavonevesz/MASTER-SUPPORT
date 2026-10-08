import { buildApp } from "../../apps/server/src/app.js";
import type { DurablePersistence } from "../../apps/server/src/persistence/models.js";
import { PostgresPersistence } from "../../apps/server/src/persistence/postgres.js";

const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
const persistence = await PostgresPersistence.start(databaseUrl);
const reconciled = await persistence.reconcileRestart();
const durability: DurablePersistence = process.env["MASTER_SUPPORT_CRASH_AFTER_RESULT_HOOK"] === "1"
  ? new Proxy(persistence, { get(target, property) {
      if (property === "persistObservation") return async (record: Parameters<DurablePersistence["persistObservation"]>[0],
        event?: Parameters<DurablePersistence["persistObservation"]>[1]) => {
        if (record.state === "completed") {
          process.stdout.write("HARNESS_RESULT_WINDOW\n");
          await new Promise<void>(() => undefined);
        }
        return target.persistObservation(record, event);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    } })
  : persistence;
const context = buildApp({ durability, sessionOptions: { leaseDurationMs: 10_000, heartbeatIntervalMs: 1_000 } });
await context.app.listen({ host: "127.0.0.1", port: 0 });
const address = context.app.server.address();
if (!address || typeof address === "string") throw new Error("dynamic_port_unavailable");
process.stdout.write(`HARNESS_READY ${JSON.stringify({ port: address.port, serverInstanceId: persistence.serverInstanceId, reconciled })}\n`);
