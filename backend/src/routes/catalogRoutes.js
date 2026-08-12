import {
  addPrerequisiteRelation,
  createFaculty,
  createProgram,
  createProgramCourse,
  deleteFaculty,
  deleteProgram,
  deleteProgramCourse,
  deletePrerequisiteRelation,
  getCatalog,
  getFaculties,
  getPrerequisites,
  getProgramCourseDeleteImpact,
  getProgramCourses,
  getProgramDeleteImpact,
  getPrograms,
  updateFaculty,
  updatePrerequisites,
  updatePrerequisiteVisibility,
  updateProgram,
  updateProgramCourse
} from '../services/catalogService.js';
import {
  createBackup,
  exportCatalog,
  getAuditLogs,
  getBackupDownload,
  getBackups,
  getDashboardSummary,
  getRecycleBin,
  getSystemHealth,
  importCatalog,
  permanentlyDeleteRecycleItem,
  restoreRecycleItem,
  validateImport
} from '../services/adminOpsService.js';
import {
  validateEntityId,
  validateFaculty,
  validateFacultyPatch,
  validatePrerequisites,
  validatePrerequisiteVisibility,
  validateProgram,
  validateProgramCourse,
  validateProgramCoursePatch,
  validateProgramPatch,
  validatePrerequisiteRelation
} from '../validation/schemas.js';
import { env } from '../config/env.js';
import { databaseDiagnosticMessage } from '../db/client.js';
import { authenticate, authCookies, clearAuthCookies, createSession, createUser, currentUser, deleteUser, listUsers, logout, publicUser, refreshSession, resetUserPassword, updateUser, countSuperAdmins, createPasswordResetRequest, listPasswordResetRequests, decidePasswordResetRequest, consumePasswordResetToken, createComplaint, listComplaints, updateComplaint, createCommunication, listCommunications, getDashboardData, updateOwnProfile } from '../services/authService.js';
import { validatePassword } from '../services/passwordService.js';

function isAllowedCorsOrigin(origin) {
  return Boolean(origin) && env.corsOrigins.includes(origin);
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (!isAllowedCorsOrigin(origin)) return false;
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Type');
  res.setHeader('Vary', 'Origin');
  return true;
}

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

function unauthorized(res) { return json(res, 401, { error: 'Authentication required' }); }
function forbidden(res) { return json(res, 403, { error: 'You do not have permission to access this resource' }); }
function canAccess(user, req, pathname) {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  const isRead = req.method === 'GET';
  const curriculum = pathname === `${env.apiBasePath}/catalog` || pathname.startsWith(`${env.apiBasePath}/faculties`) || pathname.startsWith(`${env.apiBasePath}/programs`) || pathname.startsWith(`${env.apiBasePath}/program-courses`);
  const studentCatalog = pathname === `${env.apiBasePath}/catalog` || pathname === `${env.apiBasePath}/faculties` || pathname === `${env.apiBasePath}/programs` || pathname === `${env.apiBasePath}/program-courses` || new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites$`).test(pathname);
  if (user.role === 'student') return isRead && studentCatalog && !new URL(req.url, 'http://localhost').searchParams.has('audience');
  // Regular administrators may operate the curriculum portal, but never the
  // super-admin account/request endpoints.  The old narrow allowlist made a
  // successful admin login look like a failed session during portal bootstrap.
  if (user.role === 'regular_admin') return curriculum || pathname.startsWith(`${env.apiBasePath}/admin/`);
  return false;
}

function download(res, payload) {
  res.writeHead(200, {
    'Content-Type': payload.mimeType,
    'Content-Disposition': `attachment; filename="${payload.filename.replaceAll('"', '')}"`,
    'Cache-Control': 'no-store',
  });
  res.end(payload.content);
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 12 * 1024 * 1024) throw new Error('PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function idFromPath(pathname) {
  return toNumber(pathname.split('/').filter(Boolean).at(-1));
}

async function handleUpdate(req, res, validator, updater, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const body = await parseBody(req);
  const err = validator(body);
  if (err) return json(res, 400, { error: err });
  const updated = await updater(id, body);
  if (updated === false) return json(res, 404, { error: `${label} not found` });
  if (!updated) return json(res, 409, { error: label === 'Program course' ? 'This course already exists.' : `${label} already exists` });
  return json(res, 200, updated);
}

