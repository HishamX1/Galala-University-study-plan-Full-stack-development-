import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Permissions, hasPermission } from '../backend/src/security/permissions.js';
import { submitErrorReport, changeErrorReport } from '../backend/src/services/errorReportService.js';

const regular = { id: '11111111-1111-4111-8111-111111111111', role: 'regular_admin' };
const superAdmin = { id: '22222222-2222-4222-8222-222222222222', role: 'super_admin' };
assert.equal(hasPermission(regular, Permissions.errorReportCreate), true);
assert.equal(hasPermission(regular, Permissions.errorReportsRead), false);
assert.equal(hasPermission(regular, Permissions.errorReportsManage), false);
assert.equal(hasPermission(superAdmin, Permissions.errorReportsRead), true);
assert.equal(hasPermission(superAdmin, Permissions.errorReportsManage), true);

const saved = [];
const executor = { async query(sql, params) { saved.push({ sql, params }); return { rows: [{ id: 'report-1', status: 'new' }] }; } };
await submitErrorReport(regular, {
  category: 'network', severity: 'high', message: 'Failed <b>operation</b>', reporterRole: 'super_admin',
  endpoint: '/api/private?token=leak', requestId: 'request-12345678',
  technicalDetails: { code: 'API_NETWORK_ERROR', password: 'dont store', stack: 'no stack', status: 503 }
}, { 'user-agent': 'Browser/1' }, executor);
assert.equal(saved.length, 1);
assert.equal(saved[0].params[1], 'regular_admin', 'report role is server derived');
assert.equal(saved[0].params[7], '', 'query strings and absolute paths are never stored as endpoints');
assert.deepEqual(JSON.parse(saved[0].params[5]), { code: 'API_NETWORK_ERROR', status: '503' }, 'technical details use an allowlist');
assert.doesNotMatch(saved[0].params[4], /[<>]/, 'markup characters are stripped from persisted messages');
await assert.rejects(submitErrorReport(regular, { category: 'other', severity: 'medium', message: '   ' }, {}, executor), /invalid/i);

let updateSql = '';
const updateExecutor = { async query(sql) { updateSql = sql; return { rows: [{ id: 'report-1', status: 'resolved' }] }; } };
await changeErrorReport('11111111-1111-4111-8111-111111111111', { status: 'resolved', resolutionNotes: 'Fixed' }, superAdmin.id, updateExecutor);
assert.match(updateSql, /resolved_by/);
await assert.rejects(changeErrorReport('11111111-1111-4111-8111-111111111111', { status: 'new' }, superAdmin.id, updateExecutor), /status/i);

const route = fs.readFileSync(new URL('../backend/src/routes/catalogRoutes.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../supabase/migrations/20261024120000_admin_error_reports.sql', import.meta.url), 'utf8');
const inbox = fs.readFileSync(new URL('../frontend/admin/modules/auth.js', import.meta.url), 'utf8');
assert.match(route, /Permissions\.errorReportCreate/);
assert.match(route, /Permissions\.errorReportsRead/);
assert.match(route, /Permissions\.errorReportsManage/);
assert.match(route, /error-report:\$\{client\}.*limit: 5/);
assert.match(migration, /ENABLE ROW LEVEL SECURITY[\s\S]*FORCE ROW LEVEL SECURITY/);
assert.doesNotMatch(migration, /CREATE POLICY/);
assert.match(inbox, /data-error-report-status/);
assert.match(inbox, /escapeReport\(report\.message\)/);
assert.match(migration, /CHECK \(\(status = 'resolved'\) = \(resolved_at IS NOT NULL AND resolved_by IS NOT NULL\)\)/);
assert.match(route, /Access-Control-Allow-Headers', 'Content-Type, Accept, X-Request-ID'/);
console.log('Error report permission, input sanitization, workflow, and RLS contracts passed.');
