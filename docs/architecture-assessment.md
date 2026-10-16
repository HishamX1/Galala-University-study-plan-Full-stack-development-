# Phase 1 architecture assessment

## Current architecture

The application is a static HTML/CSS/JavaScript frontend served by Netlify (or the Node server locally), a Node HTTP API, and Supabase PostgreSQL. The browser calls only `/api`; database credentials remain server-side. The principal runtime path is `server -> route/controller -> service -> repository -> PostgreSQL`.

The canonical academic catalog is `faculties`, `programs`, `courses`, `program_courses`, and `course_prerequisites`. User, refresh-session, recovery, communications, complaints, audit, and backup tables are separate operational domains. `program_courses.year_no` and `semester_no` supply the UI grouping; they are not student progress.

## Findings and risks

- `catalogRoutes.js` retains the HTTP dispatch, security middleware, permission gates, and shared error mapping; controller-backed endpoint groups are covered by focused compatibility checks.
- Catalog, user, session, recovery, notification, audit, backup, recycle-bin, and admin catalog persistence is repository-backed. Admin services retain domain decisions, multi-repository orchestration, and service-owned transaction control.
- Existing persisted roles are `student`, `regular_admin`, and `super_admin`; the project brief's `admin` label must remain an alias in documentation rather than a data migration.
- Import currently validates and then writes to production tables. It has no staging/approval boundary.
- Administrative catalog updates are transactional in several paths, but most updates are last-write-wins; no general version field exists.
- The application has focused executable regression scripts but no isolated unit-test runner or integration test database.
- Refresh tokens and password-reset tokens are correctly stored as hashes, but security controls needed a common boundary and request observability.

## Phase 1 target

`routes -> controllers (incremental) -> services -> repositories -> PostgreSQL`

Cross-cutting modules live in `config`, `middleware`, `security`, `validation`, and `utils`. Routes own HTTP translation; services own orchestration and transactions; repositories own SQL. This phase establishes these directories and begins the extraction without changing API contracts or schema.

## Migration plan

1. Completed: extract catalog read/write operations into the five academic repositories without changing API contracts.
2. Completed: extract user/session/recovery/notification query groups from `authService` into repositories.
3. Completed: authentication, catalog, dashboard/profile/student actions, admin user/support operations, and admin catalog operations are controller-backed. The route module retains CORS, Origin/CSRF checks, rate limiting, user resolution, permission gates, dispatch ordering, and shared error mapping. Focused route/controller compatibility tests cover response behavior, handler completion, and middleware ordering.
4. In progress: add repository/service contract tests and verify integration behavior against a disposable test database. Database-backed verification is blocked in the current environment; the isolated setup procedure is documented in `docs/supabase-setup.md`.
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
- **Verified against disposable PostgreSQL 16 in GitHub Actions:** workflow run [38881978244](https://github.com/HishamX1/Galala-University-study-plan-Full-stack-development-/actions/runs/38881978244) on review commit `365bcc04270bc4e40ed4f7e7134fe61bdbcee9c6` completed successfully. It applied all canonical migrations, loaded the canonical seed, and passed authentication lifecycle, role-aware session/refresh rotation, student catalog hierarchy, recycle-bin restore/cascade/permanent deletion, and the new admin transaction integration suite. That suite confirmed backup/audit commit pairing, backup rollback on injected audit failure, and import rollback/no-audit behavior on an injected later-row failure. All database-free checks in that workflow also passed.
- **Still not established by this evidence:** focused database-backed catalog CRUD/executor-propagation coverage, Supabase-managed roles/RLS behavior and provider-specific networking, and production behavior/data. The CI PostgreSQL superuser does not reproduce Supabase connection roles or prove production readiness.
- **Local environment limitation:** `npm run doctor` and direct access to the configured Supabase pooler remain unavailable in this sandbox (`EACCES`); no destructive fixture was run against Supabase. This does not negate the isolated PostgreSQL CI results. Use `docs/supabase-setup.md` for the guarded local-database procedure if local reproduction is needed.

No production data was intentionally modified. No schema or API changes were made for verification.
