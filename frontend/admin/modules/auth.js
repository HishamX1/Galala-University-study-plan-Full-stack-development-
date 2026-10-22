import { getWorkingApiBase, request, updateConfiguredApiBase } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { loadAdminOps } from './adminOps.js';
import { signOut } from '../../shared/session.js';
import { cache } from './state.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);

async function loadControlCenter() {
  const [resetData, complaintData, communicationData, userData] = await Promise.all([request('/admin/password-reset-requests'), request('/admin/complaints'), request('/admin/communications'), cache.complaintAdmins.length ? Promise.resolve(null) : request('/admin/users')]);
  if (userData) cache.complaintAdmins = userData.users.filter((item) => ['regular_admin', 'super_admin'].includes(item.role) && item.status === 'active');
  const resets = document.getElementById('resetRequestList');
  const complaints = document.getElementById('complaintList');
  const communications = document.getElementById('communicationList');
  if (resets) resets.innerHTML = resetData.requests.map((item) => `<tr data-reset-request-row="${escapeHtml(item.id)}"><td>${escapeHtml(item.name)}<small>${escapeHtml(item.email)} · ${escapeHtml(item.student_id || 'Student ID not recorded')}</small></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.created_at)}</td><td>${item.decided_at ? `${escapeHtml(item.decided_by_name || 'Historical administrator unavailable')}<small>${escapeHtml(item.decided_at)}</small>` : 'Awaiting review'}</td><td>${item.status === 'open' ? `<button data-reset-decision="approve" data-request-id="${escapeHtml(item.id)}">Approve</button> <button data-reset-decision="reject" data-request-id="${escapeHtml(item.id)}">Reject</button>` : '-'}</td></tr>`).join('') || '<tr><td colspan="6">No requests.</td></tr>';
  if (complaints) complaints.innerHTML = complaintData.complaints.map((item) => {
    const submitter = item.submitted_name || item.current_submitter_name || 'Historical identity unavailable';
    const modifier = item.last_modified_by_name || (new Date(item.updated_at).getTime() > new Date(item.created_at).getTime() ? 'Historical administrator unavailable' : 'Not modified');
    const assigneeOptions = [`<option value="">Unassigned</option>`, ...cache.complaintAdmins.map((admin) => `<option value="${escapeHtml(admin.id)}" ${admin.id === item.assigned_to ? 'selected' : ''}>${escapeHtml(admin.name)} (${escapeHtml(admin.role.replace('_', ' '))})</option>`)].join('');
    return `<tr data-complaint-row="${escapeHtml(item.id)}"><td>${escapeHtml(submitter)}<small>${escapeHtml(item.student_id || 'Student ID not recorded')} · ${escapeHtml(item.email)}</small><small>Submitted ${escapeHtml(item.created_at)}</small></td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.status)}</td><td><div>${item.assigned_to_name ? `${escapeHtml(item.assigned_to_name)} (assigned by ${escapeHtml(item.assigned_by_name || 'Historical administrator unavailable')})` : 'Unassigned'}</div><small>${item.assigned_at ? `Assignment updated ${escapeHtml(item.assigned_at)}` : 'No assignment history'}</small><select aria-label="Assign complaint ${escapeHtml(item.id)}" data-complaint-assignee="${escapeHtml(item.id)}">${assigneeOptions}</select><button type="button" data-complaint-assign="${escapeHtml(item.id)}">Save assignment</button></td><td>${escapeHtml(modifier)}<small>${escapeHtml(item.updated_at)}</small></td><td><button type="button" data-complaint-view="${escapeHtml(item.id)}">View history</button><button type="button" data-complaint-update="${escapeHtml(item.id)}">Update status / reply</button></td></tr>`;
  }).join('') || '<tr><td colspan="6">No complaints.</td></tr>';
  if (communications) communications.innerHTML = communicationData.communications.map((item) => `<tr><td>${escapeHtml(item.recipient_name)}<small>${escapeHtml(item.recipient_email)}</small></td><td>${escapeHtml(item.subject)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.created_at)}</td></tr>`).join('') || '<tr><td colspan="4">No queued communications.</td></tr>';
}

