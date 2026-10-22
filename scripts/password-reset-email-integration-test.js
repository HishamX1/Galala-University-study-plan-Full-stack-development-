import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { authenticate, createSession, createUser, decidePasswordResetRequest } = await import('../backend/src/services/authService.js');
const { closePool, query } = await import('../backend/src/db/client.js');

const origin = 'http://127.0.0.1:5500';
const publicAppUrl = 'https://study-plan.example.test';
const suffix = crypto.randomUUID();
const userIds = [];
const delivered = [];
let sender = async (message) => { delivered.push(message); };
let server;
let triggerName;
let functionName;
let requestSequence = 0;

function request(port, path, body, options = {}) {
  const forwardedFor = options.forwardedFor || `198.51.100.${(requestSequence++ % 200) + 2}`;
  const cookie = options.cookie || '';
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': forwardedFor,
        ...(cookie ? { Cookie: cookie } : {})
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

async function addUser(role, label, status = 'active') {
  const email = `reset-email-${label}-${suffix}@example.test`;
  const user = await createUser({
    name: `Reset Email ${label}`,
    email,
    studentId: `RESET-${label}-${suffix}`,
    password: 'InitialResetPass!2026',
    role,
    status
  });
  userIds.push(user.id);
  return { ...user, email };
}

async function sendRequest(port, email, options) {
  return request(port, '/api/auth/student-password-reset-requests', { email }, options);
}

try {
  const { handleApi } = await import('../backend/src/routes/catalogRoutes.js');
  const student = await addUser('student', 'success');
  const administrator = await addUser('regular_admin', 'admin');
  const superAdministrator = await addUser('super_admin', 'super-admin');
  const inactiveStudent = await addUser('student', 'inactive', 'inactive');
  const failureStudent = await addUser('student', 'failure');
  const rollbackStudent = await addUser('student', 'rollback');
  const expiryStudent = await addUser('student', 'expiry');
  const limitStudent = await addUser('student', 'limit');

  server = http.createServer(async (req, res) => {
    const handled = await handleApi(req, res, new URL(req.url, `http://${req.headers.host}`), {
      sendResetEmail: sender,
      publicAppUrl
    });
    if (handled === false) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  const first = await sendRequest(port, student.email);
  assert.equal(first.status, 202);
  assert.equal(first.headers['access-control-allow-origin'], origin);
  const genericBody = first.body;
  assert.match(genericBody, /does not confirm whether an account exists/i);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].recipient, student.email);
  const resetUrl = new URL(delivered[0].resetUrl);
  assert.equal(resetUrl.origin, publicAppUrl);
  assert.equal(resetUrl.searchParams.get('audience'), 'student');
  const rawToken = resetUrl.searchParams.get('token');
  assert.ok(rawToken);
  assert.equal(first.body.includes(rawToken), false, 'the raw reset token must never appear in the API response');
  const storedToken = (await query("SELECT id,token_hash,used_at,expires_at FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email' ORDER BY created_at DESC LIMIT 1", [student.id])).rows[0];
  assert.equal(storedToken.token_hash, crypto.createHash('sha256').update(rawToken).digest('hex'));
  assert.equal(storedToken.used_at, null);

  for (const address of [`unknown-${suffix}@example.test`, administrator.email, inactiveStudent.email]) {
    const response = await sendRequest(port, address);
    assert.equal(response.status, 202);
    assert.equal(response.body, genericBody);
  }
  assert.equal(delivered.length, 1, 'unknown, administrator, and inactive accounts must not receive student reset mail');
  assert.equal((await sendRequest(port, 'not-an-email')).status, 400, 'malformed input should be rejected before account lookup');

  const oldSession = await createSession(await authenticate(student.email, 'InitialResetPass!2026'));
  const resetResponse = await request(port, '/api/auth/password-reset', {
    token: rawToken,
    password: 'NewStudentPass!2026',
    confirmPassword: 'NewStudentPass!2026'
  });
  assert.equal(resetResponse.status, 204);
  assert.ok(await authenticate(student.email, 'NewStudentPass!2026'));
  assert.equal(await authenticate(student.email, 'InitialResetPass!2026'), null);
  const replay = await request(port, '/api/auth/password-reset', {
    token: rawToken,
    password: 'AnotherStudentPass!2026',
    confirmPassword: 'AnotherStudentPass!2026'
  });
  assert.notEqual(replay.status, 204, 'a consumed reset token must not be reusable');
  const oldRefresh = await request(port, '/api/auth/refresh', {}, { cookie: `gu_refresh=${encodeURIComponent(oldSession.refreshToken)}` });
  assert.equal(oldRefresh.status, 401, 'password reset must revoke existing refresh sessions');

  sender = async () => { throw new Error('simulated provider failure detail'); };
  const failedDelivery = await sendRequest(port, failureStudent.email);
  assert.equal(failedDelivery.status, 202, 'provider failures must retain the generic public response');
  const failedToken = (await query("SELECT id,used_at FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email' ORDER BY created_at DESC LIMIT 1", [failureStudent.id])).rows[0];
  assert.ok(failedToken.used_at, 'a token whose email failed must be invalidated');
  sender = async (message) => { delivered.push(message); };
  const retry = await sendRequest(port, failureStudent.email);
  assert.equal(retry.status, 202);
  assert.equal(delivered.at(-1).recipient, failureStudent.email, 'a recoverable delivery failure must allow a later request');

  const firstRollbackToken = await sendRequest(port, rollbackStudent.email);
  assert.equal(firstRollbackToken.status, 202);
  const activeBeforeRollback = (await query("SELECT id,used_at FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email' ORDER BY created_at DESC LIMIT 1", [rollbackStudent.id])).rows[0];
  const beforeCount = Number((await query("SELECT count(*)::int AS count FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email'", [rollbackStudent.id])).rows[0].count);
  const safeSuffix = suffix.replaceAll('-', '');
  triggerName = `reset_email_fail_${safeSuffix}`;
  functionName = `reset_email_fail_fn_${safeSuffix}`;
  await query(`CREATE FUNCTION public.${functionName}() RETURNS trigger LANGUAGE plpgsql AS $body$ BEGIN IF NEW.delivery_source = 'student_email' THEN RAISE EXCEPTION 'simulated token insertion failure'; END IF; RETURN NEW; END; $body$`);
  await query(`CREATE TRIGGER ${triggerName} BEFORE INSERT ON public.password_reset_tokens FOR EACH ROW EXECUTE FUNCTION public.${functionName}()`);
  const deliveryCountBeforeRollback = delivered.length;
  const rolledBack = await sendRequest(port, rollbackStudent.email);
  assert.equal(rolledBack.status, 500, 'database failure should use the existing server-error semantics');
  const afterCount = Number((await query("SELECT count(*)::int AS count FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email'", [rollbackStudent.id])).rows[0].count);
  const activeAfterRollback = (await query('SELECT used_at FROM public.password_reset_tokens WHERE id=$1', [activeBeforeRollback.id])).rows[0];
  assert.equal(afterCount, beforeCount, 'failed issuance must not leave a token row');
  assert.equal(activeAfterRollback.used_at, null, 'failed issuance must roll back invalidation of the previous token');
  assert.equal(delivered.length, deliveryCountBeforeRollback, 'email must not be sent when the token transaction fails');
  await query(`DROP TRIGGER ${triggerName} ON public.password_reset_tokens`);
  await query(`DROP FUNCTION public.${functionName}()`);
  triggerName = null;
  functionName = null;
  assert.equal((await sendRequest(port, rollbackStudent.email)).status, 202, 'the stage should remain retryable after a rolled-back issuance');

  const expiring = await sendRequest(port, expiryStudent.email);
  assert.equal(expiring.status, 202);
  const expiryToken = new URL(delivered.at(-1).resetUrl).searchParams.get('token');
  await query("UPDATE public.password_reset_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1", [crypto.createHash('sha256').update(expiryToken).digest('hex')]);
  const expired = await request(port, '/api/auth/password-reset', {
    token: expiryToken,
    password: 'ExpiredStudentPass!2026',
    confirmPassword: 'ExpiredStudentPass!2026'
  });
  assert.notEqual(expired.status, 204, 'expired links must not change the password');
  assert.ok(await authenticate(expiryStudent.email, 'InitialResetPass!2026'));

  for (let index = 0; index < 3; index += 1) assert.equal((await sendRequest(port, limitStudent.email)).status, 202);
  const sentBeforeLimit = delivered.length;
  assert.equal((await sendRequest(port, limitStudent.email)).status, 202);
  assert.equal(delivered.length, sentBeforeLimit, 'the fourth request in an hour must not send another token');
  const limitedTokenCount = Number((await query("SELECT count(*)::int AS count FROM public.password_reset_tokens WHERE user_id=$1 AND delivery_source='student_email'", [limitStudent.id])).rows[0].count);
  assert.equal(limitedTokenCount, 3);

  const requestsBeforeIpLimit = await Promise.all(Array.from({ length: 6 }, (_, index) =>
    sendRequest(port, `ip-limit-${index}-${suffix}@example.test`, { forwardedFor: `198.51.100.250` })
  ));
  assert.deepEqual(requestsBeforeIpLimit.slice(0, 5).map((item) => item.status), [202, 202, 202, 202, 202]);
  assert.equal(requestsBeforeIpLimit[5].status, 429);
  assert.equal(requestsBeforeIpLimit[5].headers['retry-after'], '900');

  const legacy = await request(port, '/api/auth/password-reset-requests', { identifier: student.email, message: 'Existing administrator approval flow' });
  assert.equal(legacy.status, 202, 'the existing manual administrator-review request route remains compatible');
  assert.equal(delivered.length, sentBeforeLimit, 'the legacy route must not invoke student email delivery');
  const queuedRequest = (await query('SELECT id,role,status FROM public.password_reset_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1', [student.id])).rows[0];
  assert.deepEqual({ role: queuedRequest.role, status: queuedRequest.status }, { role: 'student', status: 'open' });
  const approval = await decidePasswordResetRequest(queuedRequest.id, 'approve', superAdministrator.id);
  assert.equal(new URL(approval.resetLink, publicAppUrl).searchParams.get('audience'), 'admin');
  const approvedToken = (await query("SELECT delivery_source FROM public.password_reset_tokens WHERE user_id=$1 AND used_at IS NULL AND delivery_source='admin_approval' ORDER BY created_at DESC LIMIT 1", [student.id])).rows[0];
  assert.equal(approvedToken.delivery_source, 'admin_approval', 'administrator-approved reset remains distinct from student email issuance');
  assert.equal(delivered.length, sentBeforeLimit, 'administrator approval must keep its existing review flow without invoking Resend');

  console.log('Student password-reset PostgreSQL integration tests passed.');
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (triggerName) await query(`DROP TRIGGER IF EXISTS ${triggerName} ON public.password_reset_tokens`);
  if (functionName) await query(`DROP FUNCTION IF EXISTS public.${functionName}()`);
  for (const userId of userIds) await query('DELETE FROM public.app_users WHERE id=$1', [userId]);
  await closePool();
}
