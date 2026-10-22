export async function listUserNotifications(userId, executor) { return (await executor.query('SELECT id,subject AS title,body AS description,created_at AS timestamp,kind AS category FROM public.communication_outbox WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 8', [userId])).rows; }

export async function listStudentActivity(userId, executor) { return (await executor.query('SELECT id,created_at,subject AS action,body AS description FROM public.communication_outbox WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 6', [userId])).rows; }
export async function listOpenResetNotifications(executor) { return (await executor.query("SELECT id,created_at FROM public.password_reset_requests WHERE status='open' ORDER BY created_at DESC LIMIT 8")).rows; }
export async function listOpenComplaintNotifications(executor) { return (await executor.query("SELECT id,created_at FROM public.student_complaints WHERE status <> 'resolved' ORDER BY created_at DESC LIMIT 8")).rows; }
export async function listRecentBackupNotifications(executor) { return (await executor.query('SELECT id,created_at FROM admin_backup_history ORDER BY created_at DESC LIMIT 8')).rows; }
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
