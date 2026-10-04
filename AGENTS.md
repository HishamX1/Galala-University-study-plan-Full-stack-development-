# AGENTS.md

## Project contract

This repository root is the directory containing `.git`, `package.json`, `backend/`, `frontend/`, `supabase/`, `render.yaml`, and `netlify.toml`.

The current source tree has two parallel application trees: the root `backend/` + `frontend/` implementation and a duplicated `modernization/` tree. Treat the root implementation as the source to inspect for normal code work. Do not assume that `modernization/` is canonical or copy changes between the trees without explicit architectural confirmation.

The canonical deployment configuration is root `render.yaml` plus root `netlify.toml`: Render uses the repository root and Netlify publishes `frontend/`. The root `package.json` owns the root scripts. Keep the older `modernization/` tree out of runtime configuration.

## Current architecture

- The root frontend is static HTML/CSS/JavaScript under `frontend/`. It contains landing, student, admin, authentication, shared-session, and API-client code. It must not connect directly to PostgreSQL.
- The root backend is a Node HTTP server at `backend/src/server.js`. It serves the root `frontend/` directory locally and handles `/api` requests.
- The backend flow is `route -> controller -> service -> repository -> PostgreSQL`, with shared middleware, validation, security, and database-client modules under `backend/src/`.
- Routes/controllers translate HTTP requests, validate input, authenticate and authorize requests, and format responses. Services own domain workflows and transaction orchestration. Repositories own SQL and persistence access. Keep these boundaries intact.
- `backend/src/db/client.js` is the database access boundary. Supabase is the hosted PostgreSQL provider; browser code must never receive database credentials.
- Database schema ownership is in ordered files under `supabase/migrations/`; seed data is in `supabase/seed.sql`. `schema.sql` at the root is empty and is not a schema authority.

## Database safety and transactions

- Use parameterized SQL and preserve foreign keys, unique constraints, checks, indexes, and row-level-security configuration.
- A service that spans multiple writes owns the transaction: use one client, `BEGIN`, perform all related work, `COMMIT`, and `ROLLBACK` on failure. Repositories use the supplied executor and must not independently commit or start nested transactions.
- Schema and data changes must be deliberate, reviewed, documented, and tested through the migration or controlled-data-change path. Never run ad-hoc destructive SQL against shared or production data.
- Catalog reads exclude rows with `deleted_at` unless an explicit administrative/recycle-bin operation requires them. Catalog deletion is soft deletion by default and records actor, reason, and timestamp.
- Restore, cascade, audit, backup/import, and permanent-delete operations must preserve referential integrity. Permanent deletion is restricted to the protected recycle-bin flow.

## Authentication, security, and RBAC

- Authentication is server-side. Passwords are hashed; short-lived access tokens and revocable refresh sessions are used; production auth cookies must remain `HttpOnly`, scoped, secure, and compatible with the configured cross-origin deployment.
- Enforce authorization on the backend for every protected endpoint. Frontend guards are presentation only. Preserve allowlisted CORS, CSRF origin checks, security headers, payload limits, validation, rate limiting, and account-enumeration protections.
- The project roles are `student`, `regular_admin`, and `super_admin`. Students receive student-facing read access and student actions; regular administrators operate curriculum/admin functions but not super-admin account or recovery operations; super administrators receive protected administrative access. Use least privilege for new endpoints.
- Never expose password hashes, raw tokens, credentials, or secrets in responses, client bundles, source control, or logs. Do not weaken session revocation, password-reset controls, audit logging, or bootstrap safeguards without focused security review and tests.

## API compatibility

- Treat existing `/api` paths, methods, status codes, response shapes, cookies, and frontend consumers as compatibility contracts. Prefer additive changes; coordinate any breaking change across route/controller, service, frontend, and tests.
- Validate request bodies and path parameters at the HTTP boundary and preserve the distinction between `401` authentication failures and `403` authorization failures.

## Testing and refactoring

- Inspect the current implementation and repository state before significant refactors. Preserve unrelated work and verify the final diff.
- Run the root project scripts from the repository root. Scripts in `modernization/package.json` belong to the duplicate tree and must not be treated as canonical commands.
- Authentication, RBAC, sessions, catalog integrity, soft-delete/restore, import/export, and transaction changes require focused verification. Syntax checks alone are insufficient.

## Deployment and data changes

- Production deployment requires explicit user instruction. Do not deploy, apply migrations, seed data, bootstrap accounts, or modify production configuration during ordinary coding work.
- Before any authorized deployment, validate the root Render start configuration, root Netlify publish directory, environment variables, CORS origin, cookies, and health checks.
- Keep `DATABASE_URL`, `JWT_SECRET`, credentials, reset tokens, and other secrets in ignored local environment files or hosting-provider secret configuration only.
- Any schema or data change must be intentional, documented with compatibility and rollback implications, and accompanied by the necessary application and verification changes.

## Architectural principles

- Prefer small, reversible changes that preserve existing data and API contracts.
- Keep transport concerns in routes/controllers, domain rules in services, persistence details in repositories, and presentation concerns in the frontend.
- Do not introduce another runtime, data store, authentication path, or schema authority without an explicit architectural decision recorded in the repository.
