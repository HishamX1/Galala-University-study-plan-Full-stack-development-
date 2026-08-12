import crypto from 'node:crypto';
import { query, withPostgresClient } from '../db/client.js';
import { env } from '../config/env.js';
import { hashAndVerifyPassword, verifyPassword } from './passwordService.js';

// Access tokens are intentionally short-lived.  The refresh session, not the
// access token, provides the continuous signed-in experience.
export const ACCESS_TTL_SECONDS = 300;
const STANDARD_REFRESH_TTL_DAYS = 7;
const SUPER_ADMIN_REFRESH_TTL_DAYS = 90;
const base64url = (value) => Buffer.from(value).toString('base64url');
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => part.trim().split(/=(.*)/s)).filter(([key]) => key).map(([key, value]) => [key, decodeURIComponent(value || '')]));
const sign = (value) => crypto.createHmac('sha256', env.jwtSecret).update(value).digest('base64url');

function jwt(payload) {
  const encoded = `${base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${base64url(JSON.stringify(payload))}`;
  return `${encoded}.${sign(encoded)}`;
}

function verifyJwt(token) {
  const [header, payload, signature] = String(token || '').split('.');
  const expectedSignature = sign(`${header}.${payload}`);
  if (!header || !payload || !signature || signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
  try { const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); return value.exp > Math.floor(Date.now() / 1000) ? value : null; } catch { return null; }
}

export function cookieOptions(maxAge, httpOnly = true) {
  return `${httpOnly ? 'HttpOnly; ' : ''}Path=/; SameSite=${env.cookieSameSite}; Max-Age=${maxAge}${env.cookieSecure ? '; Secure' : ''}`;
}
export function authCookies(accessToken, refreshToken, refreshTtlSeconds) {
  return [`gu_access=${encodeURIComponent(accessToken)}; ${cookieOptions(ACCESS_TTL_SECONDS)}`, `gu_refresh=${encodeURIComponent(refreshToken)}; ${cookieOptions(refreshTtlSeconds)}`];
}
export function clearAuthCookies() { return [`gu_access=; ${cookieOptions(0)}`, `gu_refresh=; ${cookieOptions(0)}`]; }
export function publicUser(user) { return { id: user.id, name: user.name, email: user.email, username: user.username, studentId: user.student_id, role: user.role, status: user.status, avatarKey: user.avatar_key || 'avatar-1', hasCustomAvatar: Boolean(user.avatar_data) }; }

const USERNAME_RE = /^[A-Za-z0-9_.]{3,20}$/;
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'superadmin', 'system', 'support']);
export function validateUsername(username) {
  const value = String(username || '').trim();
  if (!USERNAME_RE.test(value)) return 'Username must be 3–20 characters and use only letters, numbers, dots, or underscores.';
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return 'That username is reserved.';
  return null;
}
function defaultUsername(input) {
  const basis = String(input.username || input.email || '').split('@')[0].replace(/[^A-Za-z0-9_.]/g, '_').slice(0, 20);
  return basis.length >= 3 && !RESERVED_USERNAMES.has(basis.toLowerCase()) ? basis : `user_${crypto.randomBytes(4).toString('hex')}`;
}

