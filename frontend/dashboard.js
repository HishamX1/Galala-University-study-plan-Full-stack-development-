import { getApiCandidates, saveApiBase } from './shared/apiConfig.js';
import { portalPath, restoreSession, signOut, startInactivityTimeout } from './shared/session.js';
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
if (user.role === 'regular_admin' || user.role === 'super_admin') window.__GU_ADMIN_ROLE__ = user.role;
startInactivityTimeout(user, './index.html');
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
      if (!response.ok) { const error = new Error(data?.error || 'Request failed.'); error.status = response.status; error.code = data?.code; error.requestId = data?.requestId || response.headers.get('x-request-id'); if (response.status === 401) void signOut('./index.html', { sessionExpiredRole: user.role }); throw error; }
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
  const student = [
    ['Open study plan', portalPath('student')],
    ['Browse courses', `${portalPath('student')}#programs`],
    ['Academic progress', '#academic-progress'],
    ['Notifications', '#notifications'],
    ['Profile settings', 'data:profile'],
    ['Reset password', './password-reset-request.html']
  ];
  return role === 'student' ? student : adminQuickAccessActions(role, portalPath('admin'), portalPath('student')) || [];
}
function card(title, body, extra = '', id = '') { return `<section${id ? ` id="${id}"` : ''} class="dash-card ${extra}"><h2>${title}</h2>${body}</section>`; }
function metrics(counts = {}) { return `<div class="metric-grid">${[['Faculties', counts.faculties],['Programs', counts.programs],['Courses', counts.courses],['Program courses', counts.programCourses],['Relationships', counts.relationships],['Hidden relations', counts.hiddenRelationships]].map(([k,v]) => `<div><strong>${v ?? 0}</strong><span>${k}</span></div>`).join('')}</div>`; }
function render(data) {
  dashboardData = data;
  user = data.profile; const welcome = user.role === 'student' ? `Welcome back, ${escapeHtml(user.name)}.` : user.role === 'regular_admin' ? `Welcome back, ${escapeHtml(user.name)}. Here's today's academic administration overview.` : `Welcome back, ${escapeHtml(user.name)}. Here's your system overview.`;
  document.getElementById('identity-header').innerHTML = `${avatar(user)}<div><p class="role-label">${labels[user.role]}</p><h1>${escapeHtml(user.name)}</h1><p>@${escapeHtml(user.username || 'username')} · <span class="status">${escapeHtml(user.status)}</span></p>${user.studentId ? `<p>Student ID: ${escapeHtml(user.studentId)}</p>` : ''}</div><button id="edit-profile" class="button secondary">Profile</button>`;
  const unread = data.notifications.filter(n => !n.read).length; document.getElementById('notification-count').hidden = !unread; document.getElementById('notification-count').textContent = unread;
  const noticeList = data.notifications.length ? `<div id="notification-feedback" class="notification-feedback" role="status" aria-live="polite" tabindex="-1"></div>${unread ? '<button class="button secondary mark-all-notifications" data-notification-action="all">Mark all shown as read</button>' : ''}<ul class="activity-list">${data.notifications.map(n => `<li class="notification-item${n.read ? '' : ' unread'}" ${n.notification_key ? `data-notification-key="${escapeHtml(n.notification_key)}"` : ''}><strong>${escapeHtml(n.title)}</strong><span>${escapeHtml(n.description)}</span><time>${date(n.timestamp)}</time><span class="notification-status">${n.read ? 'Read' : 'Unread'}</span>${!n.read && n.notification_key ? `<button class="button secondary mark-notification-read" data-notification-action="one" data-notification-key="${escapeHtml(n.notification_key)}">Mark as read</button>` : ''}</li>`).join('')}</ul>` : '<p class="empty">No stored notifications yet.</p>';
  const recent = data.recentActivity.length ? `<ul class="activity-list">${data.recentActivity.map(a => `<li><strong>${escapeHtml(a.action)}</strong><span>${escapeHtml(a.description || '')}</span><time>${date(a.created_at)}</time></li>`).join('')}</ul>` : '<p class="empty">No recorded activity yet.</p>';
  const quick = `<div class="quick-grid">${actions(user.role).map(([label, href]) => href === 'data:profile'
    ? `<button type="button" class="quick-action" data-dashboard-action="profile">${label}<span aria-hidden="true">→</span></button>`
    : `<a href="${href}" class="quick-action">${label}<span aria-hidden="true">→</span></a>`).join('')}</div>`;
  const security = `<dl class="security-list"><div><dt>Email</dt><dd>${escapeHtml(user.email)}</dd></div><div><dt>Username</dt><dd>@${escapeHtml(user.username || '')}</dd></div><div><dt>Account status</dt><dd>${escapeHtml(user.status)}</dd></div><div><dt>Last login</dt><dd>${date(user.lastLogin)}</dd></div><div><dt>Password last changed</dt><dd>${date(user.passwordChangedAt)}</dd></div></dl><div class="inline-actions"><a class="button secondary" href="./password-reset-request.html">Change Password</a><button id="security-sign-out" class="button danger">Sign Out</button></div>`;
  const progress = user.role === 'student' ? card('My academic progress', '<p class="muted">Loading your saved study plan…</p>', 'academic-progress-card', 'academic-progress') : '';
  const system = user.role === 'super_admin' ? card('System Health', `<p><strong>${escapeHtml(data.systemHealth?.backendStatus || 'Unknown')}</strong> backend · <strong>${escapeHtml(data.systemHealth?.databaseStatus || 'Unknown')}</strong> database</p>${data.userCounts ? `<p class="muted">${data.userCounts.users} users · ${data.userCounts.active_users} active · ${data.userCounts.suspended_users} suspended</p>` : ''}`) : '';
  const overview = user.role === 'student' ? '' : card(user.role === 'super_admin' ? 'Full System Overview' : 'Academic Catalog Overview', metrics(data.catalog?.counts));
  document.getElementById('dashboard-content').innerHTML = `<section class="welcome"><p class="role-label">Dashboard</p><h2>${welcome}</h2></section>${overview}${card('Quick Access', quick)}${progress}${card('Notifications', `<div id="notifications">${noticeList}</div>`)}${card('Recent Activity', recent)}${system}${card('Account & Security', security)}`;
  document.getElementById('edit-profile').addEventListener('click', openProfile); document.getElementById('security-sign-out').addEventListener('click', logout); document.getElementById('notification-button').addEventListener('click', () => document.getElementById('notifications').scrollIntoView({ behavior: 'smooth' }));
  document.querySelector('[data-dashboard-action="profile"]')?.addEventListener('click', openProfile);
  if (user.role === 'student') loadAcademicProgress();
}
let academicState;
async function loadAcademicProgress() {
  const root = document.querySelector('.academic-progress-card'); if (!root) return;
  try { academicState = await api('/student/academic-progress'); renderAcademicProgress(root); }
  catch (error) { root.innerHTML = `<h2>My academic progress</h2><p class="error">${escapeHtml(error.message)}</p>`; }
}
function renderAcademicProgress(root) {
  const selected = Number(academicState.profile?.programId || 0);
  const selectedProgram = academicState.programs.find(program => Number(program.id) === selected);
  const programOptions = academicState.programs.map(program => `<option value="${program.id}" ${Number(program.id) === selected ? 'selected' : ''}>${escapeHtml(program.name)} · ${escapeHtml(program.facultyName)}</option>`).join('');
  const courses = academicState.courses.map(course => `<option value="${course.id}">${escapeHtml(course.code)} — ${escapeHtml(course.name)} (${course.credits} credits)</option>`).join('');
  const attempts = academicState.attempts.filter(attempt => attempt.programId === selected);
  const attemptedCredits = attempts.reduce((total, attempt) => total + Math.max(0, Number(attempt.credits) || 0), 0);
  const termRows = academicState.termGpa.map(term => `<article class="term-estimate"><div><strong>${term.academicYear} · ${escapeHtml(term.term)}</strong><span>${term.available ? `${term.value} / 4.00` : 'Estimate unavailable'}</span></div>${term.available ? `<progress max="4" value="${Number(term.value)}" aria-label="Estimated term result ${Number(term.value)} out of 4"></progress><small>${term.attemptedCredits} attempted credit hours · planning estimate</small>` : `<small>${escapeHtml(term.reason)}</small>`}</article>`).join('');
  const estimatedTerms = academicState.termGpa.filter(term => term.available);
  const bestTerm = estimatedTerms.length ? Math.max(...estimatedTerms.map(term => term.value)).toFixed(2) : null;
  const attemptsByCourse = new Map();
  for (const attempt of attempts) {
    const id = Number(attempt.programCourseId);
    const history = attemptsByCourse.get(id) || [];
    history.push(attempt);
    attemptsByCourse.set(id, history);
  }
  const passedCourseIds = [...attemptsByCourse.entries()].filter(([, history]) => history.some(item => item.grade !== 'F')).map(([id]) => id);
  const passedCourseCredits = passedCourseIds.reduce((sum, id) => sum + Math.max(0, Number(attemptsByCourse.get(id)?.[0]?.credits) || 0), 0);
  const creditGoal = Number(academicState.profile?.totalProgramCredits) || 0;
  const progressPercent = creditGoal > 0 ? Math.min(100, Math.round(passedCourseCredits / creditGoal * 100)) : 0;
  const repeatCount = [...attemptsByCourse.values()].filter(history => history.length > 1).length;
  const profileStepsComplete = [selected > 0, academicState.profile?.totalProgramCredits != null].filter(Boolean).length;
  root.innerHTML = `<h2>My academic progress</h2><p class="future-note">A private planning view saved to your account. Your entries are self-reported, not an official university record.</p>
    <form id="academic-progress-form"><fieldset class="academic-profile-settings"><legend>Your study plan</legend><div class="academic-setup-progress"><div><strong>Set up your plan</strong><span>${profileStepsComplete} of 2 details saved</span></div><progress max="2" value="${profileStepsComplete}" aria-label="${profileStepsComplete} of 2 study plan details saved"></progress><p>Choose your program and the total hours in your approved plan. Add a personal GPA goal if you like. You can update these later.</p></div><label>Program<select name="programId" required><option value="">Choose your program</option>${programOptions}</select></label>
    <p class="academic-profile-faculty">Faculty <strong>${escapeHtml(selectedProgram?.facultyName || academicState.profile?.facultyName || 'Choose a program')}</strong></p>
    <div class="gpa-goal-grid"><section class="gpa-goal-card gpa-goal-card--boost"><div class="gpa-goal-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><path class="gpa-icon-path" d="M9 48 25 33l10 8L54 19M40 19h14v14"/><path class="gpa-icon-base" d="M9 55h46"/></svg></div><div><h3>Best term estimate</h3><strong class="gpa-highlight">${bestTerm || '—'}</strong><p>${bestTerm ? `From ${estimatedTerms.length} term${estimatedTerms.length === 1 ? '' : 's'} with enough information.` : 'Add course results to see a term estimate.'}</p></div></section>
    <section class="gpa-goal-card gpa-goal-card--target"><div class="gpa-goal-icon" aria-hidden="true"><svg viewBox="0 0 64 64"><circle class="gpa-target-ring" cx="32" cy="32" r="23"/><circle class="gpa-target-ring gpa-target-ring--inner" cx="32" cy="32" r="12"/><path class="gpa-icon-path" d="m32 32 19-19m-9 0h9v9"/></svg></div><div><h3>My GPA goal</h3><label for="target-gpa">Goal out of 4.00</label><input id="target-gpa" name="targetGpa" type="number" min="0" max="4" step="0.01" value="${academicState.profile?.targetGpa ?? ''}" placeholder="For example, 3.50"><p>${academicState.profile?.targetGpa != null ? `Saved goal: ${Number(academicState.profile.targetGpa).toFixed(2)}.` : 'Optional. Set a goal that motivates you.'}</p></div></section></div>
    <label class="program-credit-total">Total hours in your program<input name="totalProgramCredits" type="number" min="1" max="1000" step="1" value="${academicState.profile?.totalProgramCredits ?? ''}" placeholder="Enter the total from your approved plan"><small>This is used only for a personal progress estimate until verified.</small></label></fieldset>
    <section class="academic-progress-overview" aria-label="Course progress summary"><div class="academic-progress-heading"><div><span class="eyebrow">YOUR PLAN</span><h3>${escapeHtml(selectedProgram?.name || 'Choose a program to begin')}</h3></div><span class="progress-orbit" style="--progress-value:${progressPercent}%" aria-hidden="true"><span>${creditGoal ? `${progressPercent}%` : '…'}</span></span></div><div class="academic-progress-track"><progress max="${creditGoal || 1}" value="${creditGoal ? Math.min(creditGoal, passedCourseCredits) : 0}" aria-label="${passedCourseIds.length} courses with a passing entry; estimated against the total program hours"></progress></div><div class="academic-progress-numbers"><span><strong>${passedCourseIds.length}</strong> courses with a passing entry</span><span><strong>${creditGoal ? `${passedCourseCredits} / ${creditGoal}` : 'Add total hours'}</strong> plan hours</span></div><small class="academic-progress-caveat">Planning estimate only${repeatCount ? ` · ${repeatCount} course${repeatCount === 1 ? '' : 's'} have repeat entries` : ''}. The university’s repeat rules determine official completed credits.</small><div class="academic-record-summary"><span><strong>${attempts.length}</strong> result${attempts.length === 1 ? '' : 's'} recorded</span><span><strong>${attemptedCredits}</strong> attempted hours</span></div></section>
    <section class="academic-history"><h3>Your course history</h3><p>Each result is saved by course, grade, year, and term. Add another result for a retake.</p><div class="academic-attempt-list">${attempts.map((attempt,index) => `<div class="academic-attempt-row"><span>${escapeHtml(attempt.code)} · ${escapeHtml(attempt.courseName)} — ${escapeHtml(attempt.grade)}, ${attempt.academicYear} ${escapeHtml(attempt.term)}</span><button type="button" class="button secondary" data-remove-attempt="${index}" aria-label="Remove ${escapeHtml(attempt.code)} ${escapeHtml(attempt.grade)} result">Remove</button></div>`).join('') || '<p class="empty">No results yet. Add your first course result below.</p>'}</div></section>
    <fieldset class="academic-attempt-editor"><legend>Add a course result</legend><p>Choose the course and enter the result shown in your records.</p><label>Course<select name="programCourseId" required><option value="">Choose a course</option>${courses}</select></label><label>Grade<select name="grade" required>${['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].map(g => `<option>${g}</option>`).join('')}</select></label><label>Academic year<input name="academicYear" type="number" min="2000" max="2200" required value="${new Date().getFullYear()}"></label><label>Term<input name="term" maxlength="40" required placeholder="Fall, Spring, or Summer"></label><button class="button secondary" type="button" data-add-attempt>Add result</button></fieldset>
    <div class="academic-save-bar"><p class="academic-progress-message" role="status" aria-live="polite">Your changes are saved only after you choose Save.</p><button class="button primary" type="submit">Save profile &amp; progress</button></div></form>
    <section class="term-estimates"><h3>Term estimates</h3><p>These use the current planning scale. CGPA is hidden until university credit and retake rules are confirmed.</p>${termRows || '<p class="muted">Add course results to see a term estimate.</p>'}</section>`;
  const form = root.querySelector('form');
  form.addEventListener('input', () => {
    const complete = [Boolean(Number(form.elements.programId.value)), form.elements.totalProgramCredits.value !== ''].filter(Boolean).length;
    const progress = form.querySelector('.academic-setup-progress progress');
    const count = form.querySelector('.academic-setup-progress span');
    if (progress) { progress.value = complete; progress.setAttribute('aria-label', `${complete} of 2 study plan details selected`); }
    if (count) count.textContent = `${complete} of 2 details selected`;
    const message = form.querySelector('.academic-progress-message');
    if (message) message.textContent = 'You have unsaved changes. Choose Save profile & progress when ready.';
  });
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
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const message = form.querySelector('.academic-progress-message');
    const button = form.querySelector('button[type="submit"]');
    const programId = Number(form.elements.programId.value);
    const submitted = academicState.attempts.filter(item => item.programId === programId).map(({ id, programCourseId, grade, academicYear, term }) => ({ ...(id ? { id } : {}), programCourseId, grade, academicYear, term }));
    const totalProgramCredits = form.elements.totalProgramCredits.value === '' ? null : Number(form.elements.totalProgramCredits.value);
    const targetGpa = form.elements.targetGpa.value === '' ? null : Number(form.elements.targetGpa.value);
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    message.textContent = 'Saving your academic profile and progress…';
    try {
      const saved = await api('/student/academic-progress', { method: 'PUT', body: JSON.stringify({ programId, attempts: submitted, totalProgramCredits, targetGpa }) });
      academicState = saved;
      renderAcademicProgress(root);
      root.querySelector('.academic-progress-message').textContent = 'Saved. Your profile and course history can be updated whenever you need.';
      root.querySelector('.academic-save-bar')?.classList.add('is-saved');
    } catch (error) {
      message.textContent = `${error.message} Your previous saved information is unchanged.`;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
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
