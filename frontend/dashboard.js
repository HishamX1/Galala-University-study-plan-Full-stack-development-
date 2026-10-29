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
  const attemptsByCourse = new Map();
  for (const attempt of attempts) {
    const id = Number(attempt.programCourseId);
    const history = attemptsByCourse.get(id) || [];
    history.push(attempt);
    attemptsByCourse.set(id, history);
  }
  const failedCount = [...attemptsByCourse.values()].filter(history => history.at(-1)?.grade === 'F').length;
  const passedCount = [...attemptsByCourse.values()].filter(history => history.some(item => item.grade !== 'F')).length;
  const profileStepsComplete = [selected > 0, attempts.length > 0].filter(Boolean).length;
  const profilePercent = Math.round(profileStepsComplete / 2 * 100);
  root.innerHTML = `<h2>My academic progress</h2><p class="future-note">Your academic history is self-reported and is not an official university record.</p>
    <form id="academic-progress-form"><fieldset class="academic-profile-settings"><legend>Your study plan</legend><div class="academic-setup-progress"><div><strong>Academic profile setup</strong><span>${profileStepsComplete} of 2 tasks complete</span></div><progress max="2" value="${profileStepsComplete}" aria-label="${profileStepsComplete} of 2 profile setup tasks complete"></progress><p>This indicator tracks profile setup only. Your self-reported history is not an official university record.</p></div><label>Program<select name="programId" required><option value="">Choose your program</option>${programOptions}</select></label>
    <p class="academic-profile-faculty">Faculty <strong>${escapeHtml(selectedProgram?.facultyName || academicState.profile?.facultyName || 'Choose a program')}</strong></p>
</fieldset>
    <section class="academic-task-grid" aria-label="Academic profile tasks"><article class="academic-task-card"><strong>Choose or confirm your program</strong><p>${selectedProgram ? escapeHtml(selectedProgram.facultyName) + " - " + escapeHtml(selectedProgram.name) : "Select your faculty and program; you can edit these later."}</p><button class="button secondary" type="button" data-focus-program>Choose or edit program</button><span>${selected ? "Complete" : "Next"}</span></article><article class="academic-task-card"><strong>Record courses and retakes</strong><p>${attempts.length} course attempts - ${passedCount} passed courses - ${failedCount} failed attempts</p><button class="button secondary" type="button" data-focus-course>Add or edit courses</button><span>${attempts.length ? "Complete" : "Next"}</span></article><article class="academic-task-card"><strong>Review and save</strong><p>Save your self-reported profile after reviewing these entries.</p><button class="button primary" type="submit" form="academic-progress-form">Review and save</button><span>${profileStepsComplete === 2 ? "Complete" : "Remaining"}</span></article></section>
    <section class="academic-progress-overview" aria-label="Academic profile summary"><div class="academic-progress-heading"><div><span class="eyebrow">PROFILE SUMMARY</span><h3>${escapeHtml(selectedProgram?.name || "Choose a program to begin")}</h3></div><span class="progress-orbit" style="--progress-value:${profilePercent}%" aria-label="${profilePercent}% profile setup complete"><span>${profilePercent}%</span></span></div><div class="academic-record-summary"><span><strong>${attempts.length}</strong> course records saved</span><span><strong>${passedCount}</strong> passed</span><span><strong>${failedCount}</strong> failed</span><span><strong>${attempts.filter(item => !item.grade).length}</strong> without outcome</span><span><strong>${2 - profileStepsComplete}</strong> profile tasks remaining</span></div></section>
    <section class="academic-history"><h3>Your course history</h3><p>Each result is saved by course, grade, year, and term. Add another result for a retake.</p><div class="academic-attempt-list">${attempts.map((attempt,index) => `<div class="academic-attempt-row"><span>${escapeHtml(attempt.code)} · ${escapeHtml(attempt.courseName)} — ${escapeHtml(attempt.grade === 'F' ? 'Failed - F - Retake required' : attempt.grade)}, ${attempt.academicYear} ${escapeHtml(attempt.term)}</span><button type="button" class="button secondary" data-remove-attempt="${index}" aria-label="Remove ${escapeHtml(attempt.code)} ${escapeHtml(attempt.grade)} result">Remove</button></div>`).join('') || '<p class="empty">No results yet. Add your first course result below.</p>'}</div></section>
    <fieldset class="academic-attempt-editor"><legend>Add a course result</legend><p>Choose the course and enter the result shown in your records.</p><label>Course<select name="programCourseId" required><option value="">Choose a course</option>${courses}</select></label><label>Outcome<select name="grade" required><option value="">Choose outcome</option>${['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].map(g => `<option>${g}</option>`).join('')}<option value="__no_result">No result / not completed</option></select></label><label>Academic year<input name="academicYear" type="number" min="2000" max="2200" required value="${new Date().getFullYear()}"></label><label>Term<input name="term" maxlength="40" required placeholder="Fall, Spring, or Summer"></label><button class="button secondary" type="button" data-add-attempt>Add result</button></fieldset>
    <div class="academic-save-bar"><p class="academic-progress-message" role="status" aria-live="polite">Your changes are saved only after you choose Save.</p><button class="button primary" type="submit">Save profile &amp; progress</button></div></form>
    <dialog class="academic-setup-dialog" data-setup-dialog><form><p class="eyebrow">GUIDED SETUP · STEP <span data-step-number>1</span> OF 4</p><button class="button secondary" type="button" data-save-later>Finish later</button><section data-wizard-step="1"><h3>Choose your program</h3><p>You can change this later. Your selection is self-reported.</p><label>Program<select data-wizard-program><option value="">Choose your program</option>${programOptions}</select></label></section><section data-wizard-step="2" hidden><h3>Select courses</h3><label>Search by code or name<input type="search" data-wizard-search placeholder="Find courses"></label><div data-wizard-courses></div></section><section data-wizard-step="3" hidden><h3>Record outcomes</h3><p>Passed, failed (F), and no result remain distinct. Retakes are separate attempts.</p><div data-wizard-attempts></div></section><section data-wizard-step="4" hidden><h3>Review and save</h3><p>Your academic history is self-reported, not an official university record.</p><div data-wizard-review></div></section><p role="status" aria-live="polite" data-wizard-status></p><div class="academic-step-actions"><button class="button secondary" type="button" data-wizard-back>Back</button><button class="button primary" type="button" data-wizard-next>Continue</button><button class="button primary" type="button" data-wizard-save hidden>Save profile</button></div></form></dialog>
`;
  const form = root.querySelector('form');
  const setup=root.querySelector('[data-setup-dialog]'),wizard=setup.querySelector('form');let wizardStep=1,chosen=new Set(attempts.map(a=>Number(a.programCourseId)));
  let wizardDraft=attempts.map(a=>({...a}));let wizardCourses=academicState.courses;
  const drawWizard=()=>{wizard.querySelectorAll('[data-wizard-step]').forEach(panel=>panel.hidden=Number(panel.dataset.wizardStep)!==wizardStep);wizard.querySelector('[data-step-number]').textContent=wizardStep;wizard.querySelector('[data-wizard-back]').hidden=wizardStep===1;wizard.querySelector('[data-wizard-next]').hidden=wizardStep===4;wizard.querySelector('[data-wizard-save]').hidden=wizardStep!==4;if(wizardStep===2){const query=wizard.querySelector('[data-wizard-search]').value.trim().toLowerCase();wizard.querySelector('[data-wizard-courses]').innerHTML=wizardCourses.filter(c=>!query||(c.code+' '+c.name).toLowerCase().includes(query)).map(c=>`<label class="academic-course-option"><input type="checkbox" value="${c.id}" ${chosen.has(Number(c.id))?'checked':''}> <strong>${escapeHtml(c.code)}</strong> · ${escapeHtml(c.name)}</label>`).join('')||'<p class="empty">No matching courses in this program.</p>';}if(wizardStep===3)wizard.querySelector('[data-wizard-attempts]').innerHTML=[...chosen].map(id=>{const course=wizardCourses.find(c=>Number(c.id)===id),courseAttempts=wizardDraft.filter(a=>Number(a.programCourseId)===id);return course?`<fieldset><legend>${escapeHtml(course.code)} · ${escapeHtml(course.name)}</legend>${courseAttempts.map((attempt,index)=>`<label>Attempt ${index+1} outcome<select data-result-outcome="${id}" data-attempt-index="${index}"><option value="none" ${!attempt.grade?'selected':''}>No result recorded / not completed</option><option value="passed" ${attempt.grade&&attempt.grade!=='F'?'selected':''}>Completed and passed</option><option value="failed" ${attempt.grade==='F'?'selected':''}>Failed · F · Retake required</option></select></label><label>Academic year<input data-result-year="${id}" data-attempt-index="${index}" type="number" min="2000" max="2200" value="${attempt.academicYear||new Date().getFullYear()}"></label><label>Term<input data-result-term="${id}" data-attempt-index="${index}" maxlength="40" value="${escapeHtml(attempt.term||'')}"></label>`).join('')}<button type="button" data-add-retake="${id}">Add retake attempt</button></fieldset>`:''}).join('')||'<p>Select courses in the previous step.</p>';if(wizardStep===4)wizard.querySelector('[data-wizard-review]').innerHTML=`<p>${escapeHtml(wizard.querySelector('[data-wizard-program]').selectedOptions[0]?.textContent||'No program selected')} · ${wizardDraft.length} attempts selected.</p>${wizardDraft.map(a=>`<p>${escapeHtml(a.code)} · ${escapeHtml(a.courseName)} — ${a.grade==='F'?'Failed - F - Retake required':escapeHtml(a.grade||'No result')}, ${a.academicYear} ${escapeHtml(a.term)}</p>`).join('')}`;};
  wizard.querySelector('[data-save-later]').addEventListener('click',()=>setup.close());wizard.querySelector('[data-wizard-search]').addEventListener('input',drawWizard);wizard.querySelector('[data-wizard-courses]').addEventListener('change',event=>{if(!event.target.matches('input[type=checkbox]'))return;const id=Number(event.target.value),programId=Number(wizard.querySelector('[data-wizard-program]').value);if(event.target.checked){chosen.add(id);const course=wizardCourses.find(c=>Number(c.id)===id);if(course&&!wizardDraft.some(a=>Number(a.programCourseId)===id))wizardDraft.push({programId,programCourseId:id,code:course.code,courseName:course.name,grade:'',academicYear:new Date().getFullYear(),term:''});}else{chosen.delete(id);wizardDraft=wizardDraft.filter(a=>Number(a.programCourseId)!==id);} });wizard.querySelector('[data-wizard-attempts]').addEventListener('input',event=>{const id=Number(event.target.dataset.resultOutcome||event.target.dataset.resultYear||event.target.dataset.resultTerm),index=Number(event.target.dataset.attemptIndex);if(!id||!wizardDraft.filter(a=>Number(a.programCourseId)===id)[index])return;const item=wizardDraft.filter(a=>Number(a.programCourseId)===id)[index];if(event.target.matches('[data-result-outcome]'))item.grade=event.target.value==='failed'?'F':event.target.value==='none'?'':item.grade||'B';if(event.target.matches('[data-result-year]'))item.academicYear=Number(event.target.value);if(event.target.matches('[data-result-term]'))item.term=event.target.value;});wizard.querySelector('[data-wizard-attempts]').addEventListener('click',event=>{const button=event.target.closest('[data-add-retake]');if(!button)return;const id=Number(button.dataset.addRetake),course=wizardCourses.find(c=>Number(c.id)===id);if(course)wizardDraft.push({programId:Number(wizard.querySelector('[data-wizard-program]').value),programCourseId:id,code:course.code,courseName:course.name,grade:'',academicYear:new Date().getFullYear(),term:''});drawWizard();});wizard.querySelector('[data-wizard-back]').addEventListener('click',()=>{wizardStep=Math.max(1,wizardStep-1);drawWizard();});wizard.querySelector('[data-wizard-next]').addEventListener('click',async()=>{const message=wizard.querySelector('[data-wizard-status]');if(wizardStep===1){const programId=Number(wizard.querySelector('[data-wizard-program]').value);if(!programId){wizard.querySelector('[data-wizard-program]').focus();return;}if(programId!==selected){try{message.textContent='Loading courses for this program…';const result=await api(`/student/academic-progress?programId=${encodeURIComponent(programId)}`);wizardCourses=result.courses;wizardDraft=result.attempts.filter(a=>Number(a.programId)===programId).map(a=>({...a}));chosen=new Set(wizardDraft.map(a=>Number(a.programCourseId)));message.textContent='';}catch(error){message.textContent=error.message;return;}}}wizardStep=Math.min(4,wizardStep+1);drawWizard();});wizard.querySelector('[data-wizard-save]').addEventListener('click',async()=>{const programId=Number(wizard.querySelector('[data-wizard-program]').value),message=wizard.querySelector('[data-wizard-status]'),button=wizard.querySelector('[data-wizard-save]');if(!programId){wizardStep=1;drawWizard();return;}const submitted=wizardDraft.filter(a=>Number(a.programId)===programId&&a.grade).map(({id,programCourseId,grade,academicYear,term})=>({...id?{id}:{},programCourseId,grade,academicYear,term}));button.disabled=true;message.textContent='Saving your profile and course history…';try{academicState=await api('/student/academic-progress',{method:'PUT',body:JSON.stringify({programId,attempts:submitted})});setup.close();renderAcademicProgress(root);}catch(error){message.textContent=error.message+' Saved records are unchanged.';button.disabled=false;}});
  root.querySelectorAll('[data-focus-program],[data-focus-course]').forEach(button=>button.addEventListener('click',()=>{wizardStep=button.hasAttribute('data-focus-program')?1:2;const select=wizard.querySelector('[data-wizard-program]');select.value=String(selected||'');if(wizardStep===2){wizardCourses=academicState.courses;wizardDraft=attempts.map(a=>({...a}));chosen=new Set(wizardDraft.map(a=>Number(a.programCourseId)));}setup.showModal();drawWizard();}));
  const filterHistory=()=>{const query=root.querySelector('[data-history-search]')?.value.trim().toLowerCase()||'',outcome=root.querySelector('[data-history-filter]')?.value||'all',year=root.querySelector('[data-history-year]')?.value||'all',term=root.querySelector('[data-history-term]')?.value||'all';root.querySelectorAll('.academic-attempt-row[data-code]').forEach(row=>{row.hidden=!(row.dataset.code.includes(query)||row.dataset.name.includes(query))||!(outcome==='all'||row.dataset.outcome===outcome||outcome==='ungraded'&&!row.dataset.grade)||!(year==='all'||row.dataset.year===year)||!(term==='all'||row.dataset.term===term);});};
  root.querySelectorAll('[data-history-search],[data-history-filter],[data-history-year],[data-history-term]').forEach(control=>control.addEventListener('input',filterHistory));
  root.querySelectorAll('[data-edit-attempt]').forEach(button=>button.addEventListener('click',()=>{const attempt=attempts[Number(button.dataset.editAttempt)];if(!attempt)return;const value=prompt('Enter grade (A+ through D-, F), or blank for no result.',attempt.grade||'');if(value===null)return;const grade=value.trim().toUpperCase();if(grade&&!['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','D-','F'].includes(grade)){alert('Enter a supported grade.');return;}academicState.attempts=academicState.attempts.map(item=>item===attempt?{...item,grade}:item);renderAcademicProgress(root);}));
  form.addEventListener('input', () => {
    const complete = [Boolean(Number(form.elements.programId.value)), academicState.attempts.some(item => item.programId === Number(form.elements.programId.value))].filter(Boolean).length;
    const progress = form.querySelector('.academic-setup-progress progress');
    const count = form.querySelector('.academic-setup-progress span');
    if (progress) { progress.value = complete; progress.setAttribute('aria-label', `${complete} of 2 profile setup tasks selected`); }
    if (count) count.textContent = `${complete} of 2 tasks selected`;
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
      const grade=form.elements.grade.value;
      if(grade==='__no_result'){form.querySelector('.academic-progress-message').textContent='No result recorded. This course is not added as an attempt.';return;}
      academicState.attempts.push({ programId:selected, programCourseId:courseId, code:course.code, courseName:course.name, credits:Number(course.credits), grade, academicYear:Number(form.elements.academicYear.value), term:form.elements.term.value.trim() });
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
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    message.textContent = 'Saving your academic profile and progress…';
    try {
      const saved = await api('/student/academic-progress', { method: 'PUT', body: JSON.stringify({ programId, attempts: submitted }) });
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
