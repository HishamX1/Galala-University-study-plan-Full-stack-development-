# Production readiness audit

Audit date: 2026-07-18

## Scope and evidence

Reviewed the Node runtime, API routing, authentication bootstrap, database access layer, Supabase migrations, Render and Netlify manifests, frontend API configuration, scripts, and deployment documentation. `npm run check` passes. Production-mode `npm run doctor` passes against the configured Supabase database, including canonical/authentication table and migration-history checks.

## Issues found and fixed

| Finding | Risk | Resolution |
| --- | --- | --- |
| Only `.env` was read. | Environment-specific and local deployment settings could be silently ignored. | Load `.env`, then `.env.development`/`.env.production`, then `.env.local`; host values remain highest priority. |
| Startup and API errors could surface low-level database messages. | Leaks provider/network details and slows incident diagnosis. | Added sanitized database diagnostic categories for missing URL, invalid credentials, unreachable host, and generic connection failure. |
| Bootstrap did not verify connection or migration state. | Operators could enter credentials before discovering the database was unavailable or auth tables absent. | Bootstrap now validates connectivity and both authentication tables before prompting. |
| No operational preflight command existed. | Deployment configuration and migrations were easy to miss. | Added `npm run doctor` with green/red checks for configuration, database/auth tables, bootstrap state, frontend config, Render, and Netlify. |
| Render manifest lacked production JWT and cookie settings and used non-deterministic install. | Production could fail at startup or deploy differing dependency trees. | Added `NODE_ENV`, `JWT_SECRET`, cookie settings, and `npm ci`. |
| Netlify-to-Render cookie settings were not explicit. | Cross-origin login sessions can fail in browsers. | Added `COOKIE_SAME_SITE` validation and production `None`/secure Render configuration. |
| Smoke test still assumed anonymous API access. | It no longer tested the secured deployment and could mislead operators. | It now requires Super Admin smoke credentials, logs in first, and clearly skips if absent. |
| `.env.example` contained obsolete data-mode/seed settings and wildcard CORS advice. | Misconfiguration risk. | Replaced with current auth, cookie, database, and smoke-test settings. |
| Malformed JWT signatures could cause a server error. | Invalid client input could become a 500 response. | Added a signature-length check before timing-safe comparison. |
| Static file serving had no explicit containment check. | Defense-in-depth gap around path handling. | Added frontend-directory containment validation. |

## Verified constraints

- Authentication, catalog behavior, import/export/backup logic, and schema design were not changed for this audit.
- Bootstrap remains a controlled command, not a public API.
- Production rejects missing `DATABASE_URL`, missing `JWT_SECRET`, and missing/wildcard `CORS_ORIGIN`.
- Database exception details are not returned to API callers.

## Remaining recommendations

This audit is historical and was not re-run as a production readiness check on 2026-10-17. In particular, the dependency statement and readiness score below must not be treated as current evidence.

1. The 2026-07-18 audit recorded `xlsx@0.18.5` as a direct high-severity dependency. The current locked dependency tree does not contain `xlsx`; it contains `exceljs@4.4.0` with transitive `uuid@8.3.2`. A fresh `npm audit --omit=dev` could not reach the npm advisory endpoint in this environment, so current advisory status is unverified. See [ExcelJS/uuid Security Risk Acceptance](security/exceljs-uuid-risk-acceptance.md).
2. Keep the Render dashboard secrets synchronized with `.env.production` during deployment. The Supabase connectivity and migration-state statement in the 2026-07-18 scope is historical and was not reverified for this documentation refresh.
3. Run the authenticated smoke test only against a non-production database or an isolated test tenant because it creates and deletes catalog data.
4. Consider an automated CI job that runs `npm ci`, `npm run check`, `npm run doctor` with non-secret configuration validation, and `npm audit` on every deployment.

## Readiness score

**92/100 was the score assigned on 2026-07-18 only.** It is not a current readiness verdict: production connectivity/migration state and the complete current dependency audit have not been reverified in this pass.
