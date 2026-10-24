import assert from 'node:assert/strict';

globalThis.window = { __GU_API_BASE__: 'http://localhost:4000/api', location: { hostname: 'localhost', port: '4000', protocol: 'http:', search: '', assigned: [], assign(path) { this.assigned.push(path); } } };
globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.document = { querySelector: () => null };
const { request } = await import(`../frontend/admin/modules/apiClient.js?api-contract=${Date.now()}`);
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300,
  headers: { get: (key) => key === 'content-type' ? 'application/json' : key === 'x-request-id' ? 'request-12345678' : '' },
  json: async () => body });

let calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response(200, { ok: true }); };
assert.deepEqual(await request('/catalog'), { ok: true });
assert.equal(calls.length, 1);

calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return calls.length === 1 ? response(401) : response(200, { user: { id: 'u1', role: 'regular_admin', status: 'active' } }); };
assert.equal((await request('/auth/me')).user.role, 'regular_admin');
assert.equal(calls.length, 2, 'validated refresh user avoids a redundant second /auth/me request');

calls = [];
globalThis.fetch = async (url, options) => {
  calls.push(String(url));
  if (String(url).endsWith('/auth/refresh')) return response(200, { user: { id: 'u1', role: 'regular_admin', status: 'active' } });
  return calls.filter((item) => item.endsWith('/auth/refresh')).length ? response(200, { ok: true }) : response(401);
};
await Promise.all([request('/admin/one'), request('/admin/two')]);
assert.equal(calls.filter((item) => item.endsWith('/auth/refresh')).length, 1, 'concurrent 401 responses share one refresh rotation');

calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return response(403, { error: 'Forbidden', code: 'AUTHORIZATION_ERROR' }); };
await assert.rejects(request('/admin/reports'), (error) => error.status === 403 && error.code === 'AUTHORIZATION_ERROR');
assert.equal(window.location.assigned.length, 0, '403 never triggers login redirection');

calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return calls.length === 1 ? response(401, { error: 'Expired' }) : response(401, { error: 'Expired', code: 'AUTHENTICATION_ERROR' });
};
await assert.rejects(request('/admin/catalog'), (error) => error.status === 401 && error.definitiveAuthFailure);
assert.equal(calls.length, 2, 'one safe session refresh occurs after 401');
assert.equal(window.location.assigned.length, 1, 'redirect requires definitive refresh 401');

calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); return calls.length === 1 ? response(401) : response(200, { user: { id: 'u1', role: 'regular_admin', status: 'active' } }); };
await assert.rejects(request('/program-courses/3/prerequisites', { method: 'POST', body: '{}' }), (error) => error.code === 'AUTH_REFRESHED_OPERATION_NOT_REPLAYED');
assert.equal(calls.length, 2, 'mutations are not automatically replayed after token refresh');

calls = [];
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  return calls.length === 1 ? response(401) : response(503, { code: 'DATABASE_ERROR' });
};
await assert.rejects(request('/admin/catalog'), (error) => error.status === 503 && error.code === 'AUTH_SERVICE_UNAVAILABLE');
assert.equal(window.location.assigned.length, 1, 'refresh 503 does not log out');

calls = [];
globalThis.fetch = async (url, options) => { calls.push(String(url)); return calls.length === 1 ? response(401) : response(403, { code: 'AUTH_REFRESH_FORBIDDEN' }); };
await assert.rejects(request('/admin/catalog'), (error) => error.status === 403 && error.code === 'AUTH_REFRESH_FORBIDDEN');
assert.equal(window.location.assigned.length, 1, 'refresh 403 remains authorization failure');

globalThis.fetch = async () => response(503, { error: 'Unavailable', code: 'DATABASE_ERROR' });
await assert.rejects(request('/admin/catalog'), (error) => error.status === 503 && error.code === 'DATABASE_ERROR');
assert.equal(window.location.assigned.length, 1, 'server errors do not log out');

globalThis.fetch = async () => ({ status: 200, ok: true, headers: { get: () => 'text/html' }, json: async () => ({}) });
await assert.rejects(request('/admin/catalog'), (error) => error.code === 'INVALID_API_RESPONSE');

calls = [];
globalThis.fetch = async (url, options) => { calls.push({ url: String(url), options }); throw new TypeError('Failed to fetch'); };
await assert.rejects(request('/program-courses/3/prerequisites', { method: 'POST', body: '{"prerequisiteCourseId":4}' }), (error) => error.code === 'API_NETWORK_ERROR');
assert.equal(calls.length, 1, 'a failed state-changing request is never replayed');
assert.equal(window.location.assigned.length, 1, 'network failure does not log out');

const originalSetTimeout = globalThis.setTimeout;
const originalClearTimeout = globalThis.clearTimeout;
globalThis.setTimeout = (callback, delay) => { if (delay === 15_000) queueMicrotask(callback); return { delay }; };
globalThis.clearTimeout = () => {};
globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
await assert.rejects(request('/admin/catalog'), (error) => error.code === 'REQUEST_TIMEOUT');
globalThis.setTimeout = originalSetTimeout;
globalThis.clearTimeout = originalClearTimeout;

globalThis.fetch = async () => response(409, { error: 'Stale', code: 'STALE_WRITE', requestId: 'req-abcdef12' });
await assert.rejects(request('/program-courses/3', { method: 'PUT', body: '{}' }), (error) => error.status === 409 && error.code === 'STALE_WRITE' && error.requestId === 'req-abcdef12');
console.log('Admin API error classification, refresh, and no-replay contracts passed.');
