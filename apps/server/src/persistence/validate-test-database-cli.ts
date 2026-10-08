import { requireSafeTestDatabase } from "./migrations.js";

const databaseUrl = process.env["MASTER_SUPPORT_TEST_DATABASE_URL"];
if (!databaseUrl) throw new Error("MASTER_SUPPORT_TEST_DATABASE_URL is required");
requireSafeTestDatabase(databaseUrl);
process.stdout.write("PostgreSQL test database configuration is isolated.\n");
