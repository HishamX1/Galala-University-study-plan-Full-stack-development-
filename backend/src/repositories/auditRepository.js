export async function insertAuditLog(executor, { action, entity, entityId = null, oldValues = null, newValues = null, description = '', adminUser = 'Admin' }) {
  await executor.query(
    `INSERT INTO admin_audit_logs (admin_user, action, entity, entity_id, old_values, new_values, description)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7)`,
    [adminUser, action, entity, entityId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, description]
  );
}

export async function listAuditLogs(executor, filters = {}) {
  const params = [];
  const conditions = [];
  if (filters.range === 'today') conditions.push("created_at >= date_trunc('day', now())");
  if (filters.range === 'week') conditions.push("created_at >= date_trunc('week', now())");
  if (filters.entity) { params.push(filters.entity); conditions.push(`entity = $${params.length}`); }
  if (filters.action) { params.push(`%${filters.action}%`); conditions.push(`action ILIKE $${params.length}`); }
  if (filters.search) { params.push(`%${filters.search}%`); conditions.push(`(description ILIKE $${params.length} OR action ILIKE $${params.length} OR entity ILIKE $${params.length})`); }
  const order = filters.order === 'oldest' ? 'ASC' : 'DESC';
  const limit = Math.min(Number(filters.limit) || 100, 500);
  return executor.query(
    `SELECT id, created_at, admin_user, action, entity, entity_id, old_values, new_values, description
       FROM admin_audit_logs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at ${order}
      LIMIT ${limit}`,
    params
  );
}
