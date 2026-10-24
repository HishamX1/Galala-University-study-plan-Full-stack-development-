import { query, withPostgresClient } from '../db/client.js';
import { insertErrorReport, listErrorReports, updateErrorReport } from '../repositories/errorReportRepository.js';
import { logAdminAction } from './adminOpsService.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';

const categories = new Set(['api', 'authentication', 'catalog', 'import', 'network', 'ui', 'other']);
const severities = new Set(['low', 'medium', 'high', 'critical']);
const safeText = (value, max, fallback = '') => String(value ?? fallback)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F<>]/g, '')
  .replace(/\b(password|token|secret|cookie|authorization|database_url)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
  .replace(/\bBearer\s+[A-Za-z0-9._~-]+/gi, 'Bearer [redacted]')
  .trim().slice(0, max);

function sanitizeTechnicalDetails(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const allowed = ['code', 'status', 'timestamp', 'requestId', 'page', 'endpoint', 'method', 'durationMs'];
  const result = {};
  for (const key of allowed) {
    const value = input[key];
    if (typeof value === 'string' || typeof value === 'number') result[key] = safeText(value, 500);
  }
  return result;
}

function safeEndpoint(value) {
  let endpoint = safeText(value, 300);
  if (!endpoint.startsWith('/') || endpoint.startsWith('//') || endpoint.includes('://') || /[?#]/.test(endpoint)) return '';
  if (/password-reset/i.test(endpoint)) endpoint = endpoint.replace(/(password-reset(?:-requests)?\/)[^/]+/ig, '$1[redacted]');
  return endpoint.replace(/\/{2,}/g, '/');
}

export async function submitErrorReport(user, input, headers = {}, executor = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ValidationError('A valid report body is required.');
  const category = safeText(input.category, 32, 'other');
  const severity = safeText(input.severity, 16, 'medium');
  const message = safeText(input.message, 1000);
  if (!categories.has(category) || !severities.has(severity) || message.length < 5) throw new ValidationError('Report category, severity, or message is invalid.');
  const details = sanitizeTechnicalDetails(input.technicalDetails);
  const requestId = /^[A-Za-z0-9._-]{8,128}$/.test(String(input.requestId || '')) ? String(input.requestId) : null;
  const page = safeText(input.page, 160);
  const endpoint = safeEndpoint(input.endpoint);
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(String(input.method || '').toUpperCase()) ? String(input.method).toUpperCase() : null;
  const userAgent = safeText(headers['user-agent'], 300);
  const reportData = {
    reporterId: user.id, reporterRole: user.role, category, severity, message,
    technicalDetails: details, requestId, page, endpoint, method, userAgent
  };
  if (executor) return insertErrorReport(executor, reportData);
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const report = await insertErrorReport(client, reportData);
      await logAdminAction(client, { action: 'Submitted Error Report', entity: 'admin_error_report', targetId: report.id,
        category: 'security', newValues: { category, severity }, description: 'Administrator submitted an error report', actor: user });
      await client.query('COMMIT');
      return report;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}

export async function getErrorReports(filters, executor = { query }) { return listErrorReports(executor, filters); }

export async function changeErrorReport(id, input, actorId, executor = null) {
  const status = safeText(input?.status, 16);
  const notes = input?.resolutionNotes == null ? null : safeText(input.resolutionNotes, 2000);
  if (!['reviewing', 'resolved'].includes(status)) throw new ValidationError('Report status must be reviewing or resolved.');
  if (status === 'resolved' && !notes) throw new ValidationError('Resolution notes are required to resolve a report.');
  if (input?.resolutionNotes != null && !notes) throw new ValidationError('Resolution notes cannot be empty.');
  if (executor) {
    const updated = await updateErrorReport(executor, id, status, notes, actorId);
    if (!updated) throw new NotFoundError('Error report not found.');
    return updated;
  }
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const updated = await updateErrorReport(client, id, status, notes, actorId);
      if (!updated) throw new NotFoundError('Error report not found.');
      await logAdminAction(client, { action: status === 'resolved' ? 'Resolved Error Report' : 'Reviewed Error Report',
        entity: 'admin_error_report', targetId: id, category: 'security', newValues: { status },
        description: status === 'resolved' ? 'Super Admin resolved an error report' : 'Super Admin acknowledged an error report', actor: { id: actorId, role: 'super_admin' } });
      await client.query('COMMIT');
      return updated;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  });
}
