import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();
const { closePool, query } = await import('../backend/src/db/client.js');
const { createUser } = await import('../backend/src/services/authService.js');
const { submitErrorReport, getErrorReports, changeErrorReport } = await import('../backend/src/services/errorReportService.js');

const suffix = crypto.randomUUID();
const actorIds = [];
let triggerName = `error_report_failure_${suffix.replaceAll('-', '')}`;
let functionName = `error_report_failure_fn_${suffix.replaceAll('-', '')}`;
const reportIds = [];

async function count(sql, params = []) { return Number((await query(sql, params)).rows[0].count); }

try {
  const regular = await createUser({ name: `Report Admin ${suffix}`, email: `report-admin-${suffix}@example.invalid`, password: 'ReportTest!2026', role: 'regular_admin', status: 'active' });
  const superAdmin = await createUser({ name: `Report Super ${suffix}`, email: `report-super-${suffix}@example.invalid`, password: 'ReportTest!2026', role: 'super_admin', status: 'active' });
  actorIds.push(regular.id, superAdmin.id);

  const first = await submitErrorReport(regular, {
    category: 'network', severity: 'high', message: `Network outage ${suffix}`,
    requestId: 'request-12345678', endpoint: '/api/catalog?token=secret', method: 'GET',
    technicalDetails: { code: 'API_NETWORK_ERROR', password: 'hidden', status: 503 }
  }, { 'user-agent': 'Integration Test' });
  reportIds.push(first.id);
  assert.equal(first.status, 'new');
  const stored = (await query('SELECT reporter_id, reporter_role, endpoint, technical_details, user_agent FROM public.admin_error_reports WHERE id=$1', [first.id])).rows[0];
  assert.equal(stored.reporter_id, regular.id);
  assert.equal(stored.reporter_role, 'regular_admin');
  assert.equal(stored.endpoint, '', 'query-bearing paths are not persisted');
  assert.deepEqual(stored.technical_details, { code: 'API_NETWORK_ERROR', status: '503' });
  assert.equal(stored.user_agent, 'Integration Test');
  assert.equal(await count("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE target_id=$1 AND action='Submitted Error Report'", [first.id]), 1);

  const second = await submitErrorReport(regular, { category: 'catalog', severity: 'medium', message: `Catalog issue ${suffix}` });
  reportIds.push(second.id);
  const page = await getErrorReports({ status: 'new', limit: 1, offset: 1 });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  const categoryPage = await getErrorReports({ category: 'network', limit: 20, offset: 0 });
  assert.deepEqual(categoryPage.items.map((item) => item.id), [first.id]);

  const resolved = await changeErrorReport(first.id, { status: 'resolved', resolutionNotes: 'Updated the API connection settings.' }, superAdmin.id);
  assert.equal(resolved.status, 'resolved');
  assert.equal(await count("SELECT count(*)::int AS count FROM public.admin_audit_logs WHERE target_id=$1 AND action='Resolved Error Report'", [first.id]), 1);

  const rls = (await query(`SELECT c.relrowsecurity, c.relforcerowsecurity,
      (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename='admin_error_reports') AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='admin_error_reports'`)).rows[0];
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true, policies: 0 });

  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $phase1$
    BEGIN
      IF NEW.action='Submitted Error Report' AND NEW.entity='admin_error_report' THEN RAISE EXCEPTION 'injected report audit failure'; END IF;
      RETURN NEW;
    END;
  $phase1$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
  await assert.rejects(submitErrorReport(regular, { category: 'other', severity: 'low', message: `Rollback ${suffix}` }), /injected report audit failure/);
  assert.equal(await count('SELECT count(*)::int AS count FROM public.admin_error_reports WHERE message=$1', [`Rollback ${suffix}`]), 0,
    'report and audit writes roll back together');

  console.log('Error report PostgreSQL integration passed (sanitized persistence, pagination, filters, resolution, RLS, audit, and rollback).');
} finally {
  await query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${functionName}"()`).catch(() => {});
  if (reportIds.length) {
    await query('DELETE FROM public.admin_audit_logs WHERE target_id = ANY($1::text[])', [reportIds]).catch(() => {});
    await query('DELETE FROM public.admin_error_reports WHERE id = ANY($1::uuid[])', [reportIds]).catch(() => {});
  }
  if (actorIds.length) {
    await query('DELETE FROM public.admin_audit_logs WHERE actor_id = ANY($1::uuid[])', [actorIds]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id = ANY($1::uuid[])', [actorIds]).catch(() => {});
  }
  await closePool();
}