async function handleDelete(res, deleter, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const deleted = await deleter(id);
  if (!deleted) return json(res, 404, { error: `${label} not found` });
  return json(res, 200, { deleted: true, id });
}

export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith(env.apiBasePath)) return false;
  const origin = req.headers.origin;
  if (origin && !applyCorsHeaders(req, res)) {
    return json(res, 403, { error: 'Origin is not allowed' });
  }
  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    if (req.method === 'POST' && [
      `${env.apiBasePath}/auth/login`, `${env.apiBasePath}/auth/student-login`, `${env.apiBasePath}/auth/admin-login`
    ].includes(url.pathname)) {
      const body = await parseBody(req);
      if (!body.identifier || !body.password) return json(res, 400, { error: 'Identifier and password are required' });
      const user = await authenticate(String(body.identifier), String(body.password));
      if (!user) return json(res, 401, { error: 'Invalid credentials or inactive account' });
      if (url.pathname.endsWith('/student-login') && user.role !== 'student') return json(res, 403, { error: 'This account belongs to the administrator portal.' });
      if (url.pathname.endsWith('/admin-login') && !['regular_admin', 'super_admin'].includes(user.role)) return json(res, 403, { error: 'Student accounts must use the Student Portal.' });
      const session = await createSession(user);
      return json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/auth/student-signup`) {
      const body = await parseBody(req);
      if (!body.name || !body.email || !body.password || !body.confirmPassword) return json(res, 400, { error: 'Full name, email, password, and confirmation are required.' });
      if (body.password !== body.confirmPassword) return json(res, 400, { error: 'Passwords do not match.' });
      const passwordError = validatePassword(body.password);
      if (passwordError) return json(res, 400, { error: passwordError });
      const user = await createUser({ name: String(body.name).trim(), email: String(body.email).trim(), studentId: String(body.studentId || '').trim(), password: body.password, role: 'student', status: 'active' });
      const session = await createSession(user);
      return json(res, 201, { user: publicUser(user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/auth/password-reset-requests`) {
      const body = await parseBody(req);
      if (!body.identifier) return json(res, 400, { error: 'Email or student ID is required.' });
      // Return the same response for unknown accounts to avoid account enumeration.
      await createPasswordResetRequest(String(body.identifier), body.message);
      return json(res, 202, { message: 'If an active account matches that identifier, a reset request has been recorded.' });
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/auth/password-reset`) {
      const body = await parseBody(req);
      if (!body.token || !body.password || body.password !== body.confirmPassword) return json(res, 400, { error: 'A valid token and matching passwords are required.' });
      const passwordError = validatePassword(body.password); if (passwordError) return json(res, 400, { error: passwordError });
      await consumePasswordResetToken(String(body.token), body.password);
      return json(res, 204, {});
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/auth/refresh`) {
      const session = await refreshSession(req);
      if (!session) return json(res, 401, { error: 'Session expired' }, { 'Set-Cookie': clearAuthCookies() });
      return json(res, 200, { user: publicUser(session.user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/auth/logout`) { await logout(req); return json(res, 204, {}, { 'Set-Cookie': clearAuthCookies() }); }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/auth/me`) { const user = await currentUser(req); return user ? json(res, 200, { user: publicUser(user) }) : unauthorized(res); }

    const user = await currentUser(req);
    if (!user) return unauthorized(res);
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/dashboard`) {
      const dashboard = await getDashboardData(user);
      if (user.role !== 'student') dashboard.catalog = await getDashboardSummary();
      if (user.role === 'super_admin') dashboard.systemHealth = await getSystemHealth();
      return json(res, 200, dashboard);
    }
    if (req.method === 'PUT' && url.pathname === `${env.apiBasePath}/profile`) {
      const body = await parseBody(req);
      return json(res, 200, { user: await updateOwnProfile(user.id, body) });
    }
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/student/complaints`) {
      if (user.role !== 'student') return forbidden(res);
      const body = await parseBody(req);
      if (!String(body.message || '').trim()) return json(res, 400, { error: 'A complaint message is required.' });
      return json(res, 201, { complaint: await createComplaint(user, String(body.message).trim()) });
    }
    if (url.pathname.startsWith(`${env.apiBasePath}/admin/password-reset-requests`) || url.pathname.startsWith(`${env.apiBasePath}/admin/complaints`) || url.pathname.startsWith(`${env.apiBasePath}/admin/communications`)) {
      if (user.role !== 'super_admin') return forbidden(res);
    }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/password-reset-requests`) return json(res, 200, { requests: await listPasswordResetRequests() });
    if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/password-reset-requests/[^/]+/(approve|reject)$`))) {
      const body = await parseBody(req); const parts = url.pathname.split('/');
      const result = await decidePasswordResetRequest(parts.at(-2), parts.at(-1), user.id, body.note);
      return json(res, 200, { request: result });
    }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/complaints`) return json(res, 200, { complaints: await listComplaints() });
    if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/complaints/[^/]+$`))) {
      const body = await parseBody(req); return json(res, 200, { complaint: await updateComplaint(url.pathname.split('/').at(-1), body.status, body.reply, user.id) });
    }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/communications`) return json(res, 200, { communications: await listCommunications() });
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/communications`) {
      const body = await parseBody(req);
      if (!body.recipientId || !String(body.message || '').trim()) return json(res, 400, { error: 'Recipient and message are required.' });
      return json(res, 201, { communication: await createCommunication(body.recipientId, String(body.message).trim(), user.id) });
    }
    if (url.pathname === `${env.apiBasePath}/admin/users` || url.pathname.startsWith(`${env.apiBasePath}/admin/users/`)) {
      if (user.role !== 'super_admin') return forbidden(res);
    }
    if (!canAccess(user, req, url.pathname)) return forbidden(res);
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/users`) return json(res, 200, { users: await listUsers() });
    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/users`) {
      const body = await parseBody(req);
      if (!body.name || !body.email || !body.password || !['student','regular_admin','super_admin'].includes(body.role)) return json(res, 400, { error: 'Name, email, password, and a valid role are required' });
      return json(res, 201, { user: await createUser(body) });
    }
    if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+$`))) {
      const body = await parseBody(req); const id = url.pathname.split('/').at(-1);
      if (!body.name || !body.email || !['student','regular_admin','super_admin'].includes(body.role) || !['active','inactive','suspended'].includes(body.status)) return json(res, 400, { error: 'Invalid user data' });
      if (id === user.id) return json(res, 400, { error: 'You cannot edit your own account from User Management.' });
      if (body.role !== 'super_admin' && (await listUsers()).filter((item) => item.role === 'super_admin').length === 1) {
        const target = (await listUsers()).find((item) => item.id === id);
        if (target?.role === 'super_admin') return json(res, 400, { error: 'At least one Super Admin must remain.' });
      }
      const updated = await updateUser(id, body); return updated ? json(res, 200, { user: updated }) : json(res, 404, { error: 'User not found' });
    }
    if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+/reset-password$`))) {
      const body = await parseBody(req); const id = url.pathname.split('/').at(-2);
      if (!body.password || body.password !== body.confirmPassword) return json(res, 400, { error: 'Passwords must match.' });
      const passwordError = validatePassword(body.password); if (passwordError) return json(res, 400, { error: passwordError });
      return json(res, 200, { user: await resetUserPassword(id, body.password) });
    }
    if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+$`))) {
      const id = url.pathname.split('/').at(-1);
      if (id === user.id) return json(res, 400, { error: 'You cannot delete the currently signed-in user.' });
      const target = (await listUsers()).find((item) => item.id === id);
      if (!target) return json(res, 404, { error: 'User not found' });
      if (target.role === 'super_admin' && await countSuperAdmins() <= 1) return json(res, 400, { error: 'The last remaining Super Admin cannot be deleted.' });
      await deleteUser(id); return json(res, 200, { deleted: true });
    }
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/health`) {
      return json(res, 200, { status: 'ok', mode: 'postgres', schema: 'canonical' });
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/dashboard`) {
      return json(res, 200, await getDashboardSummary());
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/audit-logs`) {
      return json(res, 200, await getAuditLogs({
        range: url.searchParams.get('range') || '',
        entity: url.searchParams.get('entity') || '',
        action: url.searchParams.get('action') || '',
        search: url.searchParams.get('search') || '',
        order: url.searchParams.get('order') || 'newest'
      }));
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/recycle-bin`) {
      return json(res, 200, await getRecycleBin());
    }

    if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+/restore$`))) {
      const parts = url.pathname.split('/');
      const kind = parts.at(-3);
      const id = toNumber(parts.at(-2));
      const idErr = validateEntityId(id, `${kind} id`);
      if (idErr) return json(res, 400, { error: idErr });
      const restored = await restoreRecycleItem(kind, id);
      if (!restored) return json(res, 404, { error: 'Recycle bin item not found' });
      return json(res, 200, { restored: true, kind, id });
    }

    if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/recycle-bin/[^/]+/\\d+$`))) {
      const parts = url.pathname.split('/');
      const kind = parts.at(-2);
      const id = toNumber(parts.at(-1));
      const idErr = validateEntityId(id, `${kind} id`);
      if (idErr) return json(res, 400, { error: idErr });
      const deleted = await permanentlyDeleteRecycleItem(kind, id);
      if (!deleted) return json(res, 404, { error: 'Recycle bin item not found' });
      return json(res, 200, { deleted: true, kind, id });
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import/validate`) {
      const body = await parseBody(req);
      return json(res, 200, await validateImport(body));
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/import`) {
      const body = await parseBody(req);
      const result = await importCatalog(body);
      return json(res, result.valid ? 201 : 400, result);
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/export`) {
      return download(res, await exportCatalog(url.searchParams.get('format') || 'json'));
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/backups`) {
      return json(res, 200, await getBackups());
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/backups`) {
      const body = await parseBody(req);
      return json(res, 201, await createBackup(body.format || 'json'));
    }

    if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/backups/\\d+/download$`))) {
      const id = toNumber(url.pathname.split('/').at(-2));
      const idErr = validateEntityId(id, 'backup id');
      if (idErr) return json(res, 400, { error: idErr });
      const backup = await getBackupDownload(id);
      if (!backup) return json(res, 404, { error: 'Backup not found' });
      return download(res, backup);
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/system-health`) {
      return json(res, 200, await getSystemHealth());
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/catalog`) {
      return json(res, 200, await getCatalog({ includeHidden: url.searchParams.get('audience') === 'admin' }));
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/faculties`) {
      return json(res, 200, await getFaculties());
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/faculties`) {
      const body = await parseBody(req);
      const err = validateFaculty(body);
      if (err) return json(res, 400, { error: err });
      const created = await createFaculty(body);
      if (!created) return json(res, 409, { error: 'Faculty already exists' });
      return json(res, 201, created);
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) {
      return handleUpdate(req, res, validateFacultyPatch, updateFaculty, idFromPath(url.pathname), 'Faculty');
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) {
      return handleDelete(res, deleteFaculty, idFromPath(url.pathname), 'Faculty');
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/programs`) {
      return json(res, 200, await getPrograms(toNumber(url.searchParams.get('facultyId'))));
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/programs`) {
      const body = await parseBody(req);
      const err = validateProgram(body);
      if (err) return json(res, 400, { error: err });
      const created = await createProgram(body);
      if (!created) return json(res, 409, { error: 'Program already exists for this faculty' });
      return json(res, 201, created);
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) {
      return handleUpdate(req, res, validateProgramPatch, updateProgram, idFromPath(url.pathname), 'Program');
    }

    if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/programs/\\d+/delete-impact$`))) {
      const id = toNumber(url.pathname.split('/').at(-2));
      const idErr = validateEntityId(id, 'program id');
      if (idErr) return json(res, 400, { error: idErr });
      const impact = await getProgramDeleteImpact(id);
      if (!impact) return json(res, 404, { error: 'Program not found' });
      return json(res, 200, impact);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) {
      return handleDelete(res, deleteProgram, idFromPath(url.pathname), 'Program');
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/program-courses`) {
      return json(
        res,
        200,
        await getProgramCourses({
          facultyId: toNumber(url.searchParams.get('facultyId')),
          programId: toNumber(url.searchParams.get('programId')),
          yearNo: toNumber(url.searchParams.get('yearNo')),
          semesterNo: toNumber(url.searchParams.get('semesterNo'))
        }, { includeHidden: url.searchParams.get('audience') === 'admin' })
      );
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/program-courses`) {
      const body = await parseBody(req);
      const err = validateProgramCourse(body);
      if (err) return json(res, 400, { error: err });
      const created = await createProgramCourse(body);
      if (!created) return json(res, 409, { error: 'This course already exists.' });
      return json(res, 201, created);
    }

    if (url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites$`))) {
      const id = toNumber(url.pathname.split('/').at(-2));
      const idErr = validateEntityId(id, 'program course id');
      if (idErr) return json(res, 400, { error: idErr });
      if (req.method === 'GET') return json(res, 200, { prerequisiteCourseIds: await getPrerequisites(id) });
      if (req.method === 'POST') {
        const body = await parseBody(req);
        const err = validatePrerequisiteRelation(body);
        if (err) return json(res, 400, { error: err });
        const created = await addPrerequisiteRelation(id, body.prerequisiteCourseId);
        if (!created) return json(res, 409, { error: 'This relationship is already defined.' });
        return json(res, 201, created);
      }
      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const err = validatePrerequisites(body);
        if (err) return json(res, 400, { error: err });
        return json(res, 200, { prerequisiteCourseIds: await updatePrerequisites(id, body.prerequisiteCourseIds || []) });
      }
    }

    if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites/\\d+/visibility$`))) {
      const parts = url.pathname.split('/');
      const id = toNumber(parts.at(-4));
      const prerequisiteId = toNumber(parts.at(-2));
      const idErr = validateEntityId(id, 'program course id') || validateEntityId(prerequisiteId, 'prerequisite course id');
      if (idErr) return json(res, 400, { error: idErr });
      const body = await parseBody(req);
      const err = validatePrerequisiteVisibility(body);
      if (err) return json(res, 400, { error: err });
      const updated = await updatePrerequisiteVisibility(id, prerequisiteId, body.visibleToStudents);
      if (!updated) return json(res, 404, { error: 'Prerequisite relation not found' });
      return json(res, 200, { updated: true, courseId: id, prerequisiteCourseId: prerequisiteId, visibleToStudents: body.visibleToStudents });
    }

    if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites/\\d+$`))) {
      const parts = url.pathname.split('/');
      const id = toNumber(parts.at(-3));
      const prerequisiteId = toNumber(parts.at(-1));
      const idErr = validateEntityId(id, 'program course id') || validateEntityId(prerequisiteId, 'prerequisite course id');
      if (idErr) return json(res, 400, { error: idErr });
      const deleted = await deletePrerequisiteRelation(id, prerequisiteId);
      if (!deleted) return json(res, 404, { error: 'Prerequisite relation not found' });
      return json(res, 200, { deleted: true, courseId: id, prerequisiteCourseId: prerequisiteId });
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) {
      return handleUpdate(req, res, validateProgramCoursePatch, updateProgramCourse, idFromPath(url.pathname), 'Program course');
    }

    if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/delete-impact$`))) {
      const id = toNumber(url.pathname.split('/').at(-2));
      const idErr = validateEntityId(id, 'program course id');
      if (idErr) return json(res, 400, { error: idErr });
      const impact = await getProgramCourseDeleteImpact(id);
      if (!impact) return json(res, 404, { error: 'Program course not found' });
      return json(res, 200, impact);
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) {
      return handleDelete(res, deleteProgramCourse, idFromPath(url.pathname), 'Program course');
    }

    return json(res, 404, { error: 'API route not found' });
  } catch (error) {
    console.error('API route error:', error);
    if (error.message === 'INVALID_JSON') return json(res, 400, { error: 'Invalid JSON payload' });
    if (error.message === 'PAYLOAD_TOO_LARGE') return json(res, 413, { error: 'Import file is too large (maximum 12 MB).' });
    if (error.message === 'PG_DRIVER_MISSING') return json(res, 500, { error: 'PostgreSQL driver is missing. Install pg.' });
    if (String(error.message || '').startsWith('DB_')) return json(res, 503, { error: databaseDiagnosticMessage(error) });
    if (String(error.message || '').startsWith('FK_')) return json(res, 400, { error: 'Invalid relation id provided.' });
    if (error.code === '23505') return json(res, 409, { error: String(error.constraint || '').includes('student_id') ? 'Student ID is already in use.' : 'Email is already in use.' });
    if (error.message && !/password hash|stored password/i.test(error.message)) return json(res, 400, { error: error.message });
    return json(res, 500, { error: 'Internal server error' });
  }
}
