# ExcelJS/uuid Security Risk Acceptance

- Original review date: 2026-10-05
- Evidence refreshed: 2026-10-21 (repository dependency tree, upstream advisory, and fresh audit attempt)
- Status: Accepted temporarily / deferred remediation
- Scope: Server-side admin XLSX workflows only

### Evidence update (2026-10-21)

The installed tree was rechecked with `npm ls exceljs uuid --all`: `exceljs@4.4.0` resolves `uuid@8.3.2`. The inspected ExcelJS implementation imports and calls `v4()` for conditional-formatting identifiers; this bounds the inspected call path but does not prove the dependency is safe. The version remains inside the advisory's affected range, so the package-level advisory remains present. A fresh `npm audit --omit=dev` was attempted with an isolated temporary cache; the npm advisory endpoint failed, so no audit findings were returned and no package can be declared clear on that basis. The temporary log was written successfully outside the repository. No dependency change was made. Current advisory: [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq). Retry the audit when registry access is available; this update does not supersede the temporary risk acceptance above.

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
2. The earlier report that npm audit's automatic remediation requires a breaking ExcelJS change to `3.4.0` is historical. A fresh audit could not be completed on 2026-10-21 because this environment could not reach `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`; current npm remediation advice is therefore unverified.
3. An unverified npm override to update `uuid` outside ExcelJS's declared dependency range is not safe to apply without compatibility and regression testing.
4. No unofficial ExcelJS fork is being adopted.

## Acceptance conditions

This risk acceptance is conditional and temporary. It is limited to the server-side admin XLSX workflows described above and does not represent approval for broader use of the affected dependency or vulnerable APIs.

The accepted residual risk is the presence of a vulnerable-version transitive package despite no vulnerable API use found on the inspected ExcelJS path. Reassess when either condition is met:

- an official ExcelJS release updates the vulnerable transitive dependency; or
- a separately approved and fully tested dependency override becomes available.

Any future remediation must include API-compatibility review, admin-import testing, export and backup testing, project checks, deployment-doctor validation, a clean production audit result or documented residual findings, and package-lock consistency verification.

This acceptance does **not** waive:

- the existing XLSX parser hardening;
- dependency monitoring;
- future security review; or
- the requirement to reassess the risk before major dependency changes.
