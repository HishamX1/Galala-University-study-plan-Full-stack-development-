import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { createUser } = await import('../backend/src/services/authService.js');
const {
  cancelImportStage, createImportStage, getImportStage, listImportStages, publishImportStage
} = await import('../backend/src/services/adminOpsService.js');

const suffix = crypto.randomUUID().replaceAll('-', '');
const names = {
  owner: `stage_${suffix.slice(0, 12)}`,
  other: `other_${suffix.slice(0, 12)}`,
  published: `AR1 staged published ${suffix}`,
  stale: `AR1 staged stale ${suffix}`,
  cancelled: `AR1 staged cancelled ${suffix}`,
  expired: `AR1 staged expired ${suffix}`,
  concurrent: `AR1 staged concurrent ${suffix}`
};
const userIds = [];
const stageIds = [];
const facultyNames = [names.published, names.stale, names.cancelled, names.expired, names.concurrent];
const triggerName = `ar1_stage_publish_trigger_${suffix}`;
const functionName = `ar1_stage_publish_failure_${suffix}`;
let owner;
let other;

async function count(sql, params = []) {
  return Number((await query(sql, params)).rows[0].count);
}

async function catalogRevision() {
  return String((await query('SELECT public.get_catalog_revision()::text AS revision')).rows[0].revision);
}

async function stageFaculty(name, actor = owner) {
  const stage = await createImportStage({
    type: 'faculties', format: 'json', content: JSON.stringify([{ name }])
  }, actor);
  stageIds.push(stage.id);
  assert.equal(stage.valid, true);
  assert.equal(stage.rows.length, 1);
  return stage;
}

