---
name: galala-release-engineer
description: Prepare and validate safe releases for the Galala University repository without deploying, pushing, committing, or changing production infrastructure.
---

# Galala Release Engineer

Use this skill for release-readiness reviews, deployment preparation, and release verification of this repository. Read before changing. Validation is the default; never silently repair application, deployment, infrastructure, database, or data issues.

## Non-negotiable boundaries

1. Read `AGENTS.md` first, then inspect the repository state and relevant files.
2. The canonical tree is root `backend/` + `frontend/`, root `package.json`, root `render.yaml`, root `netlify.toml`, and ordered `supabase/migrations/`. Treat `modernization/` as a duplicate/legacy tree; do not copy from it or include it in runtime/deployment conclusions.
3. Do not deploy, push, commit, apply migrations, seed, bootstrap accounts, alter production configuration, or run destructive database operations unless the user explicitly authorizes that exact action. A release review alone does not authorize any of these.
4. Never expose secret values in output. Report names, presence, and safe classifications only. Do not remove suspicious backup or legacy files; report them.
5. Never use `git add .` blindly. Preserve unrelated work and review the final diff if changes were explicitly requested.

## Read-only release workflow

### 1. Repository and Git hygiene

Record the current branch, upstream, commit, dirty state, ahead/behind status, and recent release-relevant commits. Inspect tracked and untracked files separately. Check `.gitignore` and confirm environment files and secret-bearing files are ignored. Search tracked files and safe filenames/content patterns for accidental secrets without printing matches. Identify backup, `*.pre-*`, generated, and legacy files—especially `modernization/`—as findings, not automatic cleanup. Review staged and unstaged diffs, run `git diff --check`, and note whether a release checkpoint/tag/commit exists. Never rewrite history or stage files during this review.

### 2. Build and application validation

Use root scripts only. Compare `package.json` dependencies and scripts with `package-lock.json`; flag drift. Prefer a clean dependency-install check in an isolated or disposable location when feasible, and do not rewrite the lockfile. Run applicable existing `check`, `doctor`, `smoke`, unit, integration, regression, and security suites; distinguish skipped tests caused by missing credentials/services from failures. Validate backend startup only with safe, non-production configuration and stop it cleanly. Confirm health/doctor behavior and do not mistake syntax checks or a green local suite for production readiness.

### 3. Backend deployment readiness

Trace the root `package.json` start command to `backend/src/server.js`. Verify root directory, Render build/start commands, Node/runtime assumptions, required environment variable names, production-only flags, HTTPS/proxy and cookie assumptions, CORS origin, payload/security settings, database connectivity, migration history, and startup/health behavior. Confirm `DATABASE_URL`, `JWT_SECRET`, and other secrets are provider-managed rather than committed. Do not print values. Treat unavailable external database or hosting state as an environment/infrastructure dependency, not a code defect.

### 4. Frontend deployment readiness

Confirm the canonical publish directory is `frontend/`, inspect root `netlify.toml` redirects and security headers, and trace frontend API configuration to its production origin. Search frontend source/config for accidental `localhost`, `127.0.0.1`, credentials, database access, or references that would publish `modernization/`. Check CSP `connect-src`, HTTPS, cookies, and cross-origin compatibility against the actual API contract. Do not silently add/remove origins or weaken CSP.

### 5. Database and migration safety

Read migration filenames in order and inspect SQL for compatibility hazards, destructive operations (`DROP`, destructive `TRUNCATE`/deletes, irreversible transformations), unsafe defaults, missing constraints/indexes, and assumptions about existing data. Confirm schema authority is `supabase/migrations/`, not root `schema.sql`; inspect seed behavior separately. Check application compatibility with both pre- and post-migration states where relevant. Record rollback limitations and production-data risks. Never execute migration or seed SQL against shared/production data during this skill.

### 6. Verification and decision

Run only authorized, read-only local checks and safe smoke tests. Production URL checks are allowed only when the user explicitly requests an appropriate authorized verification; otherwise mark them not run. Classify every finding as exactly one of:

- **BLOCKER** — release must not proceed (security exposure, broken build/startup, missing required configuration, incompatible schema, failed required test, or unauthorized action required).
- **WARNING** — release may proceed only with conscious review or follow-up.
- **ACCEPTED RISK** — explicitly documented/intentional risk with owner or rationale; do not invent acceptance.
- **CLEAN** — checked with no finding.

For each finding, label the cause as `code defect`, `configuration defect`, `environment/infrastructure dependency`, or `intentional accepted risk`. Do not classify an unverified assumption as clean.

## Required final report

End every review with:

1. Overall readiness: `READY`, `READY WITH WARNINGS`, or `NOT READY`.
2. Exact blockers, warnings, and accepted risks, including classification and evidence.
3. Checks/tests completed, skipped, and their outcomes.
4. Deployment configuration status for Render, Netlify, frontend API origin, environment variables, CORS/cookies, database/migrations, and health behavior.
5. Rollback/readiness assessment and the recommended next action.

If no release review was requested and the task would require mutation, stop and ask for explicit scope. This skill does not itself deploy, push, commit, modify production infrastructure, or alter application code.
