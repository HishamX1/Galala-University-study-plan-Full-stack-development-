import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { Permissions, hasPermission } from '../security/permissions.js';
import { getDashboardSummary, getSystemHealth } from '../services/adminOpsService.js';
import { createComplaint, getDashboardData, markAllDashboardNotificationsRead, markNotificationRead, updateOwnProfile } from '../services/authService.js';

export async function handleDashboardRequest(req, res, url, user, services = {}) {
  const readNotification = services.markNotificationRead || markNotificationRead;
  const readAllNotifications = services.markAllDashboardNotificationsRead || markAllDashboardNotificationsRead;
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/dashboard`) {
    const loadDashboardData = services.getDashboardData || getDashboardData;
    const loadDashboardSummary = services.getDashboardSummary || getDashboardSummary;
    const loadSystemHealth = services.getSystemHealth || getSystemHealth;
    const hasCatalogAccess = user.role !== 'student';
    const hasSystemAccess = hasPermission(user, Permissions.systemRead);
    const [dashboard, catalog, systemHealth] = await Promise.all([
      loadDashboardData(user),
      hasCatalogAccess ? loadDashboardSummary(user) : Promise.resolve(null),
      hasSystemAccess ? loadSystemHealth() : Promise.resolve(null)
    ]);
    if (hasCatalogAccess) dashboard.catalog = catalog;
    if (hasSystemAccess) dashboard.systemHealth = systemHealth;
    return json(res, 200, dashboard);
  }
  if (req.method === 'PUT' && url.pathname === `${env.apiBasePath}/profile`) {
    const body = await parseBody(req);
    return json(res, 200, { user: await updateOwnProfile(user.id, body) });
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/notifications/read`) {
    const body = await parseBody(req, 4096);
    if (!body || typeof body.notificationKey !== 'string') return json(res, 400, { error: 'A notification key is required.' });
    return json(res, 200, { notification: await readNotification(user, body.notificationKey) });
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/notifications/read-all`) {
    return json(res, 200, await readAllNotifications(user));
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/student/complaints`) {
    const body = await parseBody(req);
    if (!String(body.message || '').trim()) return json(res, 400, { error: 'A complaint message is required.' });
    return json(res, 201, { complaint: await createComplaint(user, String(body.message).trim(), req.requestId) });
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/dashboard`) {
    return json(res, 200, await getDashboardSummary(user));
  }
  return false;
}
