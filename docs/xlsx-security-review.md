# Historical XLSX Security Review (Superseded)

This review described an earlier dependency state and is retained for historical context only. It must not be used as current dependency or production-security evidence. The current root lockfile does not list `xlsx` as a dependency, the installed tree contains no `xlsx` package, and no current root application import from `xlsx` was found. Spreadsheet processing now uses ExcelJS. See [ExcelJS/uuid Security Risk Acceptance](security/exceljs-uuid-risk-acceptance.md) for the current package-level advisory assessment and its limits.

The fresh `npm audit --omit=dev` required for a complete current dependency audit could not reach the npm registry in this review, so this superseding note does not claim that the full dependency tree is free of advisories.

## Historical findings below

## Historical dependency and advisory claim (superseded)

The direct dependency is `xlsx` `^0.18.5`. `npm audit --omit=dev` reports one high-severity dependency finding with no automated compatible fix: SheetJS prototype pollution (GHSA-4r6h-8v6p-xvw6, affected before 0.19.3) and ReDoS (GHSA-5pgg-2g8v-p4x9, affected before 0.20.2).

## Affected path and exposure

The package writes XLSX exports/backups and parses `format: "xlsx"` in `adminOpsService.importRows`. Browser input is read in the regular-admin portal, base64 encoded, then sent to `POST /api/admin/import/validate` or `POST /api/admin/import`. The backend authorization gate requires a signed-in regular admin or super admin; anonymous and student callers are rejected. It is therefore not a public unauthenticated parser, but a compromised or malicious admin account can submit crafted content.

## Existing mitigations

- JSON request bodies have a 12 MB backend ceiling.
- Cross-origin cookie mutations require an approved Origin; admin authorization is server-side.
- Imports are restricted to declared `json`, `csv`, `xlsx`, and `pdf` formats, then undergo catalog validation before publication.
- The frontend selects files only for XLSX/PDF mode, but the backend currently trusts the declared format and decodes the entire base64 payload before parsing.

## Gaps and recommendation

The request ceiling limits size but does not establish a XLSX-specific decompression/worksheet/cell limit, MIME/content-signature validation, or parser sandbox. Do not replace `xlsx` in this Phase 1 continuation: the audit reports no compatible npm fix and export/import behavior needs a compatibility test corpus. Before expanding import use, evaluate a maintained parser (for example ExcelJS for workbook input/output) against existing templates, formulas, empty cells, Unicode course names, and the current export contract. In the meantime restrict import access to trusted administrators, retain the request ceiling, and prioritize a staged import boundary with parser-specific limits in the next phase.
