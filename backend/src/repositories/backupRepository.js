export async function insertBackup(executor, format, recordCounts, snapshot, description) {
  return executor.query(
    `INSERT INTO admin_backup_history (format, scope, record_counts, snapshot, description)
     VALUES ($1, 'catalog', $2::jsonb, $3::jsonb, $4)
     RETURNING id, created_at, admin_user, format, scope, record_counts, description`,
    [format, JSON.stringify(recordCounts), JSON.stringify(snapshot), description]
  );
}

export async function listBackups(executor) {
  return executor.query(`SELECT id, created_at, admin_user, format, scope, record_counts, description FROM admin_backup_history ORDER BY created_at DESC LIMIT 50`);
}

export async function findBackupSnapshot(executor, id) {
  return executor.query('SELECT id, format, snapshot FROM admin_backup_history WHERE id = $1', [id]);
}
