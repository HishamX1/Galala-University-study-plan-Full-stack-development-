import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { handleDashboardRequest } from '../backend/src/controllers/dashboardController.js';
import { handleAdminSupportRequest, handleAdminUserRequest } from '../backend/src/controllers/adminUserController.js';
import { handleAdminOperationsRequest } from '../backend/src/controllers/adminOperationsController.js';
import { env } from '../backend/src/config/env.js';

function response() {
  return {
    statusCode: 200,
    writeHeadCalls: 0,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.writeHeadCalls += 1; this.statusCode = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body += body; }
  };
}

function request(method, pathname, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = pathname;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  return req;
}

async function assertResponse(handler, req, pathname, expectedStatus, expectedBody) {
  const res = response();
  const handled = await handler(req, res, new URL(pathname, 'http://localhost'), { id: 'user-1', role: 'student' });
  assert.notEqual(handled, false);
  assert.equal(res.statusCode, expectedStatus);
  assert.deepEqual(JSON.parse(res.body), expectedBody);
  return handled;
}

const admin = { id: 'admin-1', role: 'regular_admin' };

let dashboardServicesStarted = 0;
const startDashboardService = (value) => async () => {
  dashboardServicesStarted += 1;
  return Promise.resolve(value).then((result) => {
    assert.equal(dashboardServicesStarted, 3, 'all dashboard service reads start before any one is awaited');
    return result;
  });
};
const dashboardResponse = response();
const superAdmin = { id: 'super-admin-1', role: 'super_admin' };
await handleDashboardRequest(
  request('GET', `${env.apiBasePath}/dashboard`), dashboardResponse,
  new URL(`${env.apiBasePath}/dashboard`, 'http://localhost'), superAdmin,
  {
    getDashboardData: startDashboardService({ profile: { id: superAdmin.id } }),
    getDashboardSummary: startDashboardService({ counts: { courses: 4 } }),
    getSystemHealth: startDashboardService({ backendStatus: 'green' })
  }
);
assert.equal(dashboardResponse.statusCode, 200);
assert.deepEqual(JSON.parse(dashboardResponse.body), {
  profile: { id: superAdmin.id },
  catalog: { counts: { courses: 4 } },
  systemHealth: { backendStatus: 'green' }
});

await assertResponse(
  handleDashboardRequest,
  request('POST', `${env.apiBasePath}/student/complaints`, JSON.stringify({ message: '  ' })),
  `${env.apiBasePath}/student/complaints`, 400, { error: 'A complaint message is required.' }
);
assert.equal(await assertResponse(
  handleAdminSupportRequest,
  request('POST', `${env.apiBasePath}/admin/communications`, JSON.stringify({ recipientId: 'user-2', message: ' ' })),
  `${env.apiBasePath}/admin/communications`, 400, { error: 'Recipient and message are required.' }
), true);
assert.equal(await assertResponse(
  handleAdminUserRequest,
  request('POST', `${env.apiBasePath}/admin/users`, JSON.stringify({ name: 'A' })),
  `${env.apiBasePath}/admin/users`, 400,
  { error: 'Name, email, password, and a valid role are required' }
), true);
assert.equal(await assertResponse(
  handleAdminUserRequest,
  request('POST', `${env.apiBasePath}/admin/users/user-2/reset-password`, JSON.stringify({ password: 'one', confirmPassword: 'two' })),
  `${env.apiBasePath}/admin/users/user-2/reset-password`, 400, { error: 'Passwords must match.' }
), true);
assert.equal(await assertResponse(
  handleAdminOperationsRequest,
  request('POST', `${env.apiBasePath}/admin/recycle-bin/faculties/0/restore`),
  `${env.apiBasePath}/admin/recycle-bin/faculties/0/restore`, 400,
  { error: 'Invalid faculties id' }
), true);

const auditSuccess = response();
assert.equal(await handleAdminOperationsRequest(
  request('GET', `${env.apiBasePath}/admin/audit-logs?range=week&entity=course`),
  auditSuccess,
  new URL(`${env.apiBasePath}/admin/audit-logs?range=week&entity=course`, 'http://localhost'),
  admin,
  { getAuditLogs: async (filters) => {
    assert.deepEqual(filters, { range: 'week', entity: 'course', action: '', search: '', order: 'newest', category: '', actorId: admin.id, actor: '', from: '', to: '', limit: undefined, offset: undefined });
    return [{ id: 7, action: 'Updated Course' }];
  } }
), true);
assert.equal(auditSuccess.statusCode, 200);
assert.deepEqual(JSON.parse(auditSuccess.body), [{ id: 7, action: 'Updated Course' }]);

const missingBackup = response();
await handleAdminOperationsRequest(
  request('GET', `${env.apiBasePath}/admin/backups/99/download`),
  missingBackup,
  new URL(`${env.apiBasePath}/admin/backups/99/download`, 'http://localhost'),
  admin,
  { getBackupDownload: async () => null }
);
assert.equal(missingBackup.statusCode, 404);
assert.deepEqual(JSON.parse(missingBackup.body), { error: 'Backup not found' });

let currentUserCalls = 0;
const resolveCurrentUser = async () => { currentUserCalls += 1; return { id: 'student-1', role: 'student' }; };
const unauthenticated = response();
await handleApi(request('GET', `${env.apiBasePath}/admin/users`), unauthenticated,
  new URL(`${env.apiBasePath}/admin/users`, 'http://localhost'), { resolveCurrentUser: async () => null });
assert.equal(unauthenticated.statusCode, 401);
assert.deepEqual(JSON.parse(unauthenticated.body), { error: 'Authentication required' });

