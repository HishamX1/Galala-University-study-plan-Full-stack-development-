import { getCatalog, getFaculties, getProgramCourses, getPrograms } from '../services/catalogService.js';
import { env } from '../config/env.js';
import { databaseDiagnosticMessage } from '../db/client.js';
import { currentUser } from '../services/authService.js';
import { Permissions, hasPermission } from '../security/permissions.js';
import { allowRequest } from '../security/rateLimiter.js';
import { isSafeClientError, toErrorResponse } from '../utils/errors.js';
import { json } from '../middleware/http.js';
import { handleAuthRequest } from '../controllers/authController.js';
import { handleCatalogReadRequest, handleCatalogRequest } from '../controllers/catalogController.js';
import { handleDashboardRequest } from '../controllers/dashboardController.js';
import { handleAdminSupportRequest, handleAdminUserRequest } from '../controllers/adminUserController.js';
import { handleAdminOperationsRequest } from '../controllers/adminOperationsController.js';
import { handleErrorReportRequest } from '../controllers/errorReportController.js';
import { handleStudentProgressRequest } from '../controllers/studentProgressController.js';

function isAllowedCorsOrigin(origin) {
  return Boolean(origin) && env.corsOrigins.includes(origin);
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedCorsOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept, X-Request-ID');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type, X-Request-ID');
  res.setHeader('Vary', 'Origin');
  return true;
}

