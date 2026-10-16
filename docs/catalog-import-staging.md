# Catalog import staging

Catalog imports use a persisted, administrator-owned review stage. The supported formats remain JSON, CSV, XLSX, and PDF, and publication reuses the existing catalog insert/upsert behavior.

## API workflow

- `POST /api/admin/import/validate` remains preview-only.
- `POST /api/admin/import/stages` parses and validates an upload, then persists parsed rows and the preview for 24 hours. It returns the stage ID and preview version.
- `GET /api/admin/import/stages` lists only the authenticated administrator's unexpired stages. `GET /api/admin/import/stages/:id` returns that administrator's stage and preview.
- `POST /api/admin/import/stages/:id/publish` requires the current `previewVersion`. A stale preview returns HTTP 409 with `IMPORT_PREVIEW_STALE`, updated validation, and a diff; the administrator must review and confirm again. Invalid stages cannot publish.
- `DELETE /api/admin/import/stages/:id` cancels an owned stage. Expired and cancelled stages cannot publish.
- Every stage read or mutation is scoped to its owner. A stage owned by another administrator is reported as not found.
- The legacy `POST /api/admin/import` remains present and always returns HTTP 409 with `IMPORT_STAGING_REQUIRED`; it rejects before parsing the request body or invoking an import service.

## Safety and persistence

Stage creation accepts at most 8 MiB of request data and stores at most 8 MiB of serialized parsed rows. JSON, CSV, and PDF rows use the same 10,000-row, 100-column, and 100,000-cell limits as XLSX parsing. Stored validation errors are capped at 500 plus a truncation notice. Each administrator may have at most five active stages. The database additionally constrains parsed JSONB storage size.

Publication locks the stage row in a service-owned PostgreSQL transaction. It revalidates against the current active catalog reference snapshot; any snapshot or validation change refreshes the preview version and requires a new confirmation. Catalog writes, the existing import audit event, and the terminal `published` state commit together. Any failure rolls all of them back and leaves the stage available for retry. Row locking and conditional state transitions prevent a second publication from applying the same stage.

Stage creation and cancellation are recorded in `admin_audit_logs`; publication retains the existing `Imported <type>` audit action and includes the stage ID. Expired rows are cleaned up for the same administrator when they create a new stage; no background cleanup job is required for correctness. Do not store original uploads or secrets in stage data.

The migration is `supabase/migrations/20260812090000_catalog_import_staging.sql`. Apply it through the approved migration process before deploying application code that uses staged imports. No runtime startup migration occurs. The database-backed staging regression test runs only against the disposable PostgreSQL service in the integration workflow; never point it at Supabase or production.
