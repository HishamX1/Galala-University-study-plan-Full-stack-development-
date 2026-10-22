export async function listUserNotifications(userId, executor) { return (await executor.query(`SELECT c.id,c.subject AS title,c.body AS description,c.created_at AS timestamp,c.kind AS category,
    ('communication:' || c.id::text) AS notification_key,(r.source_id IS NOT NULL) AS read
    FROM public.communication_outbox c
    LEFT JOIN public.notification_read_states r ON r.user_id=$1 AND r.notification_type='communication' AND r.source_id=c.id::text
    WHERE c.recipient_id=$1 ORDER BY c.created_at DESC LIMIT 8`, [userId])).rows; }

export async function listStudentActivity(userId, executor) { return (await executor.query('SELECT id,created_at,subject AS action,body AS description FROM public.communication_outbox WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 6', [userId])).rows; }
export async function listOpenResetNotifications(userId, executor) { return (await executor.query(`SELECT n.id,n.created_at,(r.source_id IS NOT NULL) AS read FROM public.password_reset_requests n
    LEFT JOIN public.notification_read_states r ON r.user_id=$1 AND r.notification_type='password_reset_request' AND r.source_id=n.id::text
    WHERE n.status='open' ORDER BY n.created_at DESC LIMIT 8`, [userId])).rows; }
export async function listOpenComplaintNotifications(userId, executor) { return (await executor.query(`SELECT n.id,n.created_at,(r.source_id IS NOT NULL) AS read FROM public.student_complaints n
    LEFT JOIN public.notification_read_states r ON r.user_id=$1 AND r.notification_type='complaint' AND r.source_id=n.id::text
    WHERE n.status <> 'resolved' ORDER BY n.created_at DESC LIMIT 8`, [userId])).rows; }
export async function listRecentBackupNotifications(userId, executor) { return (await executor.query(`SELECT n.id,n.created_at,(r.source_id IS NOT NULL) AS read FROM public.admin_backup_history n
    LEFT JOIN public.notification_read_states r ON r.user_id=$1 AND r.notification_type='backup' AND r.source_id=n.id::text
    ORDER BY n.created_at DESC LIMIT 8`, [userId])).rows; }
const notificationSources = `
  SELECT 'communication'::text AS notification_type,c.id::text AS source_id
    FROM public.communication_outbox c WHERE c.id::text=$2::text AND c.recipient_id=$1
  UNION ALL
  SELECT 'password_reset_request',n.id::text FROM public.password_reset_requests n
    WHERE $3='super_admin' AND n.id::text=$2::text AND n.status='open'
  UNION ALL
  SELECT 'complaint',n.id::text FROM public.student_complaints n
    WHERE $3='super_admin' AND n.id::text=$2::text AND n.status <> 'resolved'
  UNION ALL
  SELECT 'backup',n.id::text FROM public.admin_backup_history n
    WHERE $3='super_admin' AND n.id::text=$2::text`;