try {
  owner = await createUser({ name: 'Import Stage Owner', email: `stage-owner-${suffix}@example.test`, password: 'Staging-Integration-Password-123!', role: 'regular_admin' });
  other = await createUser({ name: 'Import Stage Other', email: `stage-other-${suffix}@example.test`, password: 'Staging-Integration-Password-123!', role: 'regular_admin' });
  userIds.push(owner.id, other.id);

  const recoverable = await stageFaculty(names.published);
  const revisionBeforeFailedPublication = await catalogRevision();
  await assert.rejects(() => getImportStage(recoverable.id, other.id), (error) => error.status === 404,
    'cross-owner preview access must look like not found');
  await assert.rejects(() => cancelImportStage(recoverable.id, other.id, other.name), (error) => error.status === 404,
    'cross-owner cancellation must look like not found');
  await assert.rejects(() => publishImportStage(recoverable.id, other.id, recoverable.previewVersion, other), (error) => error.status === 404,
    'cross-owner publication must look like not found');
  assert.deepEqual(await listImportStages(other.id), [], 'another administrator must not see the stage in their list');
  assert.equal((await listImportStages(owner.id)).some((item) => item.id === recoverable.id), true);

  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $stage$
    BEGIN
      IF NEW.status = 'published' THEN
        RAISE EXCEPTION 'injected staged publish failure';
      END IF;
      RETURN NEW;
    END;
  $stage$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE UPDATE ON public.catalog_import_stages
    FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
  await assert.rejects(() => publishImportStage(recoverable.id, owner.id, recoverable.previewVersion, owner), /injected staged publish failure/);
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.published]), 0,
    'catalog writes must roll back if the stage publication transition fails');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE new_values->>'stageId' = $1 AND action = 'Imported faculties'", [recoverable.id]), 0,
    'the import audit row must roll back if stage publication fails');
  assert.equal((await getImportStage(recoverable.id, owner.id)).status, 'staged',
    'failed publication must leave the stage valid for retry');
  assert.equal(await catalogRevision(), revisionBeforeFailedPublication,
    'rolled-back staged catalog writes must not publish a new catalog revision');
  await query(`DROP TRIGGER "${triggerName}" ON public.catalog_import_stages`);
  await query(`DROP FUNCTION public."${functionName}"()`);
  const revisionBeforePublication = await catalogRevision();
  const recovered = await publishImportStage(recoverable.id, owner.id, recoverable.previewVersion, owner);
  assert.equal(recovered.outcome, 'published');
  assert.ok(BigInt(await catalogRevision()) > BigInt(revisionBeforePublication),
    'atomic staged import publication advances the catalog revision with its committed catalog rows');
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.published]), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE new_values->>'stageId' = $1 AND action = 'Imported faculties'", [recoverable.id]), 1);
  assert.equal(await assert.rejects(() => publishImportStage(recoverable.id, owner.id, recoverable.previewVersion, owner)), undefined,
    'a second publication must be rejected');

  const stale = await stageFaculty(names.stale);
  await query('INSERT INTO faculties (name) VALUES ($1)', [names.stale]);
  const staleResult = await publishImportStage(stale.id, owner.id, stale.previewVersion, owner);
  assert.equal(staleResult.outcome, 'stale');
  assert.equal(staleResult.code, 'IMPORT_PREVIEW_STALE');
  assert.equal(staleResult.stage.previewVersion, stale.previewVersion + 1);
  assert.equal(staleResult.diff.catalogReferencesChanged, true);
  assert.ok(staleResult.diff.addedErrors.some((item) => item.error === 'Duplicate faculty name already exists'));
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.stale]), 1,
    'changed preview must not publish any catalog row');
  const staleInvalid = await publishImportStage(stale.id, owner.id, staleResult.stage.previewVersion, owner);
  assert.equal(staleInvalid.outcome, 'invalid', 'fresh confirmation cannot publish a stage whose new validation has errors');
  await cancelImportStage(stale.id, owner.id, owner.name);

  const cancelled = await stageFaculty(names.cancelled);
  await cancelImportStage(cancelled.id, owner.id, owner.name);
  assert.equal((await getImportStage(cancelled.id, owner.id)).status, 'cancelled');
  await assert.rejects(() => publishImportStage(cancelled.id, owner.id, cancelled.previewVersion, owner), /Cancelled import stages cannot be published/);
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.cancelled]), 0);

  const expired = await stageFaculty(names.expired);
  await query('UPDATE catalog_import_stages SET expires_at = now() - interval \'1 second\' WHERE id = $1 AND owner_id = $2', [expired.id, owner.id]);
  assert.equal((await listImportStages(owner.id)).some((item) => item.id === expired.id), false,
    'expired stages must be omitted from the active-stage list');
  await assert.rejects(() => publishImportStage(expired.id, owner.id, expired.previewVersion, owner),
    (error) => error.status === 410 && error.code === 'IMPORT_STAGE_EXPIRED');
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.expired]), 0);

  const concurrent = await stageFaculty(names.concurrent);
  const attempts = await Promise.allSettled([
    publishImportStage(concurrent.id, owner.id, concurrent.previewVersion, owner),
    publishImportStage(concurrent.id, owner.id, concurrent.previewVersion, owner)
  ]);
  assert.equal(attempts.filter((result) => result.status === 'fulfilled' && result.value.outcome === 'published').length, 1,
    'exactly one concurrent publisher may commit');
  assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1,
    'the competing publisher must observe the terminal state and fail');
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE name = $1', [names.concurrent]), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE new_values->>'stageId' = $1 AND action = 'Imported faculties'", [concurrent.id]), 1);

  console.log('Admin import staging ownership, stale preview, expiry, cancellation, retry, rollback, and concurrency tests passed.');
} finally {
  await query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.catalog_import_stages`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${functionName}"()`).catch(() => {});
  if (stageIds.length) {
    await query('DELETE FROM admin_audit_logs WHERE new_values->>\'stageId\' = ANY($1::text[])', [stageIds]).catch(() => {});
    await query('DELETE FROM catalog_import_stages WHERE id = ANY($1::uuid[])', [stageIds]).catch(() => {});
  }
  if (facultyNames.length) await query('DELETE FROM faculties WHERE name = ANY($1::text[])', [facultyNames]).catch(() => {});
  if (userIds.length) await query('DELETE FROM app_users WHERE id = ANY($1::uuid[])', [userIds]).catch(() => {});
  await closePool();
}