const forbidden = response();
await handleApi(request('GET', `${env.apiBasePath}/admin/recycle-bin`), forbidden,
  new URL(`${env.apiBasePath}/admin/recycle-bin`, 'http://localhost'), { resolveCurrentUser });
assert.equal(forbidden.statusCode, 403);
assert.deepEqual(JSON.parse(forbidden.body), { error: 'You do not have permission to access this resource' });
assert.equal(currentUserCalls, 1);

const regularAdminAudit = response();
const regularAdmin = { id: 'regular-admin-1', role: 'regular_admin' };
assert.equal(await handleAdminOperationsRequest(
  request('GET', `${env.apiBasePath}/admin/audit-logs?actorId=00000000-0000-4000-8000-000000000002`), regularAdminAudit,
  new URL(`${env.apiBasePath}/admin/audit-logs?actorId=00000000-0000-4000-8000-000000000002`, 'http://localhost'), regularAdmin,
  { getAuditLogs: async (filters) => { assert.equal(filters.actorId, regularAdmin.id, 'regular admins are forcibly scoped to their own activity'); return []; } }
), true);
assert.equal(regularAdminAudit.statusCode, 200);

const supportPage = response();
assert.equal(await handleAdminSupportRequest(
  request('GET', `${env.apiBasePath}/admin/complaints?limit=25&offset=50`), supportPage,
  new URL(`${env.apiBasePath}/admin/complaints?limit=25&offset=50`, 'http://localhost'), admin,
  { listComplaints: async (page) => {
    assert.deepEqual(page, { limit: '25', offset: '50' });
    return { items: [{ id: 'complaint-51' }], total: 61, limit: 25, offset: 50 };
  } }
), true);
assert.equal(supportPage.statusCode, 200);
assert.deepEqual(JSON.parse(supportPage.body), { complaints: [{ id: 'complaint-51' }], page: { limit: 25, offset: 50, total: 61 } });

const invalidSupportPage = response();
await handleAdminSupportRequest(
  request('GET', `${env.apiBasePath}/admin/complaints?limit=101`), invalidSupportPage,
  new URL(`${env.apiBasePath}/admin/complaints?limit=101`, 'http://localhost'), admin,
  { listComplaints: async () => { throw new Error('Invalid request must not reach the list query'); } }
);
assert.equal(invalidSupportPage.statusCode, 400);
assert.deepEqual(JSON.parse(invalidSupportPage.body), { error: 'Invalid complaint page.' });

const communicationsPage = response();
assert.equal(await handleAdminSupportRequest(
  request('GET', `${env.apiBasePath}/admin/communications?limit=50&offset=100`), communicationsPage,
  new URL(`${env.apiBasePath}/admin/communications?limit=50&offset=100`, 'http://localhost'), admin,
  { listCommunications: async (page) => {
    assert.deepEqual(page, { limit: '50', offset: '100' });
    return { items: [{ id: 'communication-101' }], total: 111, limit: 50, offset: 100 };
  } }
), true);
assert.deepEqual(JSON.parse(communicationsPage.body), { communications: [{ id: 'communication-101' }], page: { limit: 50, offset: 100, total: 111 } });

const legacyCommunications = response();
await handleAdminSupportRequest(request('GET', `${env.apiBasePath}/admin/communications`), legacyCommunications,
  new URL(`${env.apiBasePath}/admin/communications`, 'http://localhost'), admin,
  { listCommunications: async (page) => { assert.equal(page, undefined); return [{ id: 'legacy-communication' }]; } });
assert.deepEqual(JSON.parse(legacyCommunications.body), { communications: [{ id: 'legacy-communication' }] });

const legacyComplaints = response();
await handleAdminSupportRequest(request('GET', `${env.apiBasePath}/admin/complaints`), legacyComplaints,
  new URL(`${env.apiBasePath}/admin/complaints`, 'http://localhost'), admin,
  { listComplaints: async (page) => { assert.equal(page, undefined); return [{ id: 'legacy-complaint' }]; } });
assert.deepEqual(JSON.parse(legacyComplaints.body), { complaints: [{ id: 'legacy-complaint' }] });

const options = response();
await handleApi(request('OPTIONS', `${env.apiBasePath}/admin/users`), options,
  new URL(`${env.apiBasePath}/admin/users`, 'http://localhost'), { resolveCurrentUser });
assert.equal(options.statusCode, 204);
assert.equal(currentUserCalls, 1, 'preflight must finish before authentication');

const originDenied = response();
const badOriginRequest = request('GET', `${env.apiBasePath}/admin/users`);
badOriginRequest.headers.origin = 'https://untrusted.invalid';
await handleApi(badOriginRequest, originDenied,
  new URL(`${env.apiBasePath}/admin/users`, 'http://localhost'), { resolveCurrentUser });
assert.equal(originDenied.statusCode, 403);
assert.deepEqual(JSON.parse(originDenied.body), { error: 'Origin is not allowed' });
assert.equal(currentUserCalls, 1, 'origin rejection must happen before authentication');

const adminValidation = response();
await handleApi(request('POST', `${env.apiBasePath}/admin/users`, JSON.stringify({ name: 'A' })), adminValidation,
  new URL(`${env.apiBasePath}/admin/users`, 'http://localhost'), {
    resolveCurrentUser: async () => ({ id: 'super-admin-1', role: 'super_admin' })
  });
assert.equal(adminValidation.statusCode, 400);
assert.equal(adminValidation.writeHeadCalls, 1, 'controller-handled admin response must stop route dispatch');
assert.deepEqual(JSON.parse(adminValidation.body), { error: 'Name, email, password, and a valid role are required' });

console.log('Admin route/controller compatibility tests passed.');
