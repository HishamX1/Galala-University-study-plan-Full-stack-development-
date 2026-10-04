---
name: galala-architecture-engineer
description: Review and evolve the Galala University Study Plan architecture for backend refactors, modularization, technical-debt reduction, stabilization, and significant cross-file changes while preserving project contracts and safety boundaries.
---

# Galala Architecture Engineer

Use this skill for architecture reviews, backend architecture changes, controller/service/repository refactors, modularization, technical-debt reduction, stabilization, and significant cross-file refactors in this repository.

## Required workflow

1. Read the repository-root `AGENTS.md` first.
2. Inspect only the files and modules relevant to the requested task. Establish the current implementation before making assumptions.
3. Identify affected components, dependencies, API contracts, data flows, transaction boundaries, security boundaries, and regression risks.
4. For significant changes, write a concise implementation plan before editing.
5. Prefer the smallest safe, reversible implementation and preserve existing behavior unless a behavior change is explicitly requested.
6. Preserve API compatibility, authentication, authorization/RBAC, auditability, soft-delete semantics, transaction ownership, and data integrity.
7. Before finishing, inspect the final diff for unintended changes and report what changed, why, what was verified, and remaining risks.

## Current project architecture

The canonical source tree is the repository root:

- `backend/`: Node HTTP API and backend modules.
- `frontend/`: static landing, student, admin, authentication, shared-session, and API-client code.
- `scripts/`: project checks and regression tests.
- `supabase/`: migrations, seed data, and Supabase configuration.
- `render.yaml`, `netlify.toml`, and root `package.json`: canonical deployment and project configuration.

`modernization/` is an older duplicated implementation retained temporarily for migration verification. Do not treat it as runtime source, copy changes between trees, or delete it without explicit evidence and instruction.

The backend boundary is:

```
route/controller -> service -> repository -> PostgreSQL
```

- Routes/controllers own HTTP transport, request validation, authentication/authorization checks, and response formatting.
- Services own domain and business workflows, cross-entity orchestration, audit behavior, and multi-step transaction ownership.
- Repositories own SQL and persistence access, using the executor supplied by the owning service.
- Do not place database queries or business workflows in routes/controllers.
- Do not move business logic into repositories merely to shorten services.
- Do not introduce abstractions or duplicate implementations without a concrete need.

## Safety and compatibility rules

- Never weaken authentication, RBAC, permission checks, CSRF/origin protections, rate limiting, password-reset controls, audit logging, or session revocation to simplify a refactor.
- Preserve the roles `student`, `regular_admin`, and `super_admin`, applying least privilege to new or changed endpoints.
- Services own multi-write transactions: use one client, `BEGIN`, `COMMIT`, and `ROLLBACK`; repositories must not start nested transactions or commit independently.
- Preserve soft-delete, restore, recycle-bin, referential-integrity, and audit semantics.
- Treat existing `/api` paths, methods, status codes, response shapes, cookies, and frontend consumers as compatibility contracts. Do not make silent breaking changes.
- Do not modify production data, perform destructive database operations, change schema, deploy, or introduce a new database, ORM, runtime, or authentication system unless explicitly requested and architecturally approved.
- Do not make unrelated refactors, delete tests, weaken tests, or hide failures.

## Verification

Run the smallest relevant tests first, then broader verification required by `AGENTS.md`. For significant root-project changes, use the root working directory and applicable scripts such as:

- `npm run check`
- `npm run test:foundation`
- `npm run test:auth`
- `npm run test:session`
- `npm run test:student-portal`
- `npm run test:dashboard`
- `npm run doctor`
- `npm run smoke` when its required credentials and backend are available

Do not claim a test passed if it was skipped or blocked by missing configuration. Inspect the final git diff before handoff and state any remaining risks.

