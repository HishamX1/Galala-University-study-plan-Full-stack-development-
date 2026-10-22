# Performance optimization implementation note

## Scope and baseline

This implementation is based on `main` SHA `6b7f7e4c550a9478bf13d3fd0590640a2e184eb8` and the code-review candidates in draft PR #17. PR #17 explicitly did not collect browser, API, PostgreSQL, or provider latency measurements. This note keeps its source-backed findings separate from measurements made for this change.

## Implemented

`backend/src/services/adminOpsService.js` now builds maps and sets in single passes for dashboard program counts, relationship counts, course reachability, and semester counts. The export formatter builds a reverse relationship lookup once instead of rescanning the entire relationship list for each program-course row. Output fields, metric meanings, and relationship ordering are retained.

`frontend/admin/modules/auth.js` starts catalog and dashboard-summary loading together after role validation for both interactive login and session restoration. It does not wait for either request before allowing tab or deep-link activation, and each failure is reported separately. Super-admin user and request panels load only when opened; audit logs, recycle-bin rows, backups, system health, and import stages also load on tab entry. Direct links and Quick Access use the same loaders. Secondary requests are deduplicated, retry on a later tab open after failure, and are guarded so stale results cannot overwrite a newer refresh. Account mutations refresh the user list and only the loaded complaints page whose assignment options depend on that list.

For a super-admin entering Overview with no deep link, source-flow inspection counts 11 non-authentication API requests before this change (catalog, six admin-operations reads, and four user/request reads) and 2 after it (catalog and dashboard summary), an 81.8% reduction in startup request count by code-path inspection. This excludes `/auth/me` or the interactive login request and does not measure elapsed browser time. Regular-admin startup drops from five such requests to two. No authenticated browser journey timing was available.

User search and role/status filters now render from the in-memory account list instead of fetching `/admin/users` on every input event. Account creation, account updates, and password changes explicitly refresh the list after a successful mutation. The request count for local search/filter interaction drops from one full user-list request per input event to zero; update refresh behavior is preserved.

Super-admin support panels now fetch complaints and communication history in 50-row pages, with stable `created_at, id` ordering, bounded page limits, totals, and explicit previous/next controls. The complaints endpoint preserves its original array response when called without page parameters; page-aware callers receive an envelope, and complaint detail remains available by UUID for direct links. This reduces each initial support-list response and its table rendering to at most 50 rows while retaining access to older rows through pagination. Composite ordering indexes support these access paths. The guarded disposable PostgreSQL plan test confirms both actual page-query projections select their indexes at 20,000 rows; the measured index sizes are recorded as a storage trade-off. Write latency was not separately measured.

The disposable PostgreSQL integration test measured serialized repository payloads after generating 20,000 synthetic complaints and 20,000 synthetic communications (complaints total 20,001 including a separate behavior fixture). Full-history versus 50-row JSON sizes were 13,749,567 vs. 34,420 bytes for complaints (99.75% lower) and 26,600,001 vs. 66,547 bytes for communications (99.75% lower). These are serialized repository payloads, not HTTP transfer sizes; compression, headers, and browser rendering are excluded.

In CI run 39854716421, the guarded PostgreSQL 16 fixture ran one warm `EXPLAIN ANALYZE` per query/index condition using the same selected fields and joins as the repository endpoints. The complaint query changed from a sequential scan of 20,001 rows plus joins (18.625 ms total) to the `created_at, id` index scan returning 50 rows (0.137 ms). Communications changed from scanning 20,000 rows (10.801 ms total) to an ordered index scan returning 50 rows (0.087 ms). Each index occupied 827,392 bytes for this fixture. These single-run, in-memory CI timings are illustrative plan evidence, not stable latency estimates or production predictions; the plan change and bounded reads support retaining the indexes. Write amplification and production-sized index storage remain unmeasured.

The same disposable PostgreSQL run compared the previous sequential global dashboard service sequence with the new concurrent sequence for a super-admin, after five warmups and across 30 samples, with exact serialized response parity required for every pair. Sequential P50/P95 were 70.21/89.38 ms; concurrent P50/P95 were 62.84/74.18 ms (10.5% and 17.0% lower, respectively). This measures in-process service/database work, including pool wait; it excludes HTTP transport, browser rendering, and production hardware. The super-admin user-count query was moved into the existing parallel dashboard-data batch without changing the response fields.

