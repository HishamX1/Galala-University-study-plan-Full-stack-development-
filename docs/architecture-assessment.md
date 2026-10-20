# Phase 1 architecture assessment

## Current architecture

The application is a static HTML/CSS/JavaScript frontend served by Vercel (current host as confirmed by the owner; its dashboard settings are not independently verified), a Node HTTP API, and Supabase PostgreSQL. The browser calls only `/api`; database credentials remain server-side. The principal runtime path is `server -> route/controller -> service -> repository -> PostgreSQL`. Root `netlify.toml` is retained legacy configuration pending a separate cleanup and is not evidence of active hosting behavior.

The canonical academic catalog is `faculties`, `programs`, `courses`, `program_courses`, and `course_prerequisites`. User, refresh-session, recovery, communications, complaints, audit, and backup tables are separate operational domains. `program_courses.year_no` and `semester_no` supply the UI grouping; they are not student progress.

## Findings and risks

- `catalogRoutes.js` retains the HTTP dispatch, security middleware, permission gates, and shared error mapping; controller-backed endpoint groups are covered by focused compatibility checks.
- Catalog, user, session, recovery, notification, audit, backup, recycle-bin, and admin catalog persistence is repository-backed. Admin services retain domain decisions, multi-repository orchestration, and service-owned transaction control.
- Existing persisted roles are `student`, `regular_admin`, and `super_admin`; the project brief's `admin` label must remain an alias in documentation rather than a data migration.
- Catalog import now uses persisted, owner-scoped staging, current-catalog revalidation, explicit same-administrator publication, and atomic publication/audit state. See `docs/catalog-import-staging.md`; the staging migration must be applied through the approved database change process before deploying this code.
- Administrative catalog updates are transactional in several paths, but most updates are last-write-wins; no general version field exists.
- The application has focused executable regression scripts and a GitHub Actions workflow that provisions a disposable PostgreSQL integration database per run; there is no repository-managed persistent test database.
- Refresh tokens and password-reset tokens are correctly stored as hashes, but security controls needed a common boundary and request observability.

## Phase 1 target

`routes -> controllers (incremental) -> services -> repositories -> PostgreSQL`

Cross-cutting modules live in `config`, `middleware`, `security`, `validation`, and `utils`. Routes own HTTP translation; services own orchestration and transactions; repositories own SQL. This phase establishes these directories and begins the extraction without changing API contracts or schema.

## Migration plan

1. Completed: extract catalog read/write operations into the five academic repositories without changing API contracts.
2. Completed: extract user/session/recovery/notification query groups from `authService` into repositories.
3. Completed: authentication, catalog, dashboard/profile/student actions, admin user/support operations, and admin catalog operations are controller-backed. The route module retains CORS, Origin/CSRF checks, rate limiting, user resolution, permission gates, dispatch ordering, and shared error mapping. Focused route/controller compatibility tests cover response behavior, handler completion, and middleware ordering.
4. Completed for the scoped Phase 1 boundaries: add repository/service checks and verify integration behavior against a disposable PostgreSQL database in CI. See the verification evidence below; Supabase-managed and production behavior remain outside this evidence.
5. Introduce explicit optimistic versions only after UI conflict handling is designed.

## Security foundation delivered

- Central role-to-permission definitions, enforced server-side.
- Correlation IDs, structured request logging, security response headers, and redacted error logging.
- 12 MB body ceiling, per-origin/IP auth/reset request rate limiting, explicit CORS, and Origin validation for cookie-authenticated mutations.
- Existing bcrypt cost 12, HttpOnly cookies, short-lived access JWTs, refresh rotation, and secure production cookie policy remain canonical.

## Known limitations

The in-process limiter is per backend instance; replace it with shared storage before horizontal scaling. Catalog and admin operations services retain transaction control and domain orchestration while persistence SQL is held in repositories. Admin dashboard and system-health reads use the audit, backup, and catalog repositories; the migration version is service metadata rather than a database query. Backup creation, import, restore, and permanent deletion use service-owned transactions, passing the same executor to participating repositories. Permanent recycle-bin deletion requires the target row to be soft-deleted.

### Phase 1 verification status

