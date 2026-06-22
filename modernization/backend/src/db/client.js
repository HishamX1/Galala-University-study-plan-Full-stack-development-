import { env } from '../config/env.js';

let pool;

async function getPool() {
  if (pool) return pool;
  if (!env.databaseUrl) throw new Error('DB_NOT_CONFIGURED');

  let PoolCtor;
  try {
    ({ Pool: PoolCtor } = await import('pg'));
  } catch {
    throw new Error('PG_DRIVER_MISSING');
  }

  pool = new PoolCtor({
    connectionString: env.databaseUrl,
    ssl: env.pgSsl ? { rejectUnauthorized: false } : undefined
  });
  return pool;
}

export async function ensureDataStore() {
  const activePool = await getPool();
  await activePool.query('SELECT 1');
}

export async function query(sql, params = []) {
  const activePool = await getPool();
  return activePool.query(sql, params);
}

export async function withPostgresClient(work) {
  const activePool = await getPool();
  const client = await activePool.connect();
  try {
    return await work(client);
  } finally {
    client.release();
  }
}

export async function closePool() {
  if (pool) await pool.end();
}
