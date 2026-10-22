import crypto from 'node:crypto';
import { query, withPostgresClient } from '../db/client.js';
import { env } from '../config/env.js';
import { hashAndVerifyPassword, verifyPassword } from './passwordService.js';
import { countSuperAdmins as countSuperAdminRows, countUsers as countUserRows, deleteUser as deleteUserRow, findActiveUserById, findActiveUserByIdentifier, findUserByIdForUpdate, findUserByIdentifier as findUserRow, insertUser, listUsers as listUserRows, updateManagedUser, updatePassword, updateProfile } from '../repositories/userRepository.js';
import { createRefreshSession, findActiveRefreshSession, findPriorSessionCreatedAt, revokeRefreshSession, revokeUserRefreshSessions, tokenHash } from '../repositories/sessionRepository.js';
import { countRecentStudentEmailResetTokens, createResetRequest, createResetToken, decideResetRequest, findActiveStudentByEmailForUpdate, findOpenResetRequest, findResetEligibleUser, findUsableResetToken, invalidateActiveResetTokens, listResetRequests, markResetTokenUsed, queueResetNotification } from '../repositories/recoveryRepository.js';
import { getPasswordResetEmailConfig, sendPasswordResetEmail } from './passwordResetEmailService.js';
import { createCommunicationRecord, createComplaintRecord, findActiveAdminAssignee, findAdminName, findComplaintForUpdate, findComplaintRecord, listCommunicationRecords, listComplaintRecords, listOpenComplaintNotifications, listOpenResetNotifications, listRecentBackupNotifications, listStudentActivity, listUserNotifications, markNotificationRead as saveNotificationRead, markNotificationsRead as saveNotificationsRead, updateComplaintAssignment, updateComplaintRecord, userStatusCounts } from '../repositories/notificationRepository.js';
import { listComplaintAuditEvents, listRecentAuditEvents } from '../repositories/auditRepository.js';
import { logAdminAction } from './adminOpsService.js';
import { NotFoundError, ValidationError } from '../utils/errors.js';

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

export async function authenticate(identifier, password, { requestId = null } = {}) {
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
  if (!user || !bcryptCompare) {
    try { await logAdminAction({ query }, { action: 'Authentication Failed', entity: 'auth', targetId: user?.id || null, category: 'security', outcome: 'failure', requestId, description: 'An authentication attempt was rejected' }); }
    catch { /* Audit failure must not change the public authentication response. */ }
    return null;
  }
  try { await logAdminAction({ query }, { action: 'Credentials Verified', entity: 'auth', targetId: user.id, actor: user, category: 'security', requestId, description: 'User credentials were verified' }); }
  catch { /* Audit failure must not prevent an otherwise valid sign-in. */ }
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

export async function createManagedUser(input, actor) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const created = await createUser(input, client);
      await logAdminAction(client, { action: 'Created User', entity: 'user', targetId: created.id, actor, category: 'account', newValues: { role: created.role, status: created.status }, description: 'Created a managed account' });
      await client.query('COMMIT');
      return created;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
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
export async function updateUser(id, input, actor = null) {
  let password = null;
  let passwordHash = null;
  if (input.password) { password = input.password; passwordHash = await hashAndVerifyPassword(password); }
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const previous = await findUserByIdForUpdate(id, client);
      if (!previous) { await client.query('ROLLBACK'); return null; }
      const updated = await updateManagedUser(id, input, passwordHash, client);
      if (!updated) { await client.query('ROLLBACK'); return null; }
      if (password && !(await verifyPassword(password, updated.password_hash))) throw new Error('Stored password verification failed. Password update was rejected.');
      await logAdminAction(client, { action: 'Updated User', entity: 'user', targetId: id, actor, category: 'account', oldValues: { role: previous.role, status: previous.status }, newValues: { role: updated.role, status: updated.status, passwordChanged: Boolean(password) }, description: 'Updated managed account details' });
      await client.query('COMMIT');
      const { password_hash, ...user } = updated;
      return user;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
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
    user.role === 'student' ? listStudentActivity(user.id, { query }) : listRecentAuditEvents({ query }, { actorId: user.role === 'regular_admin' ? user.id : null, limit: 6 }).then((result) => result.rows),
    user.role === 'super_admin' ? listOpenResetNotifications(user.id, { query }) : Promise.resolve([]),
    user.role === 'super_admin' ? listOpenComplaintNotifications(user.id, { query }) : Promise.resolve([]),
    user.role === 'super_admin' ? listRecentBackupNotifications(user.id, { query }) : Promise.resolve([])
  ]);
  const notifications = [...notices.map((item) => ({ ...item, read: Boolean(item.read), target: null })), ...resetRequests.map((item) => ({ id: `reset-${item.id}`, notification_key: `password_reset_request:${item.id}`, title: 'Password reset request', description: 'A password-reset request requires review.', timestamp: item.created_at, category: 'account', read: Boolean(item.read), target: '/admin/index.html' })), ...complaints.map((item) => ({ id: `complaint-${item.id}`, notification_key: `complaint:${item.id}`, title: 'Student complaint', description: 'A student complaint requires review.', timestamp: item.created_at, category: 'request', read: Boolean(item.read), target: '/admin/index.html' })), ...backups.slice(0, 1).map((item) => ({ id: `backup-${item.id}`, notification_key: `backup:${item.id}`, title: 'Backup available', description: 'A system backup was generated.', timestamp: item.created_at, category: 'system', read: Boolean(item.read), target: '/admin/index.html' }))].sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp)).slice(0, 10);
  const userCounts = user.role === 'super_admin' ? await userStatusCounts({ query }) : null;
  return { profile: { ...publicUser(user), avatarData: user.avatar_data || null, lastLogin: lastSession?.created_at || null, passwordChangedAt: user.password_changed_at || null }, notifications, recentActivity: activity, userCounts, studyProgress: user.role === 'student' ? { available: false, message: 'Academic progress will appear once university academic records are connected.' } : null };
}

