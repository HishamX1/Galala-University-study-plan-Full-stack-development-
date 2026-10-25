import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { env } = await import('../backend/src/config/env.js');
const { handleApi } = await import('../backend/src/routes/catalogRoutes.js');
const { createUser } = await import('../backend/src/services/authService.js');

const suffix = crypto.randomUUID().replaceAll('-', '');
const facultyName = `HTTP response integration ${suffix}`;
const failingFacultyName = `HTTP response DB failure ${suffix}`;
const triggerName = `http_response_failure_${suffix}`;
const functionName = `http_response_failure_fn_${suffix}`;
let actor;
let student;
const requestId = `http-response-${suffix.slice(0, 20)}`;

function makeResponse() {
  return {
    statusCode: 200,
    headers: {},
    headersSent: false,
    writableEnded: false,
    writeHeadCalls: 0,
    body: '',
    writeHead(status, headers = {}) {
      assert.equal(this.headersSent, false, 'a request must not write headers twice');
      this.writeHeadCalls += 1;
      this.headersSent = true;
      this.statusCode = status;
      Object.assign(this.headers, headers);
    },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') {
      this.body += body;
      this.writableEnded = true;
    },
    destroy() { this.destroyed = true; }
  };
}

async function call(method, pathname, body) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {
    method,
    url: pathname,
    headers: { origin: env.corsOrigins[0], 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    requestId
  });
  const res = makeResponse();
  await handleApi(req, res, new URL(pathname, 'http://localhost'), { resolveCurrentUser: async () => actor });
  assert.equal(res.writeHeadCalls, 1, `${method} ${pathname} must write exactly one response`);
  assert.equal(res.writableEnded, true, `${method} ${pathname} must finish its response`);
  return { ...res, json: res.body ? JSON.parse(res.body) : null };
}

let facultyId;

try {
  actor = await createUser({
    name: 'HTTP Response Integration Admin',
    email: `http-response-${suffix}@example.test`,
    password: 'Http-Response-Integration-2026!',
    role: 'super_admin',
    status: 'active'
  });

  const invalid = await call('POST', `${env.apiBasePath}/faculties`, {});
  assert.equal(invalid.statusCode, 400, 'validation failure is a single response');

  const created = await call('POST', `${env.apiBasePath}/faculties`, { name: facultyName });
  assert.equal(created.statusCode, 201);
  facultyId = created.json.id;
  assert.ok(facultyId);
  assert.equal(Number((await query('SELECT count(*)::int AS count FROM faculties WHERE id=$1 AND name=$2', [facultyId, facultyName])).rows[0].count), 1,
    'successful HTTP response corresponds to a committed catalog row');

  const conflict = await call('POST', `${env.apiBasePath}/faculties`, { name: facultyName });
  assert.equal(conflict.statusCode, 409, 'unique-constraint conflict becomes one conflict response');

  const foreignKeyFailure = await call('POST', `${env.apiBasePath}/programs`, {
    facultyId: Number.MAX_SAFE_INTEGER,
    name: `HTTP response invalid FK ${suffix}`,
    durationYears: 4
  });
  assert.equal(foreignKeyFailure.statusCode, 400, 'database foreign-key violation becomes one client error');

  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $http_response$
    BEGIN
      IF NEW.action = 'Created Faculty' AND NEW.description = 'Created faculty ${failingFacultyName}' THEN
        RAISE EXCEPTION 'injected HTTP response integration database failure';
      END IF;
      RETURN NEW;
    END;
  $http_response$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);

  const databaseFailure = await call('POST', `${env.apiBasePath}/faculties`, { name: failingFacultyName });
  assert.equal(databaseFailure.statusCode, 500, 'unexpected PostgreSQL transaction failure maps to one generic server error');
  assert.equal(databaseFailure.json.code, 'INTERNAL_ERROR');
  assert.doesNotMatch(databaseFailure.body, /injected HTTP response integration database failure/,
    'database internals are not disclosed to the client');
  assert.equal(Number((await query('SELECT count(*)::int AS count FROM faculties WHERE name=$1', [failingFacultyName])).rows[0].count), 0,
    'failed audit write rolls back the catalog mutation');

  const studentDenied = await (async () => {
    student = await createUser({
      name: 'HTTP Response Integration Student',
      email: `http-response-student-${suffix}@example.test`,
      password: 'Http-Response-Student-2026!',
      role: 'student',
      status: 'active'
    });
    const req = Readable.from([]);
    Object.assign(req, {
      method: 'POST', url: `${env.apiBasePath}/faculties`, headers: {},
      socket: { remoteAddress: '127.0.0.1' }, requestId
    });
    const res = makeResponse();
    await handleApi(req, res, new URL(req.url, 'http://localhost'), {
      resolveCurrentUser: async () => student
    });
    assert.equal(res.writeHeadCalls, 1);
    return res;
  })();
  assert.equal(studentDenied.statusCode, 403, 'authorization failure does not reach the mutation route');

  console.log('PostgreSQL-backed HTTP response dispatch tests passed (success, validation, unique/FK constraints, transaction error, and authorization).');
} finally {
  await query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${functionName}"()`).catch(() => {});
  if (facultyId) {
    await query("DELETE FROM public.admin_audit_logs WHERE entity='faculty' AND entity_id=$1", [facultyId]).catch(() => {});
    await query('DELETE FROM public.faculties WHERE id=$1', [facultyId]).catch(() => {});
  }
  if (actor) {
    await query("DELETE FROM public.admin_audit_logs WHERE actor_id=$1", [actor.id]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id=$1', [actor.id]).catch(() => {});
  }
  if (student) {
    await query("DELETE FROM public.admin_audit_logs WHERE actor_id=$1", [student.id]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id=$1', [student.id]).catch(() => {});
  }
  await closePool();
}