export async function authenticate(identifier, password) {
  const result = await query('SELECT * FROM public.app_users WHERE lower(email) = lower($1) OR student_id = $1 LIMIT 1', [identifier]);
  const user = result.rows[0];
  // Preserve the existing short-circuit: bcrypt is only evaluated for active users.
  const bcryptCompare = user?.status === 'active' ? await verifyPassword(password, user.password_hash) : false;
  if (env.nodeEnv !== 'production') {
    console.info('Authentication diagnostic', {
      userFound: Boolean(user),
      userId: user?.id ?? null,
      role: user?.role ?? null,
      status: user?.status ?? null,
      bcryptCompare
    });
  }
  if (!user || user.status !== 'active' || !bcryptCompare) return null;
  return user;
}
export async function createSession(user) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const refreshTtlDays = user.role === 'super_admin' ? SUPER_ADMIN_REFRESH_TTL_DAYS : STANDARD_REFRESH_TTL_DAYS;
  await query("INSERT INTO public.auth_refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 * interval '1 day'))", [user.id, tokenHash, refreshTtlDays]);
  return {
    accessToken: jwt({ sub: user.id, role: user.role, exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_SECONDS }),
    refreshToken,
    refreshTtlSeconds: refreshTtlDays * 86400
  };
}
export async function currentUser(req) {
  const token = parseCookies(req.headers.cookie).gu_access;
  const claim = verifyJwt(token);
  if (!claim?.sub) return null;
  const result = await query('SELECT * FROM public.app_users WHERE id = $1 AND status = $2', [claim.sub, 'active']);
  return result.rows[0] || null;
}
export async function refreshSession(req) {
  const token = parseCookies(req.headers.cookie).gu_refresh;
  if (!token) return null;
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  const found = await query("SELECT u.* FROM public.auth_refresh_tokens t JOIN public.app_users u ON u.id=t.user_id WHERE t.token_hash=$1 AND t.revoked_at IS NULL AND t.expires_at > now() AND u.status='active'", [hash]);
  if (!found.rows[0]) return null;
  await query('UPDATE public.auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [hash]);
  return { user: found.rows[0], ...(await createSession(found.rows[0])) };
}
export async function logout(req) { const token = parseCookies(req.headers.cookie).gu_refresh; if (token) await query('UPDATE public.auth_refresh_tokens SET revoked_at = now() WHERE token_hash = $1', [crypto.createHash('sha256').update(token).digest('hex')]); }
export async function listUsers() { return (await query('SELECT id, name, email, student_id, role, status, created_at, updated_at FROM public.app_users ORDER BY created_at DESC')).rows; }
export async function countUsers(executor = { query }) { return Number((await executor.query('SELECT count(*)::int AS count FROM public.app_users')).rows[0].count); }
export async function createUser(input, executor = { query }) {
  const username = defaultUsername(input);
  const usernameError = validateUsername(username); if (usernameError) throw new Error(usernameError);
  const hash = await hashAndVerifyPassword(input.password);
  const created = (await executor.query('INSERT INTO public.app_users (name,email,username,student_id,password_hash,role,status,password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *', [input.name, input.email.toLowerCase(), username, input.studentId || null, hash, input.role, input.status || 'active'])).rows[0];
  if (!created || !(await verifyPassword(input.password, created.password_hash))) throw new Error('Stored password verification failed. No account was created.');
  const { password_hash, ...user } = created;
  return user;
}
export async function bootstrapSuperAdmin(input) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gu_app_users_bootstrap'))");
      if (await countUsers(client)) { await client.query('COMMIT'); return null; }
      const user = await createUser({ ...input, role: 'super_admin', status: 'active' }, client);
      await client.query('COMMIT');
      return user;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}
export async function updateUser(id, input) {
  const sets = ['name=$2', 'email=$3', 'student_id=$4', 'role=$5', 'status=$6', 'updated_at=now()'];
  const values = [id, input.name, input.email.toLowerCase(), input.studentId || null, input.role, input.status];
  let password = null;
  if (input.password) { password = input.password; sets.push(`password_hash=$${values.length + 1}`); values.push(await hashAndVerifyPassword(password)); }
  const updated = (await query(`UPDATE public.app_users SET ${sets.join(', ')} WHERE id=$1 RETURNING id,name,email,student_id,password_hash,role,status,created_at,updated_at`, values)).rows[0] || null;
  if (updated && password && !(await verifyPassword(password, updated.password_hash))) throw new Error('Stored password verification failed. Password update was rejected.');
  if (!updated) return null;
  const { password_hash, ...user } = updated;
  return user;
}

