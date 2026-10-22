import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { handleApi } = await import('../backend/src/routes/catalogRoutes.js');
const { env } = await import('../backend/src/config/env.js');
const { authenticate, createManagedUser, createUser } = await import('../backend/src/services/authService.js');
const { createBackup, createImportStage, publishImportStage } = await import('../backend/src/services/adminOpsService.js');
const suffix = crypto.randomUUID().replaceAll('-', '');
const partialFaculty = `Arch Phase 1 rollback ${suffix}`;
const failingFaculty = `Arch Phase 1 injected failure ${suffix}`;
const auditFunction = `phase1_fail_audit_${suffix}`;
const auditTrigger = `phase1_fail_audit_trigger_${suffix}`;
const facultyFunction = `phase1_fail_faculty_${suffix}`;
const facultyTrigger = `phase1_fail_faculty_trigger_${suffix}`;
const userAuditFunction = `phase1_fail_user_audit_${suffix}`;
const userAuditTrigger = `phase1_fail_user_audit_trigger_${suffix}`;
const passwordAuditFunction = `part8_fail_password_audit_${suffix}`;
const passwordAuditTrigger = `part8_fail_password_audit_trigger_${suffix}`;
let backupId;
let importerId;
let stageId;
let auditActorId;
let passwordTargetId;

function makeResponse() {
  return {
    statusCode: 200, headers: {}, body: '',
    writeHead(status, headers = {}) { this.statusCode = status; Object.assign(this.headers, headers); },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body += body; }
  };
}

async function callAs(user, method, pathname, body = null) {
  const requestId = `part8-${suffix}`;
  const req = Readable.from(body === null ? [] : [Buffer.from(JSON.stringify(body))]);
  Object.assign(req, {
    method,
    url: pathname,
    headers: { origin: env.corsOrigins[0], 'content-type': 'application/json' },
    socket: { remoteAddress: '127.0.0.1' },
    requestId
  });
  const res = makeResponse();
  await handleApi(req, res, new URL(pathname, 'http://localhost'), { resolveCurrentUser: async () => user });
  return { ...res, json: res.body ? JSON.parse(res.body) : null, requestId };
}

async function count(sql, params = []) {
  return Number((await query(sql, params)).rows[0].count);
}

