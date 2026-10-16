# Supabase Setup

The app expects the canonical Supabase schema already agreed for this project.

## Schema

Use:

- `../../supabase/migrations/20260420120000_init_schema.sql`

This creates:

- `faculties`
- `programs`
- `courses`
- `program_courses`
- `course_prerequisites`

## Seed

Use:

- `../../supabase/seed.sql`

Apply it from the Supabase SQL editor or your preferred database workflow. The runtime app does not reset or migrate the database on startup.

## Backend Env

```dotenv
DATABASE_URL=
PG_SSL=true
API_BASE_PATH=/api
CORS_ORIGIN=https://your-netlify-site.netlify.app
```

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
```

The direct `psql` migration procedure above does not create Supabase CLI's migration-history bookkeeping table, so `npm run doctor` will report that specific metadata check as unavailable even when the local schema is present. Use the doctor for that check only when the database was initialized/tracked through the Supabase migration workflow; do not create fake history rows just to make the doctor green. When verification is complete, close any process using the DB and remove only this disposable local database with `dropdb -h 127.0.0.1 -p 5432 -U postgres gu_pt_phase1_test`.

The review branch also defines `.github/workflows/architecture-review-1-integration.yml`. GitHub Actions provisions a fresh PostgreSQL 16 service container per run, applies every canonical migration in filename order, loads `supabase/seed.sql`, runs the database-free regression suite, and then runs the four guarded database-backed scripts. The workflow uses only ephemeral job-local credentials and has read-only repository permissions; it does not use repository database secrets or connect to Supabase. The service container is discarded with the job. This validates SQL and behavior on PostgreSQL 16, but does not verify Supabase-managed roles, network configuration, provider-specific policies, or production data. Treat a successful CI run as integration evidence for this disposable PostgreSQL environment, not as proof of production readiness.

Other database-free checks include `npm run test:refresh-rollback`, `npm run test:admin-ops-repositories`, `npm run test:admin-import`, `npm run test:admin-routes`, `npm run test:dashboard`, `npm run test:foundation`, and `npm run check`. The current scripts do not yet provide database-backed catalog CRUD, import-failure rollback, backup/audit atomicity, or forced audit-insert-failure coverage; add these to a disposable-database harness before considering those behaviors integration-verified. Drop the dedicated local test database when the run is complete.
