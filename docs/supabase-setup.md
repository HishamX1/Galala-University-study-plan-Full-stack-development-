# Supabase Setup

The app requires the complete schema represented by every ordered migration in `../supabase/migrations/`. Runtime startup does not apply migrations.

## Migration workflow

Apply every migration in filename order. The current required migrations are:

- `20260420120000_init_schema.sql`
- `20260624090000_course_prerequisite_visibility.sql`
- `20260712090000_admin_course_integrity.sql`
- `20260712100000_admin_operations.sql`
- `20260715110000_admin_backup_xlsx.sql`
- `20260718090000_authentication.sql`
- `20260809090000_account_recovery_and_communications.sql`
- `20260811090000_dashboard_profiles.sql`
- `20260812090000_catalog_import_staging.sql`

For a new Supabase environment, apply these reviewed migrations using the project's approved Supabase migration workflow so `supabase_migrations.schema_migrations` records the applied versions. Before applying to any existing/shared project, review the pending SQL and confirm the target project and a recovery plan. Never replay a migration merely because it is absent from history: inspect whether its effects were already applied and reconcile through the approved migration process. Do not manually insert or edit migration-history rows.

### Read-only verification (default)

The following commands inspect migration history and compare it with the repository. They do not apply migrations or change database state. Confirm that the CLI is linked to the intended project before reading its history:

```powershell
supabase migration list --linked
npm run db:preflight
```

`supabase migration list --linked` is read-only but contacts the linked project. `npm run db:preflight` reads the configured database's migration-history table. Neither command proves the hosted schema, RLS, or provider configuration is otherwise correct.

### Migration application (separate, write operation)

This is not part of verification. **Do not run `supabase db push --linked` unless the project owner has explicitly approved that specific production migration operation**, the target project is independently confirmed, every pending migration has been reviewed, and the recovery plan is ready. A CLI dry-run can be used during that separately approved release review, but it is not authorization to apply anything:

```powershell
supabase db push --dry-run --linked
```

Only after the above approvals and a separate explicit authorization to perform the write may the release operator apply migrations:

```powershell
supabase db push --linked
supabase migration list --linked
npm run db:preflight
```

If migrations were previously run manually in the SQL editor, stop before pushing: the schema may already have changed without matching migration-history entries. Do not replay them or fabricate history rows; have the database owner reconcile the recorded state through the approved process.

Run this read-only check for verification, and again after any separately authorized migration application:

```bash
npm run db:preflight
```

It compares the 14-digit versions in the repository filenames with the Supabase migration-history table. It exits non-zero when history is missing/unreadable, repository migrations are unrecorded, or the database records versions absent from the checkout. It never applies SQL and does not prove the database schema, Supabase roles/RLS, or production configuration are otherwise correct.

The disposable PostgreSQL integration workflow applies all migration SQL files in sorted filename order with `psql`; that path does not create Supabase CLI migration history, so the migration-history preflight is not a CI assertion. The workflow separately verifies migration SQL by applying it and running database-backed tests. For a local database initialized with Supabase CLI, use its local migration workflow; the direct `psql` fixture procedure below is for integration tests and does not provide tracked migration history.

## Seed

Use only for a fresh/disposable environment or after an explicit data-impact review:

- `../supabase/seed.sql`

The seed loads catalog fixtures; it is not a production-data repair or migration mechanism. Do not seed a shared or production database as part of setup verification. The runtime app does not reset, seed, or migrate the database on startup.

## Backend Env

```dotenv
DATABASE_URL=
PG_SSL=true
API_BASE_PATH=/api
CORS_ORIGIN=https://your-vercel-production-domain.example
```

Replace the example with the exact HTTPS production origin assigned to the Vercel frontend. Do not use a wildcard. The frontend host and this backend allowlist must agree; preview origins should be added only when explicitly required and approved.

## Verification

Start the backend and check:

```bash
# Sign in as a Super Admin first, then call protected health endpoints with its session cookie.
curl http://localhost:4000/api/faculties
curl http://localhost:4000/api/program-courses
```

## Isolated Phase 1 integration-test database

