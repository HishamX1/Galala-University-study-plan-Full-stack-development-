import assert from 'node:assert/strict';
import { handleAdminOperationsRequest } from '../backend/src/controllers/adminOperationsController.js';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { env } from '../backend/src/config/env.js';

function response() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body += body; }
  };
}

function request(method, pathname, body = null) {
  let reads = 0;
  return {
    method,
    url: pathname,
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    get reads() { return reads; },
    async *[Symbol.asyncIterator]() { reads += 1; if (body !== null) yield Buffer.from(body); }
  };
}

const base = `${env.apiBasePath}/admin/import`;
const admin = { id: '42a4c2d5-d927-4368-a767-5865f9f2a427', name: 'Staging Admin', role: 'regular_admin' };
const stageId = '96fd0cbb-27da-4e85-90e1-6573ab25ee24';

let importCalls = 0;
const legacyRequest = request('POST', base, '{ invalid json');
const legacyResponse = response();
assert.equal(await handleAdminOperationsRequest(legacyRequest, legacyResponse,
  new URL(base, 'http://localhost'), admin, {
    importCatalog: async () => { importCalls += 1; throw new Error('legacy importer must not run'); }
  }), true);
assert.equal(legacyRequest.reads, 0, 'legacy handler must reject before reading or parsing the request body');
assert.equal(importCalls, 0, 'legacy handler must not invoke the importer');
assert.equal(legacyResponse.statusCode, 409);
assert.deepEqual(JSON.parse(legacyResponse.body), {
  error: 'Catalog imports must be staged and reviewed before publication.',
  code: 'IMPORT_STAGING_REQUIRED'
});

const calls = [];
const operations = {
  async createImportStage(payload, user) { calls.push(['create', payload, user]); return { id: stageId, ...payload }; },
  async listImportStages(ownerId) { calls.push(['list', ownerId]); return []; },
  async getImportStage(id, ownerId) { calls.push(['get', id, ownerId]); return { id }; },
  async cancelImportStage(id, ownerId, actor) { calls.push(['cancel', id, ownerId, actor]); return { id, status: 'cancelled' }; },
  async publishImportStage(id, ownerId, version, user) { calls.push(['publish', id, ownerId, version, user]); return { outcome: 'stale', code: 'IMPORT_PREVIEW_STALE', error: 'Review again.', stage: { id, previewVersion: 2 }, diff: { catalogReferencesChanged: true, addedErrors: [], resolvedErrors: [] } }; }
};

const stageReq = request('POST', `${base}/stages`, JSON.stringify({ type: 'faculties', format: 'json', content: '[]' }));
const stageRes = response();
await handleAdminOperationsRequest(stageReq, stageRes, new URL(`${base}/stages`, 'http://localhost'), admin, operations);
assert.equal(stageRes.statusCode, 201);
assert.deepEqual(calls[0], ['create', { type: 'faculties', format: 'json', content: '[]' }, admin]);

const listRes = response();
await handleAdminOperationsRequest(request('GET', `${base}/stages`), listRes, new URL(`${base}/stages`, 'http://localhost'), admin, operations);
assert.deepEqual(calls[1], ['list', admin.id]);

const ownerGetRes = response();
await handleAdminOperationsRequest(request('GET', `${base}/stages/${stageId}`), ownerGetRes,
  new URL(`${base}/stages/${stageId}`, 'http://localhost'), admin, operations);
assert.deepEqual(calls[2], ['get', stageId, admin.id]);

const cancelRes = response();
await handleAdminOperationsRequest(request('DELETE', `${base}/stages/${stageId}`), cancelRes,
  new URL(`${base}/stages/${stageId}`, 'http://localhost'), admin, operations);
assert.deepEqual(calls[3], ['cancel', stageId, admin.id, admin]);

const staleRes = response();
await handleAdminOperationsRequest(request('POST', `${base}/stages/${stageId}/publish`, '{"previewVersion":1}'), staleRes,
  new URL(`${base}/stages/${stageId}/publish`, 'http://localhost'), admin, operations);
assert.deepEqual(calls[4], ['publish', stageId, admin.id, 1, admin]);
assert.equal(staleRes.statusCode, 409);
assert.deepEqual(JSON.parse(staleRes.body), {
  error: 'Review again.', code: 'IMPORT_PREVIEW_STALE', stage: { id: stageId, previewVersion: 2 },
  diff: { catalogReferencesChanged: true, addedErrors: [], resolvedErrors: [] }
});

const invalidIdRes = response();
await handleAdminOperationsRequest(request('GET', `${base}/stages/not-a-uuid`), invalidIdRes,
  new URL(`${base}/stages/not-a-uuid`, 'http://localhost'), admin, operations);
assert.equal(invalidIdRes.statusCode, 400);
assert.equal(calls.length, 5, 'invalid stage IDs must not reach service/repository operations');

for (const [role, expectedStatus] of [['student', 403], ['regular_admin', 401]]) {
  const routeResponse = response();
  await handleApi(request('GET', `${base}/stages`), routeResponse,
    new URL(`${base}/stages`, 'http://localhost'), {
      resolveCurrentUser: async () => role === 'regular_admin' ? null : { id: 'student-1', role }
    });
  assert.equal(routeResponse.statusCode, expectedStatus);
}

console.log('Admin import staging route compatibility and legacy no-side-effect tests passed.');
