import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { compareMigrationVersions, loadRequiredMigrations, parseMigrationFilename, runSchemaPreflight } from './migration-preflight.js';

assert.deepEqual(parseMigrationFilename('20260812090000_catalog_import_staging.sql'), {
  version: '20260812090000',
  filename: '20260812090000_catalog_import_staging.sql'
});
assert.throws(() => parseMigrationFilename('catalog_import.sql'), /Invalid migration filename/);
assert.deepEqual(compareMigrationVersions(['20260420120000', '20260812090000'], ['20260420120000']), {
  missing: ['20260812090000'],
  unexpected: []
});
assert.deepEqual(compareMigrationVersions(['20260420120000'], ['20260420120000', '20260901000000']), {
  missing: [],
  unexpected: ['20260901000000']
});
const repositoryMigrations = loadRequiredMigrations();
assert.equal(repositoryMigrations.length, 11, 'the complete canonical migration chain should be discovered');
assert.equal(repositoryMigrations.at(-1).version, '20261022130000');
assert.equal(repositoryMigrations.at(-1).filename, '20261022130000_super_admin_activity_audit.sql');

const previousDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = '';
const originalError = console.error;
let missingConfigurationMessage = '';
console.error = (message) => { missingConfigurationMessage += `${message}\n`; };
try {
  assert.equal(await runSchemaPreflight(), 1);
  assert.match(missingConfigurationMessage, /no database connection was attempted/);
} finally {
  console.error = originalError;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
}

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'migration-preflight-'));
try {
  fs.writeFileSync(path.join(temporaryDirectory, '20260812090000_catalog_import_staging.sql'), '');
  fs.writeFileSync(path.join(temporaryDirectory, '20260420120000_init_schema.sql'), '');
  assert.deepEqual(loadRequiredMigrations(temporaryDirectory).map(({ version }) => version), ['20260420120000', '20260812090000']);

  fs.writeFileSync(path.join(temporaryDirectory, '20260812090000_duplicate.sql'), '');
  assert.throws(() => loadRequiredMigrations(temporaryDirectory), /Duplicate migration version/);
} finally {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}

console.log('Migration preflight manifest and comparison tests passed without connecting to PostgreSQL.');
