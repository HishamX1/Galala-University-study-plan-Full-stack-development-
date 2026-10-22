# Performance optimization implementation note

## Scope and baseline

This implementation is based on `main` SHA `6b7f7e4c550a9478bf13d3fd0590640a2e184eb8` and the code-review candidates in draft PR #17. PR #17 explicitly did not collect browser, API, PostgreSQL, or provider latency measurements. This note keeps its source-backed findings separate from measurements made for this change.

## Implemented

`backend/src/services/adminOpsService.js` now builds maps and sets in single passes for dashboard program counts, relationship counts, course reachability, and semester counts. The export formatter builds a reverse relationship lookup once instead of rescanning the entire relationship list for each program-course row. Output fields, metric meanings, and relationship ordering are retained.

`frontend/admin/modules/auth.js` starts catalog, admin-operations, and super-admin initialization together after role validation for both interactive login and session restoration. The super-admin account list and complaint assignment options share a single `/admin/users` request. The control-center request tables load in parallel with the other initial data, and requested deep links are activated after initialization completes. The number of requests is unchanged from session restoration; interactive login now also renders the user table from the already-required user request. No browser journey timing was available, so the latency benefit is not quantified.

User search and role/status filters now render from the in-memory account list instead of fetching `/admin/users` on every input event. Account creation, account updates, and password changes explicitly refresh the list after a successful mutation. The request count for local search/filter interaction drops from one full user-list request per input event to zero; update refresh behavior is preserved.

The database diagnostic command, `npm run test:dashboard-db-performance`, is guarded to the loopback disposable PostgreSQL database. It creates and removes a UUID-scoped fixture with 2,500 program-course rows and 10,000 relationships, refreshes test-table statistics, records 30 warmed dashboard-service samples with P50/P95, and captures `EXPLAIN ANALYZE` summaries for the catalog snapshot reads. It reports measurements without imposing latency thresholds. The GitHub Actions integration job runs it after the PostgreSQL regressions.

CI measured the guarded fixture on 2026-10-22 using 30 dashboard-service samples after 5 warmups: P50 64.70 ms, P95 74.07 ms, range 56.86-76.89 ms. Query execution was 0.022 ms for active faculties, 0.015 ms for active programs, 11.622 ms for program courses with joins (2,567 rows), and 1.997 ms for prerequisite relationships (10,202 rows). These are disposable CI database/service measurements, not API, browser, or production latency; hardware and connection-pool behavior affect them.

The landing background JPEG was resized from 4000×3000 to 2400×1800 and re-encoded at JPEG quality 86, shrinking from 3,275,543 bytes to 547,182 bytes (83.3%). The student-card background was resized from 1280×960 to 1100×825 at the same quality, shrinking from 500,863 bytes to 141,305 bytes (71.8%). Existing filenames and JPEG formats preserve current CSS references and browser compatibility. The candidate images were visually inspected, but browser rendering at desktop and mobile viewports was not available. The logo PNG was not changed.

## Synthetic before/after calculation measurement

The repeatable command is `npm run test:dashboard-analytics-performance`. It first compares the optimized result against the previous repeated-scan calculation for exact structural parity, then times both calculations over the same generated fixture.

| Environment | Workload | Previous median | Optimized median | Change |
|---|---:|---:|---:|---:|
| Local Node.js 24.15.0, in-process CPU calculation, 3 timed samples (latest recorded run) | 2,500 program-course rows; 10,000 prerequisite relationships | 415.00 ms | 2.67 ms | 99.4% lower calculation time |

The fixture and measurement are synthetic and machine-specific; repeated runs varied. This measures the JavaScript calculation only; it does not measure SQL, pool wait, HTTP round trips, response serialization, or browser rendering. It must not be interpreted as a 99.4% dashboard response-time improvement.

## Verification

Passed on this branch: `npm run check`, `npm run test:dashboard-analytics-performance`, `npm run test:admin-ops-repositories`, dashboard, Quick Access, admin route/UI, database guard, migration-preflight tests, and `git diff --check`. The Quick Access contract also asserts both authentication paths start independent catalog and admin-operations initialization together.

## Remaining measurement work

- Browser/API timing is still needed to quantify the super-admin initialization improvement and assess secondary-tab lazy loading.
- Dashboard summary still reads the catalog snapshot. The disposable PostgreSQL fixture now provides query plans and baseline timings; aggregate SQL remains a future candidate to evaluate without changing role-scoped semantics.
- Logo PNG source size (155,898 bytes) was observed, but no logo conversion was completed.
- Desktop/mobile browser rendering, transfer sizes, and layout-shift behavior for the resized backgrounds remain unverified; static source files were visually inspected only.
- No authenticated browser journey, API P50/P95, provider latency, or staging comparison was available. Those end-to-end results remain unverified.

No migration, production configuration, hosted data, deployment, or external service was changed.
