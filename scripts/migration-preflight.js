import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { closePool, getMigrationHistoryVersions } from '../backend/src/db/client.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '..');
const migrationsDirectory = path.join(repositoryRoot, 'supabase', 'migrations');

export function parseMigrationFilename(filename) {
  const match = String(filename).match(/^(\d{14})_([a-z0-9_]+)\.sql$/i);
  if (!match) throw new Error(`Invalid migration filename: ${filename}`);
  return { version: match[1], filename };
}

export function compareMigrationVersions(requiredVersions, appliedVersions) {
  const required = new Set(requiredVersions);
  const applied = new Set(appliedVersions.map((version) => String(version)));
  return {
    missing: [...required].filter((version) => !applied.has(version)).sort(),
    unexpected: [...applied].filter((version) => !required.has(version)).sort()
  };
}

export function loadRequiredMigrations(directory = migrationsDirectory) {
  const filenames = fs.readdirSync(directory).filter((filename) => filename.toLowerCase().endsWith('.sql')).sort();
  const migrations = filenames.map(parseMigrationFilename);
  const seen = new Set();
  for (const migration of migrations) {
    if (seen.has(migration.version)) throw new Error(`Duplicate migration version: ${migration.version}`);
    seen.add(migration.version);
  }
  if (!migrations.length) throw new Error('No SQL migrations were found.');
  return migrations;
}

export async function getSchemaMigrationState() {
  const migrations = loadRequiredMigrations();
  const history = await getMigrationHistoryVersions();
  if (!history.available) return { available: false, migrations, reason: history.reason };

  const appliedVersions = history.versions.map((version) => String(version));
  return {
    available: true,
    migrations,
    appliedVersions,
    ...compareMigrationVersions(migrations.map(({ version }) => version), appliedVersions)
  };
}

export async function runSchemaPreflight() {
  console.log('Read-only schema migration preflight');
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL is not configured; no database connection was attempted.');
    return 1;
  }

  try {
    const state = await getSchemaMigrationState();
    console.log(`Required migrations in repository: ${state.migrations.length}`);
    if (!state.available) {
      console.error(`✗ Applied migration state cannot be verified: ${state.reason}`);
      console.error('Use the approved migration workflow with Supabase migration history. Do not create or edit history rows manually.');
      return 1;
    }

    console.log(`Applied versions recorded by Supabase: ${state.appliedVersions.length}`);
    if (state.missing.length) {
      console.error('✗ Required migrations missing from database history:');
      for (const version of state.missing) {
        const migration = state.migrations.find((entry) => entry.version === version);
        console.error(`  - ${migration.filename}`);
      }
    }
    if (state.unexpected.length) {
      console.error(`✗ Database history contains versions absent from this checkout: ${state.unexpected.join(', ')}`);
    }
    if (state.missing.length || state.unexpected.length) return 1;

    console.log('✓ All repository migrations are recorded as applied; no unexpected versions were found.');
    console.log('This check verifies migration history only; it does not prove provider-specific policies or production readiness.');
    return 0;
  } catch (error) {
    console.error(`✗ Migration preflight could not complete: ${error.message}`);
    return 1;
  } finally {
    await closePool();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await runSchemaPreflight();
}
