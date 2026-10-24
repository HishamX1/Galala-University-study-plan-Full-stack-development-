import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { changeErrorReport, getErrorReports, submitErrorReport } from '../services/errorReportService.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function handleErrorReportRequest(req, res, url, user) {
  const base = `${env.apiBasePath}/admin/error-reports`;
  if (req.method === 'POST' && url.pathname === base) {
    const body = await parseBody(req, 8192);
    const report = await submitErrorReport(user, body, req.headers);
    json(res, 201, { report });
    return true;
  }
  if (req.method === 'GET' && url.pathname === base) {
    const limitValue = url.searchParams.get('limit') || '25';
    const offsetValue = url.searchParams.get('offset') || '0';
    const status = url.searchParams.get('status') || '';
    const category = url.searchParams.get('category') || '';
    if (!/^\d+$/.test(limitValue) || Number(limitValue) < 1 || Number(limitValue) > 100 || !/^\d+$/.test(offsetValue) || Number(offsetValue) > 1_000_000
      || (status && !['new', 'reviewing', 'resolved'].includes(status))
      || (category && !['api', 'authentication', 'catalog', 'import', 'network', 'ui', 'other'].includes(category))) {
      json(res, 400, { error: 'Invalid error report filters.' });
      return true;
    }
    const page = await getErrorReports({ status: status || null, category: category || null, limit: Number(limitValue), offset: Number(offsetValue) });
    json(res, 200, { reports: page.items, page: { limit: page.limit, offset: page.offset, total: page.total } });
    return true;
  }
  const match = url.pathname.match(new RegExp(`^${base}/([^/]+)$`));
  if (req.method === 'PUT' && match) {
    if (!uuidPattern.test(match[1])) { json(res, 404, { error: 'Error report not found.' }); return true; }
    const body = await parseBody(req, 4096);
    json(res, 200, { report: await changeErrorReport(match[1], body, user.id) });
    return true;
  }
  if (url.pathname === base || url.pathname.startsWith(`${base}/`)) {
    json(res, 404, { error: 'Error report route not found.' });
    return true;
  }
  return false;
}
