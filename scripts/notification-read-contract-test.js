import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Readable } from 'node:stream';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { handleDashboardRequest } from '../backend/src/controllers/dashboardController.js';
import { markNotificationRead } from '../backend/src/services/authService.js';
import { env } from '../backend/src/config/env.js';

function response() {
  return { statusCode: 200, headers: {}, body: '', writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); }, setHeader(name, value) { this.headers[name] = value; }, end(body = '') { this.body += body; } };
}
function request(method, pathname, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method; req.url = pathname; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}
async function invoke(path, body, user, services = {}) {
  const req = request('POST', `${env.apiBasePath}${path}`, body);
  const res = response();
  const url = new URL(req.url, 'http://localhost');
  const handled = await handleDashboardRequest(req, res, url, user, services);
  assert.equal(handled, undefined);
  return res;
}

let serviceCalls = 0;
const student = { id: 'student-1', role: 'student' };
const malformed = await invoke('/notifications/read', '{}', student, { markNotificationRead: async () => { serviceCalls += 1; } });
assert.equal(malformed.statusCode, 400);
assert.deepEqual(JSON.parse(malformed.body), { error: 'A notification key is required.' });
assert.equal(serviceCalls, 0);

const valid = await invoke('/notifications/read', JSON.stringify({ notificationKey: 'communication:123e4567-e89b-42d3-a456-426614174000' }), student, {
  markNotificationRead: async (user, key) => { serviceCalls += 1; assert.equal(user.id, student.id); return { id: key, read: true }; }
});
assert.equal(valid.statusCode, 200);
assert.deepEqual(JSON.parse(valid.body), { notification: { id: 'communication:123e4567-e89b-42d3-a456-426614174000', read: true } });

const all = await invoke('/notifications/read-all', '{}', student, {
  markAllDashboardNotificationsRead: async (user) => { assert.equal(user.id, student.id); return { notificationKeys: ['communication:123e4567-e89b-42d3-a456-426614174000'], updatedCount: 1 }; }
});
assert.equal(all.statusCode, 200);
assert.deepEqual(JSON.parse(all.body), { notificationKeys: ['communication:123e4567-e89b-42d3-a456-426614174000'], updatedCount: 1 });
await assert.rejects(() => markNotificationRead(student, 'not-a-notification-key'), { status: 400, code: 'VALIDATION_ERROR' });

for (const path of ['/notifications/read', '/notifications/read-all']) {
  const unauthenticated = response();
  const req = request('POST', `${env.apiBasePath}${path}`, '{}');
  await handleApi(req, unauthenticated, new URL(req.url, 'http://localhost'), { resolveCurrentUser: async () => null });
  assert.equal(unauthenticated.statusCode, 401, `${path} rejects unauthenticated requests`);

  const noDashboardPermission = response();
  const forbiddenRequest = request('POST', `${env.apiBasePath}${path}`, '{}');
  await handleApi(forbiddenRequest, noDashboardPermission, new URL(forbiddenRequest.url, 'http://localhost'), {
    resolveCurrentUser: async () => ({ id: 'unknown-1', role: 'unknown' })
  });
  assert.equal(noDashboardPermission.statusCode, 403, `${path} requires dashboard permission`);

  const authorized = response();
  const authorizedRequest = request('POST', `${env.apiBasePath}${path}`, path.endsWith('read-all') ? '{}' : JSON.stringify({ notificationKey: 'communication:123e4567-e89b-42d3-a456-426614174000' }));
  await handleApi(authorizedRequest, authorized, new URL(authorizedRequest.url, 'http://localhost'), {
    resolveCurrentUser: async () => student,
    dashboardHandler: (req, res, url, user) => handleDashboardRequest(req, res, url, user, {
      markNotificationRead: async (actor, key) => ({ id: key, read: actor.id === student.id }),
      markAllDashboardNotificationsRead: async (actor) => ({ notificationKeys: actor.id === student.id ? ['communication:123e4567-e89b-42d3-a456-426614174000'] : [], updatedCount: 1 })
    })
  });
  assert.equal(authorized.statusCode, 200, `${path} accepts a dashboard-authorized student`);
}

const frontend = fs.readFileSync(new URL('../frontend/dashboard.js', import.meta.url), 'utf8');
assert.match(frontend, /data-notification-action="one"/);
assert.match(frontend, /data-notification-action="all"/);
assert.match(frontend, /role="status" aria-live="polite"/);
assert.match(frontend, /await api\('\/notifications\/read'/);
assert.match(frontend, /applyReadState\(\[result\.notification\.id\]\)/);
assert.match(frontend, /await api\('\/notifications\/read-all'/);
assert.match(frontend, /catch \(error\)[\s\S]*Your unread notification state has not been changed/);

console.log('Notification read-state controller, route authorization, and UI contracts passed.');
