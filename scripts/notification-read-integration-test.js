import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { createUser, getDashboardData } = await import('../backend/src/services/authService.js');
const { handleApi } = await import('../backend/src/routes/catalogRoutes.js');
const { env } = await import('../backend/src/config/env.js');

const suffix = crypto.randomUUID().replaceAll('-', '');
const createdUserIds = [];
const communicationIds = [];
const complaintIds = [];
const resetRequestIds = [];
const backupIds = [];

function response() {
  return { statusCode: 200, body: '', headers: {}, writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); }, setHeader(name, value) { this.headers[name] = value; }, end(body = '') { this.body += body; } };
}
async function postAs(user, path, body = {}) {
  const url = `${env.apiBasePath}${path}`;
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = 'POST'; req.url = url; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
  const res = response();
  await handleApi(req, res, new URL(url, 'http://localhost'), { resolveCurrentUser: async () => user });
  return { status: res.statusCode, body: res.body ? JSON.parse(res.body) : null };
}
async function insertCommunication(recipientId, message) {
  const row = (await query(`INSERT INTO public.communication_outbox (recipient_id,kind,subject,body,status)
    VALUES ($1,'message','Notification integration fixture',$2,'queued') RETURNING id`, [recipientId, message])).rows[0];
  communicationIds.push(row.id);
  return row.id;
}
async function readStateCount(userId, type, sourceId) {
  return Number((await query(`SELECT count(*)::int AS count FROM public.notification_read_states
    WHERE user_id=$1 AND notification_type=$2 AND source_id=$3`, [userId, type, String(sourceId)])).rows[0].count);
}

