import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const stored = new Map();
globalThis.window = {
  __GU_API_BASE__: 'http://localhost:4000/api',
  location: { origin: 'http://localhost:4000', hostname: 'localhost', port: '4000', protocol: 'http:', search: '' }
};
globalThis.localStorage = {
  getItem: (key) => stored.get(key) || null,
  setItem: (key, value) => stored.set(key, value)
};
globalThis.sessionStorage = {
  getItem: (key) => stored.get(key) || null,
  setItem: (key, value) => stored.set(key, value),
  removeItem: (key) => stored.delete(key)
};
globalThis.document = { querySelector: () => null };
globalThis.location = { href: 'https://example.test/student/index.html', replaced: null, replace(path) { this.replaced = path; } };

const { restoreSession, clearAuthenticatedState, signOut } = await import(`../frontend/shared/session.js?session-test=${Date.now()}`);
const activeUser = { id: '8a2e9e40-f279-43de-a90c-9d706bf1cf99', role: 'student', status: 'active', name: 'Test Student' };
const response = (status, body = {}) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
const setFetch = (fn) => { globalThis.fetch = fn; };

clearAuthenticatedState();
let calls = 0;
setFetch(async () => { calls += 1; return response(200, { user: activeUser }); });
assert.deepEqual(await restoreSession(), activeUser, 'valid access sessions use the current /auth/me user');
assert.equal(calls, 1, 'valid access sessions are validated with one backend round trip');
await restoreSession();
assert.equal(calls, 2, 'a completed restoration is not memoized; later callers revalidate with the backend');

clearAuthenticatedState();
const refreshCalls = [];
setFetch(async (url) => {
  refreshCalls.push(String(url));
  return String(url).endsWith('/auth/me') ? response(401) : response(200, { user: activeUser });
});
assert.deepEqual(await restoreSession(), activeUser, 'a successful refresh returns its public user');
assert.equal(refreshCalls.length, 2, 'expired access sessions restore with /auth/me plus /auth/refresh only');
assert.match(refreshCalls.at(-1), /\/auth\/refresh$/);
assert.equal(stored.get('guAuthenticatedUser'), JSON.stringify(activeUser));

clearAuthenticatedState();
let releaseFirstFetch;
let concurrentCalls = 0;
setFetch(() => {
  concurrentCalls += 1;
  return new Promise((resolve) => { releaseFirstFetch = () => resolve(response(200, { user: activeUser })); });
});
const restores = Array.from({ length: 6 }, () => restoreSession());
await Promise.resolve();
assert.equal(concurrentCalls, 1, 'simultaneous restore callers share one in-flight validation');
releaseFirstFetch();
assert.deepEqual(await Promise.all(restores), Array.from({ length: 6 }, () => activeUser));

clearAuthenticatedState();
let releaseAfterClear;
setFetch(() => new Promise((resolve) => { releaseAfterClear = () => resolve(response(200, { user: activeUser })); }));
const clearedRestore = restoreSession();
await Promise.resolve();
clearAuthenticatedState();
releaseAfterClear();
assert.equal(await clearedRestore, null, 'a cleared in-flight restoration cannot repopulate client session state');
assert.equal(stored.has('guAuthenticatedUser'), false);

clearAuthenticatedState();
let failureCalls = 0;
setFetch(async (url) => {
  failureCalls += 1;
  return String(url).endsWith('/auth/me') ? response(401) : response(200, { user: { ...activeUser, status: 'suspended' } });
});
assert.equal(await restoreSession(), null, 'malformed or inactive refresh users fail closed');
assert.equal(stored.has('guAuthenticatedUser'), false);
assert.ok(failureCalls >= 4, 'failed first-origin restoration preserves API candidate fallback');

stored.set('guAuthenticatedUser', JSON.stringify(activeUser));
clearAuthenticatedState();
stored.set('guAuthenticatedUser', JSON.stringify(activeUser));
setFetch(async () => { throw new TypeError('Failed to fetch'); });
assert.deepEqual(await restoreSession(), { unavailable: true, user: activeUser }, 'network errors are distinct from a definitive invalid session');
assert.equal(stored.get('guAuthenticatedUser'), JSON.stringify(activeUser), 'temporary network failures preserve cached display state without treating it as authentication');
clearAuthenticatedState();
setFetch(async () => { throw new TypeError('Failed to fetch'); });
assert.deepEqual(await restoreSession(), { unavailable: true, user: null }, 'no prior user is still distinct from an invalid session during an outage');
const studentPage = await readFile(new URL('../frontend/student/student.js', import.meta.url), 'utf8');
const adminAuth = await readFile(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8');
assert.match(studentPage, /if \(authenticatedUser\?\.unavailable\)[\s\S]*?if \(!authenticatedUser\) \{[\s\S]*?location\.replace\('\.\.\/student-login\.html'\)/,
  'students with expired or revoked refresh sessions retain the student-login redirect');
assert.match(adminAuth, /sessionExpiredRole: window\.__GU_ADMIN_ROLE__ \|\| 'regular_admin'/,
  'administrators with expired or revoked sessions return home with an administrator-specific message');
assert.match(adminAuth, /withAdminLoading\('Verifying your administrator session…'[\s\S]*?startInactivityTimeout\(user, '\.\.\/index\.html'\)/,
  'restored administrator sessions start the shared inactivity timer');

clearAuthenticatedState();
let logoutCalls = 0;
setFetch(async (url) => {
  logoutCalls += 1;
  assert.match(String(url), /\/auth\/logout$/);
  return response(204);
});
stored.set('guAuthenticatedUser', JSON.stringify(activeUser));
await signOut('../index.html');
assert.equal(logoutCalls, 1);
assert.equal(stored.has('guAuthenticatedUser'), false, 'logout clears cached public user data');
assert.equal(globalThis.location.replaced, 'https://example.test/index.html');

globalThis.location.replaced = null;
setFetch(async () => { throw new TypeError('Failed to fetch'); });
await signOut('../index.html');
assert.match(globalThis.location.replaced, /logout=server-unconfirmed/, 'offline logout does not claim server-side revocation');

console.log('Session restoration tests passed (backend validation, refresh round trips, coalescing, clearing, fallback, and logout).');
