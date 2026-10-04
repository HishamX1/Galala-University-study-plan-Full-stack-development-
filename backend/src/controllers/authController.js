import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { authenticate, authCookies, clearAuthCookies, consumePasswordResetToken, createPasswordResetRequest, createSession, createUser, currentUser, logout, publicUser, refreshSession } from '../services/authService.js';
import { validatePassword } from '../services/passwordService.js';

export async function handleAuthRequest(req, res, url) {
  const path = url.pathname;
  if (req.method === 'POST' && [`${env.apiBasePath}/auth/login`, `${env.apiBasePath}/auth/student-login`, `${env.apiBasePath}/auth/admin-login`].includes(path)) {
    const body = await parseBody(req);
    if (!body.identifier || !body.password) { json(res, 400, { error: 'Identifier and password are required' }); return true; }
    const user = await authenticate(String(body.identifier), String(body.password));
    if (!user) { json(res, 401, { error: 'Invalid credentials or inactive account' }); return true; }
    if (path.endsWith('/student-login') && user.role !== 'student') { json(res, 403, { error: 'This account belongs to the administrator portal.' }); return true; }
    if (path.endsWith('/admin-login') && !['regular_admin', 'super_admin'].includes(user.role)) { json(res, 403, { error: 'Student accounts must use the Student Portal.' }); return true; }
    const session = await createSession(user);
    json(res, 200, { user: publicUser(user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    return true;
  }
  if (req.method === 'POST' && path === `${env.apiBasePath}/auth/student-signup`) {
    const body = await parseBody(req);
    if (!body.name || !body.email || !body.password || !body.confirmPassword) { json(res, 400, { error: 'Full name, email, password, and confirmation are required.' }); return true; }
    if (body.password !== body.confirmPassword) { json(res, 400, { error: 'Passwords do not match.' }); return true; }
    const passwordError = validatePassword(body.password);
    if (passwordError) { json(res, 400, { error: passwordError }); return true; }
    const user = await createUser({ name: String(body.name).trim(), email: String(body.email).trim(), studentId: String(body.studentId || '').trim(), password: body.password, role: 'student', status: 'active' });
    const session = await createSession(user);
    json(res, 201, { user: publicUser(user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    return true;
  }
  if (req.method === 'POST' && path === `${env.apiBasePath}/auth/password-reset-requests`) {
    const body = await parseBody(req);
    if (!body.identifier) { json(res, 400, { error: 'Email or student ID is required.' }); return true; }
    await createPasswordResetRequest(String(body.identifier), body.message);
    json(res, 202, { message: 'If an active account matches that identifier, a reset request has been recorded.' });
    return true;
  }
  if (req.method === 'POST' && path === `${env.apiBasePath}/auth/password-reset`) {
    const body = await parseBody(req);
    if (!body.token || !body.password || body.password !== body.confirmPassword) { json(res, 400, { error: 'A valid token and matching passwords are required.' }); return true; }
    const passwordError = validatePassword(body.password);
    if (passwordError) { json(res, 400, { error: passwordError }); return true; }
    await consumePasswordResetToken(String(body.token), body.password);
    json(res, 204, {});
    return true;
  }
  if (req.method === 'POST' && path === `${env.apiBasePath}/auth/refresh`) {
    const session = await refreshSession(req);
    if (!session) { json(res, 401, { error: 'Session expired' }, { 'Set-Cookie': clearAuthCookies() }); return true; }
    json(res, 200, { user: publicUser(session.user) }, { 'Set-Cookie': authCookies(session.accessToken, session.refreshToken, session.refreshTtlSeconds) });
    return true;
  }
  if (req.method === 'POST' && path === `${env.apiBasePath}/auth/logout`) { await logout(req); json(res, 204, {}, { 'Set-Cookie': clearAuthCookies() }); return true; }
  if (req.method === 'GET' && path === `${env.apiBasePath}/auth/me`) { const user = await currentUser(req); json(res, user ? 200 : 401, user ? { user: publicUser(user) } : { error: 'Authentication required' }); return true; }
  return false;
}
