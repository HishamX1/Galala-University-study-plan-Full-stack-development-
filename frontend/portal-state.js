import { restoreSession, signOut } from './shared/session.js';

const studentAction = document.getElementById('student-portal-action');
const adminAction = document.getElementById('admin-portal-action');
const user = await restoreSession();
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
