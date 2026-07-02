import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

const ADMIN_URL = 'postgres://postgres:postgres@localhost:5434/postgres';
const TEST_DB = 'swarmdev_test';
const TEST_URL = `postgres://postgres:postgres@localhost:5434/${TEST_DB}`;

export default async function setup(): Promise<void> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [TEST_DB]);
  if (exists.rowCount === 0) {
    await admin.query(`CREATE DATABASE ${TEST_DB}`);
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: TEST_URL });
  await migrate(drizzle(pool), { migrationsFolder: './drizzle' });
  await pool.end();
}
