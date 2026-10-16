# Future academic integration boundary

## Scope

This document is design only. The current catalog must not be used to fabricate enrollment, grades, credits, GPA, completed courses, or degree progress.

## Canonical future model

The future academic model will use separate entities: `students`, `student_programs`, `academic_terms`, `course_enrollments`, `course_attempts`, `grades`, `credits`, `academic_status`, `degree_requirements`, and `degree_audit`. Foreign keys will identify canonical GU records and retain source-system identifiers plus synchronization metadata. Catalog courses remain definitions; attempts and enrollments are student facts.

## Integration boundary

`University SIS -> integration adapter -> normalizer/mapper -> canonical GU academic model -> application services -> dashboards/degree audit`

The adapter owns vendor authentication, polling/webhooks, retries, source identifiers, and raw payload handling. The normalizer maps vendor fields into GU concepts. Application services never depend on vendor field names or use raw SIS payloads.

## Future service contracts

`getStudentAcademicProgress(studentId)`, `getStudentAcademicRecord(studentId)`, and `getDegreeAudit(studentId)` are reserved service boundaries. Until the canonical student record is populated from an approved source, each returns unavailable/empty data with an explanatory message. The current dashboard follows that rule.

## Import target

Catalog imports now use `upload -> staging -> validation -> preview -> same-administrator confirmation -> publication`. The implementation stores parsed rows for 24 hours, revalidates the preview against the active catalog, and requires fresh confirmation after a material validation-context change. It does not introduce second-person approval. See `docs/catalog-import-staging.md` for API, limits, transaction, and migration details.

## Notifications

The current dashboard composes notifications from `communication_outbox`, audit events, password-reset requests, complaints, and backups. A future dedicated model will contain notification, recipient, `read_at`, type, target, and delivery state. Existing sources remain intact until a migration plan is approved.
