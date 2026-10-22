import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { validatePassword } from '../services/passwordService.js';
import {
  countSuperAdmins, createCommunication, createManagedUser, decidePasswordResetRequest,
  deleteUser, listCommunications, listComplaints, listPasswordResetRequests,
  listUsers, resetUserPassword, updateComplaint, updateUser
} from '../services/authService.js';

const auditActor = (user, req) => ({ ...user, ...(req.requestId ? { requestId: req.requestId } : {}) });

export async function handleAdminSupportRequest(req, res, url, user) {
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/password-reset-requests`) {
    json(res, 200, { requests: await listPasswordResetRequests() });
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/password-reset-requests/[^/]+/(approve|reject)$`))) {
    const body = await parseBody(req); const parts = url.pathname.split('/');
    const result = await decidePasswordResetRequest(parts.at(-2), parts.at(-1), user.id, body.note, auditActor(user, req));
    json(res, 200, { request: result });
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/complaints`) {
    json(res, 200, { complaints: await listComplaints() });
    return true;
  }
  if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/complaints/[^/]+$`))) {
    const body = await parseBody(req);
    json(res, 200, { complaint: await updateComplaint(url.pathname.split('/').at(-1), body.status, body.reply, user.id, auditActor(user, req)) });
    return true;
  }
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/communications`) {
    json(res, 200, { communications: await listCommunications() });
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/communications`) {
    const body = await parseBody(req);
    if (!body.recipientId || !String(body.message || '').trim()) { json(res, 400, { error: 'Recipient and message are required.' }); return true; }
    json(res, 201, { communication: await createCommunication(body.recipientId, String(body.message).trim(), user.id, auditActor(user, req)) });
    return true;
  }
  return false;
}

export async function handleAdminUserRequest(req, res, url, user) {
  if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/admin/users`) {
    json(res, 200, { users: await listUsers() });
    return true;
  }
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/admin/users`) {
    const body = await parseBody(req);
    if (!body.name || !body.email || !body.password || !['student','regular_admin','super_admin'].includes(body.role)) { json(res, 400, { error: 'Name, email, password, and a valid role are required' }); return true; }
    json(res, 201, { user: await createManagedUser(body, auditActor(user, req)) });
    return true;
  }
  if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+$`))) {
    const body = await parseBody(req); const id = url.pathname.split('/').at(-1);
    if (!body.name || !body.email || !['student','regular_admin','super_admin'].includes(body.role) || !['active','inactive','suspended'].includes(body.status)) { json(res, 400, { error: 'Invalid user data' }); return true; }
    if (id === user.id) { json(res, 400, { error: 'You cannot edit your own account from User Management.' }); return true; }
    if (body.role !== 'super_admin' && (await listUsers()).filter((item) => item.role === 'super_admin').length === 1) {
      const target = (await listUsers()).find((item) => item.id === id);
      if (target?.role === 'super_admin') { json(res, 400, { error: 'At least one Super Admin must remain.' }); return true; }
    }
    const updated = await updateUser(id, body, auditActor(user, req));
    if (!updated) {
      json(res, 404, { error: 'User not found' });
      return true;
    }
    json(res, 200, { user: updated });
    return true;
  }
  if (req.method === 'POST' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+/reset-password$`))) {
    const body = await parseBody(req); const id = url.pathname.split('/').at(-2);
    if (!body.password || body.password !== body.confirmPassword) { json(res, 400, { error: 'Passwords must match.' }); return true; }
    const passwordError = validatePassword(body.password);
    if (passwordError) { json(res, 400, { error: passwordError }); return true; }
    json(res, 200, { user: await resetUserPassword(id, body.password, auditActor(user, req)) });
    return true;
  }
  if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/admin/users/[^/]+$`))) {
    const id = url.pathname.split('/').at(-1);
    if (id === user.id) { json(res, 400, { error: 'You cannot delete the currently signed-in user.' }); return true; }
    const target = (await listUsers()).find((item) => item.id === id);
    if (!target) { json(res, 404, { error: 'User not found' }); return true; }
    if (target.role === 'super_admin' && await countSuperAdmins() <= 1) { json(res, 400, { error: 'The last remaining Super Admin cannot be deleted.' }); return true; }
    await deleteUser(id, auditActor(user, req));
    json(res, 200, { deleted: true });
    return true;
  }
  return false;
}