- **Verified without PostgreSQL:** route/controller compatibility (`npm run test:admin-routes`), admin repository query delegation (`npm run test:admin-ops-repositories`), import parser/security behavior (`npm run test:admin-import`), security foundation (`npm run test:foundation`), dashboard static contract (`npm run test:dashboard`), refresh rollback unit simulation (`npm run test:refresh-rollback`), database guard tests (`npm run test:db-guard`), and syntax checks (`npm run check`).
- **Verified against disposable PostgreSQL 16 in GitHub Actions:** workflow run [38882912269](https://github.com/HishamX1/Galala-University-study-plan-Full-stack-development-/actions/runs/38882912269) on review commit `3db1ea2e30ba11de7b2d0de18692a4fb52867b54` completed successfully. It applied all canonical migrations, loaded the canonical seed, and passed authentication lifecycle, role-aware session/refresh rotation, student catalog hierarchy, recycle-bin restore/cascade/permanent deletion, admin transaction, and catalog CRUD integration suites. The catalog suite exercised faculty/program/program-course/prerequisite create/read/update/soft-delete service workflows; verified duplicate relation behavior; and proved rollback for invalid prerequisite replacement, failed multi-write course creation, course update when audit insertion fails, and faculty cascade deletion when audit insertion fails. All database-free checks in that workflow also passed.
- **Still not established by this evidence:** full HTTP-to-PostgreSQL catalog endpoint integration (the existing route/controller compatibility suite is separate), exhaustive tests for every repository query/branch, Supabase-managed roles/RLS behavior and provider-specific networking, and production behavior/data. The CI PostgreSQL superuser does not reproduce Supabase connection roles or prove production readiness.
- **Local environment limitation:** `npm run doctor` and direct access to the configured Supabase pooler remain unavailable in this sandbox (`EACCES`); no destructive fixture was run against Supabase. This does not negate the isolated PostgreSQL CI results. Use `docs/supabase-setup.md` for the guarded local-database procedure if local reproduction is needed.

No production data was intentionally modified. No schema or API changes were made for verification.

## Operational-readiness follow-up (2026-10-20)

- The complete migration chain under `supabase/migrations/` is the schema authority. `supabase/seed.sql` now contains catalog fixture data only; the redundant `credits` column DDL was removed because that column is defined by the initial migration.
- `npm run db:preflight` performs read-only comparison of repository migration timestamps against `supabase_migrations.schema_migrations`. `npm run doctor` uses the same comparison and fails when history is absent, unreadable, incomplete, or contains versions not present in the checkout. This checks migration bookkeeping, not actual schema drift, Supabase RLS/provider configuration, or production readiness.
- The guarded direct-`psql` integration setup and CI apply SQL but do not populate Supabase migration history; they verify behavior through migration application and tests, not through this preflight. Do not fabricate history rows or blindly replay migrations applied outside the tracked workflow.
- `docs/release-and-recovery-runbook.md` now covers release gates and recovery decisions. The application's backup history contains catalog snapshots only; a whole-database recovery capability and provider retention have not been verified or rehearsed.
- Local verification for this follow-up: `npm run check`, `npm run check:migration-preflight`, `npm run test:migration-preflight`, and the database-free regression suite passed. PostgreSQL CI was not run for this follow-up, and no Supabase or production checks were performed. The migration preflight was not pointed at any database.

## Operational-readiness evidence update (2026-10-21)

- Stage 2 disposable PostgreSQL recovery rehearsal passed in [CI run 39497924033](https://github.com/HishamX1/Galala-University-study-plan-Full-stack-development-/actions/runs/39497924033) for commit `977e71e8fde893f99c1f2275eb5f9b8e6b769d13`. The workflow dumped the migrated/seeded CI database, restored it into a new database in the same disposable PostgreSQL service, and compared core catalog row counts. This is generic PostgreSQL logical restore evidence only; Supabase PITR, provider retention, and production recovery remain unverified.
- Stage 3 migration check: `NODE_ENV=production npm run db:preflight` found 9 repository migrations but could not connect to the configured Supabase host. The command performed only read-only queries; applied migration history is unknown, and no production data was modified.
- Stage 3 dependency check: local `npm ls exceljs uuid --all` confirms `exceljs@4.4.0 -> uuid@8.3.2`. The inspected ExcelJS code path calls `uuid.v4()` only. The current GitHub advisory lists `uuid@8.3.2` in its affected version range but describes the unsafe buffer behavior for v3/v5/v6 APIs; this bounds the observed call path but does not remove the affected-version package or establish that the dependency is safe. A fresh `npm audit --omit=dev` retry with an isolated cache again failed at the npm registry advisory endpoint and returned no audit findings; the temporary diagnostic log was written successfully. No dependency was upgraded or overridden. Temporary risk acceptance remains pending a successful audit and a compatible remediation.
- Hosting evidence: the owner confirmed Vercel is the active frontend host and Netlify cleanup is deferred. Repository files still contain Netlify settings; these are legacy and not active-host evidence. The deployment doctor no longer checks Netlify as active production and explicitly notes that Vercel dashboard settings are externally managed. Vercel dashboard build/security/environment settings and Render dashboard secrets/CORS values were not available for verification. Do not infer them from `netlify.toml`, `render.yaml` placeholders, or a successful preview check.
- Stage 3 remains **blocked by external verification**, not a confirmed application failure. Stage 4 optimistic concurrency was subsequently implemented and merged in PR #6; that work does not satisfy Stage 3 evidence requirements. See [Stage 3 Security and Production Evidence](stage-3-security-production-evidence.md) for the latest checks and the exact remaining operator actions.
