# Concurrency risk assessment

## Existing protections

Multi-step destructive catalog operations (`deleteFaculty`, `deleteProgram`, `deleteProgramCourse`) use PostgreSQL transactions and soft-delete dependent relations before the parent record. Prerequisite replacement, course create/update, password reset consumption, password updates, and refresh-token rotation also use transactions. Bootstrap creation takes a PostgreSQL advisory transaction lock.

## Last-write-wins risks

Faculty, program, and program-course edits have no version/ETag condition: two administrators can overwrite each other's fields. Prerequisite replacement can similarly replace a concurrently edited relation set. Import validates then writes to production tables, so a catalog edit between validation and publication can make the preview stale. Recycle-bin restoration/deletion and user-profile/user-management updates are also vulnerable to stale administrative screens.

## Recommended strategy

Do not add implicit locks in Phase 1 because the current UI has no conflict state. Add an integer `version` (or use `updated_at` as an explicit expected value) to editable catalog/user payloads in a backward-compatible migration. Controllers should accept the field only when supplied, repositories should condition updates on it, and a zero-row update should return a `409 Conflict` with current version metadata. The UI can then show refresh/compare/retry controls. Import publication should compare a catalog revision captured during validation before applying any staged data.

## Manual deployment review

Coordinate administrators around catalog imports and bulk deletions until optimistic conflict handling exists. Transactions protect consistency within a single request; they do not prevent a later request from overwriting a prior update.
