import { env } from '../config/env.js';
import { download, json, parseBody } from '../middleware/http.js';
import {
  createBackup, exportCatalog, getAuditLogs, getBackupDownload, getBackups,
  getRecycleBin, getSystemHealth, importCatalog, permanentlyDeleteRecycleItem,
  restoreRecycleItem, validateImport
} from '../services/adminOpsService.js';
import { validateEntityId } from '../validation/schemas.js';

const toNumber = (value) => value === undefined || value === null || value === '' || !Number.isInteger(Number(value)) ? undefined : Number(value);
const defaultOperations = {
  createBackup, exportCatalog, getAuditLogs, getBackupDownload, getBackups, getRecycleBin,
  getSystemHealth, importCatalog, permanentlyDeleteRecycleItem, restoreRecycleItem, validateImport
};

export async function handleAdminOperationsRequest(req, res, url, user, operations = defaultOperations) {
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/audit-logs`) {
    json(res, 200, await operations.getAuditLogs({
      range: url.searchParams.get('range') || '', entity: url.searchParams.get('entity') || '',
      action: url.searchParams.get('action') || '', search: url.searchParams.get('search') || '',
      order: url.searchParams.get('order') || 'newest'
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
    const restored = await operations.restoreRecycleItem(kind, id);
    if (!restored) { json(res, 404, { error: 'Recycle bin item not found' }); return true; }
    json(res, 200, { restored: true, kind, id });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+$`))) {
    const parts = url.pathname.split('/'); const kind = parts.at(-2); const id = toNumber(parts.at(-1));
    const idErr = validateEntityId(id, `${kind} id`);
    if (idErr) { json(res, 400, { error: idErr }); return true; }
    const deleted = await operations.permanentlyDeleteRecycleItem(kind, id);
    if (!deleted) { json(res, 404, { error: 'Recycle bin item not found' }); return true; }
    json(res, 200, { deleted: true, kind, id });
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import/validate`) {
    json(res, 200, await operations.validateImport(await parseBody(req, 8 * 1024 * 1024)));
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import`) {
    const result = await operations.importCatalog(await parseBody(req, 8 * 1024 * 1024));
    json(res, result.valid ? 201 : 400, result);
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/export`) {
    download(res, await operations.exportCatalog(url.searchParams.get('format') || 'json'));
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/backups`) {
    json(res, 200, await operations.getBackups());
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/backups`) {
    const body = await parseBody(req);
    json(res, 201, await operations.createBackup(body.format || 'json'));
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
