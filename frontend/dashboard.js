import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';
import { portalPath, restoreSession, signOut } from './shared/session.js';
import { adminQuickAccessActions } from './shared/adminNavigation.js';

const avatars = ['👨🏻‍🎓','👨🏽‍💼','👨🏿‍🏫','👩🏻‍🎓','👩🏽‍💼','👩🏿‍🏫'];
const labels = { student: 'Student', regular_admin: 'Academic Administrator', super_admin: 'Super Admin' };
const escapeHtml = (value = '') => String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c]));
const date = value => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : 'Not available';
let user = await restoreSession();
if (user?.unavailable) {
  document.body.innerHTML = '<main role="alert" class="auth-unavailable"><h1>Dashboard temporarily unavailable</h1><p>Your session could not be verified because the API is unreachable. Reconnect and reload. No authentication decision has been made.</p><button type="button" onclick="location.reload()">Try again</button></main>';
  throw new Error('Session verification unavailable.');
}
if (!user) { location.replace('./index.html'); throw new Error('Dashboard session is not valid.'); }
let dashboardData;

async function api(path, options = {}) {
  let lastError;
  const method = String(options.method || 'GET').toUpperCase();
  const safeToTryAnotherBase = ['GET', 'HEAD', 'OPTIONS'].includes(method);
  for (const base of getApiCandidates()) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch(`${base}${path}`, { credentials: 'include', headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options, signal: controller.signal });
      const data = response.status === 204 ? null : await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(data?.error || 'Request failed.'); error.status = response.status; error.code = data?.code; error.requestId = data?.requestId || response.headers.get('x-request-id'); throw error; }
      saveApiBase(base);
      return data;
    } catch (error) {
      lastError = error;
      if (!safeToTryAnotherBase || error.status || controller.signal.aborted) {
        if (controller.signal.aborted) { error.code = 'REQUEST_TIMEOUT'; error.message = `${method} request timed out. Check your connection before trying again.`; }
        throw error;
      }
    } finally { clearTimeout(timeout); }
  }
  throw lastError;
}
function avatar(profile) { return profile.avatarData ? `<img class="avatar custom-image" src="${profile.avatarData}" alt="Custom avatar for ${escapeHtml(profile.name)}">` : `<span class="avatar" aria-label="Selected avatar">${avatars[Number((profile.avatarKey || 'avatar-1').split('-')[1]) - 1] || avatars[0]}</span>`; }
function actions(role) {
  const student = [['Continue Study Plan', portalPath('student')], ['Search Course', `${portalPath('student')}#catalog`], ['Open Program', `${portalPath('student')}#catalog`], ['View Notifications', '#notifications'], ['View Profile', '#profile'], ['Change Password', './password-reset-request.html']];
  return role === 'student' ? student : adminQuickAccessActions(role, portalPath('admin'), portalPath('student')) || [];
}
function card(title, body, extra = '') { return `<section class="dash-card ${extra}"><h2>${title}</h2>${body}</section>`; }
function metrics(counts = {}) { return `<div class="metric-grid">${[['Faculties', counts.faculties],['Programs', counts.programs],['Courses', counts.courses],['Program courses', counts.programCourses],['Relationships', counts.relationships],['Hidden relations', counts.hiddenRelationships]].map(([k,v]) => `<div><strong>${v ?? 0}</strong><span>${k}</span></div>`).join('')}</div>`; }
function render(data) {
  dashboardData = data;
  user = data.profile; const welcome = user.role === 'student' ? `Welcome back, ${escapeHtml(user.name)}.` : user.role === 'regular_admin' ? `Welcome back, ${escapeHtml(user.name)}. Here's today's academic administration overview.` : `Welcome back, ${escapeHtml(user.name)}. Here's your system overview.`;
  document.getElementById('identity-header').innerHTML = `${avatar(user)}<div><p class="role-label">${labels[user.role]}</p><h1>${escapeHtml(user.name)}</h1><p>@${escapeHtml(user.username || 'username')} · <span class="status">${escapeHtml(user.status)}</span></p>${user.studentId ? `<p>Student ID: ${escapeHtml(user.studentId)}</p>` : ''}</div><button id="edit-profile" class="button secondary">Profile</button>`;
  const unread = data.notifications.filter(n => !n.read).length; document.getElementById('notification-count').hidden = !unread; document.getElementById('notification-count').textContent = unread;
  const noticeList = data.notifications.length ? `<div id="notification-feedback" class="notification-feedback" role="status" aria-live="polite" tabindex="-1"></div>${unread ? '<button class="button secondary mark-all-notifications" data-notification-action="all">Mark all shown as read</button>' : ''}<ul class="activity-list">${data.notifications.map(n => `<li class="notification-item${n.read ? '' : ' unread'}" ${n.notification_key ? `data-notification-key="${escapeHtml(n.notification_key)}"` : ''}><strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.description)}</span><time>${date(n.timestamp)}</time><span class="notification-status">${n.read ? 'Read' : 'Unread'}</span>${!n.read && n.notification_key ? `<button class="button secondary mark-notification-read" data-notification-action="one" data-notification-key="${escapeHtml(n.notification_key)}">Mark as read</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty">No stored notifications yet.</p>';
  const recent = data.recentActivity.length ? `<ul class="activity-list">${data.recentActivity.map(a => `<li><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.description || '')}</span><time>${date(a.created_at)}</time></li>`).join('')}</ul>` : '<p class="empty">No recorded activity yet.</p>';
  const quick = `<div class="quick-grid">${actions(user.role).map(([label, href]) => `<a href="${href}" class="quick-action">${label}<span aria-hidden="true">→</span></a>`).join('')}</div>`;
  const security = `<dl class="security-list"><div><dt>Email</dt><dd>${escapeHtml(user.email)}</dd></div><div><dt>Username</dt><dd>@${escapeHtml(user.username || '')}</dd></div><div><dt>Account status</dt><dd>${escapeHtml(user.status)}</dd></div><div><dt>Last login</dt><dd>${date(user.lastLogin)}</dd></div><div><dt>Password last changed</dt><dd>${date(user.passwordChangedAt)}</dd></div></dl><div class="inline-actions"><a class="button secondary" href="./password-reset-request.html">Change Password</a><button id="security-sign-out" class="button danger">Sign Out</button></div>`;
  const progress = user.role === 'student' ? card('Academic progress & eligibility', '<p class="muted">Loading your self-reported course history…</p>', 'academic-progress-card') : '';
  const system = user.role === 'super_admin' ? card('System Health', `<p><strong>${escapeHtml(data.systemHealth?.backendStatus || 'Unknown')}</strong> backend · <strong>${escapeHtml(data.systemHealth?.databaseStatus || 'Unknown')}</strong> database</p>${data.userCounts ? `<p class="muted">${data.userCounts.users} users · ${data.userCounts.active_users} active · ${data.userCounts.suspended_users} suspended</p>` : ''}`) : '';
  const overview = user.role === 'student' ? '' : card(user.role === 'super_admin' ? 'Full System Overview' : 'Academic Catalog Overview', metrics(data.catalog?.counts));
  document.getElementById('dashboard-content').innerHTML = `<section class="welcome"><p class="role-label">Dashboard</p><h2>${welcome}</h2></section>${overview}${card('Quick Access', quick)}${progress}${card('Notifications', `<div id="notifications">${noticeList}</div>`)}${card('Recent Activity', recent)}${system}${card('Account & Security', security)}`;
  document.getElementById('edit-profile').addEventListener('click', openProfile); document.getElementById('security-sign-out').addEventListener('click', logout); document.getElementById('notification-button').addEventListener('click', () => document.getElementById('notifications').scrollIntoView({ behavior: 'smooth' }));
  if (user.role === 'student') loadAcademicProgress();
}
let academicState;
async function loadAcademicProgress() {
  const root = document.querySelector('.academic-progress-card'); if (!root) return;
  try { academicState = await api('/student/academic-progress'); renderAcademicProgress(root); }
  catch (error) { root.innerHTML = `<h2>Academic progress &amp; eligibility</h2><p class="error">${escapeHtml(error.message)}</p>`; }
}
function renderAcademicProgress(root) {
  const selected = Number(academicState.profile?.programId || 0);
  const programOptions = academicState.programs.map(program => `<option value="${program.id}" ${Number(program.id) === selected ? 'selected' : ''}>${escapeHtml(program.name)}</option>`).join('');
  const courses = academicState.courses.map(course => `<option value="${course.id}">${escapeHtml(course.code)} — ${escapeHtml(course.name)} (${course.credits} credits)</option>`).join('');
  const attempts = academicState.attempts.filter(attempt => attempt.programId === selected);
  const termRows = academicState.termGpa.map(term => `<li><strong>${term.academicYear} · ${escapeHtml(term.term)}:</strong> ${term.available ? `${term.value} estimated term GPA (${term.attemptedCredits} credits)` : escapeHtml(term.reason)}</li>`).join('');
  const eligibleCourses=academicState.courses.filter(course=>academicState.eligibility?.[Number(course.id)]?.eligible);
  const blockedCourses=academicState.courses.filter(course=>!academicState.eligibility?.[Number(course.id)]?.eligible);
  root.innerHTML = `<h2>Academic progress &amp; eligibility</h2><p class="future-note">Self-reported and unverified. This is a planning aid, not an official university record.</p>
    <form id="academic-progress-form"><label>Program<select name="programId" required><option value="">Choose your program</option>${programOptions}</select></label>
    <div class="academic-attempt-list">${attempts.map((attempt,index) => `<div class="academic-attempt-row"><span>${escapeHtml(attempt.code)} · ${escapeHtml(attempt.courseName)} — ${escapeHtml(attempt.grade)}, ${attempt.academicYear} ${escapeHtml(attempt.term)}</span><button type="button" class="button secondary" data-remove-attempt="${index}">Remove</button></div>`).join('') || '<p class="empty">No course attempts recorded yet.</p>'}</div>
    <div class="academic-attempt-editor"><label>Course<select name="programCourseId" required><option value="">Choose a course</option>${courses}</select></label><label>Grade<select name="grade" required>${['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F'].map(g => `<option>${g}</option>`).join('')}</select></label><label>Academic year<input name="academicYear" type="number" min="2000" max="2200" required value="${new Date().getFullYear()}"></label><label>Term<input name="term" maxlength="40" required placeholder="Fall, Spring, Summer"></label><button class="button secondary" type="button" data-add-attempt>Add attempt</button></div>
    <button class="button primary" type="submit">Save self-reported record</button><p class="academic-progress-message" role="status" aria-live="polite"></p></form>
    <h3>Estimated term GPA</h3><ul>${termRows || '<li class="muted">Add attempts to view an estimate.</li>'}</ul><h3>Course eligibility</h3><p>${eligibleCourses.length} currently eligible · ${blockedCourses.length} with unmet requirements</p><ul>${blockedCourses.slice(0,8).map(course=>`<li>${escapeHtml(course.code)}: ${escapeHtml(academicState.eligibility[Number(course.id)]?.reason||'Prerequisites not completed.')}</li>`).join('')||'<li>All listed program courses currently meet their prerequisite groups.</li>'}</ul><p class="muted">${escapeHtml(academicState.cgpa.reason)}</p><p class="muted">${escapeHtml(academicState.gradeScale)}</p>`;
  const form = root.querySelector('form');
  form.addEventListener('click', event => {
    const remove = event.target.closest('[data-remove-attempt]');
    if (remove) { const rows = attempts.slice(); rows.splice(Number(remove.dataset.removeAttempt),1); academicState.attempts = [...academicState.attempts.filter(item => item.programId !== selected),...rows]; renderAcademicProgress(root); return; }
    if (event.target.closest('[data-add-attempt]')) {
      if (!form.reportValidity()) return;
      const courseId = Number(form.elements.programCourseId.value); const course = academicState.courses.find(item => Number(item.id) === courseId);
      if (!course) return;
      academicState.attempts.push({ programId:selected, programCourseId:courseId, code:course.code, courseName:course.name, credits:Number(course.credits), grade:form.elements.grade.value, academicYear:Number(form.elements.academicYear.value), term:form.elements.term.value.trim() });
      renderAcademicProgress(root);
    }
  });
  form.addEventListener('change', event => { if (event.target.name === 'programId') { const programId=Number(event.target.value); const program=academicState.programs.find(item=>Number(item.id)===programId); academicState.profile=program?{programId,programName:program.name,verified:false}:null; loadAcademicProgressForProgram(root, programId); } });
  form.addEventListener('submit', async event => { event.preventDefault(); const message=root.querySelector('.academic-progress-message'); const programId=Number(form.elements.programId.value); const submitted=academicState.attempts.filter(item=>item.programId===programId).map(({id,programCourseId,grade,academicYear,term})=>({...(id?{id}:{}),programCourseId,grade,academicYear,term})); try { const saved=await api('/student/academic-progress',{method:'PUT',body:JSON.stringify({programId,attempts:submitted})}); academicState=saved; renderAcademicProgress(root); root.querySelector('.academic-progress-message').textContent='Self-reported record saved.'; } catch(error) { message.textContent=error.message; } });
}
async function loadAcademicProgressForProgram(root, programId) { try { if (!programId) { academicState.profile=null; academicState.courses=[]; academicState.termGpa=[]; renderAcademicProgress(root); return; } academicState=await api(`/student/academic-progress?programId=${encodeURIComponent(programId)}`); renderAcademicProgress(root); } catch(error) { root.querySelector('.academic-progress-message').textContent=error.message; } }
function applyReadState(keys) {
  const readKeys = new Set(keys);
  for (const notification of dashboardData.notifications) if (readKeys.has(notification.notification_key)) notification.read = true;
  for (const row of document.querySelectorAll('#notifications li[data-notification-key]')) {
    if (!readKeys.has(row.dataset.notificationKey)) continue;
    row.classList.remove('unread');
    const status = row.querySelector('.notification-status'); if (status) status.textContent = 'Read';
    row.querySelector('[data-notification-action="one"]')?.remove();
  }
  const unread = dashboardData.notifications.filter(notification => !notification.read).length;
  const badge = document.getElementById('notification-count'); badge.hidden = !unread; badge.textContent = unread;
  if (!unread) document.querySelector('[data-notification-action="all"]')?.remove();
}
document.getElementById('dashboard-content').addEventListener('click', async event => {
  const button = event.target.closest('[data-notification-action]'); if (!button) return;
  const action = button.dataset.notificationAction; button.disabled = true;
  const feedback = document.getElementById('notification-feedback'); if (feedback) feedback.textContent = '';
  try {
    if (action === 'one') {
      const result = await api('/notifications/read', { method: 'POST', body: JSON.stringify({ notificationKey: button.dataset.notificationKey }) });
      applyReadState([result.notification.id]);
      const status = document.getElementById('notification-feedback'); status.textContent = 'Notification marked as read.'; status.focus();
    } else {
      const result = await api('/notifications/read-all', { method: 'POST', body: '{}' });
      applyReadState(result.notificationKeys);
      const status = document.getElementById('notification-feedback'); status.textContent = `${result.updatedCount} notification${result.updatedCount === 1 ? '' : 's'} marked as read.`; status.focus();
    }
  } catch (error) {
    button.disabled = false;
    const status = document.getElementById('notification-feedback'); if (status) status.textContent = `${error.message} Your unread notification state has not been changed on this screen.`;
  }
});
function openProfile() { const form = document.getElementById('profile-form'); form.name.value = user.name; form.username.value = user.username || ''; document.getElementById('avatar-options').innerHTML = avatars.map((icon, i) => `<label class="avatar-choice"><input type="radio" name="avatarKey" value="avatar-${i+1}" ${user.avatarKey === `avatar-${i+1}` ? 'checked' : ''}><span>${icon}</span><b>${i < 3 ? 'Masc.' : 'Fem.'} ${i % 3 + 1}</b></label>`).join(''); document.getElementById('profile-error').textContent = ''; document.getElementById('profile-dialog').showModal(); }
document.getElementById('profile-form').addEventListener('submit', async event => { event.preventDefault(); const form = event.currentTarget; try { const payload = { name: form.name.value, username: form.username.value, avatarKey: new FormData(form).get('avatarKey') }; const file = document.getElementById('avatar-upload').files[0]; if (file) { if (file.size > 700 * 1024) throw new Error('Custom avatar must be smaller than 700 KB.'); payload.avatarData = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); }); } const response = await api('/profile', { method: 'PUT', body: JSON.stringify(payload) }); user = response.user; document.getElementById('profile-dialog').close(); render(await api('/dashboard')); } catch (error) { document.getElementById('profile-error').textContent = error.message; } });
document.getElementById('close-profile').addEventListener('click', () => document.getElementById('profile-dialog').close()); document.getElementById('cancel-profile').addEventListener('click', () => document.getElementById('profile-dialog').close());
document.getElementById('remove-avatar').addEventListener('click', async () => { try { await api('/profile', { method: 'PUT', body: JSON.stringify({ avatarData: '' }) }); document.getElementById('profile-dialog').close(); render(await api('/dashboard')); } catch (error) { document.getElementById('profile-error').textContent = error.message; } });
async function logout() { await signOut('./index.html'); }
document.getElementById('sign-out').addEventListener('click', logout);
try { render(await api('/dashboard')); } catch (error) { document.getElementById('dashboard-content').innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`; }
finally { const overlay = document.getElementById('dashboardLoadingOverlay'); if (overlay) overlay.hidden = true; }
