# Performance baseline and bottleneck assessment

**Assessment status: partial, source-backed baseline; end-to-end performance baseline remains incomplete.** This is a measurement-first review. No application optimization, schema change, runtime instrumentation, deployment, database operation, or production request was performed.

## Repository and evidence provenance

- GitHub reports `main` at `6b7f7e4c550a9478bf13d3fd0590640a2e184eb8` (merge of PR #16). The source tree hash is `e21360ad143c52174248a14c934bca5264fcd75e`.
- Assessment branch: `codex/performance-baseline`. The isolated local source snapshot begins at `d3460fd66d990a36928076ba649da76453ca10de`, the Part 9 commit and second parent of the verified `main` merge. Its tree hash is also `e21360ad143c52174248a14c934bca5264fcd75e`, exactly matching current `main` content. The merge commit object was not present in the original local object database, and a shell `git fetch` could not reach GitHub; source-content identity was checked by tree hash through the GitHub API and local Git object database. If published, the PR branch will be created directly from verified `main` SHA `6b7f7e4c550a9478bf13d3fd0590640a2e184eb8`. The original checkout remains on `codex/part-9-final-delivery` with its five existing documentation edits untouched.
- PR #7 (`codex/stage-3-security-production`) was rechecked and remains **open and draft**. No release state was changed.
- GitHub Actions run [#39789037587](https://github.com/HishamX1/Galala-University-study-plan-Full-stack-development-/actions/runs/39789037587) passed for the Part 9 commit. It is regression/integration evidence, not a latency benchmark.
- Local environment: Windows, Node.js `v24.15.0`; no `TEST_DATABASE_URL` or dedicated performance staging URL was configured. No `psql` client was available on PATH. Playwright/Puppeteer are not project dependencies. A headless Chrome attempt using an isolated temporary profile did not return page DOM; no Web Vitals were captured, and the temporary profile was removed. No production host, Supabase database, Resend endpoint, or student/admin credentials were used.

## Method and results

The current environment supports source inspection and static file-size measurement, but not authenticated application journeys or a safely isolated database benchmark. Counts below are deliberately separated from response-time measurements.

| Measure | Result | Evidence type / limitation |
|---|---:|---|
| Main branch content | SHA `6b7f7e4c…`; tree `e21360ad…` | GitHub branch API and matching local source-tree hash |
| Frontend/API latency samples | **0** | No authorized staging endpoint or browser capture; P50/P95/max unavailable |
| PostgreSQL query samples / EXPLAIN | **0** | No disposable local database configured; CI PostgreSQL tests do not measure query latency |
| Student/admin authenticated journey samples | **0** | No dedicated non-production test account/session was supplied for this assessment |
| Landing HTML source file | 14.78 KiB | Local file size, not compressed network transfer |
| Landing background image | 3,198.77 KiB | Local JPEG file size; not an observed transfer or proof that every visitor downloads it |
| Student-card background image | 489.12 KiB | Local JPEG file size |
| University logo | 152.24 KiB | Local PNG file size |
| Referenced landing-page HTML plus these three local images | up to 3,854.91 KiB | Arithmetic sum of source files; excludes CSS/font responses and does not account for viewport, caching, or compression |
| Student/admin HTML and CSS source files | student HTML 12.99 KiB, student CSS 33.35 KiB; admin HTML 27.95 KiB, admin CSS 8.61 KiB; shared styles 15.08 KiB and design system 18.08 KiB | Local file sizes only |

No cold/warm timing comparison, LCP/INP/CLS, API status/error rate, payload transfer size, connection-pool wait, or query duration is claimed. Provider/CDN compression, cache behavior, and deployed assets are unknown. The landing and student pages request Google Fonts; external font latency was not measured.

## Architecture and code-path observations

These are code-review findings and measurement priorities—not measured bottlenecks.

| Priority | Journey / candidate | Direct evidence | Assessment and validation needed |
|---|---|---|---|
| 1 | Super-admin sign-in and initial control panel | `frontend/admin/modules/auth.js` awaits `loadRelations()`, then `loadAdminOps()`, then `loadControlCenter()`. `loadAdminOps()` fetches several resources in parallel, then awaits audit logs; the control center fetches three or four more resources in parallel. | Multiple sequential network waves can amplify user-perceived latency on high-RTT connections. Measure each request and time-to-interactive with a dedicated admin account before considering any consolidation or reordering. Preserve role checks, error feedback, and tab deep links. |
| 2 | Admin dashboard summary | `backend/src/services/adminOpsService.js` reads the full catalog snapshot, then performs audit/count reads sequentially and derives analytics using repeated array `filter`/`some` scans. The dashboard controller awaits dashboard data, catalog summary, and Super Admin system health in sequence. | Potential database round-trip and CPU growth as catalog/audit rows grow. Obtain per-query timings and `EXPLAIN (ANALYZE, BUFFERS)` only on disposable PostgreSQL; compare response JSON before considering changes. |
| 3 | Admin request/communication/user lists | `listComplaintRecords`, `listCommunicationRecords`, and `listUsers` return whole ordered result sets without a page limit; the UI renders returned records into tables. Audit logs are separately bounded to 100 rows per request. | Response and DOM work can grow with retained history. Measure actual row counts, payload bytes, and render time. Pagination would affect API/UI behavior and must be designed compatibly, not assumed necessary from source alone. |
| 4 | Landing-page initial load | The `landing-background.jpg` source file is about 3.12 MiB and is referenced as a CSS background; the page also references the student-card background and logo. The page uses layered blur/filter effects and external Google Fonts. | Asset size is a concrete optimization candidate, but the resulting network cost and rendering impact are not measured. Capture browser Network/Web Vitals on desktop and mobile; if material, test responsive/compressed image variants and visual quality before adopting them. |
| 5 | Student password-reset request | `createStudentPasswordResetRequest` awaits the email sender after committing token creation. The Resend adapter applies an 8-second request timeout. | External-provider wait is a plausible latency source, not a measured one. The existing provider contract test mocks HTTP; it does not benchmark Resend. Measure with a mock/sink and, only if authorized, a dedicated non-production sender. Do not change delivery semantics in this baseline phase. |
| 6 | Catalog browsing and page transitions | Student catalog loading uses one `/catalog` request whose service retrieves faculties, programs, and program courses in parallel. Search/filter/back/detail operations use the loaded in-memory catalog state. | This avoids a request per navigation action in the inspected paths, but initial payload/render cost and interaction responsiveness are unmeasured. Measure initial catalog transfer and interactions with a realistic disposable dataset. |
| 7 | API and database observability | `safeRequestLog` emits a server request duration and request ID, but there is no in-process latency histogram, query timing, response-size metric, or exported pool wait/usage measurement in the inspected modules. The PostgreSQL pool is created lazily without app-level pool metrics. JSON response serialization has no explicit cache header in `json()`; provider/CDN behavior is unknown. | Existing request logs may help correlate individual requests, but do not provide P50/P95 or isolate network, application, and SQL time. Add only scoped, privacy-conscious measurement after an environment and collection method are approved; do not add permanent instrumentation in this assessment. |

The catalog path is layered `route/controller -> service -> repository -> PostgreSQL`. Existing integration tests use a guarded PostgreSQL 16 disposable service in GitHub Actions and apply ordered migrations before running. Their successful result establishes functional regression evidence, not representative database scale, query plans, pool saturation, or latency.

## Repeatable measurement protocol for the next run

Use an explicitly dedicated staging/local environment with synthetic records and a dedicated test account. Record commit, browser/version, device/viewport, network profile, region, dataset size, environment, and test time. Never use production student records or a production account for automated repetition.

1. **Browser journeys:** in Chrome DevTools Performance and Network, collect five cold-cache and ten warm-cache runs per page/journey. Record LCP, CLS, and navigation/interaction timings; record INP only after representative interactions are exercised. Include initial landing, student catalog search/filter/detail/back, session restore, student dashboard/notifications, admin login and initial panel, Quick Access/tab changes, catalog search/detail, and audit/complaint history. Record transferred bytes and the largest image/font resources. Label local/synthetic runs separately from deployed staging.
2. **API:** after five warm-ups, issue 30 sequential low-rate reads per selected endpoint against staging/local only. Record client-observed round-trip P50/P95/max, status/error counts, and response bytes. Do not auto-refresh sessions; use a valid dedicated test session, redact cookies/tokens, and stop on unexpected errors or rate limiting. Correlate representative calls to backend request IDs/log durations where available; client round-trip and server duration are different measures.
3. **PostgreSQL:** use the guarded disposable PostgreSQL CI database or an explicitly disposable local database populated with synthetic data at stated sizes. Measure query and transaction durations under a small sequential workload. Use `EXPLAIN (ANALYZE, BUFFERS)` only there. Record row counts and pool configuration; do not use production Supabase for plans, load, or experimentation.
4. **Password reset:** first measure the application path with a deterministic mocked sender and separately time a dedicated test email sink if approved. Never send repeated requests to real students. Preserve the existing generic account response, token invalidation behavior, and rate limits.
5. Repeat runs under the same conditions after each approved optimization; do not put arbitrary wall-clock thresholds into ordinary CI.

## Ranked optimization candidates (not authorized or implemented here)

1. Measure and then reduce the admin sign-in request waterfall, while preserving role-specific calls, deep links, loading/error states, and API contracts. **Risk:** medium. **Validation:** UI contract tests, role matrix, request-count/latency comparison, PostgreSQL regression suite.
2. Profile dashboard SQL and JavaScript analytics with representative catalog/audit sizes; optimize only the demonstrated dominant work. **Risk:** medium/high due to sensitive dashboard semantics. **Validation:** exact response-contract comparisons, disposable-DB query plans, audit/authorization tests, before/after P50/P95.
3. Measure complaint/communication/user list growth and front-end render cost; consider bounded pagination only if data volume supports it. **Risk:** medium/high because contracts and operator workflows are involved. **Validation:** pagination compatibility tests, access-control tests, row-count and payload comparisons.
4. Test smaller responsive landing/student imagery and font-loading choices. **Risk:** low/medium visual/accessibility risk. **Validation:** real browser screenshots at desktop/mobile, visual review, resource transfer and LCP comparisons.
5. Quantify reset endpoint database time versus provider wait using a mock/sink. Any later delivery architecture change requires a separate design review and tests for account-enumeration resistance, retry/idempotency, token cleanup, auditability, and recovery; it is not part of this phase. **Risk:** high for behavior/security if delivery semantics change.
6. Review safe cache policy for public catalog/static assets only after observing actual repeated requests and deployed headers. **Risk:** medium because stale catalog data and cross-user data leakage must be prevented. **Validation:** cache-key/privacy review, mutation invalidation behavior, API compatibility and browser tests.

## Limitations and verdict

**Source-level bottleneck assessment: delivered. Trustworthy end-to-end performance baseline: incomplete.** We have measured local source-file sizes and identified code paths worth timing, but do not have valid frontend Web Vitals, user-journey timings, API P50/P95, PostgreSQL timings/plans, cold/warm comparisons, or provider latency. No optimization should be selected as a confirmed fix solely from this report.

To complete the baseline, provide or enable: (a) an authorized dedicated staging URL and test student/admin accounts, (b) a disposable PostgreSQL target matching the existing safety guard and representative synthetic data, (c) browser performance capture that can run in this environment, and (d) if email-provider timing is needed, an approved test sink. Until then, the candidates above remain hypotheses or source-derived risks, and production performance is unverified.

No benchmark script was added because there was no safe target on which to validate its target guards and end-to-end behavior. The protocol above is intended to make the next measurement run repeatable once isolated infrastructure is available.