function unauthorized(res) { return json(res, 401, { error: 'Authentication required' }); }
function forbidden(res) { return json(res, 403, { error: 'You do not have permission to access this resource' }); }
function requirePermission(res, user, permission) {
  if (hasPermission(user, permission)) return true;
  forbidden(res);
  return false;
}
function canAccess(user, req, pathname) {
  if (!user) return false;
  const isRead = req.method === 'GET';
  const curriculum = pathname === `${env.apiBasePath}/catalog` || pathname.startsWith(`${env.apiBasePath}/faculties`) || pathname.startsWith(`${env.apiBasePath}/programs`) || pathname.startsWith(`${env.apiBasePath}/program-courses`);
  const studentCatalog = pathname === `${env.apiBasePath}/catalog` || pathname === `${env.apiBasePath}/faculties` || pathname === `${env.apiBasePath}/programs` || pathname === `${env.apiBasePath}/program-courses` || new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites$`).test(pathname);
  if (user.role === 'student') return hasPermission(user, Permissions.catalogRead) && isRead && studentCatalog;
  // Regular administrators may operate the curriculum portal, but never the
  // super-admin account/request endpoints.  The old narrow allowlist made a
  // successful admin login look like a failed session during portal bootstrap.
  // More-sensitive admin endpoints are rejected above this compatibility gate.
  // The remaining legacy curriculum operations stay available to regular admins.
  if (pathname.startsWith(`${env.apiBasePath}/admin/`)) return hasPermission(user, Permissions.catalogWrite);
  return curriculum && hasPermission(user, isRead ? Permissions.catalogRead : Permissions.catalogWrite);
}

function isStateChanging(method) { return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method); }
function hasSessionCookie(req) { return /(?:^|;\s*)gu_(?:access|refresh)=/.test(String(req.headers.cookie || '')); }
function trustedStateChange(req) {
  // Cookie-authenticated mutations require an explicit approved Origin. This
  // preserves credentialed Vercel/Render requests while rejecting blind CSRF.
  if (!isStateChanging(req.method) || !hasSessionCookie(req)) return true;
  return isAllowedCorsOrigin(req.headers.origin);
}

export async function handleApi(req, res, url, { resolveCurrentUser = currentUser, sendResetEmail, publicAppUrl, dashboardHandler = handleDashboardRequest } = {}) {
  if (!url.pathname.startsWith(env.apiBasePath)) return false;
  const origin = req.headers.origin;
  if (origin && !applyCorsHeaders(req, res)) {
    return json(res, 403, { error: 'Origin is not allowed' });
  }
  if (req.method === 'OPTIONS') return json(res, 204, {});
  if (!trustedStateChange(req)) return json(res, 403, { error: 'Origin validation failed' });
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/status`) return json(res, 200, { status: 'ok' });

  const studentResetRequestPath = `${env.apiBasePath}/auth/student-password-reset-requests`;
  const authSensitive = [`${env.apiBasePath}/auth/login`, `${env.apiBasePath}/auth/student-login`, `${env.apiBasePath}/auth/admin-login`, `${env.apiBasePath}/auth/password-reset-requests`, studentResetRequestPath];
  const signupPath = `${env.apiBasePath}/auth/student-signup`;
  const client = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
  const rateLimitResponse = (retryAfter = '60') => json(res, 429, { error: 'Too many requests. Please try again shortly.' }, { 'Retry-After': retryAfter });
  if (req.method === 'POST' && url.pathname === signupPath && !allowRequest(`${url.pathname}:${client}`, { limit: 5, windowMs: 15 * 60_000 })) {
    return rateLimitResponse('900');
  }
  if (req.method === 'POST' && authSensitive.includes(url.pathname)) {
    if (!allowRequest(`${url.pathname}:${client}`, { limit: 10, windowMs: 60_000 })) return rateLimitResponse();
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/error-reports`
    && !allowRequest(`error-report:${client}`, { limit: 5, windowMs: 15 * 60_000 })) return rateLimitResponse('900');
  if (req.method === 'POST' && url.pathname === studentResetRequestPath
    && !allowRequest(`${url.pathname}:ip:${client}`, { limit: 5, windowMs: 15 * 60_000 })) {
    return rateLimitResponse('900');
  }

  try {
    if (await handleAuthRequest(req, res, url, { sendResetEmail, publicAppUrl })) return true;

    const user = await resolveCurrentUser(req);
    if (!user) return unauthorized(res);
    if (url.pathname === `${env.apiBasePath}/student/academic-progress`) {
      if (user.role !== 'student' || !requirePermission(res, user, Permissions.academicProgress)) return;
      return handleStudentProgressRequest(req, res, url, user);
    }
    const errorReportsPath = `${env.apiBasePath}/admin/error-reports`;
    if (url.pathname === errorReportsPath || url.pathname.startsWith(`${errorReportsPath}/`)) {
      const permission = req.method === 'POST' && url.pathname === errorReportsPath
        ? Permissions.errorReportCreate
        : req.method === 'GET' ? Permissions.errorReportsRead : Permissions.errorReportsManage;
      if (!requirePermission(res, user, permission)) return;
      return handleErrorReportRequest(req, res, url, user);
    }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/dashboard`) {
      if (!requirePermission(res, user, Permissions.dashboardRead)) return;
      return handleDashboardRequest(req, res, url, user);
    }
    if (req.method === 'PUT' && url.pathname === `${env.apiBasePath}/profile`) {
      if (!requirePermission(res, user, Permissions.profileWrite)) return;
      return handleDashboardRequest(req, res, url, user);
    }
    if (req.method === 'POST' && [`${env.apiBasePath}/notifications/read`, `${env.apiBasePath}/notifications/read-all`].includes(url.pathname)) {
      if (!requirePermission(res, user, Permissions.dashboardRead)) return;
      return await dashboardHandler(req, res, url, user);
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/student/complaints`) {
      if (user.role !== 'student' || !requirePermission(res, user, Permissions.studentComplaintCreate)) return;
      return handleDashboardRequest(req, res, url, user);
    }
    if (url.pathname.startsWith(`${env.apiBasePath}/admin/password-reset-requests`)) {
      if (!requirePermission(res, user, Permissions.recoveryManage)) return;
    }
    if (url.pathname.startsWith(`${env.apiBasePath}/admin/complaints`) || url.pathname.startsWith(`${env.apiBasePath}/admin/communications`)) {
      if (!requirePermission(res, user, Permissions.complaintsManage)) return;
    }
    if (await handleAdminSupportRequest(req, res, url, user)) return true;
    if (url.pathname === `${env.apiBasePath}/admin/users` || url.pathname.startsWith(`${env.apiBasePath}/admin/users/`)) {
      const permission = req.method === 'GET' ? Permissions.usersRead : req.method === 'DELETE' ? Permissions.usersDelete : Permissions.usersWrite;
      if (!requirePermission(res, user, permission)) return;
    }
    if (!canAccess(user, req, url.pathname)) return forbidden(res);
    if (await handleAdminUserRequest(req, res, url, user)) return true;
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/health`) {
      return json(res, 200, { status: 'ok', mode: 'postgres', schema: 'canonical' });
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/dashboard`) {
      if (!requirePermission(res, user, Permissions.dashboardRead)) return;
      return handleDashboardRequest(req, res, url, user);
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/audit-logs`) {
      if (!requirePermission(res, user, Permissions.auditRead)) return;
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/recycle-bin`) {
      if (user.role !== 'super_admin') return forbidden(res);
    }

    if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+/restore$`))) {
      if (user.role !== 'super_admin') return forbidden(res);
    }

    if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+$`))) {
      if (user.role !== 'super_admin') return forbidden(res);
    }

    if (url.pathname === `${env.apiBasePath}/admin/import/validate`
      || url.pathname === `${env.apiBasePath}/admin/import`
      || url.pathname === `${env.apiBasePath}/admin/import/stages`
      || url.pathname.startsWith(`${env.apiBasePath}/admin/import/stages/`)) {
      if (!requirePermission(res, user, Permissions.catalogImport)) return;
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/export`) {
      if (!requirePermission(res, user, Permissions.catalogExport)) return;
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/backups`) {
      if (!requirePermission(res, user, Permissions.backupRun)) return;
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/backups`) {
      if (!requirePermission(res, user, Permissions.backupRun)) return;
    }

    if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/backups/\\d+/download$`))) {
      if (!requirePermission(res, user, Permissions.backupRun)) return;
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/system-health`) {
      if (!requirePermission(res, user, Permissions.systemRead)) return;
    }

    if (await handleAdminOperationsRequest(req, res, url, user)) return true;

    if (await handleCatalogReadRequest(req, res, url, user)) return true;
    if (await handleCatalogRequest(req, res, url, user)) return true;

    return json(res, 404, { error: 'API route not found' });
  } catch (error) {
    console.error(JSON.stringify({ requestId: req.requestId, event: 'api_error', name: error?.name, code: error?.code, message: String(error?.message || '').replace(/(?:password|token|secret|cookie)=?\S*/ig, '[redacted]') }));
    // A controller can fail after it has already committed its response (for
    // example, an async cleanup or logging step). At that point a JSON error
    // response would be a second write and can raise ERR_HTTP_HEADERS_SENT.
    // Preserve the original failure in logs, but leave the completed response
    // untouched. If headers were sent but the body is still open, terminate it.
    if (res.headersSent || res.writableEnded) {
      if (!res.writableEnded && typeof res.destroy === 'function') res.destroy();
      return true;
    }
    if (error.message === 'INVALID_JSON') return json(res, 400, { error: 'Invalid JSON payload' });
    if (error.message === 'PAYLOAD_TOO_LARGE' && [`${env.apiBasePath}/notifications/read`, `${env.apiBasePath}/notifications/read-all`].includes(url.pathname)) return json(res, 413, { error: 'Request body is too large.', code: 'PAYLOAD_TOO_LARGE' });
    if (error.message === 'PAYLOAD_TOO_LARGE') return json(res, 413, { error: 'Import file is too large (maximum 12 MB).' });
    if (error.message === 'PG_DRIVER_MISSING') return json(res, 500, { error: 'PostgreSQL driver is missing. Install pg.' });
    if (String(error.message || '').startsWith('DB_')) return json(res, 503, { error: databaseDiagnosticMessage(error) });
    if (String(error.message || '').startsWith('FK_') || ['23503', '23514'].includes(String(error.code))) return json(res, 400, { error: 'Invalid relation id provided.' });
    if (error.code === '23505') return json(res, 409, { error: String(error.constraint || '').includes('student_id') ? 'Student ID is already in use.' : 'Email is already in use.' });
    if (isSafeClientError(error)) return json(res, 400, { error: error.message });
    const mapped = toErrorResponse(error, req.requestId);
    return json(res, mapped.status, mapped.body);
  }
}
