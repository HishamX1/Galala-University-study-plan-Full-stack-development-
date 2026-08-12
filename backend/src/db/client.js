import { env } from '../config/env.js';

let pool;

function connectionError(error) {
  if (error?.message === 'DB_NOT_CONFIGURED') return new Error('DB_NOT_CONFIGURED');
  if (error?.code === '28P01') return new Error('DB_AUTH_FAILED');
  if (['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error?.code)) return new Error('DB_UNREACHABLE');
  return new Error('DB_CONNECTION_FAILED');
}

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
  try { const activePool = await getPool(); await activePool.query('SELECT 1'); }
  catch (error) { throw connectionError(error); }
}

export function databaseDiagnosticMessage(error) {
  if (error?.message === 'DB_NOT_CONFIGURED') return 'DATABASE_URL is missing. Configure a PostgreSQL/Supabase connection string.';
  if (error?.message === 'DB_AUTH_FAILED') return 'PostgreSQL rejected DATABASE_URL credentials. Verify the username and password.';
  if (error?.message === 'DB_UNREACHABLE') return 'Cannot reach PostgreSQL. Verify the host, network access, and Supabase availability.';
  return 'Cannot connect to PostgreSQL. Verify DATABASE_URL, SSL settings, and database availability.';
}

export async function getDatabaseReadiness() {
  try {
    await ensureDataStore();
    const result = await query("SELECT to_regclass('public.app_users') AS app_users, to_regclass('public.auth_refresh_tokens') AS refresh_tokens, to_regclass('public.faculties') AS faculties, to_regclass('supabase_migrations.schema_migrations') AS migration_history");
    return { connected: true, ...result.rows[0] };
  } catch (error) { return { connected: false, error: databaseDiagnosticMessage(error) }; }
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
