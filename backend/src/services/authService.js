import crypto from 'node:crypto';
import { query, withPostgresClient } from '../db/client.js';
import { env } from '../config/env.js';
import { hashAndVerifyPassword, verifyPassword } from './passwordService.js';
import { countSuperAdmins as countSuperAdminRows, countUsers as countUserRows, deleteUser as deleteUserRow, findActiveUserById, findActiveUserByIdentifier, findUserByIdentifier as findUserRow, insertUser, listUsers as listUserRows, updateManagedUser, updatePassword, updateProfile } from '../repositories/userRepository.js';
import { createRefreshSession, findActiveRefreshSession, findPriorSessionCreatedAt, revokeRefreshSession, revokeUserRefreshSessions, tokenHash } from '../repositories/sessionRepository.js';
import { createResetRequest, createResetToken, decideResetRequest, findOpenResetRequest, findResetEligibleUser, findUsableResetToken, listResetRequests, markResetTokenUsed, queueResetNotification } from '../repositories/recoveryRepository.js';
import { createCommunicationRecord, createComplaintRecord, listAdminActivity, listCommunicationRecords, listComplaintRecords, listOpenComplaintNotifications, listOpenResetNotifications, listRecentBackupNotifications, listStudentActivity, listUserNotifications, updateComplaintRecord, userStatusCounts } from '../repositories/notificationRepository.js';

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
  const user = await findActiveUserByIdentifier(identifier, { query });
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
  if (!user || !bcryptCompare) return null;
  return user;
}
export async function createSession(user, executor = { query }) {
  const refreshToken = crypto.randomBytes(48).toString('base64url');
  const refreshTokenHash = tokenHash(refreshToken);
  const refreshTtlDays = user.role === 'super_admin' ? SUPER_ADMIN_REFRESH_TTL_DAYS : STANDARD_REFRESH_TTL_DAYS;
  await createRefreshSession(user.id, refreshTokenHash, refreshTtlDays, executor);
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
  return findActiveUserById(claim.sub, { query });
}
export async function rotateRefreshSession(hash, client) {
  const user = await findActiveRefreshSession(hash, client);
  if (!user) return null;
  await revokeRefreshSession(hash, client);
  return { user, ...(await createSession(user, client)) };
}
export async function refreshSession(req) {
  const token = parseCookies(req.headers.cookie).gu_refresh;
  if (!token) return null;
  const hash = tokenHash(token);
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const session = await rotateRefreshSession(hash, client);
      if (!session) { await client.query('ROLLBACK'); return null; }
      await client.query('COMMIT');
      return session;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}
export async function logout(req) { const token = parseCookies(req.headers.cookie).gu_refresh; if (token) await revokeRefreshSession(tokenHash(token), { query }); }
export async function listUsers() { return listUserRows({ query }); }
export async function countUsers(executor = { query }) { return countUserRows(executor); }
export async function createUser(input, executor = { query }) {
  const username = defaultUsername(input);
  const usernameError = validateUsername(username); if (usernameError) throw new Error(usernameError);
  const hash = await hashAndVerifyPassword(input.password);
  const created = await insertUser(input, hash, username, executor);
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
  let password = null;
  let passwordHash = null;
  if (input.password) { password = input.password; passwordHash = await hashAndVerifyPassword(password); }
  const updated = await updateManagedUser(id, input, passwordHash, { query });
  if (updated && password && !(await verifyPassword(password, updated.password_hash))) throw new Error('Stored password verification failed. Password update was rejected.');
  if (!updated) return null;
  const { password_hash, ...user } = updated;
  return user;
}

export async function updateOwnProfile(userId, input) {
  const changes = [];
  if (input.name !== undefined) changes.push(['name', String(input.name).trim()]);
  if (input.username !== undefined) {
    const username = String(input.username).trim(); const error = validateUsername(username); if (error) throw new Error(error);
    changes.push(['username', username]);
  }
  if (input.avatarKey !== undefined) {
    if (!['avatar-1','avatar-2','avatar-3','avatar-4','avatar-5','avatar-6'].includes(input.avatarKey)) throw new Error('Invalid avatar selection.');
    changes.push(['avatar_key', input.avatarKey], ['avatar_data_null', null]);
  }
  if (input.avatarData !== undefined) {
    const avatar = String(input.avatarData || '');
    if (avatar && (!/^data:image\/(jpeg|png|webp);base64,/i.test(avatar) || Buffer.byteLength(avatar, 'utf8') > 1024 * 1024)) throw new Error('Avatar must be a JPG, PNG, or WebP image smaller than 1 MB.');
    changes.push(['avatar_data', avatar || null]);
  }
  const updated = await updateProfile(userId, changes, { query });
  return publicUser(updated);
}

