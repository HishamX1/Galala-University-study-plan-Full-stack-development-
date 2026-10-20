# Concurrency risk assessment

## Existing protections

Multi-step destructive catalog operations (`deleteFaculty`, `deleteProgram`, `deleteProgramCourse`) use PostgreSQL transactions and soft-delete dependent relations before the parent record. Prerequisite replacement, course create/update, password reset consumption, password updates, and refresh-token rotation also use transactions. Bootstrap creation takes a PostgreSQL advisory transaction lock.

## Last-write-wins risks

Faculty, program, and program-course edits have no version/ETag condition: two administrators can overwrite each other's fields. Prerequisite replacement can similarly replace a concurrently edited relation set. Recycle-bin restoration/deletion and user-profile/user-management updates are also vulnerable to stale administrative screens.

Staged catalog imports have a separate publication safeguard: publication revalidates against current catalog state. If revalidation changes the preview materially or finds new validation errors, the stage is not published; the administrator must review the refreshed result and explicitly confirm again. Publication uses a service-owned transaction for catalog writes, audit records, and stage-state transition. See [catalog import staging](catalog-import-staging.md). This addresses stale-preview publication, but does not add optimistic concurrency controls to ordinary catalog edits.

## Recommended strategy

Do not add implicit locks to ordinary edits because the current UI has no conflict state. For a later, explicitly scoped improvement, add an integer `version` (or use `updated_at` as an explicit expected value) to editable catalog/user payloads in a backward-compatible migration. Controllers should accept the field only when supplied, repositories should condition updates on it, and a zero-row update should return a `409 Conflict` with current version metadata. The UI can then show refresh/compare/retry controls. Staged imports already perform publication-time revalidation and require fresh confirmation when the preview changes; no separate catalog-revision field is currently recommended as a prerequisite for import publication.

## Manual deployment review

Coordinate administrators around catalog imports and bulk deletions until optimistic conflict handling exists. Transactions protect consistency within a single request; they do not prevent a later request from overwriting a prior update.
