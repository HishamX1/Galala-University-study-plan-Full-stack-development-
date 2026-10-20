# Catalog optimistic concurrency

The admin catalog API supports optional optimistic concurrency preconditions on ordinary edits, relation changes, and soft deletion. A stale precondition returns HTTP `409` with code `STALE_WRITE`; the server makes no catalog or audit change for the rejected operation, including cascaded soft-delete writes. Clients that omit `expectedVersion` retain the legacy behavior for compatibility, so external/older clients do not receive lost-update protection until they send the version returned with catalog records.

Faculty and program records expose a UTC timestamp with six fractional digits (the PostgreSQL microsecond precision):

```json
"version": { "updatedAt": "<UTC timestamp>" }
```

Program-course records expose a composite version because a course's descriptive fields are stored on a shared `courses` row:

```json
"version": {
  "updatedAt": "<program-course row UTC timestamp>",
  "relatedUpdatedAt": "<shared course row UTC timestamp>"
}
```

Send the record's `version` unchanged as `expectedVersion` in update request bodies. Relation changes use the owning program-course row's `version.updatedAt`; a successful relation change advances that revision. The admin UI refreshes the catalog after a stale-write response and asks the administrator to compare the latest record and reapply changes manually. It does not automatically replay the write.

These revisions use the existing `updated_at` columns and require no schema migration. The service still owns each mutation transaction; the conditional repository update and related audit write remain within that transaction. Import publication and protected recycle-bin operations are not ordinary interactive edits and are not governed by this request precondition.

The compatibility mode is deliberate: callers that do not provide a version remain last-write-wins. Any future API client that needs protection should first read the current record and return its version with the edit.