export async function getDashboardData(user) {
  const [lastSession, notices, activity, resetRequests, complaints, backups] = await Promise.all([
    findPriorSessionCreatedAt(user.id, { query }),
    listUserNotifications(user.id, { query }),
    user.role === 'student' ? listStudentActivity(user.id, { query }) : listAdminActivity({ query }),
    user.role === 'super_admin' ? listOpenResetNotifications({ query }) : Promise.resolve([]),
    user.role === 'super_admin' ? listOpenComplaintNotifications({ query }) : Promise.resolve([]),
    user.role === 'super_admin' ? listRecentBackupNotifications({ query }) : Promise.resolve([])
  ]);
  const notifications = [...notices.map((item) => ({ ...item, read: false, target: null })), ...resetRequests.map((item) => ({ id: `reset-${item.id}`, title: 'Password reset request', description: 'A password-reset request requires review.', timestamp: item.created_at, category: 'account', read: false, target: '/admin/index.html' })), ...complaints.map((item) => ({ id: `complaint-${item.id}`, title: 'Student complaint', description: 'A student complaint requires review.', timestamp: item.created_at, category: 'request', read: false, target: '/admin/index.html' })), ...backups.slice(0, 1).map((item) => ({ id: `backup-${item.id}`, title: 'Backup available', description: 'A system backup was generated.', timestamp: item.created_at, category: 'system', read: true, target: '/admin/index.html' }))].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
  const userCounts = user.role === 'super_admin' ? await userStatusCounts({ query }) : null;
  return { profile: { ...publicUser(user), avatarData: user.avatar_data || null, lastLogin: lastSession?.created_at || null, passwordChangedAt: user.password_changed_at || null }, notifications, recentActivity: activity, userCounts, studyProgress: user.role === 'student' ? { available: false, message: 'Academic progress will appear once university academic records are connected.' } : null };
}

export async function deleteUser(id) {
  const deleted = await deleteUserRow(id, { query });
  return deleted ? publicUser(deleted) : null;
}

export async function countSuperAdmins(executor = { query }) {
  return countSuperAdminRows(executor);
}

export async function findUserByIdentifier(identifier) {
  const found = await findUserRow(identifier, { query });
  return found ? publicUser(found) : null;
}

export async function resetUserPassword(userId, password) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const hash = await hashAndVerifyPassword(password);
      const updated = await updatePassword(userId, hash, client);
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
  const user = await findResetEligibleUser(identifier, { query });
  if (!user || user.status !== 'active') return null;
  return createResetRequest(user, message, { query });
}

export async function listPasswordResetRequests() {
  return listResetRequests({ query });
}

export async function decidePasswordResetRequest(id, decision, actorId, note = '') {
  if (!['approve', 'reject'].includes(decision)) throw new Error('Invalid reset-request decision.');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const found = await findOpenResetRequest(id, client);
      if (!found) throw new Error('Password reset request not found.');
      if (found.status !== 'open') throw new Error('This password reset request has already been decided.');
      let resetLink = null;
      // A random single-use token is stored only as a hash. Delivery is queued
      // for the registered address; it is never returned by this API or logged.
      if (decision === 'approve') {
        const token = crypto.randomBytes(32).toString('base64url');
        const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await createResetToken(found.user_id, resetTokenHash, client);
        await queueResetNotification(found.user_id, actorId, client);
        // The one-hour link is returned only once to the approving Super Admin,
        // who can send it through the registered email channel. The database
        // retains only its hash; no password or hash is ever exposed.
        resetLink = `/reset-password.html?token=${encodeURIComponent(token)}`;
      }
      const updated = await decideResetRequest(id, decision === 'approve' ? 'approved' : 'rejected', actorId, note, client);
      await client.query('COMMIT'); return { ...updated, resetLink };
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function consumePasswordResetToken(token, password) {
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const reset = await findUsableResetToken(hash, client);
      if (!reset) throw new Error('This password reset link is invalid or has expired.');
      const passwordHash = await hashAndVerifyPassword(password);
      await updatePassword(reset.user_id, passwordHash, client);
      await markResetTokenUsed(reset.id, client);
      await revokeUserRefreshSessions(reset.user_id, client);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function createComplaint(user, message) {
  return createComplaintRecord(user, message, { query });
}
export async function listComplaints() { return listComplaintRecords({ query }); }
export async function updateComplaint(id, status, reply, actorId) {
  if (!['open','in_progress','resolved'].includes(status)) throw new Error('Invalid complaint status.');
  return updateComplaintRecord(id, status, reply, actorId, { query });
}
export async function createCommunication(recipientId, message, senderId) {
  return createCommunicationRecord(recipientId, message, senderId, { query });
}
export async function listCommunications() {
  return listCommunicationRecords({ query });
}
