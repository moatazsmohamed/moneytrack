import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool, assertDatabaseConfigured, closePool } from './db.js';
import { splitSqlStatements } from './sql-statements.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '../db/migrations');

export async function runMigrations() {
  assertDatabaseConfigured();
  await pool.query(`CREATE TABLE IF NOT EXISTS mt_schema_migrations (
    migration_key VARCHAR(190) NOT NULL PRIMARY KEY,
    applied_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  const files = (await fs.readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  const [appliedRows] = await pool.query('SELECT migration_key FROM mt_schema_migrations');
  const applied = new Set(appliedRows.map((row) => row.migration_key));
  const completed = [];
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      // mysql2 application connections do not enable multipleStatements.
      for (const statement of splitSqlStatements(sql)) await conn.query(statement);
      await conn.execute('INSERT INTO mt_schema_migrations (migration_key) VALUES (?)', [file]);
      await conn.commit();
      completed.push(file);
    } catch (error) {
      try { await conn.rollback(); } catch { /* preserve original error */ }
      throw error;
    } finally { conn.release(); }
  }
  return { applied: completed };
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  runMigrations().then((result) => {
    process.stdout.write(`Applied ${result.applied.length} migration(s).\n`);
  }).catch((error) => {
    process.stderr.write(`Migration failed: ${error.code || error.message}\n`);
    process.exitCode = 1;
  }).finally(async () => { try { await closePool(); } catch { /* best effort */ } });
}
