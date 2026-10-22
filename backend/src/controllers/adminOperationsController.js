import { env } from '../config/env.js';
import { download, json, parseBody } from '../middleware/http.js';
import {
  cancelImportStage, createBackup, createImportStage, exportCatalog, getAuditLogs,
  getBackupDownload, getBackups, getImportStage, getRecycleBin, getSystemHealth,
  listImportStages, permanentlyDeleteRecycleItem, publishImportStage,
  restoreRecycleItem, validateImport
} from '../services/adminOpsService.js';
import { validateEntityId } from '../validation/schemas.js';

const toNumber = (value) => value === undefined || value === null || value === '' || !Number.isInteger(Number(value)) ? undefined : Number(value);
const defaultOperations = {
  createBackup, exportCatalog, getAuditLogs, getBackupDownload, getBackups, getRecycleBin,
  getSystemHealth, permanentlyDeleteRecycleItem, restoreRecycleItem, validateImport,
  cancelImportStage, createImportStage, getImportStage, listImportStages, publishImportStage
};
const stageIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dateOnly = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

export async function handleAdminOperationsRequest(req, res, url, user, operations = defaultOperations) {
  const actor = user ? { ...user, ...(req.requestId ? { requestId: req.requestId } : {}) } : null;
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/audit-logs`) {
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';
    const actorId = url.searchParams.get('actorId') || '';
    if ((from && !dateOnly(from)) || (to && !dateOnly(to)) || (from && to && from > to)
      || (actorId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(actorId))) {
      json(res, 400, { error: 'Invalid audit filter.' });
      return true;
    }
    json(res, 200, await operations.getAuditLogs({
      range: url.searchParams.get('range') || '', entity: url.searchParams.get('entity') || '',
      action: url.searchParams.get('action') || '', search: url.searchParams.get('search') || '',
      order: url.searchParams.get('order') || 'newest', category: url.searchParams.get('category') || '',
      actorId: user?.role === 'regular_admin' ? user.id : actorId,
      actor: url.searchParams.get('actor') || '', from,
      to, limit: toNumber(url.searchParams.get('limit')),
      offset: toNumber(url.searchParams.get('offset'))
    }));
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/recycle-bin`) {
    json(res, 200, await operations.getRecycleBin());
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+/restore$`))) {
    const parts = url.pathname.split('/'); const kind = parts.at(-3); const id = toNumber(parts.at(-2));
    const idErr = validateEntityId(id, `${kind} id`);
    if (idErr) { json(res, 400, { error: idErr }); return true; }
    const restored = await operations.restoreRecycleItem(kind, id, actor);
    if (!restored) { json(res, 404, { error: 'Recycle bin item not found' }); return true; }
    json(res, 200, { restored: true, kind, id });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+$`))) {
    const parts = url.pathname.split('/'); const kind = parts.at(-2); const id = toNumber(parts.at(-1));
    const idErr = validateEntityId(id, `${kind} id`);
    if (idErr) { json(res, 400, { error: idErr }); return true; }
    const deleted = await operations.permanentlyDeleteRecycleItem(kind, id, actor);
    if (!deleted) { json(res, 404, { error: 'Recycle bin item not found' }); return true; }
    json(res, 200, { deleted: true, kind, id });
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import/validate`) {
    json(res, 200, await operations.validateImport(await parseBody(req, 8 * 1024 * 1024)));
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import`) {
    json(res, 409, { error: 'Catalog imports must be staged and reviewed before publication.', code: 'IMPORT_STAGING_REQUIRED' });
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import/stages`) {
    const body = await parseBody(req, 8 * 1024 * 1024);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      json(res, 400, { error: 'Import payload must be an object.', code: 'VALIDATION_ERROR' });
      return true;
    }
    json(res, 201, await operations.createImportStage(body, actor));
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/import/stages`) {
    json(res, 200, await operations.listImportStages(user.id));
    return true;
  }
  const stageRoute = url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/import/stages/([^/]+)(?:/(publish))?$`));
  if (stageRoute && ['GET', 'DELETE', 'POST'].includes(req.method)) {
    const [, id, action] = stageRoute;
    if (!stageIdPattern.test(id)) { json(res, 400, { error: 'Invalid import stage id', code: 'VALIDATION_ERROR' }); return true; }
    if (action === 'publish' && req.method === 'POST') {
      const body = await parseBody(req, 16 * 1024);
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        json(res, 400, { error: 'A preview version is required.', code: 'INVALID_IMPORT_PREVIEW_VERSION' });
        return true;
      }
      const result = await operations.publishImportStage(id, user.id, body.previewVersion, actor);
      if (result.outcome === 'stale') {
        json(res, 409, { error: result.error, code: result.code, stage: result.stage, diff: result.diff });
      } else if (result.outcome === 'version_conflict') {
        json(res, 409, { error: 'This preview has already been refreshed. Review it and confirm again.', code: result.code, stage: result.stage });
      } else if (result.outcome === 'invalid') {
        json(res, 422, { error: 'This import has validation errors and cannot be published.', code: result.code, stage: result.stage });
      } else {
        json(res, 200, { published: true, inserted: result.inserted, stage: result.stage });
      }
      return true;
    }
    if (action) return false;
    if (req.method === 'GET') {
      json(res, 200, await operations.getImportStage(id, user.id));
      return true;
    }
    if (req.method === 'DELETE') {
      json(res, 200, { cancelled: true, stage: await operations.cancelImportStage(id, user.id, actor) });
      return true;
    }
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/export`) {
    download(res, await operations.exportCatalog(url.searchParams.get('format') || 'json', actor));
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/backups`) {
    json(res, 200, await operations.getBackups());
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/backups`) {
    const body = await parseBody(req);
    json(res, 201, await operations.createBackup(body.format || 'json', actor));
    return true;
  }
  if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/backups/\\d+/download$`))) {
    const id = toNumber(url.pathname.split('/').at(-2));
    const idErr = validateEntityId(id, 'backup id');
    if (idErr) { json(res, 400, { error: idErr }); return true; }
    const backup = await operations.getBackupDownload(id);
    if (!backup) { json(res, 404, { error: 'Backup not found' }); return true; }
    download(res, backup);
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/system-health`) {
    json(res, 200, await operations.getSystemHealth());
    return true;
  }
  return false;
}
