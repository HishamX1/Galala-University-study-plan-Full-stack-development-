import { getWorkingApiBase, request, updateConfiguredApiBase } from './apiClient.js';
import { elements, setMessage, withButtonBusy } from './adminDom.js';
import { openConfirmDialog, openFormDialog } from './dialogs.js';
import { loadRelations } from './dataLoader.js';
import { loadAdminOps } from './adminOps.js';
import { signOut } from '../../shared/session.js';
import { activateAdminTab, resolveAdminTab } from '../../shared/adminNavigation.js';
import { cache } from './state.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' })[char]);

async function loadControlCenter(adminUsersPromise = null) {
  const userDataPromise = adminUsersPromise || (cache.complaintAdmins.length ? Promise.resolve(null) : request('/admin/users'));
  const [resetData, complaintData, communicationData, userData] = await Promise.all([request('/admin/password-reset-requests'), request('/admin/complaints'), request('/admin/communications'), userDataPromise]);
  if (userData) cache.complaintAdmins = userData.users.filter((item) => ['regular_admin', 'super_admin'].includes(item.role) && item.status === 'active');
  const resets = document.getElementById('resetRequestList');
  const complaints = document.getElementById('complaintList');
  const communications = document.getElementById('communicationList');
  if (resets) resets.innerHTML = resetData.requests.map((item) => `<tr data-reset-request-row="${escapeHtml(item.id)}"><td>${escapeHtml(item.name)}<small>${escapeHtml(item.email)} · ${escapeHtml(item.student_id || 'Student ID not recorded')}</small></td><td>${escapeHtml(item.role)}</td><td>${escapeHtml(item.status)}</td><td>${escapeHtml(item.created_at)}</td><td>${item.decided_at ? `${escapeHtml(item.decided_by_name || 'Historical administrator unavailable')}<small>${escapeHtml(item.decided_at)}</small>` : 'Awaiting review'}</td><td>${item.status === 'open' ? `<button data-reset-decision="approve" data-request-id="${escapeHtml(item.id)}">Approve</button> <button data-reset-decision="reject" data-request-id="${escapeHtml(item.id)}">Reject</button>` : '-'}</td></tr>`).join('') || '<tr><td colspan="6">No requests.</td></tr>';
  if (complaints) complaints.innerHTML = complaintData.complaints.map((item) => {
    const submitter = item.submitted_name || item.current_submitter_name || 'Historical identity unavailable';
    const modifier = item.last_modified_by_name || (new Date(item.updated_at).getTime() > new Date(item.created_at).getTime() ? 'Historical administrator unavailable' : 'Not modified');
    const assigneeOptions = [`<option value="">Unassigned</option>`, ...cache.complaintAdmins.map((admin) => `<option value="${escapeHtml(admin.id)}" ${admin.id === item.assigned_to ? 'selected' : ''}>${escapeHtml(admin.name)} (${escapeHtml(admin.role.replace('_', ' '))})</option>`)].join('');
    return `<tr data-complaint-row="${escapeHtml(item.id)}"><td>${escapeHtml(submitter)}<small>${escapeHtml(item.student_id || 'Student ID not recorded')} · ${escapeHtml(item.email)}</small><small>Submitted ${escapeHtml(item.created_at)}</small></td><td>${escapeHtml(item.message)}</td><td>${escapeHtml(item.status)}</td><td><div>${item.assigned_to_name ? `${escapeHtml(item.assigned_to_name)} (assigned by ${escapeHtml(item.assigned_by_name || 'Historical administrator unavailable')})` : 'Unassigned'}</div><small>${item.assigned_at ? `Assignment updated ${escapeHtml(item.assigned_at)}` : 'No assignment history'}</small><select aria-label="Select an administrator for complaint from ${escapeHtml(submitter)}" data-complaint-assignee="${escapeHtml(item.id)}">${assigneeOptions}</select><button type="button" data-complaint-assign="${escapeHtml(item.id)}">Update assignment</button></td><td>${escapeHtml(modifier)}<small>${escapeHtml(item.updated_at)}</small></td><td><button type="button" data-complaint-view="${escapeHtml(item.id)}">View history</button><button type="button" data-complaint-update="${escapeHtml(item.id)}">Update status / reply</button></td></tr>`;
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
  const tab = params.get('tab') || (params.has('complaint') || params.has('resetRequest') ? 'requests' : null);
  if (!tab) return;
  const destination = resolveAdminTab(tab, role);
  if (!destination.allowed) {
    setMessage('error', destination.reason === 'forbidden'
      ? 'You do not have permission to view that administrator section.'
      : 'That administrator section is not available.');
    activateAdminTab('dashboard', role);
    return;
  }
  if (!activateAdminTab(tab, role, document, window, { updateUrl: false })) {
    setMessage('error', 'That administrator section is not available.');
    activateAdminTab('dashboard', role);
    return;
  }
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

    await withButtonBusy(elements.loginBtn, async () => {
    setMessage('progress', 'Signing you in…');
    try {
      const { user } = await request('/auth/admin-login', { method: 'POST', body: JSON.stringify({ identifier: username, password }) });
      if (!['regular_admin', 'super_admin'].includes(user.role)) { window.location.assign('../denied.html'); return; }
      cache.adminRole = user.role;
      elements.loginCard.hidden = true;
      elements.dashboard.hidden = false;
      document.querySelector('[data-user-name]')?.replaceChildren(document.createTextNode(`${user.name} (${user.role.replace('_', ' ')})`));
      document.querySelectorAll('[data-super-admin]').forEach((item) => { item.hidden = user.role !== 'super_admin'; });
      setMessage('success', `Welcome, ${user.name}`);
      // Catalog rendering and operations rendering use separate endpoints and
      // cache fields; start both after role validation, then open deep links.
      await loadInitialAdminData(user.role);
      await openRequestedAdminDestination(user.role);
    } catch (error) {
      setMessage('error', error.message);
    }
    });
  };

  elements.loginBtn.addEventListener('click', onLogin);
  elements.passInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') onLogin();
  });

  document.getElementById('logoutBtn')?.addEventListener('click', () => signOut('../index.html'));

  let managedUsers = null;
  const renderUsers = async (initialUsers = null, refresh = false) => {
    if (initialUsers !== null) managedUsers = initialUsers;
    if (managedUsers === null || refresh) managedUsers = (await request('/admin/users')).users;
    const users = managedUsers;
    cache.complaintAdmins = users.filter((item) => ['regular_admin', 'super_admin'].includes(item.role) && item.status === 'active');
    const list = document.getElementById('managedUserList');
    const search = String(document.getElementById('userSearch')?.value || '').toLowerCase();
    const role = document.getElementById('userRoleFilter')?.value || '';
    const status = document.getElementById('userStatusFilter')?.value || '';
    const filtered = users.filter((u) => !search || [u.name, u.email, u.student_id].some((v) => String(v || '').toLowerCase().includes(search))).filter((u) => !role || u.role === role).filter((u) => !status || u.status === status);
    if (list) { list._users = users; list.innerHTML = filtered.map((u) => `<tr><td>${escapeHtml(u.name)}<small>${escapeHtml(u.student_id || 'No student ID')}</small></td><td>${escapeHtml(u.email)}</td><td>${escapeHtml(u.role.replace('_', ' '))}</td><td>${escapeHtml(u.status)}</td><td class="user-actions"><button type="button" data-action="view" data-user-id="${escapeHtml(u.id)}" aria-label="View account details for ${escapeHtml(u.name)}">View</button><button type="button" data-action="edit" data-user-id="${escapeHtml(u.id)}" aria-label="Edit account details for ${escapeHtml(u.name)}">Edit</button><button type="button" data-action="reset" data-user-id="${escapeHtml(u.id)}" aria-label="Change password for ${escapeHtml(u.name)}">Change password</button><button type="button" data-action="${u.status === 'suspended' ? 'activate' : 'suspend'}" data-user-id="${escapeHtml(u.id)}">${u.status === 'suspended' ? 'Activate account' : 'Suspend account'}</button><button type="button" class="danger" data-action="delete" data-user-id="${escapeHtml(u.id)}" aria-label="Permanently delete account for ${escapeHtml(u.name)}">Delete account</button></td></tr>`).join('') || '<tr><td colspan="5">No matching users.</td></tr>'; }
  };
  const loadInitialAdminData = async (role) => {
    const tasks = [loadRelations(), loadAdminOps()];
    if (role === 'super_admin') {
      const userDataPromise = request('/admin/users');
      tasks.push(userDataPromise.then(({ users }) => renderUsers(users)));
      tasks.push(loadControlCenter(userDataPromise));
    }
    await Promise.all(tasks);
  };
  document.getElementById('createManagedUser')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    await withButtonBusy(button, async () => { setMessage('progress', 'Creating the account…');
    try {
      await request('/admin/users', { method: 'POST', body: JSON.stringify({ name: document.getElementById('managedUserName').value.trim(), email: document.getElementById('managedUserEmail').value.trim(), studentId: document.getElementById('managedUserStudentId').value.trim(), password: document.getElementById('managedUserPassword').value, role: document.getElementById('managedUserRole').value, status: document.getElementById('managedUserStatus').value }) });
      setMessage('success', 'User account created. It is now available in the account list.'); await renderUsers(null, true);
    } catch (error) { setMessage('error', error.message); }
    });
  });
  const dialog = document.getElementById('userDialog');
  let userDialogReturnFocus = null;
  const closeUserDialog = () => { dialog.hidden = true; userDialogReturnFocus?.focus?.(); userDialogReturnFocus = null; };
  const openDialog = (title, markup, userId, trigger = document.activeElement) => { userDialogReturnFocus = trigger; dialog.querySelector('h3').textContent = title; dialog.querySelector('.user-dialog-body').innerHTML = markup; dialog.dataset.userId = userId; dialog.hidden = false; setTimeout(() => dialog.querySelector('input, select, button')?.focus(), 0); };
  document.getElementById('managedUserList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-user-id]'); if (!button) return;
    const user = event.currentTarget._users?.find((item) => item.id === button.dataset.userId); if (!user) return;
    const action = button.dataset.action;
    if (action === 'view') return openDialog('User account details', `<p><b>Name:</b> ${escapeHtml(user.name)}</p><p><b>Email:</b> ${escapeHtml(user.email)}</p><p><b>Student ID:</b> ${escapeHtml(user.student_id || 'Not set')}</p><p><b>Role:</b> ${escapeHtml(user.role.replace('_', ' '))}</p><p><b>Status:</b> ${escapeHtml(user.status)}</p>`, user.id, button);
    if (action === 'reset') return openDialog('Change account password', `<p>Set a new password for <strong>${escapeHtml(user.name)}</strong>. The password is never displayed after saving.</p><form id="resetUserForm"><label>New password<input name="password" type="password" autocomplete="new-password" required></label><label>Confirm new password<input name="confirmPassword" type="password" autocomplete="new-password" required></label><button type="submit">Save new password</button></form>`, user.id, button);
    if (action === 'edit') return openDialog('Edit user account', `<form id="editUserForm"><label>Name<input name="name" value="${escapeHtml(user.name)}" required></label><label>Email<input name="email" type="email" value="${escapeHtml(user.email)}" required></label><label>Student ID<input name="studentId" value="${escapeHtml(user.student_id || '')}"></label><label>Role<select name="role"><option value="student" ${user.role === 'student' ? 'selected' : ''}>Student</option><option value="regular_admin" ${user.role === 'regular_admin' ? 'selected' : ''}>Regular Admin</option><option value="super_admin" ${user.role === 'super_admin' ? 'selected' : ''}>Super Admin</option></select></label><label>Status<select name="status"><option value="active" ${user.status === 'active' ? 'selected' : ''}>Active</option><option value="inactive" ${user.status === 'inactive' ? 'selected' : ''}>Inactive</option><option value="suspended" ${user.status === 'suspended' ? 'selected' : ''}>Suspended</option></select></label><button type="submit">Save account changes</button></form>`, user.id, button);
    await withButtonBusy(button, async () => { setMessage('progress', action === 'delete' ? 'Deleting the account…' : 'Updating account access…');
    try {
      if (action === 'delete') {
        const confirmed = await openConfirmDialog({ title: `Delete ${user.name}'s account?`, description: `This permanently deletes the account for ${user.name} and its sessions. This action cannot be undone.`, submitLabel: 'Delete account' });
        if (!confirmed) return;
        await request(`/admin/users/${user.id}`, { method: 'DELETE' });
        setMessage('success', `${user.name}'s account was permanently deleted.`);
      } else {
        await request(`/admin/users/${user.id}`, { method: 'PUT', body: JSON.stringify({ name:user.name,email:user.email,studentId:user.student_id || '',role:user.role,status:action === 'suspend' ? 'suspended' : 'active' }) });
        setMessage('success', action === 'suspend' ? `${user.name}'s account was suspended.` : `${user.name}'s account was reactivated.`);
      }
      await renderUsers(null, true);
    } catch (error) { setMessage('error', error.message); }
    });
  });
  dialog?.addEventListener('submit', async (event) => { event.preventDefault(); const form = event.target; const values = Object.fromEntries(new FormData(form)); await withButtonBusy(event.submitter || form.querySelector('button[type="submit"]'), async () => { setMessage('progress', form.id === 'resetUserForm' ? 'Changing the password…' : 'Saving account changes…'); try { await request(form.id === 'resetUserForm' ? `/admin/users/${dialog.dataset.userId}/reset-password` : `/admin/users/${dialog.dataset.userId}`, { method: form.id === 'resetUserForm' ? 'POST' : 'PUT', body: JSON.stringify(values) }); closeUserDialog(); setMessage('success', form.id === 'resetUserForm' ? 'The account password was changed successfully.' : 'Account details were updated successfully.'); await renderUsers(null, true); } catch (error) { setMessage('error', error.message); } }); });
  document.getElementById('userDialogClose')?.addEventListener('click', closeUserDialog);
  dialog?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.preventDefault(); closeUserDialog(); return; }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    if (event.shiftKey && document.activeElement === focusable[0]) { event.preventDefault(); focusable.at(-1).focus(); }
    else if (!event.shiftKey && document.activeElement === focusable.at(-1)) { event.preventDefault(); focusable[0].focus(); }
  });
  ['userSearch', 'userRoleFilter', 'userStatusFilter'].forEach((id) => document.getElementById(id)?.addEventListener('input', renderUsers));

  request('/auth/me').then(async ({ user }) => {
    if (!['regular_admin', 'super_admin'].includes(user.role)) { window.location.assign('../denied.html'); return; }
    cache.adminRole = user.role;
    elements.loginCard.hidden = true;
    elements.dashboard.hidden = false;
    document.querySelector('[data-user-name]')?.replaceChildren(document.createTextNode(`${user.name} (${user.role.replace('_', ' ')})`));
    document.querySelectorAll('[data-super-admin]').forEach((item) => { item.hidden = user.role !== 'super_admin'; });
    await loadInitialAdminData(user.role);
    await openRequestedAdminDestination(user.role);
  }).catch(() => { window.location.assign('../admin-login.html'); });

  document.getElementById('resetRequestList')?.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-reset-decision]'); if (!button) return;
    const row = button.closest('tr');
    const account = row?.querySelector('td')?.textContent.replace(/\s+/g, ' ').trim() || 'the selected account';
    const approve = button.dataset.resetDecision === 'approve';
    const confirmed = await openConfirmDialog({ title: approve ? 'Approve password-reset request?' : 'Reject password-reset request?', description: approve ? `Create a one-time reset link for ${account}. The link is shown once and must be sent only to the account's registered email.` : `Reject the password-reset request for ${account}. No reset link will be created.`, submitLabel: approve ? 'Approve & create link' : 'Reject request', danger: !approve });
    if (!confirmed) return;
    await withButtonBusy(button, async () => { setMessage('progress', approve ? 'Approving the request…' : 'Rejecting the request…');
    try { const { request: reset } = await request(`/admin/password-reset-requests/${button.dataset.requestId}/${button.dataset.resetDecision}`, { method: 'POST', body: JSON.stringify({}) }); if (reset.resetLink) prompt('Copy this one-time reset link and send it only to the registered email:', `${location.origin}${reset.resetLink}`); setMessage('success', approve ? 'The reset request was approved and its one-time link was generated.' : 'The reset request was rejected.'); await loadControlCenter(); } catch (error) { setMessage('error', error.message); }
    });
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
        const row = assign.closest('tr');
        const assigneeId = row?.querySelector('[data-complaint-assignee]')?.value || null;
        const assigneeName = cache.complaintAdmins.find((admin) => admin.id === assigneeId)?.name || 'no administrator (unassigned)';
        const submitter = row?.querySelector('td')?.textContent.replace(/\s+/g, ' ').trim() || 'the selected complaint';
        const confirmed = await openConfirmDialog({ title: assigneeId ? 'Assign complaint?' : 'Remove complaint assignment?', description: assigneeId ? `Assign the complaint from ${submitter} to ${assigneeName}? The assignment will be recorded in its history.` : `Remove the current assignment from the complaint submitted by ${submitter}?`, submitLabel: assigneeId ? 'Assign complaint' : 'Unassign complaint', danger: false });
        if (!confirmed) return;
        await withButtonBusy(assign, async () => {
          setMessage('progress', 'Saving the complaint assignment…');
          await request(`/admin/complaints/${id}/assignment`, { method: 'POST', body: JSON.stringify({ assigneeId }) });
          setMessage('success', assigneeId ? `Complaint assigned to ${assigneeName}.` : 'Complaint is now unassigned.');
          await loadControlCenter();
        });
        return;
      }
      const row = update.closest('tr');
      const currentStatus = row?.querySelector('td:nth-child(3)')?.textContent.trim() || 'open';
      let draft = { status: currentStatus, reply: '' };
      let saveError = '';
      while (true) {
        const form = await openFormDialog({ title: 'Update complaint', description: `${saveError ? `The update was not saved: ${saveError} ` : ''}Choose the current status and write an optional reply. Replies are saved for registered-email delivery.`, submitLabel: 'Save complaint update', fields: [
          { name: 'status', label: 'Status', type: 'select', value: draft.status, required: true, options: [{ value: 'open', label: 'Open' }, { value: 'in_progress', label: 'In progress' }, { value: 'resolved', label: 'Resolved' }] },
          { name: 'reply', label: 'Reply to student (optional)', type: 'textarea', value: draft.reply }
        ] });
        if (!form) return;
        try {
          await withButtonBusy(update, async () => {
            setMessage('progress', 'Saving the complaint update…');
            await request(`/admin/complaints/${id}`, { method: 'PUT', body: JSON.stringify({ status: form.status, reply: form.reply }) });
            setMessage('success', `Complaint status updated to ${form.status.replace('_', ' ')}. The reply was saved for registered-email delivery.`);
            await loadControlCenter();
          });
          break;
        } catch (error) {
          draft = form;
          saveError = error.message;
        }
      }
    } catch (error) { setMessage('error', error.message); }
  });
  document.getElementById('complaintDetailClose')?.addEventListener('click', () => document.getElementById('complaintDetailDialog')?.close());
}
