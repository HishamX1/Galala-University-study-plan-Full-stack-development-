export async function insertAuditLog(executor, { action, entity, entityId = null, targetId = null, oldValues = null, newValues = null, description = '', adminUser = 'Admin', actorId = null, actorRole = null, actorName = null, outcome = 'success', category = 'admin', requestId = null }) {
  await executor.query(
    `INSERT INTO admin_audit_logs (admin_user, action, entity, entity_id, old_values, new_values, description, actor_id, actor_role, actor_name, outcome, category, target_id, request_id)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [adminUser, action, entity, entityId, oldValues ? JSON.stringify(oldValues) : null, newValues ? JSON.stringify(newValues) : null, description, actorId, actorRole, actorName, outcome, category, targetId ?? (entityId == null ? null : String(entityId)), requestId]
  );
}

export async function listAuditLogs(executor, filters = {}) {
  const params = [];
  const conditions = [];
  if (filters.range === 'today') conditions.push("created_at >= date_trunc('day', now())");
  if (filters.range === 'week') conditions.push("created_at >= date_trunc('week', now())");
  if (filters.entity) { params.push(filters.entity); conditions.push(`entity = $${params.length}`); }
  if (filters.category) { params.push(filters.category); conditions.push(`category = $${params.length}`); }
  if (filters.actorId) { params.push(filters.actorId); conditions.push(`actor_id = $${params.length}`); }
  if (filters.actor) { params.push(`%${filters.actor}%`); conditions.push(`COALESCE(actor_name, admin_user) ILIKE $${params.length}`); }
  if (filters.from) { params.push(filters.from); conditions.push(`created_at >= $${params.length}::timestamptz`); }
  if (filters.to) { params.push(filters.to); conditions.push(`created_at < ($${params.length}::date + INTERVAL '1 day')`); }
  if (filters.action) { params.push(`%${filters.action}%`); conditions.push(`action ILIKE $${params.length}`); }
  if (filters.search) { params.push(`%${filters.search}%`); conditions.push(`(description ILIKE $${params.length} OR action ILIKE $${params.length} OR entity ILIKE $${params.length} OR actor_name ILIKE $${params.length})`); }
  const order = filters.order === 'oldest' ? 'ASC' : 'DESC';
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 100);
  const offset = Math.min(Math.max(Number(filters.offset) || 0, 0), 100_000);
  return executor.query(
    `SELECT id, created_at, admin_user, actor_id, actor_role, COALESCE(actor_name, admin_user) AS actor_name, action, entity, entity_id, target_id, old_values, new_values, description, outcome, category, request_id
       FROM admin_audit_logs
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY created_at ${order}
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
}

export async function countTodayAuditEvents(executor, actorId = null) {
  return executor.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE created_at >= date_trunc('day', now()) AND ($1::uuid IS NULL OR actor_id = $1)", [actorId]);
}

export async function listRecentAuditEvents(executor, { actorId = null, limit = 8 } = {}) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 8, 1), 20);
  return executor.query(
    `SELECT id, created_at, action, entity, entity_id, target_id, description, actor_id, actor_role, COALESCE(actor_name, admin_user) AS actor_name, outcome, category
       FROM admin_audit_logs
      WHERE ($1::uuid IS NULL OR actor_id = $1)
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}`,
    [actorId]
  );
}

export async function listComplaintAuditEvents(executor, complaintId, limit = 50) {
  const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 50);
  return executor.query(
    `SELECT id, created_at, action, actor_id, actor_role,
            COALESCE(actor_name, admin_user) AS actor_name,
            old_values, new_values, description, outcome, request_id
       FROM admin_audit_logs
      WHERE entity = 'complaint' AND target_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT ${boundedLimit}`,
    [String(complaintId)]
  );
}

export async function findLatestAuditEvent(executor, actionPrefix) {
  return executor.query(
    'SELECT created_at FROM admin_audit_logs WHERE action ILIKE $1 ORDER BY created_at DESC LIMIT 1',
    [`${actionPrefix}%`]
  );
}
