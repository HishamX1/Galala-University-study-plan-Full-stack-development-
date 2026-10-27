import { restoreSession, signOut } from './shared/session.js';

const studentAction = document.getElementById('student-portal-action');
const adminAction = document.getElementById('admin-portal-action');
const user = await restoreSession();
const logoutUnconfirmed = new URLSearchParams(location.search).get('logout') === 'server-unconfirmed';
const params = new URLSearchParams(location.search);
const timedOutRole = params.get('sessionTimeout');
const expiredRole = params.get('sessionExpired');
if (timedOutRole || expiredRole) {
  const role = timedOutRole || expiredRole;
  const audience = role === 'student' ? 'student' : 'administrator';
  const status = document.createElement('p');
  status.className = 'session-return-notice';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = timedOutRole
    ? `For your security, your ${audience} session ended after 5 minutes without activity. Please sign in again to continue.`
    : `Your ${audience} session expired. Please sign in again to continue.`;
  if (logoutUnconfirmed) status.textContent += ' The service could not confirm server-side session revocation; reconnect before signing in again.';
  document.querySelector('main')?.prepend(status);
} else if (user?.unavailable || logoutUnconfirmed) {
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.textContent = logoutUnconfirmed
    ? 'You are signed out on this device. The service could not confirm server-side session revocation; reconnect and sign in again to verify your account status.'
    : 'Your sign-in status cannot be checked while the service is unavailable. Reload when your connection returns.';
  document.querySelector('main')?.prepend(status);
}
const control = document.getElementById('authenticated-control');
if (user && control) {
  const label = user.role === 'super_admin' ? 'Super Admin Dashboard' : user.role === 'regular_admin' ? 'Admin Dashboard' : 'Student Dashboard';
  control.hidden = false;
  control.innerHTML = `<a class="user-chip" href="./dashboard.html" aria-label="Open ${label}">${user.name} · ${label}</a><button type="button" id="landing-sign-out">Sign Out</button>`;
  document.getElementById('landing-sign-out').addEventListener('click', () => signOut('./index.html'));
}
if (user?.role === 'student') {
  studentAction.textContent = 'Open Student Portal'; studentAction.href = './student/index.html'; adminAction.closest('.portal-card').hidden = true;
} else if (['regular_admin', 'super_admin'].includes(user?.role)) {
  adminAction.textContent = user.role === 'super_admin' ? 'Open Super Admin Center' : 'Open Admin Portal'; adminAction.href = './admin/index.html';
  studentAction.closest('.portal-card').hidden = user.role === 'regular_admin';
  if (user.role === 'super_admin') { studentAction.textContent = 'Open Student Portal'; studentAction.href = './student/index.html'; }
}
