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
assert.equal(repositoryMigrations.length, 19, 'the complete canonical migration chain should be discovered');
assert.equal(repositoryMigrations.at(-1).version, '20261026120000');
assert.equal(repositoryMigrations.at(-1).filename, '20261026120000_student_profile_goals.sql');
const errorReportMigration = fs.readFileSync(new URL('../supabase/migrations/20261024120000_admin_error_reports.sql', import.meta.url), 'utf8');
assert.match(errorReportMigration, /ENABLE ROW LEVEL SECURITY/);
assert.match(errorReportMigration, /FORCE ROW LEVEL SECURITY/);
assert.doesNotMatch(errorReportMigration, /CREATE POLICY/);
const prerequisiteGroupMigration=fs.readFileSync(new URL('../supabase/migrations/20261026100000_prerequisite_groups.sql',import.meta.url),'utf8');
assert.match(prerequisiteGroupMigration,/INSERT INTO public\.course_prerequisite_groups[\s\S]*'mandatory'/);
assert.match(prerequisiteGroupMigration,/legacy_relation_id/);
assert.match(prerequisiteGroupMigration,/group_type text NOT NULL CHECK \(group_type IN \('mandatory', 'alternative'\)\)/);
const studentProgressMigration=fs.readFileSync(new URL('../supabase/migrations/20261026110000_student_self_reported_progress.sql',import.meta.url),'utf8');
assert.match(studentProgressMigration,/REFERENCES public\.app_users\(id\) ON DELETE CASCADE/);
assert.match(studentProgressMigration,/verified boolean NOT NULL DEFAULT false CHECK \(verified = false\)/);
assert.match(studentProgressMigration,/grade text NOT NULL CHECK/);
const studentProfileGoalsMigration=fs.readFileSync(new URL('../supabase/migrations/20261026120000_student_profile_goals.sql',import.meta.url),'utf8');
assert.match(studentProfileGoalsMigration,/total_program_credits smallint CHECK \(total_program_credits BETWEEN 1 AND 1000\)/);
assert.match(studentProfileGoalsMigration,/target_gpa numeric\(3,2\) CHECK \(target_gpa BETWEEN 0 AND 4\)/);
const seed=fs.readFileSync(new URL('../supabase/seed.sql',import.meta.url),'utf8');
assert.match(seed,/INSERT INTO course_prerequisite_groups[\s\S]*legacy_relation_id[\s\S]*INSERT INTO course_prerequisite_group_members/,
  'canonical seeded prerequisite links retain one mandatory group per legacy relationship');
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
