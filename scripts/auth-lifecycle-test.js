import crypto from 'node:crypto';
import { authenticate, createSession, createUser, currentUser, refreshSession, resetUserPassword, updateUser } from '../backend/src/services/authService.js';
import { closePool, query } from '../backend/src/db/client.js';

if (process.env.NODE_ENV === 'production') throw new Error('Authentication lifecycle tests must not run in production.');

const suffix = crypto.randomUUID();
const email = `auth-lifecycle-${suffix}@example.test`;
const studentId = `AUTH-${suffix}`;
const initialPassword = 'InitialPass!2026';
const updatedPassword = 'UpdatedPass!2026';
const resetPassword = 'ResetPass!2026';
let userId;

try {
  const created = await createUser({ name: 'Authentication Lifecycle Test', email, studentId, password: initialPassword, role: 'super_admin', status: 'active' });
  userId = created.id;
  if (!(await authenticate(email, initialPassword))) throw new Error('Newly created password did not authenticate.');

  const updated = await updateUser(userId, { name: created.name, email, studentId, password: updatedPassword, role: 'super_admin', status: 'active' });
  if (!updated || await authenticate(email, initialPassword) || !(await authenticate(email, updatedPassword))) throw new Error('Password update verification failed.');

  await resetUserPassword(userId, resetPassword);
  const authenticated = await authenticate(email, resetPassword);
  if (!authenticated || await authenticate(email, updatedPassword)) throw new Error('Password reset verification failed.');

  const session = await createSession(authenticated);
  if (!(await currentUser({ headers: { cookie: `gu_access=${encodeURIComponent(session.accessToken)}` } }))) throw new Error('JWT session verification failed.');
  if (!(await refreshSession({ headers: { cookie: `gu_refresh=${encodeURIComponent(session.refreshToken)}` } }))) throw new Error('Refresh token verification failed.');
  console.log('Authentication lifecycle test passed.');
} finally {
  if (userId) await query('DELETE FROM public.app_users WHERE id = $1', [userId]);
  await closePool();
}
