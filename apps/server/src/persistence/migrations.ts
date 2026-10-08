import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function migrate(pool: Pool): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version integer PRIMARY KEY, name text NOT NULL, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const supported = files.map(name => Number(name.split("_", 1)[0]));
  if (new Set(supported).size !== supported.length) throw new Error("duplicate_migration_version");
  const applied = await pool.query<{ version: number; checksum: string }>("SELECT version, checksum FROM schema_migrations ORDER BY version");
  const known = new Map(applied.rows.map(row => [row.version, row.checksum]));
  const latest = supported.at(-1) ?? 0;
  if (applied.rows.some(row => row.version > latest || !supported.includes(row.version))) throw new Error("database_schema_is_newer_than_server");
  for (const file of files) {
    const version = Number(file.split("_", 1)[0]);
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (known.has(version)) {
      if (known.get(version) !== checksum) throw new Error(`migration_checksum_mismatch:${version}`);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(version, name, checksum) VALUES ($1, $2, $3)", [version, file, checksum]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  }
}

export async function validateCurrentSchema(pool: Pool): Promise<void> {
  const files = (await readdir(migrationsDirectory)).filter(name => /^\d+_[a-z0-9_]+\.sql$/.test(name)).sort();
  const exists = await pool.query<{ name: string | null }>("SELECT to_regclass('schema_migrations')::text AS name");
  if (!exists.rows[0]?.name) throw new Error("database_schema_is_not_migrated");
  const applied = await pool.query<{ version: number; name: string; checksum: string }>(
    "SELECT version, name, checksum FROM schema_migrations ORDER BY version");
  if (applied.rows.length !== files.length) throw new Error("database_schema_version_mismatch");
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!; const row = applied.rows[index]; const version = Number(file.split("_", 1)[0]);
    const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");
    if (!row || row.version !== version || row.name !== file || row.checksum !== checksum)
      throw new Error(`database_schema_version_mismatch:${version}`);
  }
}

export function requireSafeTestDatabase(databaseUrl: string): URL {
  const parsed = new URL(databaseUrl);
  const database = parsed.pathname.slice(1);
  if (parsed.protocol !== "postgresql:" && parsed.protocol !== "postgres:") throw new Error("test_database_must_use_postgresql");
  if (!['127.0.0.1', 'localhost', '::1', 'postgres'].includes(parsed.hostname)) throw new Error("test_database_host_is_not_allowed");
  if (database !== "master_support_test") throw new Error("unsafe_test_database_name");
  return parsed;
}
