# Phase 1 architecture assessment

## Current architecture

The application is a static HTML/CSS/JavaScript frontend served by Netlify (or the Node server locally), a Node HTTP API, and Supabase PostgreSQL. The browser calls only `/api`; database credentials remain server-side. The principal runtime path is `server -> route/controller -> service -> repository -> PostgreSQL`.

The canonical academic catalog is `faculties`, `programs`, `courses`, `program_courses`, and `course_prerequisites`. User, refresh-session, recovery, communications, complaints, audit, and backup tables are separate operational domains. `program_courses.year_no` and `semester_no` supply the UI grouping; they are not student progress.

## Findings and risks

- `catalogRoutes.js` is an oversized HTTP/router module and historically mixed routing, CORS, authorization, parsing, and error mapping.
- Catalog, user, session, recovery, and notification persistence are repository-backed. `adminOpsService.js` remains a legacy SQL-heavy service and the catalog route remains an incremental controller-extraction candidate.
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
3. Partial: authentication is controller-backed; split the remaining legacy route file into dashboard, admin, and catalog controllers behind compatibility tests.
4. Add repository/service contract tests and a disposable test database.
5. Introduce explicit optimistic versions only after UI conflict handling is designed.

## Security foundation delivered

- Central role-to-permission definitions, enforced server-side.
- Correlation IDs, structured request logging, security response headers, and redacted error logging.
- 12 MB body ceiling, per-origin/IP auth/reset request rate limiting, explicit CORS, and Origin validation for cookie-authenticated mutations.
- Existing bcrypt cost 12, HttpOnly cookies, short-lived access JWTs, refresh rotation, and secure production cookie policy remain canonical.

## Known limitations

The in-process limiter is per backend instance; replace it with shared storage before horizontal scaling. Catalog services retain only `BEGIN`/`COMMIT`/`ROLLBACK` statements for transaction orchestration; all catalog persistence SQL is in repositories. The legacy route module and `adminOpsService` remain the next extraction candidates. Existing production data was not modified.
