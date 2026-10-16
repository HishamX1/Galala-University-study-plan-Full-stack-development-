import assert from 'node:assert/strict';
import {
  requireIsolatedTestDatabase,
  TEST_DATABASE_CONFIRMATION,
  TEST_DATABASE_NAME,
  validateTestDatabaseConfig
} from './helpers/require-isolated-test-database.js';

const localUrl = `postgresql://fixture:secret@127.0.0.1:5432/${TEST_DATABASE_NAME}`;
const approved = { testDatabaseUrl: localUrl, confirmation: TEST_DATABASE_CONFIRMATION, nodeEnv: 'test' };

assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: '' }), /TEST_DATABASE_URL is required/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, nodeEnv: 'production' }), /disabled in production/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, confirmation: '' }), /confirmation is required/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: 'postgresql://u:p@db.example.com/gu_pt_phase1_test' }), /local loopback host/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: 'postgresql://u:p@aws-1-eu-central-1.pooler.supabase.com/postgres' }), /local loopback host/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: 'postgresql://u:p@127.0.0.1:5432/my_test_db' }), /must be named/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: `postgresql://u:p@127.0.0.1:5433/${TEST_DATABASE_NAME}` }), /port 5432/);
assert.throws(() => validateTestDatabaseConfig({ ...approved, testDatabaseUrl: `${localUrl}?host=shared.example.com` }), /query parameters/);
assert.equal(validateTestDatabaseConfig(approved), localUrl);

const environment = {
  TEST_DATABASE_URL: localUrl,
  ALLOW_DESTRUCTIVE_TEST_DB: TEST_DATABASE_CONFIRMATION,
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://shared.example.com/postgres'
};
assert.equal(requireIsolatedTestDatabase(environment), localUrl);
assert.equal(environment.DATABASE_URL, localUrl, 'the explicit disposable URL must override any application URL');

const rejectedEnvironment = { DATABASE_URL: 'postgresql://shared.example.com/postgres' };
assert.throws(() => requireIsolatedTestDatabase(rejectedEnvironment), /TEST_DATABASE_URL is required/);
assert.equal(rejectedEnvironment.DATABASE_URL, 'postgresql://shared.example.com/postgres', 'a rejected configuration must not change the environment');

assert.throws(() => validateTestDatabaseConfig({
  ...approved,
  testDatabaseUrl: 'postgresql://user:do-not-print@shared.example.com/postgres'
}), (error) => {
  assert.doesNotMatch(error.message, /do-not-print|shared\.example/);
  return true;
});

console.log('Database integration guard tests passed without connecting to PostgreSQL.');
