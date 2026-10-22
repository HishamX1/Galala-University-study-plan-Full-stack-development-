# Performance optimization implementation note

## Scope and baseline

This implementation is based on `main` SHA `6b7f7e4c550a9478bf13d3fd0590640a2e184eb8` and the code-review candidates in draft PR #17. PR #17 explicitly did not collect browser, API, PostgreSQL, or provider latency measurements. This note keeps its source-backed findings separate from measurements made for this change.

## Implemented

`backend/src/services/adminOpsService.js` now builds maps and sets in single passes for dashboard program counts, relationship counts, course reachability, and semester counts. The export formatter builds a reverse relationship lookup once instead of rescanning the entire relationship list for each program-course row. Output fields, metric meanings, and relationship ordering are retained.

`frontend/admin/modules/auth.js` now starts the catalog load and admin-operations load concurrently after the administrator role is validated, both after interactive login and session restoration. They populate independent state and render separate panels; requested deep links are still activated after both complete. The number and contents of requests are unchanged. No browser journey timing was available, so the latency benefit is not quantified.

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

- Super-admin user and request data are still loaded in sequence during session restoration because the request renderer reuses the active-admin list populated by the user loader. A browser/API test is needed before changing that dependency or making secondary-tab data lazy.
- Dashboard summary still reads the catalog snapshot. A disposable PostgreSQL fixture and query plans are needed to decide whether aggregate SQL can reduce database work without changing role-scoped semantics.
- Logo PNG source size (155,898 bytes) was observed, but no logo conversion was completed.
- Desktop/mobile browser rendering, transfer sizes, and layout-shift behavior for the resized backgrounds remain unverified; static source files were visually inspected only.
- No authenticated browser journey, API P50/P95, PostgreSQL query timing/plan, provider latency, or staging comparison was available. Those end-to-end results remain unverified.

No migration, production configuration, hosted data, deployment, or external service was changed.
