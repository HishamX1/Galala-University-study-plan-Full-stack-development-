import crypto from 'node:crypto';

export const tokenHash = (token) => crypto.createHash('sha256').update(token).digest('hex');

export async function createRefreshSession(userId, hash, ttlDays, executor) {
  await executor.query("INSERT INTO public.auth_refresh_tokens (user_id,token_hash,expires_at) VALUES ($1,$2,now()+($3 * interval '1 day'))", [userId, hash, ttlDays]);
}

export async function findActiveRefreshSession(hash, executor) {
  return (await executor.query("SELECT u.* FROM public.auth_refresh_tokens t JOIN public.app_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at>now() AND u.status='active'", [hash])).rows[0] || null;
}

export async function revokeRefreshSession(hash, executor) {
  await executor.query('UPDATE public.auth_refresh_tokens SET revoked_at=now() WHERE token_hash=$1', [hash]);
}

export async function revokeUserRefreshSessions(userId, executor) {
  await executor.query('UPDATE public.auth_refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [userId]);
}

export async function findPriorSessionCreatedAt(userId, executor) {
  return (await executor.query('SELECT created_at FROM public.auth_refresh_tokens WHERE user_id=$1 ORDER BY created_at DESC OFFSET 1 LIMIT 1', [userId])).rows[0] || null;
}