try {
  const auditActor = await createUser({ name: 'Admin Activity Test', email: `admin-activity-${suffix}@example.test`, password: 'Activity-Test-Password-123!', role: 'super_admin' });
  auditActorId = auditActor.id;
  const passwordTarget = await createUser({ name: 'Managed Admin Activity Test', email: `managed-admin-${suffix}@example.test`, password: 'Initial-Managed-Password-123!', role: 'regular_admin' });
  passwordTargetId = passwordTarget.id;
  const { rows: rlsRows } = await query("SELECT relrowsecurity FROM pg_class WHERE oid='public.admin_audit_logs'::regclass");
  assert.equal(rlsRows[0]?.relrowsecurity, true, 'audit table must not be directly exposed through public API roles');

  const resetPath = `${env.apiBasePath}/admin/users/${passwordTarget.id}/reset-password`;
  const resetBody = { password: 'Updated-Managed-Password-123!', confirmPassword: 'Updated-Managed-Password-123!' };
  const forbiddenReset = await callAs(passwordTarget, 'POST', resetPath, resetBody);
  assert.equal(forbiddenReset.statusCode, 403, 'a regular administrator cannot change managed passwords through the super-admin workflow');
  assert.ok(await authenticate(passwordTarget.email, 'Initial-Managed-Password-123!'), 'forbidden password changes leave the target credential unchanged');

  await query(`CREATE FUNCTION public."${passwordAuditFunction}"() RETURNS trigger LANGUAGE plpgsql AS $part8$
    BEGIN
      IF NEW.action='Reset User Password' AND NEW.target_id='${passwordTarget.id}' THEN
        RAISE EXCEPTION 'injected managed-password audit failure';
      END IF;
      RETURN NEW;
    END;
  $part8$`);
  await query(`CREATE TRIGGER "${passwordAuditTrigger}" BEFORE INSERT ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public."${passwordAuditFunction}"()`);
  const failedPasswordReset = await callAs(auditActor, 'POST', resetPath, resetBody);
  assert.equal(failedPasswordReset.statusCode, 500, 'audit failure must fail the password-change operation');
  assert.equal(failedPasswordReset.body.includes('injected managed-password audit failure'), false, 'internal database failure details must not reach the API response');
  await query(`DROP TRIGGER "${passwordAuditTrigger}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${passwordAuditFunction}"()`);
  assert.ok(await authenticate(passwordTarget.email, 'Initial-Managed-Password-123!'), 'failed audit rolls the password update back');
  assert.equal(await authenticate(passwordTarget.email, resetBody.password), null, 'failed password change does not authenticate with the requested new password');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action='Reset User Password' AND target_id=$1", [passwordTarget.id]), 0,
    'failed password change leaves no success audit event');

  const successfulPasswordReset = await callAs(auditActor, 'POST', resetPath, resetBody);
  assert.equal(successfulPasswordReset.statusCode, 200);
  assert.equal(successfulPasswordReset.json.user.id, passwordTarget.id);
  assert.equal('password_hash' in successfulPasswordReset.json.user, false, 'password change response excludes the credential hash');
  assert.equal('password' in successfulPasswordReset.json.user, false, 'password change response excludes the submitted password');
  assert.equal(await authenticate(passwordTarget.email, 'Initial-Managed-Password-123!'), null);
  assert.ok(await authenticate(passwordTarget.email, resetBody.password), 'managed administrator can authenticate with the successfully updated password');

  const passwordAudit = (await query(`SELECT id,created_at,actor_id,actor_role,actor_name,action,entity,target_id,outcome,category,request_id
    FROM admin_audit_logs WHERE action='Reset User Password' AND target_id=$1`, [passwordTarget.id])).rows[0];
  assert.deepEqual({
    actor_id: passwordAudit.actor_id, actor_role: passwordAudit.actor_role, actor_name: passwordAudit.actor_name,
    action: passwordAudit.action, entity: passwordAudit.entity, target_id: passwordAudit.target_id,
    outcome: passwordAudit.outcome, category: passwordAudit.category, request_id: passwordAudit.request_id
  }, {
    actor_id: auditActor.id, actor_role: 'super_admin', actor_name: auditActor.name,
    action: 'Reset User Password', entity: 'user', target_id: passwordTarget.id,
    outcome: 'success', category: 'account', request_id: successfulPasswordReset.requestId
  }, 'successful password-change audit identifies the authenticated actor, target, outcome, and request');
  assert.ok(Number.isFinite(Date.parse(passwordAudit.created_at)), 'successful password-change audit has a valid timestamp');
  const dashboard = await callAs(auditActor, 'GET', `${env.apiBasePath}/dashboard`);
  assert.equal(dashboard.statusCode, 200);
  const recentPasswordReset = dashboard.json.recentActivity.find((item) => item.id === passwordAudit.id);
  assert.ok(recentPasswordReset, 'super-admin Recent Activity includes the password change without a backup operation');
  assert.equal(recentPasswordReset.actor_id, auditActor.id);
  assert.equal(recentPasswordReset.actor_role, 'super_admin');
  assert.equal(recentPasswordReset.target_id, passwordTarget.id);
  assert.equal(recentPasswordReset.outcome, 'success');

  const backup = await createBackup('json', auditActor);
  backupId = backup.id;
  assert.ok(backup.id, 'successful backup must return a persisted id');
  assert.equal(await count('SELECT count(*)::int AS count FROM admin_backup_history WHERE id = $1', [backup.id]), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity = 'backup' AND entity_id = $1 AND action = 'Database Backup'", [backup.id]), 1,
    'backup record and audit row must commit together');
  const backupAudit = (await query("SELECT actor_id,actor_role,category FROM admin_audit_logs WHERE entity='backup' AND entity_id=$1", [backup.id])).rows[0];
  assert.deepEqual(backupAudit, { actor_id: auditActor.id, actor_role: 'super_admin', category: 'backup' }, 'backup audit captures the authenticated actor');

  const backupCountBeforeFailure = await count('SELECT count(*)::int AS count FROM admin_backup_history');
  await query(`CREATE FUNCTION public."${auditFunction}"() RETURNS trigger LANGUAGE plpgsql AS $phase1$
    BEGIN
      IF NEW.action = 'Database Backup' AND NEW.entity = 'backup' THEN
        RAISE EXCEPTION 'injected audit failure for transaction regression test';
      END IF;
      RETURN NEW;
    END;
  $phase1$`);
  await query(`CREATE TRIGGER "${auditTrigger}" BEFORE INSERT ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public."${auditFunction}"()`);
  await assert.rejects(() => createBackup('json', auditActor), /injected audit failure/);
  await query(`DROP TRIGGER "${auditTrigger}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${auditFunction}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM admin_backup_history'), backupCountBeforeFailure,
    'backup insert must roll back when its audit insert fails');

  const managedUserEmail = `rollback-user-${suffix}@example.test`;
  await query(`CREATE FUNCTION public."${userAuditFunction}"() RETURNS trigger LANGUAGE plpgsql AS $phase1$
    BEGIN
      IF NEW.action = 'Created User' THEN RAISE EXCEPTION 'injected managed-user audit failure'; END IF;
      RETURN NEW;
    END;
  $phase1$`);
  await query(`CREATE TRIGGER "${userAuditTrigger}" BEFORE INSERT ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public."${userAuditFunction}"()`);
  await assert.rejects(() => createManagedUser({ name: 'Rollback User', email: managedUserEmail, password: 'Rollback-User-Password-123!', role: 'student' }, auditActor), /injected managed-user audit failure/);
  await query(`DROP TRIGGER "${userAuditTrigger}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${userAuditFunction}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM app_users WHERE email=$1', [managedUserEmail]), 0,
    'managed-user creation must roll back when its audit insert fails');

  const importedAuditCountBefore = await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Imported faculties'");
  const importer = await createUser({
    name: 'Admin Transaction Test', email: `admin-transaction-${suffix}@example.test`,
    password: 'Transaction-Test-Password-123!', role: 'regular_admin'
  });
  importerId = importer.id;
  const stage = await createImportStage({
    type: 'faculties',
    format: 'json',
    content: JSON.stringify([{ name: partialFaculty }, { name: failingFaculty }])
  }, importer);
  stageId = stage.id;
  await query(`CREATE FUNCTION public."${facultyFunction}"() RETURNS trigger LANGUAGE plpgsql AS $phase1$
    BEGIN
      IF NEW.name = '${failingFaculty}' THEN
        RAISE EXCEPTION 'injected faculty insert failure for transaction regression test';
      END IF;
      RETURN NEW;
    END;
  $phase1$`);
  await query(`CREATE TRIGGER "${facultyTrigger}" BEFORE INSERT ON public.faculties
    FOR EACH ROW EXECUTE FUNCTION public."${facultyFunction}"()`);
  await assert.rejects(() => publishImportStage(stage.id, importer.id, stage.previewVersion, importer), /injected faculty insert failure/);
  await query(`DROP TRIGGER "${facultyTrigger}" ON public.faculties`);
  await query(`DROP FUNCTION public."${facultyFunction}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = ANY($1::text[])', [[partialFaculty, failingFaculty]]), 0,
    'earlier catalog rows must roll back after a later import insert fails');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Imported faculties'"), importedAuditCountBefore,
    'failed import must not write its audit event');
  assert.equal((await query('SELECT status FROM catalog_import_stages WHERE id = $1', [stage.id])).rows[0].status, 'staged',
    'failed staged import remains available for retry');

  console.log('Admin backup/audit atomicity and import-failure rollback integration tests passed.');
} finally {
  await query(`DROP TRIGGER IF EXISTS "${passwordAuditTrigger}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${passwordAuditFunction}"()`).catch(() => {});
  await query(`DROP TRIGGER IF EXISTS "${userAuditTrigger}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${userAuditFunction}"()`).catch(() => {});
  await query(`DROP TRIGGER IF EXISTS "${auditTrigger}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${auditFunction}"()`).catch(() => {});
  await query(`DROP TRIGGER IF EXISTS "${facultyTrigger}" ON public.faculties`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${facultyFunction}"()`).catch(() => {});
  if (backupId) {
    await query("DELETE FROM admin_audit_logs WHERE entity = 'backup' AND entity_id = $1 AND action = 'Database Backup'", [backupId]).catch(() => {});
    await query('DELETE FROM admin_backup_history WHERE id = $1', [backupId]).catch(() => {});
  }
  if (stageId) await query("DELETE FROM admin_audit_logs WHERE entity = 'catalog_import_stage' AND new_values->>'stageId' = $1", [stageId]).catch(() => {});
  if (auditActorId) await query('DELETE FROM admin_audit_logs WHERE actor_id=$1', [auditActorId]).catch(() => {});
  if (passwordTargetId) await query('DELETE FROM admin_audit_logs WHERE target_id=$1', [passwordTargetId]).catch(() => {});
  if (importerId) await query('DELETE FROM app_users WHERE id = $1', [importerId]).catch(() => {});
  if (passwordTargetId) await query('DELETE FROM app_users WHERE id = $1', [passwordTargetId]).catch(() => {});
  if (auditActorId) await query('DELETE FROM app_users WHERE id = $1', [auditActorId]).catch(() => {});
  await closePool();
}
