import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool";
import { logger } from "../logging/logger";

async function migrate(): Promise<void> {
  const migrationsDirectory = path.resolve(__dirname, "migrations");
  const migrationFiles = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_]+\.sql$/i.test(file))
    .sort((first, second) => {
      const firstNumber = Number.parseInt(first, 10);
      const secondNumber = Number.parseInt(second, 10);
      return firstNumber - secondNumber || first.localeCompare(second);
    });
  if (migrationFiles.length === 0) {
    throw new Error("No database migration files were found");
  }

  const client = await pool.connect();

  try {
    for (const file of migrationFiles) {
      const version = file.replace(/\.sql$/i, "");
      const migration = await readFile(path.join(migrationsDirectory, file), "utf8");
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1)", [891324004]);
        await client.query(
          `CREATE TABLE IF NOT EXISTS schema_migrations (
             version TEXT PRIMARY KEY,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
           )`
        );
        const applied = await client.query(
          "SELECT 1 FROM schema_migrations WHERE version = $1",
          [version]
        );
        if ((applied.rowCount ?? 0) > 0) {
          await client.query("COMMIT");
          logger.info({ version }, "Database migration already applied");
          continue;
        }

        await client.query(migration);
        await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
        await client.query("COMMIT");
        logger.info({ version }, "Database migration completed");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Database migration and rollback failed");
        }
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  logger.error({ err: error }, "Database migration failed");
  process.exitCode = 1;
});
