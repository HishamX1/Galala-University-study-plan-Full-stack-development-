---
name: galala-security-engineer
description: Perform focused security audits and security-preserving changes for the Galala University Study Plan Node API and static frontend, covering authentication, sessions, RBAC, browser security, recovery, abuse controls, secrets, audit integrity, and security regression testing.
---

# Galala Security Engineer

Use this skill for security audits, authentication or session hardening, RBAC review, cookie/CORS/CSRF analysis, password recovery, rate limiting, security headers, secret handling, security-event integrity, dependency advisory review, and focused security regression tests.

Do not use it for broad architecture refactors unless a confirmed security issue requires one. `AGENTS.md` remains the project-wide contract; `galala-architecture-engineer` remains responsible for general architecture work.

## Project security context

- The canonical runtime is the repository-root `backend/` and `frontend/` tree. `modernization/` is not runtime source.
- The backend is a Node HTTP API. The frontend is static JavaScript and must never connect directly to PostgreSQL.
- Authentication uses bcrypt password hashes, short-lived access tokens, revocable refresh sessions, and `HttpOnly` cookies. Production cross-origin cookies require explicit secure `SameSite` configuration.
- The roles are `student`, `regular_admin`, and `super_admin`. Backend permissions are authoritative; frontend guards are convenience only.
- PostgreSQL access belongs behind `backend/src/db/client.js` and repositories. Security mutations and their audit records must share the service-owned transaction executor.
- Existing `xlsx` import/export has a documented high-severity advisory. Do not replace or upgrade it automatically; assess reachability, trusted-admin exposure, compatibility, and parser limits first.

## Required workflow

1. Read the repository-root `AGENTS.md` first.
2. Identify the exact security boundary and inspect the complete request, authentication, authorization, persistence, and response flow involved.
3. Establish current behavior before assuming a vulnerability. Identify attacker-controlled input, trust boundaries, sensitive operations, privilege transitions, and affected data.
4. Classify each finding as a confirmed vulnerability, defense-in-depth improvement, or theoretical concern. Do not inflate severity.
5. For significant changes, state a concise plan before editing.
6. Make the smallest safe, reversible fix and preserve API contracts and user-visible behavior unless a deliberate security change requires otherwise.
7. Add or update focused behavioral regression tests for real security behavior. Never weaken, delete, or bypass tests.
8. Inspect the final diff for unintended security regressions and report evidence, verification, and remaining risk.

## Review boundaries

Review only the areas relevant to the task, including when applicable:

- password validation, hashing, credential handling, login failure behavior, and account enumeration
- access-token lifetime, refresh-token rotation/revocation, logout, and session lifecycle
- password-reset requests, token expiry/use, recovery authorization, and bootstrap safeguards
- `HttpOnly`, `Secure`, `SameSite`, cookie scope, CORS allowlists, approved-origin/CSRF checks, and security headers
- backend authorization for every protected endpoint, least privilege, privilege escalation, recycle-bin protection, user operations, and recovery operations
- request/path/query/body validation, payload limits, malformed input, error disclosure, dynamic SQL safety, and path containment
- authentication and recovery rate limits, including trivial bypass and enumeration behavior
- logs, audit records, secrets, hashes, tokens, credentials, and environment values
- transaction atomicity for security-sensitive mutations, revocation, and audit writes
- dependency advisories only when the dependency is actually used and the affected path is reachable

## Non-negotiable rules

- Never disable authentication, authorization, origin protection, rate limiting, security middleware, session revocation, or password-reset safeguards to make behavior or tests easier.
- Never broaden permissions to make a test pass. Preserve `student`, `regular_admin`, and `super_admin` least privilege.
- Never expose passwords, password hashes, raw tokens, reset tokens, database credentials, JWT secrets, or sensitive environment values in responses, bundles, source control, or logs.
- Do not use frontend authorization as the security boundary.
- Do not silently change API paths, methods, status codes, response shapes, cookies, or frontend expectations.
- Do not modify production data, change the database schema, apply migrations, or deploy without explicit instruction.
- Do not make speculative security changes without a credible threat or measurable security benefit.

## Verification

Run the smallest relevant security test first. For significant security work, run from the repository root:

- `npm run check`
- `npm run test:foundation`
- `npm run test:auth`
- `npm run test:session`
- `npm run test:dashboard`
- `npm run test:student-portal`
- `npm run doctor`

Run additional focused tests when available. Do not claim a finding is fixed until the affected behavior is verified. Inspect `git diff` before handoff.

## Reporting

For each real finding, report:

- severity: Critical, High, Medium, Low, or Informational
- affected component and attack precondition
- impact and concrete evidence
- remediation and whether it was implemented
- tests or other verification performed
- remaining limitations or later-phase work

Keep audits evidence-based and concise.