async function showComplaintDetails(id) {
  const dialog = document.getElementById('complaintDetailDialog');
  const content = document.getElementById('complaintDetailContent');
  const { complaint, history } = await request(`/admin/complaints/${encodeURIComponent(id)}`);
  const submitter = complaint.submitted_name || complaint.current_submitter_name || 'Historical identity unavailable';
  const modifier = complaint.last_modified_by_name || (new Date(complaint.updated_at).getTime() > new Date(complaint.created_at).getTime() ? 'Historical administrator unavailable' : 'Not modified');
  const events = history.length ? history.map((event) => `<li><strong>${escapeHtml(event.action)}</strong><br>${escapeHtml(event.description || 'No historical summary recorded')}<br><span>${escapeHtml(event.actor_name || 'Historical actor unavailable')}${event.actor_role ? ` (${escapeHtml(event.actor_role.replace('_', ' '))})` : ''} · ${escapeHtml(event.created_at)}</span></li>`).join('') : '<li>No retained activity history. Earlier changes may predate audit logging.</li>';
  content.innerHTML = `<dl><dt>Submitter</dt><dd>${escapeHtml(submitter)} · ${escapeHtml(complaint.student_id || 'Student ID not recorded')} · ${escapeHtml(complaint.email)}</dd><dt>Submitted</dt><dd>${escapeHtml(complaint.created_at)}</dd><dt>Status</dt><dd>${escapeHtml(complaint.status)}</dd><dt>Last modified by</dt><dd>${escapeHtml(modifier)} · ${escapeHtml(complaint.updated_at)}</dd><dt>Assigned to</dt><dd>${escapeHtml(complaint.assigned_to_name || 'Unassigned')}</dd><dt>Assignment recorded by</dt><dd>${escapeHtml(complaint.assigned_by_name || (complaint.assigned_at ? 'Historical administrator unavailable' : 'Not assigned'))}${complaint.assigned_at ? ` · ${escapeHtml(complaint.assigned_at)}` : ''}</dd><dt>Message</dt><dd class="complaint-message">${escapeHtml(complaint.message)}</dd><dt>Reply</dt><dd class="complaint-message">${escapeHtml(complaint.reply || 'No reply recorded')}</dd></dl><h3>Activity history</h3><ol class="complaint-history">${events}</ol>`;
  if (!dialog.open) dialog.showModal();
}

async function openRequestedAdminDestination(role) {
  const params = new URLSearchParams(window.location.search);
  const tab = params.get('tab');
  if (!tab && !params.has('complaint')) return;
  if (tab === 'requests' && role !== 'super_admin') {
    setMessage('error', 'You do not have permission to view system-wide requests and complaints.');
    return;
  }
  const allowed = new Set(['dashboard', 'catalog', 'audit', 'recycle', 'transfer', 'backup', 'health', 'users', 'requests']);
  if (tab && allowed.has(tab)) document.querySelector(`[data-admin-tab="${tab}"]`)?.click();
  const complaintId = params.get('complaint');
  if (complaintId && tab === 'requests' && role === 'super_admin') {
    await showComplaintDetails(complaintId);
  }
  const resetRequestId = params.get('resetRequest');
  if (resetRequestId && tab === 'requests' && role === 'super_admin') {
    const row = [...document.querySelectorAll('[data-reset-request-row]')].find((item) => item.dataset.resetRequestRow === resetRequestId);
    row?.classList.add('complaint-row-highlight');
    row?.scrollIntoView({ block: 'center' });
  }
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
    cache.complaintAdmins = users.filter((item) => ['regular_admin', 'super_admin'].includes(item.role) && item.status === 'active');
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
    cache.adminRole = user.role;
    elements.loginCard.hidden = true;
    elements.dashboard.hidden = false;
    document.querySelector('[data-user-name]')?.replaceChildren(document.createTextNode(`${user.name} (${user.role.replace('_', ' ')})`));
    document.querySelectorAll('[data-super-admin]').forEach((item) => { item.hidden = user.role !== 'super_admin'; });
    await loadRelations(); await loadAdminOps(); if (user.role === 'super_admin') { await renderUsers(); await loadControlCenter(); }
    await openRequestedAdminDestination(user.role);
  }).catch(() => { window.location.assign('../admin-login.html'); });

  document.getElementById('resetRequestList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reset-decision]'); if (!button) return;
    try { const { request: reset } = await request(`/admin/password-reset-requests/${button.dataset.requestId}/${button.dataset.resetDecision}`, { method: 'POST', body: JSON.stringify({}) }); if (reset.resetLink) prompt('Copy this one-time reset link and send it only to the registered email:', `${location.origin}${reset.resetLink}`); setMessage('success', 'Request updated.'); await loadControlCenter(); } catch (error) { setMessage('error', error.message); }
  });
  document.getElementById('complaintList')?.addEventListener('click', async (event) => {
    const view = event.target.closest('[data-complaint-view]');
    const assign = event.target.closest('[data-complaint-assign]');
    const update = event.target.closest('[data-complaint-update]');
    if (!view && !assign && !update) return;
    const id = view?.dataset.complaintView || assign?.dataset.complaintAssign || update?.dataset.complaintUpdate;
    try {
      if (view) { await showComplaintDetails(id); return; }
      if (assign) {
        const assigneeId = document.querySelector(`[data-complaint-assignee="${id}"]`)?.value || null;
        await request(`/admin/complaints/${id}/assignment`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
        setMessage('success', 'Complaint assignment updated.');
        await loadControlCenter();
        return;
      }
      const reply = prompt('Reply to the student (saved for registered-email delivery):'); if (reply === null) return;
      const status = prompt('Status: open, in_progress, or resolved', 'in_progress'); if (!status) return;
      await request(`/admin/complaints/${id}`, { method: 'PUT', body: JSON.stringify({ status, reply }) });
      setMessage('success', 'Complaint updated.'); await loadControlCenter();
    } catch (error) { setMessage('error', error.message); }
  });
  document.getElementById('complaintDetailClose')?.addEventListener('click', () => document.getElementById('complaintDetailDialog')?.close());
}
