# ExcelJS/uuid Security Risk Acceptance

- Original review date: 2026-10-05
- Evidence refreshed: 2026-10-21 (repository dependency tree, complete production audit result, upstream package constraints, and read-only remediation review)
- Status: Accepted temporarily / deferred remediation
- Scope: Server-side admin XLSX workflows only

### Evidence update (2026-10-21)

The committed lockfile resolves `exceljs@4.4.0` with `uuid@8.3.2`. A fresh `npm audit --omit=dev --json` completed with 2 moderate package entries (direct `exceljs`, transitive `uuid`), both caused by [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq); these are two nodes for one advisory. The audit's suggested automatic repair is `exceljs@3.4.0`, a semver-major downgrade. No dependency change was made. ExcelJS's current published manifest still declares `uuid@^8.3.0`, and its inspected code only calls `v4()` without a supplied buffer. That narrows the inspected call path but does not clear the package finding or prove the dependency safe.

## Advisory

`GHSA-w5hq-g745-h8pq` / `CVE-2026-41907` is a Moderate-severity advisory affecting the transitive dependency `uuid@8.3.2`, reached through `exceljs@4.4.0`. The advisory identifies affected versions below the patched uuid 11.1.1/12.0.1/13.0.1 releases; version 8.3.2 is within the affected version range. See the [GitHub Advisory Database entry](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

The vulnerable behavior is specific to v3/v5/v6 when called with caller-supplied output buffers or offsets; the advisory explicitly distinguishes these APIs from v4. The application does not directly import or call `uuid`. Inspection of the installed ExcelJS 4.4.0 package found its uuid import in `lib/xlsx/xform/sheet/cf-ext/cf-rule-ext-xform.js`, where it calls `v4()` to generate conditional-formatting identifiers. No vulnerable v3/v5/v6 call was found in that package path. This is evidence of non-reachability through the inspected ExcelJS code, not removal of the vulnerable transitive package or a guarantee about every possible future code path.

## Application exposure and mitigations

XLSX import is admin-gated and is processed only through the server-side admin workflow. Existing protections remain mandatory:

- file-size limits;
- ZIP structure, entry-count, entry-size, total-size, and compression-ratio limits;
- exactly one worksheet;
- row, column, and cell limits;
- formula, hyperlink, and note restrictions;
- worker isolation;
- parser timeout and concurrency limits; and
- validation before any database mutation.

These controls do not remove the dependency advisory, but they materially constrain the reachable XLSX attack surface. XLSX export and backup generation are also server-side admin workflows.

## Why remediation is deferred

No dependency change is being made at this time because:

1. The project locks `exceljs@4.4.0`, whose package dependency range is `uuid@^8.3.0`; the [upstream releases page](https://github.com/exceljs/exceljs/releases) currently identifies v4.4.0 as latest. This is a point-in-time upstream observation, not a claim that future releases will not appear.
2. The fresh registry-backed audit confirms npm's suggested automatic remediation is a downgrade to `exceljs@3.4.0`, marked semver-major; it is not approved because it risks the application's spreadsheet behavior.
3. The smallest override candidate is a root-level npm override scoped only to the `uuid` child of `exceljs@4.4.0`, pinned to patched `uuid@11.1.1`. This violates ExcelJS's declared `^8.3.0` dependency range. UUID 11.1.1 still has a Node CommonJS export, and ExcelJS's inspected call uses only `require('uuid').v4()` with no arguments, but these facts alone do not prove compatibility. The override is not applied or approved; test it separately before any dependency change.
4. No unofficial ExcelJS fork is being adopted.

## Acceptance conditions

This risk acceptance is conditional and temporary. It is limited to the server-side admin XLSX workflows described above and does not represent approval for broader use of the affected dependency or vulnerable APIs.

The accepted residual risk is the presence of a vulnerable-version transitive package despite no vulnerable API use found on the inspected ExcelJS path. Reassess when either condition is met:

- an official ExcelJS release updates the vulnerable transitive dependency; or
- a separately approved and fully tested dependency override becomes available.

Any future remediation must include clean isolated `npm ci`; lockfile/tree/audit verification; an ExcelJS-resolved UUID v4 and conditional-formatting round trip; XLSX import/export and backup round trips; all current parser-security cases; disposable-PostgreSQL staged publication and rollback/audit/state-retention tests; full project CI and deployment-doctor checks; a fresh full audit with residual findings documented; and package-lock consistency verification. These candidate-override tests have not been run, so no fix is claimed safe.

This acceptance does **not** waive:

- the existing XLSX parser hardening;
- dependency monitoring;
- future security review; or
- the requirement to reassess the risk before major dependency changes.