Database-backed regression scripts create and delete users/catalog fixtures. They fail closed unless `TEST_DATABASE_URL` explicitly points to a loopback PostgreSQL host on port 5432 and the database is named `gu_pt_phase1_test`, and `ALLOW_DESTRUCTIVE_TEST_DB` is set to the confirmation value below. The scripts replace `DATABASE_URL` with `TEST_DATABASE_URL` before importing backend modules, so the regular application URL is not used. Never point this setting at production/shared data or tunnel a shared server through localhost. This repository does not provision a test database, so create a dedicated disposable local PostgreSQL database yourself.

With PostgreSQL running locally, create a fresh, dedicated database (the command prompts for the local PostgreSQL user's password if required), then from PowerShell at the repository root apply the migrations in filename order using `psql` (the migration files include their own transaction statements):

```powershell
createdb -h 127.0.0.1 -p 5432 -U postgres gu_pt_phase1_test
$env:TEST_DATABASE_URL = 'postgresql://postgres:<local-password>@127.0.0.1:5432/gu_pt_phase1_test'
$env:ALLOW_DESTRUCTIVE_TEST_DB = 'I_CONFIRM_DISPOSABLE_LOCAL_DATABASE'
$env:DATABASE_URL = $env:TEST_DATABASE_URL
$env:PG_SSL = 'false'

Get-ChildItem .\supabase\migrations\*.sql | Sort-Object Name | ForEach-Object {
  & psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f $_.FullName
  if ($LASTEXITCODE -ne 0) { throw "Migration failed: $($_.Name)" }
}
```

The guard rejects missing configuration, production mode, non-loopback hosts (including Supabase), nonstandard ports, URL query parameters, and any database name other than the exact dedicated name. A database name and URL checks cannot prove that the PostgreSQL server is disposable or that it contains no valuable data: use a dedicated local PostgreSQL instance/database, do not use SSH tunnels or proxies to shared servers, and review the target before opting in. The confirmation value is an explicit operator acknowledgment, not an isolation proof. Seed the local database with `supabase/seed.sql` only if needed by the student-catalog regression; that test requires existing catalog and prerequisite data.

Run the DB-backed checks from the same PowerShell session:

```powershell
npm run test:auth
npm run test:session
npm run test:student-portal
npm run test:recycle-bin
npm run test:admin-transactions
npm run test:catalog-crud
npm run test:admin-import-staging
```

The direct `psql` migration procedure above does not create Supabase CLI's migration-history bookkeeping table, so `npm run db:preflight` and `npm run doctor` cannot verify which migrations were applied there and will fail that check even when schema objects exist. Do not create fake history rows to make the checks green. Use this direct-`psql` path for isolated integration testing; use the approved tracked Supabase migration workflow when you need migration-history verification. When verification is complete, close any process using the DB and remove only this disposable local database with `dropdb -h 127.0.0.1 -p 5432 -U postgres gu_pt_phase1_test`.

The repository defines `.github/workflows/architecture-review-1-integration.yml`. GitHub Actions provisions a fresh PostgreSQL 16 service container per run, applies every canonical migration in filename order, loads `supabase/seed.sql`, runs the database-free regression suite, and then runs the guarded database-backed scripts, including import staging. The workflow uses only ephemeral job-local credentials and has read-only repository permissions; it does not use repository database secrets or connect to Supabase. The service container is discarded with the job. This validates SQL and behavior on PostgreSQL 16, but does not verify Supabase-managed roles, network configuration, provider-specific policies, or production data. Treat a successful CI run as integration evidence for this disposable PostgreSQL environment, not as proof of production readiness.

Other database-free checks include `npm run test:refresh-rollback`, `npm run test:admin-ops-repositories`, `npm run test:admin-import`, `npm run test:admin-routes`, `npm run test:admin-import-staging-routes`, `npm run test:dashboard`, `npm run test:foundation`, and `npm run check`. The admin transaction integration script verifies successful backup/audit pairing and rollback on injected audit/import failures. The catalog CRUD integration script covers catalog CRUD and transaction rollback. The staging integration test covers owner isolation, stale previews, expiry, cancellation, concurrent publication, and transaction rollback/retry. Fixtures and temporary triggers are scoped to generated IDs/names. Drop the dedicated local test database when the run is complete.