export async function markNotificationRead(userId, role, notificationType, sourceId, executor) {
  const result = await executor.query(`WITH eligible AS (${notificationSources})
    INSERT INTO public.notification_read_states (user_id,notification_type,source_id)
    SELECT $1,notification_type,source_id FROM eligible WHERE notification_type=$4
    ON CONFLICT (user_id,notification_type,source_id) DO UPDATE SET read_at=public.notification_read_states.read_at
    RETURNING notification_type,source_id`, [userId, sourceId, role, notificationType]);
  return result.rows[0] || null;
}
export async function markNotificationsRead(userId, role, notificationKeys, executor) {
  if (!notificationKeys.length) return [];
  const result = await executor.query(`WITH requested AS (
      SELECT split_part(input.key,':',1) AS notification_type,split_part(input.key,':',2) AS source_id
      FROM unnest($3::text[]) AS input(key)
      WHERE input.key ~ '^(communication|password_reset_request|complaint):[0-9a-fA-F-]{36}$|^backup:[1-9][0-9]{0,17}$'
    ), eligible AS (
      SELECT 'communication'::text AS notification_type,c.id::text AS source_id FROM requested q
        JOIN public.communication_outbox c ON c.id::text=q.source_id AND c.recipient_id=$1 AND q.notification_type='communication'
      UNION ALL
      SELECT 'password_reset_request',n.id::text FROM requested q JOIN public.password_reset_requests n ON n.id::text=q.source_id
        WHERE $2='super_admin' AND q.notification_type='password_reset_request' AND n.status='open'
      UNION ALL
      SELECT 'complaint',n.id::text FROM requested q JOIN public.student_complaints n ON n.id::text=q.source_id
        WHERE $2='super_admin' AND q.notification_type='complaint' AND n.status <> 'resolved'
      UNION ALL
      SELECT 'backup',n.id::text FROM requested q JOIN public.admin_backup_history n ON n.id::text=q.source_id
        WHERE $2='super_admin' AND q.notification_type='backup'
    ), saved AS (
      INSERT INTO public.notification_read_states (user_id,notification_type,source_id)
      SELECT $1,notification_type,source_id FROM eligible
      ON CONFLICT (user_id,notification_type,source_id) DO UPDATE SET read_at=public.notification_read_states.read_at
      RETURNING notification_type,source_id
    )
    SELECT notification_type || ':' || source_id::text AS notification_key FROM saved`, [userId, role, notificationKeys]);
  return result.rows.map((row) => row.notification_key);
}
export async function userStatusCounts(executor) { return (await executor.query("SELECT count(*)::int AS users,count(*) FILTER (WHERE status='active')::int AS active_users,count(*) FILTER (WHERE status='suspended')::int AS suspended_users FROM public.app_users")).rows[0] || null; }
export async function createComplaintRecord(user, message, executor) { return (await executor.query('INSERT INTO public.student_complaints (student_id,email,message,submitted_by,submitted_name) VALUES ($1,$2,$3,$4,$5) RETURNING *', [user.student_id, user.email, message, user.id, user.name || null])).rows[0] || null; }
const complaintSelect = `SELECT c.*, submitter.name AS current_submitter_name,
    modifier.name AS last_modified_by_name, assignee.name AS assigned_to_name,
    assigner.name AS assigned_by_name
  FROM public.student_complaints c
  LEFT JOIN public.app_users submitter ON submitter.id=c.submitted_by
  LEFT JOIN public.app_users modifier ON modifier.id=c.last_modified_by
  LEFT JOIN public.app_users assignee ON assignee.id=c.assigned_to
  LEFT JOIN public.app_users assigner ON assigner.id=c.assigned_by`;
export async function listComplaintRecords(executor) { return (await executor.query(`${complaintSelect} ORDER BY c.created_at DESC`)).rows; }
export async function findComplaintRecord(id, executor) { return (await executor.query(`${complaintSelect} WHERE c.id=$1`, [id])).rows[0] || null; }
export async function updateComplaintRecord(id, status, reply, actorId, executor) { return (await executor.query('UPDATE public.student_complaints SET status=$2,reply=$3,handled_by=$4,last_modified_by=$4,updated_at=now() WHERE id=$1 RETURNING *', [id, status, String(reply || '').slice(0, 4000), actorId])).rows[0] || null; }
export async function findComplaintForUpdate(id, executor) { return (await executor.query('SELECT id,status,reply,assigned_to,assigned_by FROM public.student_complaints WHERE id=$1 FOR UPDATE', [id])).rows[0] || null; }
export async function findActiveAdminAssignee(id, executor) { return (await executor.query("SELECT id,name,role FROM public.app_users WHERE id=$1 AND role IN ('regular_admin','super_admin') AND status='active'", [id])).rows[0] || null; }
export async function findAdminName(id, executor) { return (await executor.query("SELECT name FROM public.app_users WHERE id=$1 AND role IN ('regular_admin','super_admin')", [id])).rows[0]?.name || null; }
export async function updateComplaintAssignment(id, assigneeId, actorId, executor) { return (await executor.query('UPDATE public.student_complaints SET assigned_to=$2,assigned_by=$3,assigned_at=now(),updated_at=now(),last_modified_by=$3,handled_by=$3 WHERE id=$1 RETURNING *', [id, assigneeId, actorId])).rows[0] || null; }
export async function createCommunicationRecord(recipientId, message, senderId, executor) { return (await executor.query("INSERT INTO public.communication_outbox (recipient_id,sender_id,kind,subject,body,status) VALUES ($1,$2,'message','Message from Galala University',$3,'queued') RETURNING *", [recipientId, senderId, message])).rows[0] || null; }
export async function listCommunicationRecords(executor) { return (await executor.query(`SELECT c.id,c.kind,c.subject,c.body,c.status,c.created_at,u.name AS recipient_name,u.email AS recipient_email FROM public.communication_outbox c JOIN public.app_users u ON u.id=c.recipient_id ORDER BY c.created_at DESC`)).rows; }
