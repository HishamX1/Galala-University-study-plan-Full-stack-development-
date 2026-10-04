export async function findResetEligibleUser(identifier, executor) {
  return (await executor.query('SELECT id,role,status FROM public.app_users WHERE lower(email)=lower($1) OR student_id=$1 LIMIT 1', [identifier])).rows[0] || null;
}

export async function createResetRequest(user, message, executor) {
  return (await executor.query("INSERT INTO public.password_reset_requests (user_id,role,message) VALUES ($1,$2,$3) RETURNING id,user_id,role,status,message,created_at", [user.id, user.role, String(message || '').slice(0, 2000)])).rows[0] || null;
}

export async function listResetRequests(executor) {
  return (await executor.query(`SELECT r.id,r.role,r.status,r.message,r.created_at,r.decided_at,u.name,u.email,u.student_id
    FROM public.password_reset_requests r JOIN public.app_users u ON u.id=r.user_id ORDER BY r.created_at DESC`)).rows;
}

export async function findOpenResetRequest(id, executor) {
  return (await executor.query('SELECT * FROM public.password_reset_requests WHERE id=$1 FOR UPDATE', [id])).rows[0] || null;
}

export async function createResetToken(userId, tokenHash, executor) {
  await executor.query("INSERT INTO public.password_reset_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 hour')", [userId, tokenHash]);
}

export async function queueResetNotification(userId, actorId, executor) {
  await executor.query("INSERT INTO public.communication_outbox (recipient_id,sender_id,kind,subject,body,status) VALUES ($1,$2,'password_reset','Password reset approved','A secure password-reset link has been generated for your registered email address.','queued')", [userId, actorId]);
}

export async function decideResetRequest(id, decision, actorId, note, executor) {
  return (await executor.query("UPDATE public.password_reset_requests SET status=$2,decided_by=$3,decided_at=now(),decision_note=$4 WHERE id=$1 RETURNING id,user_id,role,status,message,created_at,decided_at", [id, decision, actorId, String(note || '').slice(0, 2000)])).rows[0] || null;
}

export async function findUsableResetToken(tokenHash, executor) {
  return (await executor.query('SELECT * FROM public.password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE', [tokenHash])).rows[0] || null;
}

export async function markResetTokenUsed(id, executor) {
  await executor.query('UPDATE public.password_reset_tokens SET used_at=now() WHERE id=$1', [id]);
}