export async function updateOwnProfile(userId, input) {
  const sets = ['updated_at=now()']; const values = [userId];
  if (input.name !== undefined) { sets.push(`name=$${values.length + 1}`); values.push(String(input.name).trim()); }
  if (input.username !== undefined) {
    const username = String(input.username).trim(); const error = validateUsername(username); if (error) throw new Error(error);
    sets.push(`username=$${values.length + 1}`); values.push(username);
  }
  if (input.avatarKey !== undefined) {
    if (!['avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6'].includes(input.avatarKey)) throw new Error('Invalid avatar selection.');
    sets.push(`avatar_key=$${values.length + 1}`, 'avatar_data=NULL'); values.push(input.avatarKey);
  }
  if (input.avatarData !== undefined) {
    const avatar = String(input.avatarData || '');
    if (avatar && (!/^data:image\/(jpeg|png|webp);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 1024 * 1024)) throw new Error('Avatar must be a JPG, PNG, or WebP image smaller than 1 MB.');
    sets.push(`avatar_data=$${values.length + 1}`); values.push(avatar || null);
  }
  const updated = (await query(`UPDATE public.app_users SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, values)).rows[0];
  return publicUser(updated);
}

export async function getDashboardData(user) {
  const [lastSession, notices, activity, resetRequests, complaints, backups] = await Promise.all([
    query('SELECT created_at FROM public.auth_refresh_tokens WHERE user_id=$1 ORDER BY created_at DESC OFFSET 1 LIMIT 1', [user.id]),
    query(`SELECT id,subject AS title,body AS description,created_at AS timestamp,kind AS category FROM public.communication_outbox WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 8`, [user.id]),
    user.role === 'student' ? query('SELECT id,created_at,subject AS action,body AS description FROM public.communication_outbox WHERE recipient_id=$1 ORDER BY created_at DESC LIMIT 6', [user.id]) : query('SELECT id,created_at,action,description FROM admin_audit_logs ORDER BY created_at DESC LIMIT 6'),
    user.role === 'super_admin' ? query("SELECT id,created_at FROM public.password_reset_requests WHERE status='open' ORDER BY created_at DESC LIMIT 8") : Promise.resolve({ rows: [] }),
    user.role === 'super_admin' ? query("SELECT id,created_at FROM public.student_complaints WHERE status <> 'resolved' ORDER BY created_at DESC LIMIT 8") : Promise.resolve({ rows: [] }),
    user.role === 'super_admin' ? query('SELECT id,created_at FROM admin_backup_history ORDER BY created_at DESC LIMIT 8') : Promise.resolve({ rows: [] })
  ]);
  const notifications = [...notices.rows.map((item) => ({ ...item, read: false, target: null })), ...resetRequests.rows.map((item) => ({ id: `reset-${item.id}`, title: 'Password reset request', description: 'A password-reset request requires review.', timestamp: item.created_at, category: 'account', read: false, target: '/admin/index.html' })), ...complaints.rows.map((item) => ({ id: `complaint-${item.id}`, title: 'Student complaint', description: 'A student complaint requires review.', timestamp: item.created_at, category: 'request', read: false, target: '/admin/index.html' })), ...backups.rows.slice(0, 1).map((item) => ({ id: `backup-${item.id}`, title: 'Backup available', description: 'A system backup was generated.', timestamp: item.created_at, category: 'system', read: true, target: '/admin/index.html' }))].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
  const userCounts = user.role === 'super_admin' ? await query("SELECT count(*)::int AS users, count(*) FILTER (WHERE status='active')::int AS active_users, count(*) FILTER (WHERE status='suspended')::int AS suspended_users FROM public.app_users") : { rows: [] };
  return { profile: { ...publicUser(user), avatarData: user.avatar_data || null, lastLogin: lastSession.rows[0]?.created_at || null, passwordChangedAt: user.password_changed_at || null }, notifications, recentActivity: activity.rows, userCounts: userCounts.rows[0] || null, studyProgress: user.role === 'student' ? { available: false, message: 'Academic progress will appear once university academic records are connected.' } : null };
}

export async function deleteUser(id) {
  const deleted = (await query('DELETE FROM public.app_users WHERE id=$1 RETURNING id,name,email,student_id,role,status', [id])).rows[0] || null;
  return deleted ? publicUser(deleted) : null;
}

export async function countSuperAdmins(executor = { query }) {
  return Number((await executor.query("SELECT count(*)::int AS count FROM public.app_users WHERE role='super_admin'")).rows[0].count);
}

export async function findUserByIdentifier(identifier) {
  const found = (await query('SELECT id,name,email,student_id,role,status FROM public.app_users WHERE lower(email) = lower($1) OR student_id = $1 LIMIT 1', [identifier])).rows[0] || null;
  return found ? publicUser(found) : null;
}

export async function resetUserPassword(userId, password) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const hash = await hashAndVerifyPassword(password);
      const updated = (await client.query('UPDATE public.app_users SET password_hash=$2, updated_at=now() WHERE id=$1 RETURNING id,name,email,student_id,password_hash,role,status,created_at,updated_at', [userId, hash])).rows[0] || null;
      if (!updated) throw new Error('User not found.');
      if (!(await verifyPassword(password, updated.password_hash))) throw new Error('Stored password verification failed. Password reset was rolled back.');
      await client.query('COMMIT');
      const { password_hash, ...user } = updated;
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function createPasswordResetRequest(identifier, message = '') {
  const found = await query("SELECT id, role, status FROM public.app_users WHERE lower(email)=lower($1) OR student_id=$1 LIMIT 1", [identifier]);
  const user = found.rows[0];
  if (!user || user.status !== 'active') return null;
  return (await query("INSERT INTO public.password_reset_requests (user_id, role, message) VALUES ($1,$2,$3) RETURNING id,user_id,role,status,message,created_at", [user.id, user.role, String(message || '').slice(0, 2000)])).rows[0];
}

export async function listPasswordResetRequests() {
  return (await query(`SELECT r.id,r.role,r.status,r.message,r.created_at,r.decided_at,u.name,u.email,u.student_id
    FROM public.password_reset_requests r JOIN public.app_users u ON u.id=r.user_id ORDER BY r.created_at DESC`)).rows;
}

export async function decidePasswordResetRequest(id, decision, actorId, note = '') {
  if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid reset-request decision.');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const found = (await client.query('SELECT * FROM public.password_reset_requests WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!found) throw new Error('Password reset request not found.');
      if (found.status !== 'open') throw new Error('This password reset request has already been decided.');
      let resetLink = null;
      // A random single-use token is stored only as a hash. Delivery is queued
      // for the registered address; it is never returned by this API or logged.
      if (decision === 'approve') {
        const token = crypto.randomBytes(32).toString('base64url');
        const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await client.query("INSERT INTO public.password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,now()+interval '1 hour')", [found.user_id, resetTokenHash]);
        await client.query("INSERT INTO public.communication_outbox (recipient_id, sender_id, kind, subject, body, status) VALUES ($1,$2,'password_reset','Password reset approved','A secure password-reset link has been generated for your registered email address.','queued')", [found.user_id, actorId]);
        // The one-hour link is returned only once to the approving Super Admin,
        // who can send it through the registered email channel. The database
        // retains only its hash; no password or hash is ever exposed.
        resetLink = `/reset-password.html?token=${encodeURIComponent(token)}`;
      }
      const updated = (await client.query("UPDATE public.password_reset_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING id,user_id,role,status,message,created_at,decided_at", [id, decision === 'approve' ? 'approved' : 'rejected', actorId, String(note || '').slice(0, 2000)])).rows[0];
      await client.query('COMMIT'); return { ...updated, resetLink };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function consumePasswordResetToken(token, password) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const reset = (await client.query("SELECT * FROM public.password_reset_tokens WHERE token_hash=$1 AND used_at IS NULL AND expires_at>now() FOR UPDATE", [hash])).rows[0];
      if (!reset) throw new Error('This password reset link is invalid or has expired.');
      const passwordHash = await hashAndVerifyPassword(password);
      await client.query('UPDATE public.app_users SET password_hash=$2, updated_at=now() WHERE id=$1', [reset.user_id, passwordHash]);
      await client.query('UPDATE public.password_reset_tokens SET used_at=now() WHERE id=$1', [reset.id]);
      await client.query('UPDATE public.auth_refresh_tokens SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL', [reset.user_id]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function createComplaint(user, message) {
  return (await query("INSERT INTO public.student_complaints (student_id,email,message) VALUES ($1,$2,$3) RETURNING *", [user.student_id, user.email, message])).rows[0];
}
export async function listComplaints() { return (await query('SELECT * FROM public.student_complaints ORDER BY created_at DESC')).rows; }
export async function updateComplaint(id, status, reply, actorId) {
  if (!['open','in_progress','resolved'].includes(status)) throw new Error('Invalid complaint status.');
  return (await query("UPDATE public.student_complaints SET status=$2, reply=$3, handled_by=$4, updated_at=now() WHERE id=$1 RETURNING *", [id, status, String(reply || '').slice(0, 4000), actorId])).rows[0];
}
export async function createCommunication(recipientId, message, senderId) {
  return (await query("INSERT INTO public.communication_outbox (recipient_id,sender_id,kind,subject,body,status) VALUES ($1,$2,'message','Message from Galala University',$3,'queued') RETURNING *", [recipientId, senderId, message])).rows[0];
}
export async function listCommunications() {
  return (await query(`SELECT c.id,c.kind,c.subject,c.body,c.status,c.created_at,u.name AS recipient_name,u.email AS recipient_email
    FROM public.communication_outbox c JOIN public.app_users u ON u.id=c.recipient_id ORDER BY c.created_at DESC`)).rows;
}
