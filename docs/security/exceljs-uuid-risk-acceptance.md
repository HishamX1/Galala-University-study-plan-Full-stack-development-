# ExcelJS/uuid Security Risk Acceptance

- Review date: 2026-10-05
- Status: Accepted temporarily / deferred remediation
- Scope: Server-side admin XLSX workflows only

## Advisory

`GHSA-w5hq-g745-h8pq` / `CVE-2026-41907` is a Moderate-severity advisory affecting the transitive dependency `uuid@8.3.2`, reached through `exceljs@4.4.0`.

The vulnerable APIs are `uuid` v3/v5/v6 when called with caller-supplied output buffers or offsets. The application does not directly import or call `uuid`. During the dependency review, the reachable ExcelJS path was confirmed to use `uuid`'s `v4()` API only; the vulnerable v3/v5/v6 APIs are not reached by the application's ExcelJS usage.

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

1. The official ExcelJS release currently in use remains `4.4.0`.
2. npm audit's automatic remediation requires a breaking ExcelJS change to `3.4.0`.
3. An unverified npm override to update `uuid` outside ExcelJS's declared dependency range is not safe to apply without compatibility and regression testing.
4. No unofficial ExcelJS fork is being adopted.

## Acceptance conditions

This risk acceptance is conditional and temporary. It is limited to the server-side admin XLSX workflows described above and does not represent approval for broader use of the affected dependency or vulnerable APIs.

Future remediation must be reassessed when either condition is met:

- an official ExcelJS release updates the vulnerable transitive dependency; or
- a separately approved and fully tested dependency override becomes available.

Any future remediation must include API-compatibility review, admin-import testing, export and backup testing, project checks, deployment-doctor validation, a clean production audit result or documented residual findings, and package-lock consistency verification.

This acceptance does **not** waive:

- the existing XLSX parser hardening;
- dependency monitoring;
- future security review; or
- the requirement to reassess the risk before major dependency changes.