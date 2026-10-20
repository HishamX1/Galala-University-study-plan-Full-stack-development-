# Release and Recovery Runbook

This runbook covers the root application and ordered Supabase migrations. It does not authorize a production release, database write, migration, account bootstrap, or restore. Obtain the required project-owner approval before performing any production operation.

## Pre-release checklist

1. Confirm the release branch is based on the intended `main` commit, inspect the complete diff, and ensure no unrelated or secret-bearing files are included.
2. Confirm the pull request CI is green, including the disposable PostgreSQL workflow. Run `npm ci`, `npm run check`, and the relevant root regression scripts. Do not substitute local syntax checks for PostgreSQL integration evidence.
3. Review every pending SQL migration in filename order. Confirm it is additive/compatible with the application rollout, has no unreviewed destructive operation, and has a documented recovery decision. The repository has no automatic migration rollback mechanism.
4. For default read-only verification, confirm the linked target and run `supabase migration list --linked` and `npm run db:preflight`. These inspect migration bookkeeping only; they do not apply migrations. Never expose connection URLs or passwords in commands, screenshots, logs, or chat. Any migration application is a separate write operation and requires explicit project-owner approval, reviewed SQL, target confirmation, and a recovery plan as described in `supabase-setup.md`.
5. In Render, check required environment-variable presence and classification without displaying values; confirm production `NODE_ENV`, explicit CORS origin, and secure cookies. Confirm that the allowed origin is the exact Vercel production origin and that `frontend/config.js` points to the intended Render `/api` URL.
6. In Vercel, verify the connected repository and production branch, build/output settings for the root `frontend/` static files, and effective routes and security headers. Repository configuration does not prove dashboard state; record unavailable settings as blocked, not passed.
7. After the database owner has approved and applied the reviewed migrations, run `npm run db:preflight` and `npm run doctor`. Do not deploy the backend if required migration history is missing, unexpected, or unverifiable. The doctor cannot inspect provider dashboards.
8. Deploy backend and frontend only through the approved release process. Do not run seed data or bootstrap commands on an existing deployment.

## Post-release verification

- Verify the Render root health response and authenticated Super Admin `/api/health` check.
- Verify student login/session refresh/logout and student catalog browsing.
- Verify administrator login/RBAC, catalog read and a controlled non-destructive edit if authorized, import-stage preview and publish flow, and the relevant audit visibility.
- Verify the deployed frontend routes and that browser requests target the intended API origin. Check browser console/network errors without copying cookies or tokens into logs.
- Record deployed commit, migration preflight result, CI run, smoke-check outcome, and any deferred external verification. Do not record secret values.

## Incident triage and recovery

1. Record incident time, deployed commit, request/correlation IDs, affected workflow, and sanitized error class. Check Render/Vercel/Supabase provider status and logs through authorized dashboards; do not paste secrets or personal data into issue reports.
2. Stop repeated or destructive retries. Do not edit schema or production rows ad hoc. Identify whether the failure is application, configuration, migration, provider availability, or data integrity related.
3. If the application release is the cause, use the hosting provider's approved rollback to the last known-good application version only after confirming compatibility with the current database schema. Do not automatically reverse a migration; the schema may be ahead of the application and migrations have no guaranteed down scripts.
4. The application's admin backup feature stores catalog snapshots in `admin_backup_history`; it is not a whole-database backup and does not cover authentication/session, recovery, communications, or all operational data. Do not treat it as a complete disaster-recovery copy.
5. For database-wide recovery, use the institution's approved Supabase backup/PITR capability and retention policy. Confirm authorization, recovery point, target project, and impact with the database owner. Restore into an isolated project first when feasible; validate there before any production cutover. This repository cannot establish the provider plan's availability or retention.
6. After recovery, verify migration history/schema readiness, authentication and RBAC, catalog integrity, audit consistency, and the affected user workflows. Record the recovery point and any lost-work window. Resume normal releases only after the owner approves.

## Rehearsal requirement

The PostgreSQL CI workflow rehearses a logical dump and restore between two databases in its disposable PostgreSQL service, then compares catalog row counts. This verifies generic PostgreSQL dump/restore mechanics only; it does not verify Supabase PITR, provider backup retention, hosted configuration, or production recovery. No whole-database restore command or backup restore endpoint is provided by this repository. Rehearse provider-level database restoration only if an approved isolated recovery target and provider capability are available. Never point integration fixtures or a rehearsal restore at shared or production Supabase.