const NOTIFICATION_KEY_PATTERN = /^(communication|password_reset_request|complaint):([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$|^(backup):([1-9][0-9]{0,17})$/i;
function parseNotificationKey(key) {
  const match = NOTIFICATION_KEY_PATTERN.exec(String(key || ''));
  if (!match) throw new ValidationError('Invalid notification key.');
  return { type: match[1] || match[3], sourceId: match[2] || match[4] };
}

export async function markNotificationRead(user, key) {
  const { type, sourceId } = parseNotificationKey(key);
  const saved = await saveNotificationRead(user.id, user.role, type, sourceId, { query });
  if (!saved) throw new NotFoundError('Notification not found.');
  return { id: key, read: true };
}

export async function markAllDashboardNotificationsRead(user) {
  const dashboard = await getDashboardData(user);
  const keys = dashboard.notifications.filter((item) => !item.read).map((item) => item.notification_key).filter(Boolean);
  const notificationKeys = await saveNotificationsRead(user.id, user.role, keys, { query });
  return { notificationKeys, updatedCount: notificationKeys.length };
}

export async function deleteUser(id, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const previous = await findUserByIdForUpdate(id, client);
      if (!previous) { await client.query('ROLLBACK'); return null; }
      const deleted = await deleteUserRow(id, client);
      if (!deleted) { await client.query('ROLLBACK'); return null; }
      await logAdminAction(client, { action: 'Deleted User', entity: 'user', targetId: id, actor, category: 'account', oldValues: { role: previous.role, status: previous.status }, description: 'Deleted a managed account' });
      await client.query('COMMIT');
      return publicUser(deleted);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}

export async function countSuperAdmins(executor = { query }) {
  return countSuperAdminRows(executor);
}

export async function findUserByIdentifier(identifier) {
  const found = await findUserRow(identifier, { query });
  return found ? publicUser(found) : null;
}

export async function resetUserPassword(userId, password, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const hash = await hashAndVerifyPassword(password);
      const updated = await updatePassword(userId, hash, client);
      if (!updated) throw new Error('User not found.');
      if (!(await verifyPassword(password, updated.password_hash))) throw new Error('Stored password verification failed. Password reset was rolled back.');
      await logAdminAction(client, { action: 'Reset User Password', entity: 'user', targetId: userId, actor, category: 'account', description: 'Reset a managed account password' });
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

export async function createStudentPasswordResetRequest(email, { sendEmail, publicAppUrl, requestId = null, logger = console } = {}) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const sender = sendEmail || sendPasswordResetEmail;
  const appUrl = sendEmail
    ? String(publicAppUrl || '')
    : getPasswordResetEmailConfig().publicAppUrl;
  if (!appUrl) throw new Error('A public application URL is required by the email adapter.');

  const reset = await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const student = await findActiveStudentByEmailForUpdate(normalizedEmail, client);
      if (!student || await countRecentStudentEmailResetTokens(student.id, client) >= 3) {
        await client.query('COMMIT');
        return null;
      }

      const token = crypto.randomBytes(32).toString('base64url');
      const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await invalidateActiveResetTokens(student.id, client);
      const tokenRecord = await createResetToken(student.id, resetTokenHash, client, 'student_email');
      await client.query('COMMIT');
      return { recipient: student.email, token, tokenId: tokenRecord.id };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  if (!reset) return { accepted: true };
  const resetUrl = new URL('/reset-password.html', appUrl);
  resetUrl.searchParams.set('token', reset.token);
  resetUrl.searchParams.set('audience', 'student');
  try {
    await sender({ recipient: reset.recipient, resetUrl: resetUrl.href });
  } catch {
    try { await markResetTokenUsed(reset.tokenId, { query }); }
    catch { logger.error?.(JSON.stringify({ requestId, event: 'student_password_reset_token_cleanup_failed' })); }
    logger.warn?.(JSON.stringify({ requestId, event: 'student_password_reset_email_delivery_failed' }));
  }
  return { accepted: true };
}

export async function listPasswordResetRequests() {
  return listResetRequests({ query });
}

export async function decidePasswordResetRequest(id, decision, actorId, note = '', actor = null) {
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
        resetLink = `/reset-password.html?token=${encodeURIComponent(token)}&audience=admin`;
      }
      const updated = await decideResetRequest(id, decision === 'approve' ? 'approved' : 'rejected', actorId, note, client);
      await logAdminAction(client, { action: `Password Reset Request ${decision === 'approve' ? 'Approved' : 'Rejected'}`, entity: 'password_reset_request', targetId: id, actor, category: 'account', newValues: { decision: updated.status }, description: 'Reviewed a password-reset request' });
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

export async function createComplaint(user, message, requestId = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const complaint = await createComplaintRecord(user, message, client);
      await logAdminAction(client, { action: 'Complaint Submitted', entity: 'complaint', targetId: complaint.id, actor: { ...user, requestId }, category: 'request', newValues: { status: complaint.status }, description: 'Student submitted a complaint' });
      await client.query('COMMIT');
      return complaint;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}
export async function listComplaints(options = undefined) { return listComplaintRecords({ query }, options); }
export async function getComplaintDetails(id) {
  const complaint = await findComplaintRecord(id, { query });
  if (!complaint) return null;
  const { rows: history } = await listComplaintAuditEvents({ query }, id);
  return { complaint, history };
}
export async function updateComplaint(id, status, reply, actorId, actor = null) {
  if (!['open','in_progress','resolved'].includes(status)) throw new Error('Invalid complaint status.');
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const previous = await findComplaintForUpdate(id, client);
      if (!previous) { await client.query('ROLLBACK'); return null; }
      const updated = await updateComplaintRecord(id, status, reply, actorId, client);
      await logAdminAction(client, { action: 'Complaint Updated', entity: 'complaint', targetId: id, actor, category: 'request', oldValues: { status: previous.status }, newValues: { status: updated.status }, description: 'Updated student complaint status or response' });
      await client.query('COMMIT');
      return updated;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}
export async function assignComplaint(id, assigneeId, actor) {
  if (assigneeId !== null && (typeof assigneeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(assigneeId))) {
    throw new ValidationError('Invalid assigneeId.');
  }
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const previous = await findComplaintForUpdate(id, client);
      if (!previous) throw new NotFoundError('Complaint not found.');
      const previousAssigneeName = previous.assigned_to ? await findAdminName(previous.assigned_to, client) : null;
      const assignee = assigneeId ? await findActiveAdminAssignee(assigneeId, client) : null;
      if (assigneeId && !assignee) throw new NotFoundError('Active administrator not found.');
      if ((previous.assigned_to || null) === (assignee?.id || null)) {
        const unchanged = await findComplaintRecord(id, client);
        await client.query('COMMIT');
        return unchanged;
      }
      const updated = await updateComplaintAssignment(id, assignee?.id || null, actor.id, client);
      const action = !assignee ? 'Complaint Unassigned' : previous.assigned_to ? 'Complaint Reassigned' : 'Complaint Assigned';
      await logAdminAction(client, {
        action, entity: 'complaint', targetId: id, actor, category: 'request',
        oldValues: { assignedTo: previous.assigned_to || null, assignedToName: previousAssigneeName },
        newValues: { assignedTo: assignee?.id || null, assignedToName: assignee?.name || null, assignedBy: actor.id },
        description: !assignee ? 'Removed the complaint assignment' : `${action === 'Complaint Assigned' ? 'Assigned' : 'Reassigned'} a complaint to ${assignee.name}`
      });
      const result = await findComplaintRecord(id, client);
      await client.query('COMMIT');
      return result;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}
export async function createCommunication(recipientId, message, senderId, actor = null) {
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const communication = await createCommunicationRecord(recipientId, message, senderId, client);
      await logAdminAction(client, { action: 'Communication Queued', entity: 'communication', targetId: communication.id, actor, category: 'communication', newValues: { recipientId, status: communication.status }, description: 'Queued a student communication' });
      await client.query('COMMIT');
      return communication;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  });
}
export async function listCommunications(options = undefined) {
  return listCommunicationRecords({ query }, options);
}
