const STAGE_COLUMNS = `id, owner_id, import_type, import_format, parsed_rows, validation,
  reference_fingerprint, preview_fingerprint, preview_version, status, created_at, expires_at,
  published_at, cancelled_at`;

export async function lockCatalogImportStageOwner(executor, ownerId) {
  return executor.query("SELECT pg_advisory_xact_lock(hashtext('catalog_import_stages:' || $1::text))", [ownerId]);
}

export async function deleteExpiredCatalogImportStages(executor, ownerId) {
  return executor.query('DELETE FROM catalog_import_stages WHERE owner_id = $1 AND expires_at <= now()', [ownerId]);
}

export async function countActiveCatalogImportStages(executor, ownerId) {
  return executor.query(`SELECT count(*)::int AS count FROM catalog_import_stages
    WHERE owner_id = $1 AND status = 'staged' AND expires_at > now()`, [ownerId]);
}

export async function insertCatalogImportStage(executor, { ownerId, type, format, rows, validation, referenceFingerprint, previewFingerprint }) {
  return executor.query(`INSERT INTO catalog_import_stages
      (owner_id, import_type, import_format, parsed_rows, validation, reference_fingerprint, preview_fingerprint)
    VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
    RETURNING ${STAGE_COLUMNS}`,
  [ownerId, type, format, JSON.stringify(rows), JSON.stringify(validation), referenceFingerprint, previewFingerprint]);
}

export async function listCatalogImportStagesForOwner(executor, ownerId) {
  return executor.query(`SELECT ${STAGE_COLUMNS} FROM catalog_import_stages
    WHERE owner_id = $1 AND status = 'staged' AND expires_at > now()
    ORDER BY created_at DESC`, [ownerId]);
}

export async function findCatalogImportStageForOwner(executor, id, ownerId, { forUpdate = false } = {}) {
  return executor.query(`SELECT ${STAGE_COLUMNS} FROM catalog_import_stages
    WHERE id = $1 AND owner_id = $2${forUpdate ? ' FOR UPDATE' : ''}`, [id, ownerId]);
}

export async function refreshCatalogImportStagePreview(executor, { id, ownerId, validation, referenceFingerprint, previewFingerprint }) {
  return executor.query(`UPDATE catalog_import_stages
    SET validation = $3::jsonb, reference_fingerprint = $4, preview_fingerprint = $5,
        preview_version = preview_version + 1
    WHERE id = $1 AND owner_id = $2 AND status = 'staged' AND expires_at > now()
    RETURNING ${STAGE_COLUMNS}`,
  [id, ownerId, JSON.stringify(validation), referenceFingerprint, previewFingerprint]);
}

export async function markCatalogImportStagePublished(executor, id, ownerId) {
  return executor.query(`UPDATE catalog_import_stages
    SET status = 'published', published_at = now()
    WHERE id = $1 AND owner_id = $2 AND status = 'staged' AND expires_at > now()
    RETURNING ${STAGE_COLUMNS}`, [id, ownerId]);
}

export async function cancelCatalogImportStage(executor, id, ownerId) {
  return executor.query(`UPDATE catalog_import_stages
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = $1 AND owner_id = $2 AND status = 'staged'
    RETURNING ${STAGE_COLUMNS}`, [id, ownerId]);
}
