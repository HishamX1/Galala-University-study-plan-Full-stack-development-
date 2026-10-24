export async function insertErrorReport(executor, report) {
  const { rows } = await executor.query(
    `INSERT INTO public.admin_error_reports
      (reporter_id, reporter_role, category, severity, message, technical_details, request_id, page, endpoint, method, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11)
     RETURNING id, created_at, status`,
    [report.reporterId, report.reporterRole, report.category, report.severity, report.message,
      JSON.stringify(report.technicalDetails), report.requestId, report.page, report.endpoint,
      report.method, report.userAgent]
  );
  return rows[0];
}

export async function listErrorReports(executor, { status, category, limit, offset }) {
  const values = [];
  const where = [];
  if (status) { values.push(status); where.push(`status = $${values.length}`); }
  if (category) { values.push(category); where.push(`category = $${values.length}`); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await executor.query(`SELECT count(*)::int AS total FROM public.admin_error_reports ${whereSql}`, values);
  values.push(limit, offset);
  const rows = await executor.query(
    `SELECT r.id, r.created_at, r.updated_at, r.reporter_id, u.name AS reporter_name, u.email AS reporter_email,
            r.reporter_role, r.category, r.severity,
            r.message, r.technical_details, r.request_id, r.page, r.endpoint, r.method, r.user_agent,
            r.status, r.resolution_notes, r.resolved_at, r.resolved_by, resolver.name AS resolved_by_name
       FROM public.admin_error_reports r JOIN public.app_users u ON u.id=r.reporter_id
       LEFT JOIN public.app_users resolver ON resolver.id=r.resolved_by
       ${whereSql ? whereSql.replace(/\b(status|category)\b/g, 'r.$1') : ''}
      ORDER BY r.created_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values
  );
  return { items: rows.rows, total: count.rows[0].total, limit, offset };
}

export async function updateErrorReport(executor, id, status, notes, actorId) {
  const { rows } = await executor.query(
    `UPDATE public.admin_error_reports
        SET status=$2,
            resolution_notes=CASE WHEN $3::text IS NULL THEN resolution_notes ELSE $3 END,
            resolved_at=CASE WHEN $2='resolved' THEN now() ELSE NULL END,
            resolved_by=CASE WHEN $2='resolved' THEN $4::uuid ELSE NULL END,
            updated_at=now()
      WHERE id=$1::uuid
      RETURNING id, status, resolution_notes, updated_at, resolved_at, resolved_by`,
    [id, status, notes, actorId]
  );
  return rows[0] || null;
}
