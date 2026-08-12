import { getWorkingApiBase, request, updateConfiguredApiBase } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { loadAdminOps } from './adminOps.js';
import { signOut } from '../../shared/session.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);

async function loadControlCenter() {
  const [resetData, complaintData, communicationData] = await Promise.all([request('/admin/password-reset-requests'), request('/admin/complaints'), request('/admin/communications')]);
  const resets = document.getElementById('resetRequestList');
  const complaints = document.getElementById('complaintList');
  const communications = document.getElementById('communicationList');
  if (resets) resets.innerHTML = resetData.requests.map((item) => `<tr><td>${escapeHtml(item.name)}<small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.created_at)}</td><td>${item.status === 'open' ? `<button data-reset-decision="approve" data-request-id="${item.id}">Approve</button> <button data-reset-decision="reject" data-request-id="${item.id}">Reject</button>` : '-'}</td></tr>`).join('') || '<tr><td colspan="5">No requests.</td></tr>';
  if (complaints) complaints.innerHTML = complaintData.complaints.map((item) => `<tr><td>${escapeHtml(item.student_id || '-')}<small>${escapeHtml(item.email)}</small></td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.status)}</td><td><button data-complaint-id="${item.id}">Update</button></td></tr>`).join('') || '<tr><td colspan="4">No complaints.</td></tr>';
  if (communications) communications.innerHTML = communicationData.communications.map((item) => `<tr><td>${escapeHtml(item.recipient_name)}<small>${escapeHtml(item.recipient_email)}</small></td><td>${escapeHtml(item.subject)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">No queued communications.</td></tr>';
}

export function setupLogin() {
  if (elements.apiBaseInput) {
    elements.apiBaseInput.value = getWorkingApiBase() || '';
    elements.apiBaseInput.addEventListener('change', () => {
      updateConfiguredApiBase(elements.apiBaseInput.value);
      elements.apiBaseInput.value = getWorkingApiBase();
    });
  }

  const onLogin = async () => {
    elements.authError.textContent = '';
    const username = elements.userInput.value.trim();
    const password = elements.passInput.value.trim();

    try {
      const { user } = await request('/auth/admin-login', { method: 'POST', body: JSON.stringify({ identifier: username, password }) });
      if (!['regular_admin', 'super_admin'].includes(user.role)) { window.location.assign('../denied.html'); return; }
      elements.loginCard.hidden = true;
      elements.dashboard.hidden = false;
      document.querySelector('[data-user-name]')?.replaceChildren(document.createTextNode(`${user.name} (${user.role.replace('_', ' ')})`));
      document.querySelectorAll('[data-super-admin]').forEach((item) => { item.hidden = user.role !== 'super_admin'; });
      setMessage('success', `Welcome, ${user.name}`);
      await loadRelations();
      await loadAdminOps();
      if (user.role === 'super_admin') await loadControlCenter();
    } catch (error) {
      setMessage('error', error.message);
    }
  };

  elements.loginBtn.addEventListener('click', onLogin);
  elements.passInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onLogin();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => signOut('../index.html'));

  const renderUsers = async () => {
    const { users } = await request('/admin/users');
    const list = document.getElementById('managedUserList');
    const search = String(document.getElementById('userSearch')?.value || '').toLowerCase();
    const role = document.getElementById('userRoleFilter')?.value || '';
    const status = document.getElementById('userStatusFilter')?.value || '';
    const filtered = users.filter((u) => !search || [u.name, u.email, u.student_id].some((v) => String(v || '').toLowerCase().includes(search))).filter((u) => !role || u.role === role).filter((u) => !status || u.status === status);
    if (list) { list._users = users; list.innerHTML = filtered.map((u) => `<tr><td>${u.name}<small>${u.student_id || 'No student ID'}</small></td><td>${u.email}</td><td>${u.role.replace('_', ' ')}</td><td>${u.status}</td><td class="user-actions"><button data-action="view" data-user-id="${u.id}">View</button><button data-action="edit" data-user-id="${u.id}">Edit</button><button data-action="reset" data-user-id="${u.id}">Reset password</button><button data-action="${u.status === 'suspended' ? 'activate' : 'suspend'}" data-user-id="${u.id}">${u.status === 'suspended' ? 'Activate' : 'Suspend'}</button><button data-action="delete" data-user-id="${u.id}">Delete</button></td></tr>`).join('') || '<tr><td colspan="5">No matching users.</td></tr>'; }
  };
  document.getElementById('createManagedUser')?.addEventListener('click', async () => {
    try {
      await request('/admin/users', { method: 'POST', body: JSON.stringify({ name: document.getElementById('managedUserName').value.trim(), email: document.getElementById('managedUserEmail').value.trim(), studentId: document.getElementById('managedUserStudentId').value.trim(), password: document.getElementById('managedUserPassword').value, role: document.getElementById('managedUserRole').value, status: document.getElementById('managedUserStatus').value }) });
      setMessage('success', 'User created.'); await renderUsers();
    } catch (error) { setMessage('error', error.message); }
  });
  const dialog = document.getElementById('userDialog');
  const openDialog = (title, markup, userId) => { dialog.querySelector('h3').textContent = title; dialog.querySelector('.user-dialog-body').innerHTML = markup; dialog.dataset.userId = userId; dialog.hidden = false; };
  document.getElementById('managedUserList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-user-id]'); if (!button) return;
    const user = event.currentTarget._users?.find((item) => item.id === button.dataset.userId); if (!user) return;
    const action = button.dataset.action;
    if (action === 'view') return openDialog('User details', `<p><b>Name:</b> ${user.name}</p><p><b>Email:</b> ${user.email}</p><p><b>Student ID:</b> ${user.student_id || 'Not set'}</p><p><b>Role:</b> ${user.role}</p><p><b>Status:</b> ${user.status}</p>`, user.id);
    if (action === 'reset') return openDialog('Reset password', '<form id="resetUserForm"><label>New password<input name="password" type="password" required></label><label>Confirm password<input name="confirmPassword" type="password" required></label><button>Reset password</button></form>', user.id);
    if (action === 'edit') return openDialog('Edit user', `<form id="editUserForm"><label>Name<input name="name" value="${user.name}" required></label><label>Email<input name="email" type="email" value="${user.email}" required></label><label>Student ID<input name="studentId" value="${user.student_id || ''}"></label><label>Role<select name="role"><option value="student" ${user.role === 'student' ? 'selected' : ''}>Student</option><option value="regular_admin" ${user.role === 'regular_admin' ? 'selected' : ''}>Regular Admin</option><option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option></select></label><label>Status<select name="status"><option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${user.status === 'inactive' ? 'selected' : ''}>Inactive</option><option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></label><button>Save changes</button></form>`, user.id);
    try { if (action === 'delete') { if (!confirm(`Delete ${user.name}? This permanently removes the account and its sessions.`)) return; await request(`/admin/users/${user.id}`, { method: 'DELETE' }); } else { await request(`/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name:user.name,email:user.email,studentId:user.student_id || '',role:user.role,status:action === 'suspend' ? 'suspended' : 'active' }) }); } setMessage('success', `User ${action}d.`); await renderUsers(); } catch (error) { setMessage('error', error.message); }
  });
  dialog?.addEventListener('submit', async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(event.target)); try { await request(event.target.id === 'resetUserForm' ? `/admin/users/${dialog.dataset.userId}/reset-password` : `/admin/users/${dialog.dataset.userId}`, { method: event.target.id === 'resetUserForm' ? 'POST' : 'PUT', body: JSON.stringify(values) }); dialog.hidden = true; setMessage('success', 'User updated.'); await renderUsers(); } catch (error) { setMessage('error', error.message); } });
  document.getElementById('userDialogClose')?.addEventListener('click', () => { dialog.hidden = true; });
  ['userSearch', 'userRoleFilter', 'userStatusFilter'].forEach((id) => document.getElementById(id)?.addEventListener('input', renderUsers));

  request('/auth/me').then(async ({ user }) => {
    if (!['regular_admin', 'super_admin'].includes(user.role)) { window.location.assign('../denied.html'); return; }
    elements.loginCard.hidden = true;
    elements.dashboard.hidden = false;
    document.querySelector('[data-user-name]')?.replaceChildren(document.createTextNode(`${user.name} (${user.role.replace('_', ' ')})`));
    document.querySelectorAll('[data-super-admin]').forEach((item) => { item.hidden = user.role !== 'super_admin'; });
    await loadRelations(); await loadAdminOps(); if (user.role === 'super_admin') { await renderUsers(); await loadControlCenter(); }
  }).catch(() => { window.location.assign('../admin-login.html'); });

  document.getElementById('resetRequestList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reset-decision]'); if (!button) return;
    try { const { request: reset } = await request(`/admin/password-reset-requests/${button.dataset.requestId}/${button.dataset.resetDecision}`, { method: 'POST', body: JSON.stringify({}) }); if (reset.resetLink) prompt('Copy this one-time reset link and send it only to the registered email:', `${location.origin}${reset.resetLink}`); setMessage('success', 'Request updated.'); await loadControlCenter(); } catch (error) { setMessage('error', error.message); }
  });
  document.getElementById('complaintList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-complaint-id]'); if (!button) return;
    const reply = prompt('Reply to the student (saved for registered-email delivery):'); if (reply === null) return;
    const status = prompt('Status: open, in_progress, or resolved', 'in_progress'); if (!status) return;
    try { await request(`/admin/complaints/${button.dataset.complaintId}`, { method: 'PUT', body: JSON.stringify({ status, reply }) }); setMessage('success', 'Complaint updated.'); await loadControlCenter(); } catch (error) { setMessage('error', error.message); }
  });
}
