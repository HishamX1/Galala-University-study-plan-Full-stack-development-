# Catalog cache behavior and rollout

`GET /api/catalog` uses a bounded in-process cache with separate student and administrator entries. Each request reads the authoritative PostgreSQL catalog revision; cache entries live for at most five minutes and are limited to eight audience/revision combinations. Returned JSON is cloned so one request cannot mutate another request's result. All JSON API responses carry `Cache-Control: no-store`; this backend cache is internal and does not change browser or CDN caching.

The `catalog_revision_state` row is shared by backend instances. Statement-level triggers on `faculties`, `programs`, `courses`, `program_courses`, and `course_prerequisites` advance its revision in the same database transaction as each non-empty insert, update, delete, or truncate. This also covers imports, recycle-bin restore/purge, and controlled SQL updates. A cache fill reads the revision before and after querying its snapshot and retries when it changes. Revision-read and catalog-query failures are returned as errors; expired entries are never served as fallback.

The student page requests a fresh catalog at initial load and revalidates after returning to a visible/focused page when its last successful load is at least 30 seconds old. Concurrent refreshes share one request. Refresh rebuilds the current navigation and filters from canonical data, drops removed history items, and closes a course panel if its course was removed. If refresh fails, the stale catalog is hidden and a retry action is available.

## Deployment and rollback

Apply the migration through the approved database change process before deploying a backend that calls `public.get_catalog_revision()`. The migration does not rewrite catalog records; trigger revision increments participate in ordinary transactions and roll back with them. Deploy application code only after the function and triggers exist. Roll back application code before removing the migration objects; do not drop the revision table or triggers while a running backend depends on them. No hosted migration was run as part of this change.

The login flow was inspected for a safe sequential call that could be removed. Authentication and audit writes are ordered security-sensitive steps, and no latency measurements established a safe additional reduction. Session restoration does remove a verified redundant `/auth/me` call after refresh by consuming the validated user returned from refresh.
