import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  port: Number(process.env.PGPORT || 5432),
  database: process.env.PGDATABASE || 'weatherwatch',
  user: process.env.PGUSER || 'weatherwatch',
  password: process.env.PGPASSWORD,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function initializeDatabase() {
  const schema = await readFile(new URL('../schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
}

export async function waitForDatabase() {
  const attempts = 30;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await initializeDatabase();
      console.info('Database is ready.');
      return;
    } catch (error) {
      if (attempt === attempts) {
        throw new Error(`Database was not ready after ${attempts} attempts.`, {
          cause: error,
        });
      }

      console.warn(`Database connection attempt ${attempt}/${attempts} failed.`);
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