try {
  const student = await createUser({ name: `Notification Student ${suffix}`, email: `notification-${suffix}@example.test`, studentId: `N${suffix.slice(0, 12)}`, password: 'Notification-Test-Password-123!', role: 'student', status: 'active' });
  const otherStudent = await createUser({ name: `Other Student ${suffix}`, email: `other-notification-${suffix}@example.test`, studentId: `O${suffix.slice(0, 12)}`, password: 'Notification-Test-Password-123!', role: 'student', status: 'active' });
  const regularAdmin = await createUser({ name: `Regular Admin ${suffix}`, email: `regular-notification-${suffix}@example.test`, password: 'Notification-Test-Password-123!', role: 'regular_admin', status: 'active' });
  const superAdmin = await createUser({ name: `Super Admin ${suffix}`, email: `super-notification-${suffix}@example.test`, password: 'Notification-Test-Password-123!', role: 'super_admin', status: 'active' });
  createdUserIds.push(student.id, otherStudent.id, regularAdmin.id, superAdmin.id);

  const messageId = await insertCommunication(student.id, `Unread fixture ${suffix}`);
  const notificationKey = `communication:${messageId}`;
  const keyPath = '/notifications/read';
  const marked = await postAs(student, keyPath, { notificationKey });
  assert.equal(marked.status, 200);
  assert.deepEqual(marked.body, { notification: { id: notificationKey, read: true } });
  assert.equal(await readStateCount(student.id, 'communication', messageId), 1);
  assert.equal((await getDashboardData(student)).notifications.find((item) => item.notification_key === notificationKey).read, true,
    'read state is returned on a later dashboard load');

  const duplicateResults = await Promise.all(Array.from({ length: 6 }, () => postAs(student, keyPath, { notificationKey })));
  assert(duplicateResults.every((result) => result.status === 200), 'duplicate and concurrent read requests are idempotent');
  assert.equal(await readStateCount(student.id, 'communication', messageId), 1, 'the unique state key prevents duplicates');

  const crossOwner = await postAs(otherStudent, keyPath, { notificationKey });
  assert.equal(crossOwner.status, 404, 'another student cannot read or mark the notification');
  assert.equal(await readStateCount(otherStudent.id, 'communication', messageId), 0, 'cross-owner attempts persist no state');
  const adminCrossOwner = await postAs(regularAdmin, keyPath, { notificationKey });
  assert.equal(adminCrossOwner.status, 404, 'administrators cannot mark a student-owned communication');
  const missing = await postAs(student, keyPath, { notificationKey: 'communication:123e4567-e89b-42d3-a456-426614174000' });
  assert.equal(missing.status, 404);

  const allMessageIds = [await insertCommunication(student.id, `Read-all fixture A ${suffix}`), await insertCommunication(student.id, `Read-all fixture B ${suffix}`)];
  const all = await postAs(student, '/notifications/read-all');
  assert.equal(all.status, 200);
  assert.equal(all.body.updatedCount, all.body.notificationKeys.length);
  assert(allMessageIds.every((id) => all.body.notificationKeys.includes(`communication:${id}`)));
  const refreshed = await getDashboardData(student);
  assert(refreshed.notifications.filter((item) => item.notification_key.startsWith('communication:')).every((item) => item.read),
    'read-all persists for subsequent dashboard reads');

  const complaint = (await query('INSERT INTO public.student_complaints (email,message) VALUES ($1,$2) RETURNING id', [`notification-complaint-${suffix}@example.test`, 'notification integration fixture'])).rows[0];
  complaintIds.push(complaint.id);
  const resetRequest = (await query(`INSERT INTO public.password_reset_requests (user_id,role,message,status)
    VALUES ($1,'student','notification integration fixture','open') RETURNING id`, [student.id])).rows[0];
  resetRequestIds.push(resetRequest.id);
  const backup = (await query(`INSERT INTO public.admin_backup_history (admin_user,format,scope,description)
    VALUES ($1,'json','catalog',$2) RETURNING id`, [superAdmin.name, `notification integration fixture ${suffix}`])).rows[0];
  backupIds.push(backup.id);

  const adminDashboard = await getDashboardData(superAdmin);
  const adminKeys = adminDashboard.notifications.map((item) => item.notification_key);
  assert(adminKeys.includes(`complaint:${complaint.id}`));
  assert(adminKeys.includes(`password_reset_request:${resetRequest.id}`));
  assert(adminKeys.includes(`backup:${backup.id}`));
  const adminReadAll = await postAs(superAdmin, '/notifications/read-all');
  assert.equal(adminReadAll.status, 200);
  assert(adminReadAll.body.notificationKeys.includes(`complaint:${complaint.id}`));
  assert(adminReadAll.body.notificationKeys.includes(`password_reset_request:${resetRequest.id}`));
  assert(adminReadAll.body.notificationKeys.includes(`backup:${backup.id}`), 'bigint backup IDs are supported');
  assert.equal(await readStateCount(superAdmin.id, 'complaint', complaint.id), 1);

  assert.equal((await postAs(regularAdmin, keyPath, { notificationKey: `complaint:${complaint.id}` })).status, 404,
    'regular administrators cannot mark super-admin-only complaint alerts');
  assert.equal((await postAs(regularAdmin, keyPath, { notificationKey: `password_reset_request:${resetRequest.id}` })).status, 404,
    'regular administrators cannot mark super-admin-only reset alerts');
  assert.equal(await readStateCount(regularAdmin.id, 'complaint', complaint.id), 0);
  console.log('Notification read-state PostgreSQL integration tests passed.');
} finally {
  if (backupIds.length) await query('DELETE FROM public.admin_backup_history WHERE id=ANY($1::bigint[])', [backupIds]).catch(() => {});
  if (complaintIds.length) await query('DELETE FROM public.student_complaints WHERE id=ANY($1::uuid[])', [complaintIds]).catch(() => {});
  if (resetRequestIds.length) await query('DELETE FROM public.password_reset_requests WHERE id=ANY($1::uuid[])', [resetRequestIds]).catch(() => {});
  if (communicationIds.length) await query('DELETE FROM public.communication_outbox WHERE id=ANY($1::uuid[])', [communicationIds]).catch(() => {});
  if (createdUserIds.length) await query('DELETE FROM public.app_users WHERE id=ANY($1::uuid[])', [createdUserIds]).catch(() => {});
  await closePool();
}
