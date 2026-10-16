import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { createBackup, importCatalog } = await import('../backend/src/services/adminOpsService.js');
const suffix = crypto.randomUUID().replaceAll('-', '');
const partialFaculty = `Arch Phase 1 rollback ${suffix}`;
const failingFaculty = `Arch Phase 1 injected failure ${suffix}`;
const auditFunction = `phase1_fail_audit_${suffix}`;
const auditTrigger = `phase1_fail_audit_trigger_${suffix}`;
const facultyFunction = `phase1_fail_faculty_${suffix}`;
const facultyTrigger = `phase1_fail_faculty_trigger_${suffix}`;
let backupId;

async function count(sql, params = []) {
  return Number((await query(sql, params)).rows[0].count);
}

try {
  const backup = await createBackup('json');
  backupId = backup.id;
  assert.ok(backup.id, 'successful backup must return a persisted id');
  assert.equal(await count('SELECT count(*)::int AS count FROM admin_backup_history WHERE id = $1', [backup.id]), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity = 'backup' AND entity_id = $1 AND action = 'Database Backup'", [backup.id]), 1,
    'backup record and audit row must commit together');

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
  await assert.rejects(() => createBackup('json'), /injected audit failure/);
  await query(`DROP TRIGGER "${auditTrigger}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${auditFunction}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM admin_backup_history'), backupCountBeforeFailure,
    'backup insert must roll back when its audit insert fails');

  const importedAuditCountBefore = await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Imported faculties'");
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
  await assert.rejects(() => importCatalog({
    type: 'faculties',
    format: 'json',
    content: JSON.stringify([{ name: partialFaculty }, { name: failingFaculty }])
  }), /injected faculty insert failure/);
  await query(`DROP TRIGGER "${facultyTrigger}" ON public.faculties`);
  await query(`DROP FUNCTION public."${facultyFunction}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = ANY($1::text[])', [[partialFaculty, failingFaculty]]), 0,
    'earlier catalog rows must roll back after a later import insert fails');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Imported faculties'"), importedAuditCountBefore,
    'failed import must not write its audit event');

  console.log('Admin backup/audit atomicity and import-failure rollback integration tests passed.');
} finally {
  await query(`DROP TRIGGER IF EXISTS "${auditTrigger}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${auditFunction}"()`).catch(() => {});
  await query(`DROP TRIGGER IF EXISTS "${facultyTrigger}" ON public.faculties`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${facultyFunction}"()`).catch(() => {});
  if (backupId) {
    await query("DELETE FROM admin_audit_logs WHERE entity = 'backup' AND entity_id = $1 AND action = 'Database Backup'", [backupId]).catch(() => {});
    await query('DELETE FROM admin_backup_history WHERE id = $1', [backupId]).catch(() => {});
  }
  await closePool();
}
