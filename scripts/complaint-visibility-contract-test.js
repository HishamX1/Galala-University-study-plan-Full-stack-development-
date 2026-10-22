import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { handleAdminSupportRequest } from '../backend/src/controllers/adminUserController.js';
import { listResetRequests } from '../backend/src/repositories/recoveryRepository.js';
import { env } from '../backend/src/config/env.js';

const complaintId = 'b36f5cb5-67a1-44cc-b756-5aa8fdf34a30';
const assigneeId = '1e2ed17d-8f6e-49ac-86b9-e71100436a72';

function makeResponse() {
  return {
    statusCode: 200, body: '', headers: {},
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body += body; }
  };
}

function makeRequest(method, path, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = method;
  req.url = path;
  req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  req.requestId = 'request-test-4';
  return req;
}

let detailCalls = 0;
let assignmentCall;
const detailRes = makeResponse();
assert.equal(await handleAdminSupportRequest(
  makeRequest('GET', `${env.apiBasePath}/admin/complaints/${complaintId}`), detailRes,
  new URL(`${env.apiBasePath}/admin/complaints/${complaintId}`, 'http://localhost'),
  { id: 'super-admin', role: 'super_admin' },
  { getComplaintDetails: async (id) => { detailCalls += 1; assert.equal(id, complaintId); return { complaint: { id }, history: [] }; } }
), true);
assert.equal(detailCalls, 1);
assert.equal(detailRes.statusCode, 200);
assert.deepEqual(JSON.parse(detailRes.body), { complaint: { id: complaintId }, history: [] });

const missingDetail = makeResponse();
await handleAdminSupportRequest(
  makeRequest('GET', `${env.apiBasePath}/admin/complaints/${complaintId}`), missingDetail,
  new URL(`${env.apiBasePath}/admin/complaints/${complaintId}`, 'http://localhost'),
  { id: 'super-admin', role: 'super_admin' },
  { getComplaintDetails: async () => null }
);
assert.equal(missingDetail.statusCode, 404);
assert.deepEqual(JSON.parse(missingDetail.body), { error: 'Complaint not found.' });

const assignRes = makeResponse();
assert.equal(await handleAdminSupportRequest(
  makeRequest('POST', `${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, JSON.stringify({ assigneeId })), assignRes,
  new URL(`${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, 'http://localhost'),
  { id: 'super-admin', role: 'super_admin', name: 'Reviewer' },
  { assignComplaint: async (...args) => { assignmentCall = args; return { id: complaintId, assigned_to: assigneeId }; } }
), true);
assert.equal(assignRes.statusCode, 200);
assert.equal(assignmentCall[0], complaintId);
assert.equal(assignmentCall[1], assigneeId);
assert.equal(assignmentCall[2].id, 'super-admin');
assert.equal(assignmentCall[2].requestId, 'request-test-4');

const invalidAssignment = makeResponse();
let invalidAssignmentCalled = false;
await handleAdminSupportRequest(
  makeRequest('POST', `${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, JSON.stringify({ assigneeId: 'student-1' })), invalidAssignment,
  new URL(`${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, 'http://localhost'),
  { id: 'super-admin', role: 'super_admin' },
  { assignComplaint: async () => { invalidAssignmentCalled = true; } }
);
assert.equal(invalidAssignment.statusCode, 400);
assert.equal(invalidAssignmentCalled, false, 'invalid assignee input must not reach the service');

for (const [role, expectedStatus] of [['student', 403], ['regular_admin', 403]]) {
  for (const [method, path, body] of [
    ['GET', `${env.apiBasePath}/admin/complaints/${complaintId}`, ''],
    ['POST', `${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, JSON.stringify({ assigneeId })]
  ]) {
    const response = makeResponse();
    await handleApi(makeRequest(method, path, body), response,
      new URL(path, 'http://localhost'),
      { resolveCurrentUser: async () => ({ id: `${role}-1`, role }) });
    assert.equal(response.statusCode, expectedStatus, `${role} is denied ${method} ${path}`);
  }
}

const unauthenticated = makeResponse();
await handleApi(makeRequest('POST', `${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, JSON.stringify({ assigneeId })), unauthenticated,
  new URL(`${env.apiBasePath}/admin/complaints/${complaintId}/assignment`, 'http://localhost'),
  { resolveCurrentUser: async () => null });
assert.equal(unauthenticated.statusCode, 401, 'complaint assignment requires authentication');

const [adminUi, adminOps, adminHtml] = await Promise.all([
  readFile(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin/modules/adminOps.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/admin/index.html', import.meta.url), 'utf8')
]);
assert.match(adminUi, /submitted_name\s*\|\|\s*item\.current_submitter_name\s*\|\|\s*'Historical identity unavailable'/);
assert.match(adminUi, /last_modified_by_name/);
assert.match(adminUi, /assigned_by_name/);
assert.match(adminUi, /decided_by_name/);
assert.match(adminUi, /decided_at/);
assert.match(adminUi, /showModal\(\)/);
assert.match(adminUi, /new URLSearchParams\(window\.location\.search\)/);
assert.match(adminOps, /supportRequestHref/);
assert.match(adminOps, /tab:\s*'requests'/);
assert.match(adminHtml, /data-admin-panel="requests"[^>]*data-super-admin/);
assert.match(adminHtml, /complaintDetailDialog/);

let resetRequestSql = '';
await listResetRequests({ query: async (sql) => { resetRequestSql = sql; return { rows: [] }; } });
assert.match(resetRequestSql, /LEFT JOIN public\.app_users decider ON decider\.id=r\.decided_by/);
assert.match(resetRequestSql, /decider\.name AS decided_by_name/);

console.log('Complaint visibility authorization and UI contract tests passed.');
