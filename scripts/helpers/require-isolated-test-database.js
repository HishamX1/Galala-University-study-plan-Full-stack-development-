export const TEST_DATABASE_NAME = 'gu_pt_phase1_test';
export const TEST_DATABASE_CONFIRMATION = 'I_CONFIRM_DISPOSABLE_LOCAL_DATABASE';

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validateTestDatabaseConfig({ testDatabaseUrl, confirmation, nodeEnv }) {
  if (String(nodeEnv || '').toLowerCase() === 'production') throw new Error('Database integration fixtures are disabled in production.');
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for database integration fixtures.');
  if (confirmation !== TEST_DATABASE_CONFIRMATION) throw new Error('Explicit disposable test database confirmation is required.');

  let parsed;
  try { parsed = new URL(testDatabaseUrl); }
  catch { throw new Error('TEST_DATABASE_URL must be a valid PostgreSQL URL.'); }

  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error('TEST_DATABASE_URL must use PostgreSQL.');
  if (!loopbackHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error('TEST_DATABASE_URL must target a local loopback host; shared and remote targets are rejected.');
  }
  if (parsed.port && parsed.port !== '5432') throw new Error('TEST_DATABASE_URL must use the local PostgreSQL port 5432.');
  if (parsed.search || parsed.hash) throw new Error('TEST_DATABASE_URL query parameters and fragments are not allowed.');

  let databaseName;
  try { databaseName = decodeURIComponent(parsed.pathname.slice(1)); }
  catch { throw new Error('TEST_DATABASE_URL database path is invalid.'); }
  if (databaseName !== TEST_DATABASE_NAME) throw new Error(`The dedicated local database must be named ${TEST_DATABASE_NAME}.`);
  return testDatabaseUrl;
}

export function requireIsolatedTestDatabase(environment = process.env) {
  const databaseUrl = validateTestDatabaseConfig({
    testDatabaseUrl: environment.TEST_DATABASE_URL,
    confirmation: environment.ALLOW_DESTRUCTIVE_TEST_DB,
    nodeEnv: environment.NODE_ENV
  });
  // Fixture scripts must call this before dynamically importing backend modules.
  // The normal application DATABASE_URL is intentionally ignored.
  environment.DATABASE_URL = databaseUrl;
  return databaseUrl;
}
