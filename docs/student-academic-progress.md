# Self-reported academic progress prototype

This feature stores student-entered program selection and course attempts separately from the canonical course catalog. It is explicitly unverified and is not a SIS integration or official academic record. Attempts are retained individually so failed grades and retakes remain visible.

## Data and ownership

- `student_academic_profiles` stores each student's selected program (`verified=false`).
- `student_course_attempts` stores owner, program, program-course row, grade, academic year, and term. Attempt rows are retained across program selection changes.
- The API derives ownership from the authenticated `app_users.id`; callers cannot select another user's record. Students can read and write only their own records.
- Catalog imports and recycle-bin actions do not write or delete student attempts. Foreign keys prevent permanent deletion of referenced programs or courses while attempts exist.

## Grade and GPA behavior

The displayed grade mapping is a planning scale based on the task's supplied values. Term GPA is a credit-weighted calculation over entered attempts in one selected term and is suppressed if a grade is unmapped or any credit value is zero/missing. It remains a calculation over unverified self-reported data. CGPA is not calculated because the institution's repeat-grade policy is unknown.

Before presenting official results, GU must confirm the authoritative percentage boundaries (including exactly 97%), grade scale, passing threshold, withdrawals/incompletes, repeat replacement or inclusion rules, and treatment of repeated course credits. The current schema permits zero-credit courses even though all 67 seeded program-course rows have positive values (1–8 credits).

## Prerequisite groups

`course_prerequisite_groups` represents independent requirements; each mandatory group contains one course. Alternative groups contain multiple acceptable course options. The migration backfills every existing active or recycle-bin relationship as its own mandatory group. The legacy `course_prerequisites` links remain mirrored for old clients and catalog views. The existing flat prerequisite update remains an all-mandatory operation.

Catalog JSON exports and catalog backup snapshots include group metadata; the JSON import staging flow accepts `prerequisiteGroups` rows after their referenced program-course rows exist. Existing CSV/XLSX catalog exports serialize group data with each course. Admin catalog backups remain catalog-only and have no application restore route; student attempt data is retained separately and is not included in these catalog exports. A whole-database backup restore is outside this feature's verified scope.

## Migration and verification

Apply migrations `20261026100000_prerequisite_groups.sql` and `20261026110000_student_self_reported_progress.sql` only to a disposable test database during verification. They have not been applied to production. The database suite is guarded to require loopback `gu_pt_phase1_test` and explicit destructive-test confirmation. CI runs it with the repository's disposable PostgreSQL 16 service.

The new PostgreSQL integration suite is registered in `.github/workflows/architecture-review-1-integration.yml`, but that workflow was not triggered from this local-only change. No `TEST_DATABASE_URL` is available here, so migration execution, backfill, ownership persistence, group mutation, recycle-bin restore, and database error behavior remain unverified in this workspace.
