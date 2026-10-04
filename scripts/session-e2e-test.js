import crypto from 'node:crypto';
import http from 'node:http';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { createUser } from '../backend/src/services/authService.js';
import { closePool, query } from '../backend/src/db/client.js';

if (process.env.NODE_ENV === 'production') throw new Error('Session lifecycle tests must not run in production.');

const origin = 'http://127.0.0.1:5500';
const suffix = crypto.randomUUID();
const password = 'SessionPass!2026';
const userIds = [];
let server;

function request(port, path, method = 'GET', body, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

try {
  const users = [
    { role: 'student', endpoint: '/api/auth/student-login', refreshAge: 7 * 86400 },
    { role: 'regular_admin', endpoint: '/api/auth/admin-login', refreshAge: 7 * 86400 },
    { role: 'super_admin', endpoint: '/api/auth/admin-login', refreshAge: 90 * 86400 }
  ];
  for (const item of users) {
    const email = `session-e2e-${item.role}-${suffix}@example.test`;
    const user = await createUser({ name: `Session E2E ${item.role}`, email, studentId: `SESSION-${suffix}-${item.role}`, password, role: item.role, status: 'active' });
    userIds.push(user.id);
    item.email = email;
  }
  server = http.createServer(async (req, res) => {
    const handled = await handleApi(req, res, new URL(req.url, `http://${req.headers.host}`));
    if (handled === false) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  for (const item of users) {
    const login = await request(port, item.endpoint, 'POST', { identifier: item.email, password });
    const loginCookies = login.headers['set-cookie'] || [];
    if (login.status !== 200 || login.headers['access-control-allow-origin'] !== origin || login.headers['access-control-allow-credentials'] !== 'true') throw new Error(`Credentialed ${item.role} login response failed.`);
    if (loginCookies.length !== 2 || !loginCookies.every((value) => /HttpOnly; Path=\/; SameSite=Lax; Max-Age=/.test(value) && !/Domain=/.test(value) && !/Secure/.test(value))) throw new Error(`Local ${item.role} cookie policy failed.`);
    if (!loginCookies.some((value) => value.startsWith('gu_access=') && /Max-Age=300/.test(value)) || !loginCookies.some((value) => value.startsWith('gu_refresh=') && new RegExp(`Max-Age=${item.refreshAge}`).test(value))) throw new Error(`${item.role} session lifetime policy failed.`);
    const cookie = loginCookies.map((value) => value.split(';')[0]).join('; ');
    const me = await request(port, '/api/auth/me', 'GET', null, cookie);
    if (me.status !== 200) throw new Error(`${item.role} session was not preserved for /auth/me.`);
    const rotations = await Promise.all([
      request(port, '/api/auth/refresh', 'POST', null, cookie),
      request(port, '/api/auth/refresh', 'POST', null, cookie)
    ]);
    const successfulRotations = rotations.filter((result) => result.status === 200);
    const rejectedRotations = rotations.filter((result) => result.status === 401);
    if (successfulRotations.length !== 1 || rejectedRotations.length !== 1) throw new Error(`${item.role} refresh-token replay race was not rejected.`);
    const refreshedCookies = successfulRotations[0].headers['set-cookie'] || [];
    if (refreshedCookies.length !== 2) throw new Error(`${item.role} refresh-token renewal failed.`);
    const refreshedCookie = refreshedCookies.map((value) => value.split(';')[0]).join('; ');
    if ((await request(port, '/api/auth/refresh', 'POST', null, cookie)).status !== 401) throw new Error(`${item.role} old refresh token was reusable.`);
    const logout = await request(port, '/api/auth/logout', 'POST', null, refreshedCookie);
    if (logout.status !== 204 || !(logout.headers['set-cookie'] || []).every((value) => /Max-Age=0/.test(value))) throw new Error(`${item.role} logout cookie clearing failed.`);
    if ((await request(port, '/api/auth/me', 'GET', null, 'gu_access=; gu_refresh=')).status !== 401) throw new Error(`${item.role} logout did not clear access.`);
  }
  console.log('Local role-aware session lifecycle test passed.');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const userId of userIds) await query('DELETE FROM public.app_users WHERE id = $1', [userId]);
  await closePool();
}
