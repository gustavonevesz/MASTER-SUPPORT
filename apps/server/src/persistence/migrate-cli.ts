import { Pool } from "pg";
import { migrate } from "./migrations.js";

const databaseUrl = process.env["MASTER_SUPPORT_DATABASE_URL"];
if (!databaseUrl) throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 3_000 });
try { await migrate(pool); process.stdout.write("Database migrations are current.\n"); }
finally { await pool.end(); }
