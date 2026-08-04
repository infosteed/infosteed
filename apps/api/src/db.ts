// SPDX-License-Identifier: AGPL-3.0-only
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString });
}

function defaultMigrationsDir(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "migrations"),
    path.resolve(currentDir, "../../../migrations"),
    path.resolve(currentDir, "../migrations"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export async function runMigrations(
  pool: Pool,
  migrationsDir = defaultMigrationsDir(),
): Promise<void> {
  const migrationClient = await pool.connect();
  try {
    await migrationClient.query("select pg_advisory_lock(748394021)");
    await migrationClient.query(`
    create table if not exists schema_migrations (
      version text primary key,
      applied_at timestamptz not null default now()
    )
    `);

    const files = (await readdir(migrationsDir))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, "");
      const applied = await migrationClient.query(
        "select 1 from schema_migrations where version = $1",
        [version],
      );
      if ((applied.rowCount ?? 0) > 0) continue;

      const sql = await readFile(path.join(migrationsDir, file), "utf8");
      try {
        await migrationClient.query("begin");
        await migrationClient.query(sql);
        await migrationClient.query(
          "insert into schema_migrations (version) values ($1)",
          [version],
        );
        await migrationClient.query("commit");
      } catch (error) {
        await migrationClient.query("rollback");
        throw error;
      }
    }
  } finally {
    await migrationClient
      .query("select pg_advisory_unlock(748394021)")
      .catch(() => undefined);
    migrationClient.release();
  }
}

export async function withTransaction<T>(
  pool: Pool,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await work(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