The database diagnostic command, `npm run test:dashboard-db-performance`, is guarded to the loopback disposable PostgreSQL database. It creates and removes a UUID-scoped fixture with 2,500 program-course rows and 10,000 relationships, refreshes test-table statistics, records 30 warmed dashboard-service samples with P50/P95, and captures `EXPLAIN ANALYZE` summaries for the catalog snapshot reads. It reports measurements without imposing latency thresholds. The GitHub Actions integration job runs it after the PostgreSQL regressions.

CI measured the guarded fixture on 2026-10-22 using 30 dashboard-service samples after 5 warmups: P50 64.70 ms, P95 74.07 ms, range 56.86-76.89 ms. Query execution was 0.022 ms for active faculties, 0.015 ms for active programs, 11.622 ms for program courses with joins (2,567 rows), and 1.997 ms for prerequisite relationships (10,202 rows). These are disposable CI database/service measurements, not API, browser, or production latency; hardware and connection-pool behavior affect them.

The landing background JPEG was resized from 4000×3000 to 2400×1800 and re-encoded at JPEG quality 86, shrinking from 3,275,543 bytes to 547,182 bytes (83.3%). The student-card background was resized from 1280×960 to 1100×825 at the same quality, shrinking from 500,863 bytes to 141,305 bytes (71.8%). WebP variants preserve these dimensions and reduce the optimized JPEG sizes further to 280,080 bytes (48.8%) and 86,722 bytes (38.6%), respectively. Mean absolute luma differences between each JPEG and WebP are 1.52/255 and 1.67/255. CSS `image-set()` selects WebP in supporting browsers and retains JPEG fallback URLs. Pillow decode/compare and visual previews confirmed the variants retain the source scene; browser rendering of the WebP selection itself is not yet verified. Headless Chrome captures at 390×844 exposed horizontal clipping of the landing header and panels. A CSS adjustment was attempted but the follow-up capture still clipped content, so no responsive fix is included or claimed. The logo PNG was not changed.

## Synthetic before/after calculation measurement

The repeatable command is `npm run test:dashboard-analytics-performance`. It first compares the optimized result against the previous repeated-scan calculation for exact structural parity, then times both calculations over the same generated fixture.

| Environment | Workload | Previous median | Optimized median | Change |
|---|---:|---:|---:|---:|
| Local Node.js 24.15.0, in-process CPU calculation, 3 timed samples (2026-10-22) | 2,500 program-course rows; 10,000 prerequisite relationships | 415.00 ms | 2.67 ms | 99.4% lower calculation time |
| Local Node.js 24.15.0, in-process CPU calculation, 3 timed samples (2026-10-23) | 2,500 program-course rows; 10,000 prerequisite relationships | 411.87 ms | 1.90 ms | 99.5% lower calculation time |

The fixture and measurement are synthetic and machine-specific; repeated runs varied. This measures the JavaScript calculation only; it does not measure SQL, pool wait, HTTP round trips, response serialization, or browser rendering. It must not be interpreted as a 99.4% dashboard response-time improvement.

## Verification

Passed on this branch: `npm run check`, `npm run test:dashboard-analytics-performance`, `npm run test:admin-ops-repositories`, dashboard, Quick Access, admin route/UI, support-pagination, complaint-visibility, database-guard, migration-preflight, and `git diff --check`. The Quick Access contract asserts parallel catalog/dashboard startup, lazy secondary-tab loading, direct links, cache invalidation, and stale-response protection. The admin-route contract verifies super-admin dashboard reads all start before any one is awaited. CI run 39854612457 passed the expanded 20,000-row support-list plan and payload fixture.

## Remaining measurement work

- Browser/API timing is still needed to quantify the administrator initialization improvement and secondary-tab transitions.
- The parallel global dashboard read-path change is covered by a deterministic route contract and the disposable PostgreSQL sequential-versus-concurrent diagnostic in CI run 39855263800.
- Dashboard summary still reads the catalog snapshot. The disposable PostgreSQL fixture now provides query plans and baseline timings; aggregate SQL remains a future candidate to evaluate without changing role-scoped semantics.
- HTTP transfer-size and browser-rendering measurements for the paginated support lists remain outstanding. CI measured repository JSON sizes without HTTP compression, headers, or rendering.
- Logo PNG source size (155,898 bytes) was observed, but no logo conversion was completed.
- The landing page's mobile horizontal clipping needs a verified layout fix. Desktop/mobile rendering, transfer sizes, and layout-shift behavior for the resized backgrounds also remain unverified.
- No authenticated browser journey, API P50/P95, provider latency, or staging comparison was available. Those end-to-end results remain unverified.

No migration, production configuration, hosted data, deployment, or external service was changed.
