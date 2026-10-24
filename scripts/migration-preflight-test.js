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
assert.equal(repositoryMigrations.length, 15, 'the complete canonical migration chain should be discovered');
assert.equal(repositoryMigrations.at(-1).version, '20261024090000');
assert.equal(repositoryMigrations.at(-1).filename, '20261024090000_catalog_revision_cache.sql');
const supportIndexMigration = fs.readFileSync(new URL('../supabase/migrations/20261022160000_support_list_order_indexes.sql', import.meta.url), 'utf8');
assert.match(supportIndexMigration, /idx_student_complaints_created_id/);
assert.match(supportIndexMigration, /idx_communication_outbox_created_id/);
const catalogRevisionMigration = fs.readFileSync(new URL('../supabase/migrations/20261024090000_catalog_revision_cache.sql', import.meta.url), 'utf8');
for (const table of ['faculties', 'programs', 'courses', 'program_courses', 'course_prerequisites']) {
  assert.ok(catalogRevisionMigration.includes(`'${table}'`), `catalog revision triggers cover ${table}`);
}
assert.match(catalogRevisionMigration, /SECURITY DEFINER[\s\S]*SET search_path = pg_catalog, public, pg_temp/,
  'catalog revision functions use a fixed search path');
assert.match(catalogRevisionMigration, /REFERENCING NEW TABLE AS new_rows/);
assert.match(catalogRevisionMigration, /REFERENCING OLD TABLE AS old_rows/);
assert.match(catalogRevisionMigration, /BEFORE TRUNCATE/);
assert.match(catalogRevisionMigration, /SELECT EXISTS \(SELECT 1 FROM public\.%I\)/,
  'truncate checks that rows existed before the statement');
assert.match(catalogRevisionMigration, /EXECUTE format\('SELECT EXISTS \(SELECT 1 FROM %I\)', TG_ARGV\[0\]\)/,
  'zero-row DML statements do not advance the revision');

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
