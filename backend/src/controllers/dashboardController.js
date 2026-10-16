import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { Permissions, hasPermission } from '../security/permissions.js';
import { getDashboardSummary, getSystemHealth } from '../services/adminOpsService.js';
import { createComplaint, getDashboardData, updateOwnProfile } from '../services/authService.js';

export async function handleDashboardRequest(req, res, url, user) {
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/dashboard`) {
    const dashboard = await getDashboardData(user);
    if (user.role !== 'student') dashboard.catalog = await getDashboardSummary();
    if (hasPermission(user, Permissions.systemRead)) dashboard.systemHealth = await getSystemHealth();
    return json(res, 200, dashboard);
  }
  if (req.method === 'PUT' && url.pathname === `${env.apiBasePath}/profile`) {
    const body = await parseBody(req);
    return json(res, 200, { user: await updateOwnProfile(user.id, body) });
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/student/complaints`) {
    const body = await parseBody(req);
    if (!String(body.message || '').trim()) return json(res, 400, { error: 'A complaint message is required.' });
    return json(res, 201, { complaint: await createComplaint(user, String(body.message).trim()) });
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/dashboard`) {
    return json(res, 200, await getDashboardSummary());
  }
  return false;
}
