import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { download, json, writeUnexpectedError } from '../backend/src/middleware/http.js';
import { handleCatalogUpdate } from '../backend/src/controllers/catalogController.js';
import { env } from '../backend/src/config/env.js';

function response() {
  return {
    statusCode: 200, headersSent: false, writableEnded: false, writeHeadCalls: 0, destroyCalls: 0,
    headers: {}, body: '',
    setHeader(name, value) { this.headers[name] = value; },
    writeHead(status, headers = {}) { this.writeHeadCalls += 1; this.headersSent = true; this.statusCode = status; Object.assign(this.headers, headers); },
    end(body = '') { this.body += body; this.writableEnded = true; },
    destroy() { this.destroyCalls += 1; }
  };
}

function request(pathname, body = '') {
  const req = Readable.from(body ? [Buffer.from(body)] : []);
  req.method = 'POST'; req.url = pathname; req.headers = {};
  req.socket = { remoteAddress: '127.0.0.1' };
  req.requestId = 'http-response-test';
  return req;
}

const pathname = `${env.apiBasePath}/notifications/read-all`;
const user = { id: 'test-admin', role: 'super_admin' };
const resolveCurrentUser = async () => user;

const catalogMutationResponse = response();
const mutationHandled = await handleCatalogUpdate(
  request(`${env.apiBasePath}/program-courses/12`), catalogMutationResponse,
  () => null, async () => ({ id: 12 }), 12, 'Program course', user
);
assert.equal(mutationHandled, true, 'catalog mutation response is explicitly reported as handled');
assert.equal(catalogMutationResponse.writeHeadCalls, 1);

const success = response();
await handleApi(request(pathname), success, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async (_req, res) => json(res, 200, { read: 3 })
});
assert.equal(success.writeHeadCalls, 1, 'successful async handler writes one response');
assert.equal(success.statusCode, 200);

const rejected = response();
await handleApi(request(pathname), rejected, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async () => { throw new Error('DB_UNREACHABLE'); }
});
assert.equal(rejected.writeHeadCalls, 1, 'database rejection is converted to one error response');
assert.equal(rejected.statusCode, 503);
assert.match(rejected.body, /Cannot reach PostgreSQL/);

const unexpected = response();
await handleApi(request(pathname), unexpected, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async () => { throw new Error('simulated unexpected failure'); }
});
assert.equal(unexpected.writeHeadCalls, 1, 'unexpected rejection is converted to one error response');
assert.equal(unexpected.statusCode, 500);
assert.match(unexpected.body, /unexpected error occurred/i);

const completedThenRejected = response();
await handleApi(request(pathname), completedThenRejected, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async (_req, res) => {
    json(res, 200, { read: 3 });
    throw new Error('simulated post-response failure');
  }
});
assert.equal(completedThenRejected.writeHeadCalls, 1, 'post-response failure does not provoke a second response');
assert.equal(completedThenRejected.statusCode, 200, 'completed success remains intact');
assert.deepEqual(JSON.parse(completedThenRejected.body), { read: 3 });

const partialThenRejected = response();
await handleApi(request(pathname), partialThenRejected, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    throw new Error('simulated failure after headers');
  }
});
assert.equal(partialThenRejected.writeHeadCalls, 1, 'partial response is not followed by an error response');
assert.equal(partialThenRejected.destroyCalls, 1, 'incomplete response is terminated after headers were sent');

const duplicateAttempt = response();
await handleApi(request(pathname), duplicateAttempt, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async (_req, res) => {
    json(res, 200, { read: 3 });
    json(res, 200, { read: 4 });
  }
});
assert.equal(duplicateAttempt.writeHeadCalls, 1, 'shared JSON writer rejects a duplicate response before a second write');
assert.equal(duplicateAttempt.statusCode, 200);

const fileDownload = response();
assert.equal(download(fileDownload, { mimeType: 'application/octet-stream', filename: 'catalog.json', content: 'data' }), true);
assert.equal(fileDownload.writeHeadCalls, 1, 'download helper writes one response');
assert.equal(fileDownload.headers['Content-Disposition'], 'attachment; filename="catalog.json"');

const denied = response();
const catalogPath = `${env.apiBasePath}/program-courses/12`;
await handleApi(request(catalogPath), denied, new URL(catalogPath, 'http://localhost'), {
  resolveCurrentUser: async () => ({ id: 'student-1', role: 'student' })
});
assert.equal(denied.writeHeadCalls, 1, 'authorization failure writes one response');
assert.equal(denied.statusCode, 403);

const csrfDenied = response();
const csrfPath = `${env.apiBasePath}/program-courses`;
const csrfRequest = request(csrfPath, '{}');
csrfRequest.headers.cookie = 'gu_access=present';
await handleApi(csrfRequest, csrfDenied, new URL(csrfPath, 'http://localhost'), {
  resolveCurrentUser: async () => { throw new Error('CSRF rejection must happen before authentication'); }
});
assert.equal(csrfDenied.statusCode, 403, 'cookie-authenticated mutation without an approved origin is denied');
assert.equal(csrfDenied.writeHeadCalls, 1);

const malformed = response();
const malformedPath = `${env.apiBasePath}/program-courses`;
await handleApi(request(malformedPath, '{'), malformed, new URL(malformedPath, 'http://localhost'), { resolveCurrentUser });
assert.equal(malformed.statusCode, 400, 'malformed request JSON is a single validation response');
assert.equal(malformed.writeHeadCalls, 1);

const oversizedNotification = response();
await handleApi(request(pathname), oversizedNotification, new URL(pathname, 'http://localhost'), {
  resolveCurrentUser,
  dashboardHandler: async () => { throw new Error('PAYLOAD_TOO_LARGE'); }
});
assert.equal(oversizedNotification.statusCode, 413);
assert.equal(oversizedNotification.writeHeadCalls, 1);
assert.match(oversizedNotification.body, /Request body is too large/);

const unknownRoute = response();
const missingPath = `${env.apiBasePath}/program-courses/not-a-route`;
await handleApi(request(missingPath), unknownRoute, new URL(missingPath, 'http://localhost'), { resolveCurrentUser });
assert.equal(unknownRoute.statusCode, 404, 'unmatched route inside an authorized API area gets one 404');
assert.equal(unknownRoute.writeHeadCalls, 1);

const outerBoundary = response();
assert.equal(writeUnexpectedError(outerBoundary, 'outer-boundary-test'), true);
assert.equal(outerBoundary.statusCode, 500);
assert.equal(outerBoundary.writeHeadCalls, 1, 'server boundary writes one response for an unexpected request failure');
assert.equal(writeUnexpectedError(outerBoundary, 'outer-boundary-test'), false);
assert.equal(outerBoundary.writeHeadCalls, 1, 'server boundary leaves an already completed response alone');

console.log('HTTP response boundary success, rejection, and post-completion failure cases passed.');
