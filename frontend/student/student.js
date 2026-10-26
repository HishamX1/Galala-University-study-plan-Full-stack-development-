import { getApiCandidates, saveApiBase } from '../shared/apiConfig.js';
import { normalizeCatalog } from '../shared/catalogNormalizer.js';
import { restoreSession, signOut } from '../shared/session.js';
import { escapeHtml } from '../shared/dom.js';
import { reconcileStudentViewStack, resolveProgramFacultyId } from './navigation.js';

const CATALOG_FRESHNESS_MS = 30_000;

const apiCandidates = getApiCandidates();
let workingApiBase = apiCandidates[0] || '/api';

const authenticatedUser = await restoreSession();
if (authenticatedUser?.unavailable) {
  document.body.innerHTML = '<main class="auth-unavailable" role="alert"><h1>Student portal temporarily unavailable</h1><p>Your session could not be verified because the API is unreachable. Reconnect and reload this page. You have not been signed out.</p><button type="button" onclick="location.reload()">Try again</button></main>';
  throw new Error('Session verification unavailable.');
}
if (!authenticatedUser) {
  location.replace('../student-login.html');
  throw new Error('Student session is not valid.');
}
document.getElementById('student-sign-out')?.addEventListener('click', () => signOut('../index.html'));

const state = {
  viewStack: [],
  history: [],
  currentView: 'overview',
  catalogLoadedAt: 0,
  data: {
    faculties: [],
    programs: [],
    programCourses: [],
    academicProgress: null
  }
};

const elements = {
  statFaculties: document.getElementById('stat-faculties'),
  statPrograms: document.getElementById('stat-programs'),
  statCourses: document.getElementById('stat-courses'),
  filterFaculty: document.getElementById('filter-faculty'),
  filterProgram: document.getElementById('filter-program'),
  filterYear: document.getElementById('filter-year'),
  filterSemester: document.getElementById('filter-semester'),
  activeFilters: document.getElementById('active-filters'),
  activeFiltersList: document.getElementById('active-filters-list'),
  clearFiltersBtn: document.getElementById('clear-filters-btn'),
  courseSearch: document.getElementById('course-search'),
  searchBtn: document.getElementById('search-btn'),
  searchSuggestions: document.getElementById('course-search-suggestions'),
  overviewView: document.getElementById('overview-view'),
  semesterView: document.getElementById('semester-view'),
  courseView: document.getElementById('course-view'),
  searchView: document.getElementById('search-view'),
  facultyGrid: document.getElementById('faculty-grid'),
  semesterGrid: document.getElementById('semester-grid'),
  coursesTbody: document.getElementById('courses-tbody'),
  searchResults: document.getElementById('search-results'),
  semesterViewTitle: document.getElementById('semester-view-title'),
  courseViewTitle: document.getElementById('course-view-title'),
  searchViewTitle: document.getElementById('search-view-title'),
  breadcrumb: document.getElementById('breadcrumb-container'),
  loadingState: document.getElementById('loading-state'),
  errorState: document.getElementById('error-state'),
  emptyState: document.getElementById('empty-state'),
  errorMessage: document.getElementById('error-message'),
  clearSearchBtn: document.getElementById('clear-search-btn'),
  courseModal: document.getElementById('course-modal'),
  modalBody: document.getElementById('modal-body'),
  modalTitle: document.getElementById('modal-title'),
  viewHierarchyBtn: document.getElementById('view-hierarchy-btn'),
  bgLayer: document.getElementById('bg-layer'),
  bgOverlay: document.getElementById('bg-overlay'),
  programsBackBtn: document.getElementById('programs-back-btn'),
  historyList: document.getElementById('history-list'),
  facultyNavBtn: document.getElementById('faculty-nav-btn'),
  programsNavBtn: document.getElementById('programs-nav-btn'),
  overviewTitle: document.getElementById('overview-title'),
  navStatus: document.getElementById('student-nav-status'),
  retryCatalogBtn: document.getElementById('retry-catalog-btn'),
  mainContent: document.getElementById('main-content'),
  visualization: document.getElementById('visualization-container')
};

let catalogLoadPromise = null;
let navigationToRestore = null;
let studentRefreshInFlight = null;

function refreshStudentSession(base, signal) {
  if (!studentRefreshInFlight) {
    const pending = fetch(`${base}/auth/refresh`, { method: 'POST', credentials: 'include', headers: { Accept: 'application/json' }, signal })
      .then(async (response) => ({ response, data: await response.json().catch(() => ({})) }))
      .finally(() => { if (studentRefreshInFlight === pending) studentRefreshInFlight = null; });
    studentRefreshInFlight = pending;
  }
  return studentRefreshInFlight;
}

async function fetchJson(path) {
  let lastError = null;

  for (const base of [workingApiBase, ...apiCandidates.filter((candidate) => candidate !== workingApiBase)]) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      let res = await fetch(`${base}${path}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal });
      if (res.status === 401) {
        const { response: refreshed } = await refreshStudentSession(base, controller.signal);
        if (refreshed.status === 401) { window.location.assign('../student-login.html'); const error = new Error('Your session has expired. Please sign in again.'); error.noRetry = true; throw error; }
        if (!refreshed.ok) { const error = new Error('The authentication service is temporarily unavailable.'); error.status = refreshed.status; error.noRetry = true; throw error; }
        res = await fetch(`${base}${path}`, { credentials: 'include', headers: { Accept: 'application/json' }, signal: controller.signal });
      }
      if (res.status === 401) {
        window.location.assign('../student-login.html');
        const error = new Error('Authentication required');
        error.noRetry = true;
        throw error;
      }
      if (res.status === 403) {
        window.location.assign('../denied.html');
        const error = new Error('This account cannot access the Student Portal.');
        error.noRetry = true;
        throw error;
      }
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) { const error = new Error('API returned an unexpected response.'); error.noRetry = true; throw error; }
      const data = await res.json();
      if (!res.ok) { const error = new Error(data.error || `HTTP ${res.status}`); error.status = res.status; error.code = data.code; error.requestId = data.requestId || res.headers.get('x-request-id'); error.noRetry = true; throw error; }
      workingApiBase = base;
      saveApiBase(base);
      return data;
    } catch (error) {
      if (error.noRetry) throw error;
      if (controller.signal.aborted) { const timeoutError = new Error('The API request timed out. Check your connection and try again.'); timeoutError.code = 'REQUEST_TIMEOUT'; timeoutError.noRetry = true; throw timeoutError; }
      if (error.status) throw error;
      lastError = error;
    } finally { clearTimeout(timeout); }
  }

  throw new Error(`Unable to reach backend API. (${lastError?.message || 'Unknown error'})`);
}

function yearsForProgram(programId) {
  return [...new Set(state.data.programCourses
    .filter((course) => course.programId === Number(programId))
    .map((course) => course.yearNo))]
    .sort((a, b) => a - b);
}

function semestersForProgramYear(programId, yearNo) {
  return [...new Set(state.data.programCourses
    .filter((course) => course.programId === Number(programId) && course.yearNo === Number(yearNo))
    .map((course) => course.semesterNo))]
    .sort((a, b) => a - b);
}

function coursesFor(programId, yearNo, semesterNo) {
  return state.data.programCourses
    .filter((course) => (
      course.programId === Number(programId) &&
      course.yearNo === Number(yearNo) &&
      course.semesterNo === Number(semesterNo)
    ))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function programById(id) {
  return state.data.programs.find((program) => program.id === Number(id));
}

function facultyById(id) {
  return state.data.faculties.find((faculty) => faculty.id === Number(id));
}

function courseById(id) {
  return state.data.programCourses.find((course) => course.id === Number(id));
}

function setBackgroundDepth(depth) {
  const value = Math.max(0, Math.min(4, depth));
  elements.bgLayer?.setAttribute('data-depth', value);
  elements.bgOverlay?.setAttribute('data-depth', value);
}

function hideAllViews() {
  [elements.overviewView, elements.semesterView, elements.courseView, elements.searchView, elements.loadingState, elements.errorState, elements.emptyState]
    .forEach((el) => { if (el) el.style.display = 'none'; });
}

function showView(el) {
  hideAllViews();
  if (el) el.style.display = el === elements.loadingState || el === elements.errorState || el === elements.emptyState ? 'flex' : 'block';
  if (el?.classList?.contains('view-section')) {
    state.currentView = el === elements.overviewView ? 'overview'
      : el === elements.semesterView ? 'program'
        : el === elements.courseView ? 'courses'
          : el === elements.searchView ? 'search' : state.currentView;
    el.classList.remove('is-entering');
    const animate = () => el.classList.add('is-entering');
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(animate);
    else animate();
  }
}

function showError(message) {
  elements.errorMessage.textContent = message;
  showView(elements.errorState);
}

function optionHtml(items, label, value = 'id', empty = 'Select...') {
  return `<option value="">${escapeHtml(empty)}</option>${items.map((item) => `<option value="${escapeHtml(item[value])}">${escapeHtml(item[label])}</option>`).join('')}`;
}

function updateStats() {
  if (elements.statFaculties) {
    elements.statFaculties.textContent = state.data.faculties.length;
  }

  if (elements.statPrograms) {
    elements.statPrograms.textContent = state.data.programs.length;
  }

  if (elements.statCourses) {
    elements.statCourses.textContent = state.data.programCourses.length;
  }
}

function syncFilterValues({ facultyId = '', programId = '', yearNo = '', semesterNo = '' } = {}) {
  elements.filterFaculty.value = facultyId ? String(facultyId) : '';
  updateProgramFilter(facultyId);
  elements.filterProgram.value = programId ? String(programId) : '';

  if (programId) updateYearFilter(programId);
  else elements.filterYear.innerHTML = '<option value="">All Years</option>';
  elements.filterYear.value = yearNo ? String(yearNo) : '';

  if (programId && yearNo) updateSemesterFilter(programId, yearNo);
  else elements.filterSemester.innerHTML = '<option value="">All Semesters</option>';
  elements.filterSemester.value = semesterNo ? String(semesterNo) : '';
  renderActiveFilters({ facultyId, programId, yearNo, semesterNo });
}

function renderActiveFilters({ facultyId = '', programId = '', yearNo = '', semesterNo = '' } = {}) {
  if (!elements.activeFilters || !elements.activeFiltersList) return;
  const chips = [];
  const faculty = facultyId ? facultyById(facultyId) : null;
  const program = programId ? programById(programId) : null;
  if (faculty) chips.push(`Faculty: ${faculty.name}`);
  if (program) chips.push(`Program: ${program.name}`);
  if (yearNo) chips.push(`Year ${yearNo}`);
  if (semesterNo) chips.push(`Semester ${semesterNo}`);

  elements.activeFilters.style.display = chips.length ? 'block' : 'none';
  elements.activeFiltersList.innerHTML = chips
    .map((label) => `<span class="active-filter-chip">${escapeHtml(label)}</span>`)
    .join('');
}

function populateFilters() {
  elements.filterFaculty.innerHTML = optionHtml(state.data.faculties, 'name', 'id', 'All Faculties');
  elements.filterProgram.innerHTML = optionHtml(state.data.programs, 'name', 'id', 'All Programs');
  elements.filterYear.innerHTML = '<option value="">All Years</option>';
  elements.filterSemester.innerHTML = '<option value="">All Semesters</option>';
  elements.filterProgram.disabled = false;
  elements.filterYear.disabled = false;
  elements.filterSemester.disabled = false;
  renderActiveFilters();
}

function updateProgramFilter(facultyId) {
  const programs = facultyId
    ? state.data.programs.filter((program) => program.facultyId === Number(facultyId))
    : state.data.programs;
  elements.filterProgram.innerHTML = optionHtml(programs, 'name', 'id', 'All Programs');
  elements.filterYear.innerHTML = '<option value="">All Years</option>';
  elements.filterSemester.innerHTML = '<option value="">All Semesters</option>';
  elements.filterProgram.disabled = false;
  elements.filterYear.disabled = !elements.filterProgram.value;
  elements.filterSemester.disabled = true;
}

function updateYearFilter(programId) {
  const years = yearsForProgram(programId).map((yearNo) => ({ id: yearNo, label: `Year ${yearNo}` }));
  elements.filterYear.innerHTML = optionHtml(years, 'label', 'id', 'All Years');
  elements.filterSemester.innerHTML = '<option value="">All Semesters</option>';
  elements.filterYear.disabled = !programId;
  elements.filterSemester.disabled = true;
}

function updateSemesterFilter(programId, yearNo) {
  const semesters = semestersForProgramYear(programId, yearNo).map((semesterNo) => ({ id: semesterNo, label: `Semester ${semesterNo}` }));
  elements.filterSemester.innerHTML = optionHtml(semesters, 'label', 'id', 'All Semesters');
  elements.filterSemester.disabled = !(programId && yearNo);
}

function updateBreadcrumb(items) {
  elements.breadcrumb.innerHTML = items.map((item, index) => {
    const last = index === items.length - 1;
    return last
      ? `<span class="breadcrumb-item active">${escapeHtml(item.label)}</span>`
      : `<button class="breadcrumb-item" data-action="${escapeHtml(item.action)}">${escapeHtml(item.label)}</button>`;
  }).join('<span class="breadcrumb-separator">/</span>');
  elements.breadcrumb.querySelectorAll('[data-action="overview"]').forEach((btn) => {
    btn.addEventListener('click', renderOverview);
  });
}

function addHistory(type, id, label) {
  state.history = state.history.filter((item) => item.type !== type || item.id !== id);
  state.history.unshift({ type, id, label });
  state.history = state.history.slice(0, 5);
  renderHistory();
}

function bindCardActivation(node, action) {
  node.addEventListener('click', action);
  node.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  });
}

function renderHistory() {
  if (!elements.historyList) return;
  if (!state.history.length) {
    elements.historyList.innerHTML = '<p class="text-muted" style="font-size: 0.875rem; padding: 0.5rem 0;">No recent views</p>';
    return;
  }
  elements.historyList.innerHTML = state.history.map((item) => `<button class="history-item" data-type="${escapeHtml(item.type)}" data-id="${escapeHtml(item.id)}"><span>${escapeHtml(item.label)}</span></button>`).join('');
  elements.historyList.querySelectorAll('.history-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.type === 'faculty') renderProgramsForFaculty(btn.dataset.id);
      if (btn.dataset.type === 'program') renderProgramSemesters(btn.dataset.id);
      if (btn.dataset.type === 'course') showCourseModal(Number(btn.dataset.id));
    });
  });
}

function focusOverview() {
  elements.overviewTitle?.focus();
  elements.overviewTitle?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function renderOverview({ focus = false } = {}) {
  showView(elements.overviewView);
  setBackgroundDepth(0);
  state.viewStack = [{ view: 'overview' }];
  if (elements.overviewTitle) elements.overviewTitle.textContent = 'Choose a Faculty';
  if (elements.navStatus) elements.navStatus.textContent = '';
  if (elements.programsBackBtn) elements.programsBackBtn.style.display = 'none';
  updateBreadcrumb([{ label: 'Home', active: true }]);
  syncFilterValues();

  elements.facultyGrid.innerHTML = state.data.faculties.map((faculty) => {
    const programs = state.data.programs.filter((program) => program.facultyId === faculty.id);
    const courseCount = state.data.programCourses.filter((course) => course.facultyId === faculty.id).length;
    return `
      <div class="faculty-card" data-faculty-id="${escapeHtml(faculty.id)}" role="button" tabindex="0" aria-label="View ${escapeHtml(faculty.name)}">
        <h3>${escapeHtml(faculty.name)}</h3>
        <p>Explore the academic programs and course structure</p>
        <div class="faculty-stats">
          <div class="faculty-stat"><span>${programs.length} Programs</span></div>
          <div class="faculty-stat"><span>${courseCount} Courses</span></div>
        </div>
      </div>
    `;
  }).join('') || '<div class="gu-empty"><h3 class="gu-empty-title">No faculties found</h3></div>';

  elements.facultyGrid.querySelectorAll('[data-faculty-id]').forEach((card) => {
    bindCardActivation(card, () => renderProgramsForFaculty(card.dataset.facultyId));
  });
  if (focus) focusOverview();
}

function renderProgramsForFaculty(facultyId, { resetStack = false, focus = false } = {}) {
  const faculty = facultyById(facultyId);
  if (!faculty) return renderOverview({ focus });
  showView(elements.overviewView);
  setBackgroundDepth(1);
  if (resetStack) state.viewStack = [{ view: 'overview' }, { view: 'faculty', facultyId: Number(facultyId) }];
  else state.viewStack.push({ view: 'faculty', facultyId: Number(facultyId) });
  if (elements.overviewTitle) elements.overviewTitle.textContent = `Programs in ${faculty.name}`;
  if (elements.navStatus) elements.navStatus.textContent = '';
  if (elements.programsBackBtn) elements.programsBackBtn.style.display = 'inline-flex';

  const programs = state.data.programs.filter((program) => program.facultyId === Number(facultyId));
  if (faculty) addHistory('faculty', faculty.id, faculty.name);
  updateBreadcrumb([{ label: 'Home', action: 'overview' }, { label: faculty?.name || 'Faculty', active: true }]);
  syncFilterValues({ facultyId });

  elements.facultyGrid.innerHTML = programs.map((program) => {
    const courseCount = state.data.programCourses.filter((course) => course.programId === program.id).length;
    return `
      <div class="faculty-card program-card" data-program-id="${escapeHtml(program.id)}" role="button" tabindex="0">
        <h3>${escapeHtml(program.name)}</h3>
        <p>View the complete study plan structure</p>
        <div class="faculty-stats">
          <div class="faculty-stat"><span>${program.durationYears} Years</span></div>
          <div class="faculty-stat"><span>${courseCount} Courses</span></div>
        </div>
      </div>
    `;
  }).join('') || '<div class="gu-empty"><h3 class="gu-empty-title">No programs found</h3></div>';

  elements.facultyGrid.querySelectorAll('[data-program-id]').forEach((card) => {
    bindCardActivation(card, () => renderProgramSemesters(card.dataset.programId));
  });
  if (focus) focusOverview();
}

function openFacultyNavigation() {
  renderOverview({ focus: true });
}

function openProgramsNavigation() {
  const facultyId = resolveProgramFacultyId(state.viewStack, state.data, elements.filterFaculty.value);
  if (!facultyId || !facultyById(facultyId)) {
    renderOverview({ focus: true });
    if (elements.navStatus) elements.navStatus.textContent = 'Choose a faculty first, then select Programs.';
    return;
  }
  renderProgramsForFaculty(facultyId, { resetStack: true, focus: true });
}

function renderProgramSemesters(programId) {
  if (!programById(programId)) return renderOverview();
  showView(elements.semesterView);
  setBackgroundDepth(2);
  state.viewStack.push({ view: 'program', programId });

  const program = programById(programId);
  if (program) addHistory('program', program.id, program.name);
  elements.semesterViewTitle.textContent = program?.name || 'Program Study Plan';
  updateBreadcrumb([{ label: 'Home', action: 'overview' }, { label: program?.name || 'Program', active: true }]);
  syncFilterValues({ facultyId: program?.facultyId || '', programId });

  const cards = [];
  for (const yearNo of yearsForProgram(programId)) {
    for (const semesterNo of semestersForProgramYear(programId, yearNo)) {
      const courses = coursesFor(programId, yearNo, semesterNo);
      const credits = courses.reduce((sum, course) => sum + (course.credits || 0), 0);
      cards.push(`
        <div class="semester-card" data-program-id="${escapeHtml(programId)}" data-year-no="${escapeHtml(yearNo)}" data-semester-no="${escapeHtml(semesterNo)}" role="button" tabindex="0">
          <div class="semester-card-header"><h3>Semester ${escapeHtml(semesterNo)}</h3></div>
          <div class="semester-stats">
            <span><strong>${courses.length}</strong> Courses</span>
            <span><strong>${credits}</strong> Credits</span>
          </div>
          <div class="course-tags">${courses.slice(0, 4).map((course) => `<span class="course-tag">${escapeHtml(course.code)}</span>`).join('')}</div>
        </div>
      `);
    }
  }
  elements.semesterGrid.innerHTML = cards.join('') || '<div class="gu-empty"><h3 class="gu-empty-title">No courses found</h3></div>';
  elements.semesterGrid.querySelectorAll('[data-program-id]').forEach((card) => {
    bindCardActivation(card, () => renderCourseTable(card.dataset.programId, card.dataset.yearNo, card.dataset.semesterNo));
  });
}

function renderCourseTable(programId, yearNo, semesterNo) {
  if (!programById(programId) || !coursesFor(programId, yearNo, semesterNo).length) return renderOverview();
  showView(elements.courseView);
  setBackgroundDepth(3);
  state.viewStack.push({ view: 'courses', programId, yearNo, semesterNo });
  elements.courseViewTitle.textContent = `Year ${yearNo}, Semester ${semesterNo}`;
  const courses = coursesFor(programId, yearNo, semesterNo);
  const program = programById(programId);
  syncFilterValues({ facultyId: program?.facultyId || '', programId, yearNo, semesterNo });

  elements.coursesTbody.innerHTML = courses.map((course) => {
    const prereqs = (course.prerequisiteCourseIds || []).map(courseById).filter(Boolean);
    return `
      <tr>
        <td class="course-code-cell">${escapeHtml(course.code)}</td>
        <td class="course-name-cell">${escapeHtml(course.name)}</td>
        <td><strong>${escapeHtml(course.credits)}</strong></td>
        <td class="prereq-cell">${prereqs.length ? prereqs.map((item) => `<span class="prereq-tag">${escapeHtml(item.code)}</span>`).join('') : '<span class="no-prereq">None</span>'}</td>
        <td class="actions-cell">
          <button class="gu-btn gu-btn--primary gu-btn--sm" data-action="view-course" data-course-id="${escapeHtml(course.id)}">View</button>
          <button class="gu-btn gu-btn--secondary gu-btn--sm" data-action="view-hierarchy" data-course-id="${escapeHtml(course.id)}">Hierarchy</button>
        </td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="5" class="text-center text-muted" style="padding: 3rem;">No courses found for this semester.</td></tr>';

  elements.coursesTbody.querySelectorAll('[data-action="view-course"]').forEach((btn) => {
    btn.addEventListener('click', () => showCourseModal(Number(btn.dataset.courseId)));
  });
  elements.coursesTbody.querySelectorAll('[data-action="view-hierarchy"]').forEach((btn) => {
    btn.addEventListener('click', () => showHierarchyView(Number(btn.dataset.courseId)));
  });
}

function populateSearchSuggestions() {
  elements.searchSuggestions.innerHTML = state.data.programCourses
    .map((course) => `<option value="${escapeHtml(`${course.code}: ${course.name}`)}">`)
    .join('');
}

function performSearch(query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return renderOverview();
  const results = state.data.programCourses.filter((course) =>
    course.code.toLowerCase().includes(normalized) ||
    course.name.toLowerCase().includes(normalized)
  );
  showView(elements.searchView);
  setBackgroundDepth(1);
  elements.searchViewTitle.textContent = `Search Results (${results.length})`;
  elements.searchResults.innerHTML = results.map((course) => `
    <div class="search-result-card" data-course-id="${escapeHtml(course.id)}" role="button" tabindex="0">
      <div class="search-result-content">
        <h4>${escapeHtml(course.code)} - ${escapeHtml(course.name)}</h4>
        <p class="search-result-meta">${escapeHtml(course.credits || 0)} credits</p>
      </div>
    </div>
  `).join('') || '<div class="gu-empty"><h3 class="gu-empty-title">No results found</h3></div>';
  elements.searchResults.querySelectorAll('[data-course-id]').forEach((card) => {
    bindCardActivation(card, () => showCourseModal(Number(card.dataset.courseId)));
  });
}

function showCourseModal(courseId) {
  const course = courseById(courseId);
  if (!course) return;
  addHistory('course', course.id, course.code);
  const program = programById(course.programId);
  const faculty = facultyById(course.facultyId);
  const prereqs = (course.prerequisiteCourseIds || []).map(courseById).filter(Boolean);

  elements.modalTitle.textContent = `${course.code} - ${course.name}`;
  elements.modalBody.innerHTML = `
    <div class="modal-course-details">
      <div class="detail-group"><span class="detail-label">Faculty</span><span class="detail-value">${escapeHtml(faculty?.name || 'N/A')}</span></div>
      <div class="detail-group"><span class="detail-label">Program</span><span class="detail-value">${escapeHtml(program?.name || 'N/A')}</span></div>
      <div class="detail-group"><span class="detail-label">Year</span><span class="detail-value">${escapeHtml(course.yearNo)}</span></div>
      <div class="detail-group"><span class="detail-label">Semester</span><span class="detail-value">${escapeHtml(course.semesterNo)}</span></div>
      <div class="detail-group"><span class="detail-label">Credits</span><span class="detail-value">${escapeHtml(course.credits || 0)}</span></div>
      <div class="detail-group"><span class="detail-label">Prerequisites</span><span class="detail-value">${prereqs.length ? prereqs.map((item) => escapeHtml(item.code)).join(', ') : 'None'}</span></div>
    </div>
  `;
  elements.viewHierarchyBtn.onclick = () => showHierarchyView(course.id);
  elements.courseModal.classList.add('active');
  elements.courseModal.dataset.courseId = String(course.id);
  document.body.style.overflow = 'hidden';
}

function showHierarchyView(courseId) {
  const course = courseById(courseId);
  if (!course) return;
  addHistory('course', course.id, course.code);
  const prerequisites = (course.prerequisiteCourseIds || []).map(courseById).filter(Boolean);
  const prerequisiteGroups = Array.isArray(course.prerequisiteGroups) && course.prerequisiteGroups.length
    ? course.prerequisiteGroups.map(group => ({ ...group, members: (group.members || []).map(member => courseById(member.courseId)).filter(Boolean) }))
    : prerequisites.map(item => ({ type: 'mandatory', label: 'Required prerequisite', members: [item] }));
  const mandatoryPrerequisites = prerequisiteGroups.filter(group => group.type !== 'alternative').flatMap(group => group.members);
  const alternativePrerequisiteGroups = prerequisiteGroups.filter(group => group.type === 'alternative');
  const dependents = state.data.programCourses.filter((item) => (item.prerequisiteCourseIds || []).includes(course.id));
  elements.modalTitle.textContent = `Course Hierarchy - ${course.code}`;
  elements.modalBody.innerHTML = `
    <div class="hierarchy-view-boxes">
      <div class="hierarchy-level hierarchy-level--prerequisites"><h6>Prerequisites (${escapeHtml(prerequisites.length)})</h6><div class="hierarchy-prerequisite-groups">${mandatoryPrerequisites.length ? `<section class="hierarchy-prerequisite-group hierarchy-prerequisite-group--mandatory"><h6>All required</h6><div class="hierarchy-row" role="region" aria-label="Mandatory prerequisite courses">${mandatoryPrerequisites.map(item => hierarchyCard(item, false, 'prerequisite')).join('')}</div></section>` : ''}${alternativePrerequisiteGroups.map(group => `<section class="hierarchy-prerequisite-group hierarchy-prerequisite-group--alternative"><h6>Complete either one · ${escapeHtml(group.label)}</h6><div class="hierarchy-row" role="region" aria-label="Alternative prerequisite courses">${group.members.map(item => hierarchyCard(item, false, 'prerequisite')).join('') || '<span class="no-prereq">No active options</span>'}</div></section>`).join('') || (!mandatoryPrerequisites.length ? '<span class="no-prereq">None</span>' : '')}</div></div>
      <div class="hierarchy-center-wrapper">${hierarchyCard(course, true)}</div>
      <div class="hierarchy-level hierarchy-level--dependents"><h6>Required For (${escapeHtml(dependents.length)})</h6><div class="hierarchy-row" role="region" aria-label="Courses that require this course">${dependents.map((item) => hierarchyCard(item, false, 'dependent')).join('') || '<span class="no-prereq">None</span>'}</div></div>
      <svg class="hierarchy-relationship-layer" aria-hidden="true" focusable="false"></svg>
      <p class="hierarchy-focus-status" aria-live="polite" aria-atomic="true">Hover, focus, or tap a related course to trace its connection.</p>
    </div>
  `;
  const hierarchyRoot = elements.modalBody.querySelector('.hierarchy-view-boxes');
  let activeRelationship = null;
  let inputMode = 'pointer';
  let relationshipSequence = 0;
  let drawFrame = 0;
  const schedulePathDraw = () => {
    cancelAnimationFrame(drawFrame);
    drawFrame = requestAnimationFrame(() => {
      if (activeRelationship) drawHierarchyPath(hierarchyRoot, activeRelationship.prerequisite, activeRelationship.dependent, activeRelationship.label);
    });
  };
  const focusTarget = (card) => {
    const sequence = ++relationshipSequence;
    hierarchyRoot.querySelectorAll('.hierarchy-card.is-focused, .hierarchy-card.is-related').forEach(item => item.classList.remove('is-focused', 'is-related'));
    hierarchyRoot.querySelectorAll('.hierarchy-card.is-tracing').forEach(item => item.classList.remove('is-tracing'));
    hierarchyRoot.classList.remove('has-focus');
    const layer = hierarchyRoot.querySelector('.hierarchy-relationship-layer');
    layer.replaceChildren();
    activeRelationship = null;
    if (!card || card.classList.contains('current')) {
      hierarchyRoot.querySelector('.hierarchy-focus-status').textContent = 'Hover, focus, or tap a related course to trace its connection.';
      return;
    }
    hierarchyRoot.classList.add('has-focus'); card.classList.add('is-focused');
    const isPrerequisite = card.dataset.relationKind === 'prerequisite';
    const oppositeRows = [...hierarchyRoot.querySelectorAll(isPrerequisite ? '.hierarchy-level--dependents .hierarchy-row' : '.hierarchy-prerequisite-groups .hierarchy-row')];
    const oppositeCards = oppositeRows.flatMap(row => [...row.querySelectorAll('.hierarchy-card[data-course-id]')]);
    const pairedCards = oppositeCards.filter(item => isPrerequisite
      ? (courseById(Number(item.dataset.courseId))?.prerequisiteCourseIds || []).some(id => Number(id) === Number(card.dataset.courseId))
      : (courseById(Number(card.dataset.courseId))?.prerequisiteCourseIds || []).some(id => Number(id) === Number(item.dataset.courseId)));
    if (!pairedCards.length) {
      hierarchyRoot.querySelector('.hierarchy-focus-status').textContent = 'No directly matching course appears in the opposite row.';
      return;
    }
    pairedCards.forEach(item => item.classList.add('is-related'));
    const relatedCodes = pairedCards.map(item => item.dataset.courseCode);
    const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const traceMatches = async () => {
      for (let index = 0; index < pairedCards.length; index += 1) {
        if (sequence !== relationshipSequence) return;
        const paired = pairedCards[index];
        hierarchyRoot.querySelectorAll('.hierarchy-card.is-tracing').forEach(item => item.classList.remove('is-tracing'));
        paired.classList.add('is-tracing');
        const prerequisiteCard = isPrerequisite ? card : paired;
        const dependentCard = isPrerequisite ? paired : card;
        const prerequisite = courseById(Number(prerequisiteCard.dataset.courseId));
        const dependent = courseById(Number(dependentCard.dataset.courseId));
        const prerequisiteState = courseCompletionState(prerequisite);
        const selectedState = courseCompletionState(course);
        const relevantState = isPrerequisite ? prerequisiteState : selectedState;
        const statusMessage = relevantState.uncertain
          ? `Multiple ${isPrerequisite ? prerequisite.code : course.code} attempts are recorded; the university repeat policy is needed to confirm this prerequisite for ${dependent.code}.`
          : relevantState.passed
            ? `${isPrerequisite ? prerequisite.code : course.code} is completed and satisfies its prerequisite link for ${dependent.code}.`
            : `Complete ${isPrerequisite ? prerequisite.code : course.code} to satisfy a prerequisite requirement for ${dependent.code}.`;
        const label = relevantState.uncertain ? 'REPEAT POLICY' : relevantState.passed ? 'PREREQUISITE SATISFIED' : 'COMPLETE TO UNLOCK';
        activeRelationship = { prerequisite: prerequisiteCard, dependent: dependentCard, label };
        const oppositeRow = paired.closest('.hierarchy-row');
        oppositeRow.scrollTo({ left: centeredScrollPosition(paired, oppositeRow), behavior: reduceMotion ? 'auto' : 'smooth' });
        schedulePathDraw();
        hierarchyRoot.querySelector('.hierarchy-focus-status').textContent = `${index + 1} of ${pairedCards.length}. ${statusMessage}`;
        if (pairedCards.length > 1 && !reduceMotion) await new Promise(resolve => setTimeout(resolve, 700));
      }
      if (sequence !== relationshipSequence) return;
      const relationText = isPrerequisite
        ? `Prerequisite ${card.dataset.courseCode} is linked to ${pairedCards.length} required-for course${pairedCards.length === 1 ? '' : 's'}: ${relatedCodes.join(', ')}.`
        : `${card.dataset.courseCode} requires ${pairedCards.length} prerequisite course${pairedCards.length === 1 ? '' : 's'}: ${relatedCodes.join(', ')}.`;
      hierarchyRoot.querySelector('.hierarchy-focus-status').textContent = relationText;
    };
    traceMatches();
  };
  hierarchyRoot?.addEventListener('pointerover', event => {
    inputMode = event.pointerType === 'touch' ? 'touch' : 'pointer';
    const card = event.target.closest('.hierarchy-card[data-relation-kind]');
    if (card && !card.contains(event.relatedTarget)) focusTarget(card);
  });
  hierarchyRoot?.addEventListener('pointerout', event => {
    if (event.pointerType === 'touch') return;
    const fromCard = event.target.closest('.hierarchy-card[data-relation-kind]');
    if (!fromCard || fromCard.contains(event.relatedTarget)) return;
    const nextCard = event.relatedTarget?.closest?.('.hierarchy-card[data-relation-kind]');
    if (nextCard) focusTarget(nextCard);
    else {
      const focusedCard = document.activeElement?.closest?.('.hierarchy-card[data-relation-kind]');
      focusTarget(inputMode === 'keyboard' && focusedCard && hierarchyRoot.contains(focusedCard) ? focusedCard : null);
    }
  });
  hierarchyRoot?.addEventListener('focusin', event => { const card = event.target.closest('.hierarchy-card[data-relation-kind]'); if (inputMode !== 'touch' && card) focusTarget(card); });
  hierarchyRoot?.addEventListener('focusout', event => { if (!hierarchyRoot.contains(event.relatedTarget) && !hierarchyRoot.matches(':hover')) focusTarget(null); });
  hierarchyRoot?.addEventListener('click', event => { const card = event.target.closest('.hierarchy-card[data-relation-kind]'); if (inputMode !== 'touch' && card && !card.classList.contains('is-focused') && !event.target.closest('[data-action="open-related"]')) focusTarget(card); });
  hierarchyRoot?.addEventListener('keydown', event => { if (['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)) inputMode = 'keyboard'; }, true);
  hierarchyRoot?.addEventListener('click', (event) => {
    const card = event.target.closest('.hierarchy-card[data-course-id]:not(.current)');
    if (!card || !hierarchyRoot.contains(card)) return;
    if (inputMode === 'touch' && !card.classList.contains('is-focused')) {
      focusTarget(card);
      hierarchyRoot.querySelector('.hierarchy-focus-status').textContent += ' Tap the highlighted course again to open its actions.';
      return;
    }
    openRelatedCourse(Number(card.dataset.courseId));
  });
  hierarchyRoot?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.hierarchy-card[data-course-id]:not(.current)');
    if (!card || !hierarchyRoot.contains(card)) return;
    event.preventDefault();
    openRelatedCourse(Number(card.dataset.courseId));
  });
  hierarchyRoot?.querySelectorAll('.hierarchy-row').forEach(row => row.addEventListener('scroll', schedulePathDraw, { passive: true }));
  hierarchyRoot?.addEventListener('wheel', event => {
    const hoveredRow = event.target.closest('.hierarchy-row');
    // Vertical wheel input over the center/blank hierarchy space must keep scrolling
    // the modal/page vertically. Only explicit horizontal gestures, or vertical
    // wheel input while directly over a course strip, move that strip sideways.
    if (!hoveredRow || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    if (hoveredRow.scrollWidth <= hoveredRow.clientWidth + 1) return;
    hoveredRow.scrollLeft += event.deltaY;
    event.preventDefault();
  }, { passive: false });
  if (typeof ResizeObserver !== 'undefined') {
    elements.modalBody._hierarchyResizeObserver?.disconnect();
    const hierarchyResizeObserver = new ResizeObserver(schedulePathDraw);
    hierarchyResizeObserver.observe(hierarchyRoot);
    elements.modalBody._hierarchyResizeObserver = hierarchyResizeObserver;
  }
  elements.courseModal.classList.add('active');
  elements.courseModal.dataset.courseId = String(course.id);
  document.body.style.overflow = 'hidden';
}

function hierarchyCard(course, current = false, relationKind = '') {
  const progress = state.data.academicProgress;
  const attempts = progress?.attempts?.filter(attempt => Number(attempt.programCourseId) === Number(course.id)) || [];
  const latest = attempts.at(-1);
  const status = !attempts.length ? { label:'Not completed', kind:'neutral' }
    : attempts.length > 1 ? { label:`Attempts: ${attempts.map(attempt=>attempt.grade).join(' → ')} · repeat policy unresolved`, kind:'neutral' }
      : latest.grade === 'F' ? { label:'Failed · F · Retake required', kind:'failed' }
        : { label:`Completed · ${latest.grade}`, kind:'passed' };
  const eligibility = progress?.profile?.programId === Number(course.programId) ? progress.eligibility?.[Number(course.id)] : null;
  const successfulAlternative = eligibility?.explanation?.find(group=>group.type==='alternative'&&group.satisfied&&group.passed.length);
  const eligibilityLabel = !eligibility ? '' : eligibility.status==='unknown' ? eligibility.reason
    : eligibility.eligible && successfulAlternative ? `Eligible through ${successfulAlternative.label}: ${successfulAlternative.passed.join(', ')} passed; ${successfulAlternative.remaining.length ? `${successfulAlternative.remaining.join(', ')} remain alternatives` : 'alternative group satisfied'}`
      : eligibility.eligible ? 'Eligible — prerequisite groups satisfied' : `Not yet eligible — ${eligibility.reason}`;
  return `<div class="hierarchy-card ${current ? 'current' : ''} academic-status-${status.kind}" data-course-id="${escapeHtml(course.id)}" data-course-code="${escapeHtml(course.code)}" ${relationKind ? `data-relation-kind="${relationKind}"` : ''} ${current ? '' : 'role="button" tabindex="0"'} aria-label="${current ? 'Current course' : `${relationKind === 'dependent' ? 'Required for this course' : 'Prerequisite of this course'}: ${escapeHtml(course.code)}. Activate to open course choices.`}">
    <div class="hierarchy-card-header"><span class="hierarchy-card-code">${escapeHtml(course.code)}</span></div>
    <div class="hierarchy-card-body"><h4 class="hierarchy-card-title">${escapeHtml(course.name)}</h4><p class="hierarchy-academic-status">${escapeHtml(status.label)}</p>${eligibilityLabel ? `<p class="hierarchy-academic-eligibility">${escapeHtml(eligibilityLabel)}</p>` : ''}</div>
  </div>`;
}

function centeredScrollPosition(card, row) {
  const cardRect = card.getBoundingClientRect();
  const rowRect = row.getBoundingClientRect();
  return Math.max(0, Math.min(row.scrollWidth - row.clientWidth,
    row.scrollLeft + cardRect.left - rowRect.left - (row.clientWidth - cardRect.width) / 2));
}

function courseCompletionState(course) {
  const attempts = state.data.academicProgress?.attempts?.filter(attempt => Number(attempt.programCourseId) === Number(course?.id)) || [];
  const passedAttempts = attempts.filter(attempt => attempt.grade !== 'F');
  return { passed: passedAttempts.length === 1, attempts, uncertain: attempts.length > 1 };
}

function drawHierarchyPath(root, source, target, label) {
  const svg = root.querySelector('.hierarchy-relationship-layer');
  const bounds = root.getBoundingClientRect();
  const sourceBox = source.getBoundingClientRect();
  const targetBox = target.getBoundingClientRect();
  const center = root.querySelector('.hierarchy-card.current')?.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !center) return;
  svg.setAttribute('viewBox', `0 0 ${bounds.width} ${bounds.height}`);
  svg.setAttribute('width', bounds.width);
  svg.setAttribute('height', bounds.height);
  const point = box => ({ x: box.left - bounds.left + box.width / 2, y: box.top - bounds.top + box.height / 2 });
  const from = point(sourceBox), mid = point(center), to = point(targetBox);
  const sourceStart = { x: from.x, y: sourceBox.bottom - bounds.top };
  const centerEntry = { x: mid.x, y: center.top - bounds.top };
  const centerExit = { x: mid.x, y: center.bottom - bounds.top };
  const targetEnd = { x: to.x, y: targetBox.top - bounds.top };
  const laneX = Math.max(12, Math.min(bounds.width - 12, mid.x + (from.x < mid.x ? 1 : -1) * (center.width / 2 + 22)));
  const ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  defs.innerHTML = '<marker id="hierarchy-arrowhead" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor"/></marker>';
  svg.replaceChildren(defs);
  const firstPath = document.createElementNS(ns, 'path');
  firstPath.setAttribute('class', 'hierarchy-relationship-path');
  firstPath.setAttribute('d', `M ${sourceStart.x} ${sourceStart.y} C ${sourceStart.x} ${(sourceStart.y + centerEntry.y) / 2}, ${laneX} ${(sourceStart.y + centerEntry.y) / 2}, ${laneX} ${centerEntry.y} L ${centerEntry.x} ${centerEntry.y}`);
  firstPath.setAttribute('marker-end', 'url(#hierarchy-arrowhead)');
  const secondPath = document.createElementNS(ns, 'path');
  secondPath.setAttribute('class', 'hierarchy-relationship-path');
  secondPath.setAttribute('d', `M ${centerExit.x} ${centerExit.y} L ${laneX} ${centerExit.y} L ${laneX} ${(centerExit.y + targetEnd.y) / 2} C ${laneX} ${(centerExit.y + targetEnd.y) / 2}, ${targetEnd.x} ${(centerExit.y + targetEnd.y) / 2}, ${targetEnd.x} ${targetEnd.y}`);
  secondPath.setAttribute('marker-end', 'url(#hierarchy-arrowhead)');
  svg.append(firstPath, secondPath);
  const text = document.createElementNS(ns, 'text');
  text.setAttribute('class', 'hierarchy-relationship-label');
  const laneOnRight = laneX > mid.x;
  text.setAttribute('x', String(Math.max(12, Math.min(bounds.width - 12, laneX + (laneOnRight ? 8 : -8)))));
  text.setAttribute('text-anchor', laneOnRight ? 'start' : 'end');
  text.setAttribute('y', String(Math.max(12, centerEntry.y - 8)));
  text.textContent = label;
  svg.append(text);
}

function openRelatedCourse(courseId) {
  const course = courseById(courseId);
  if (!course) return;
  showRelatedCourseChoice(course);
}

function showRelatedCourseChoice(course) {
  elements.modalBody.querySelector('.related-course-choice')?.remove();

  const sheet = document.createElement('div');
  sheet.className = 'related-course-choice';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'related-course-choice-title');
  sheet.innerHTML = `
    <div class="related-course-choice__panel">
      <p class="related-course-choice__eyebrow">Related course</p>
      <h4 id="related-course-choice-title">${escapeHtml(course.code)} - ${escapeHtml(course.name)}</h4>
      <div class="related-course-choice__actions">
        <button class="gu-btn gu-btn--secondary" type="button" data-related-action="details">Open as course details</button>
        <button class="gu-btn gu-btn--primary" type="button" data-related-action="hierarchy">Open as hierarchy view</button>
      </div>
      <button class="related-course-choice__cancel" type="button" data-related-action="cancel">Cancel</button>
    </div>
  `;

  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) {
      sheet.remove();
      return;
    }

    const actionButton = event.target.closest('[data-related-action]');
    if (!actionButton) return;

    const action = actionButton.dataset.relatedAction;
    sheet.remove();
    if (action === 'details') showCourseModal(course.id);
    if (action === 'hierarchy') showHierarchyView(course.id);
  });
  sheet.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    sheet.remove();
  });

  elements.modalBody.appendChild(sheet);
  sheet.querySelector('[data-related-action="details"]')?.focus();
}

function closeModal() {
  elements.courseModal.classList.remove('active');
  delete elements.courseModal.dataset.courseId;
  document.body.style.overflow = '';
}

function goBack() {
  state.viewStack.pop();
  const previous = state.viewStack.pop();
  if (!previous || previous.view === 'overview') return renderOverview();
  if (previous.view === 'faculty') return renderProgramsForFaculty(previous.facultyId);
  if (previous.view === 'program') return renderProgramSemesters(previous.programId);
  if (previous.view === 'courses') return renderCourseTable(previous.programId, previous.yearNo, previous.semesterNo);
}

function setupEventListeners() {
  elements.facultyNavBtn?.addEventListener('click', openFacultyNavigation);
  elements.programsNavBtn?.addEventListener('click', openProgramsNavigation);
  elements.retryCatalogBtn?.addEventListener('click', () => loadData({ preserveCurrent: true }));
  elements.filterFaculty.addEventListener('change', (event) => {
    updateProgramFilter(event.target.value);
    renderActiveFilters({ facultyId: event.target.value });
    if (event.target.value) renderProgramsForFaculty(event.target.value);
    else renderOverview();
  });
  elements.filterProgram.addEventListener('change', (event) => {
    updateYearFilter(event.target.value);
    const program = programById(event.target.value);
    renderActiveFilters({ facultyId: elements.filterFaculty.value || program?.facultyId || '', programId: event.target.value });
    if (event.target.value) renderProgramSemesters(event.target.value);
  });
  elements.filterYear.addEventListener('change', (event) => {
    if (elements.filterProgram.value && event.target.value) updateSemesterFilter(elements.filterProgram.value, event.target.value);
    renderActiveFilters({
      facultyId: elements.filterFaculty.value,
      programId: elements.filterProgram.value,
      yearNo: event.target.value
    });
  });
  elements.filterSemester.addEventListener('change', (event) => {
    renderActiveFilters({
      facultyId: elements.filterFaculty.value,
      programId: elements.filterProgram.value,
      yearNo: elements.filterYear.value,
      semesterNo: event.target.value
    });    if (elements.filterProgram.value && elements.filterYear.value && event.target.value) {
      renderCourseTable(elements.filterProgram.value, elements.filterYear.value, event.target.value);
    }
  });
  elements.clearFiltersBtn.addEventListener('click', () => {
    elements.filterFaculty.value = '';
    populateFilters();
    renderOverview();
  });
  elements.searchBtn.addEventListener('click', () => performSearch(elements.courseSearch.value));
  elements.courseSearch.addEventListener('keypress', (event) => {
    if (event.key === 'Enter') performSearch(elements.courseSearch.value);
  });
  elements.clearSearchBtn.addEventListener('click', renderOverview);
  elements.programsBackBtn?.addEventListener('click', goBack);
  document.querySelectorAll('.back-btn[data-action="back"]').forEach((btn) => btn.addEventListener('click', goBack));
  document.querySelector('.gu-modal-close')?.addEventListener('click', closeModal);
  document.querySelector('.modal-close-btn')?.addEventListener('click', closeModal);
  elements.courseModal.addEventListener('click', (event) => { if (event.target === elements.courseModal) closeModal(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModal(); });
  window.addEventListener('focus', () => { if (state.catalogLoadedAt && Date.now() - state.catalogLoadedAt >= CATALOG_FRESHNESS_MS) loadData({ preserveCurrent: true }); });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && state.catalogLoadedAt && Date.now() - state.catalogLoadedAt >= CATALOG_FRESHNESS_MS) loadData({ preserveCurrent: true });
  });
}

function setCatalogInteractionEnabled(enabled) {
  elements.mainContent?.toggleAttribute('aria-busy', !enabled);
  elements.mainContent?.querySelectorAll('button, input, select').forEach((control) => { control.disabled = !enabled; });
  if (elements.facultyNavBtn) elements.facultyNavBtn.disabled = !enabled;
  if (elements.programsNavBtn) elements.programsNavBtn.disabled = !enabled;
  if (elements.retryCatalogBtn) elements.retryCatalogBtn.disabled = enabled;
}

function rememberCurrentNavigation() {
  const modalCourseId = elements.courseModal?.classList.contains('active') ? elements.courseModal.dataset.courseId : null;
  navigationToRestore = {
    stack: state.viewStack.map((item) => ({ ...item })),
    filters: { facultyId: elements.filterFaculty.value, programId: elements.filterProgram.value, yearNo: elements.filterYear.value, semesterNo: elements.filterSemester.value },
    search: elements.courseSearch.value,
    wasSearch: state.currentView === 'search',
    modalCourseId,
    scrollY: window.scrollY
  };
}

function restoreNavigation(snapshot) {
  const stack = reconcileStudentViewStack(snapshot.stack, state.data);
  renderOverview();
  for (const item of stack.slice(1)) {
    if (item.view === 'faculty') renderProgramsForFaculty(item.facultyId);
    if (item.view === 'program') renderProgramSemesters(item.programId);
    if (item.view === 'courses') renderCourseTable(item.programId, item.yearNo, item.semesterNo);
  }
  const filters = snapshot.filters || {};
  const facultyId = state.data.faculties.some((x) => String(x.id) === String(filters.facultyId)) ? filters.facultyId : '';
  const filteredPrograms = state.data.programs.filter((x) => !facultyId || x.facultyId === Number(facultyId));
  const programId = filteredPrograms.some((x) => String(x.id) === String(filters.programId)) ? filters.programId : '';
  const yearNo = programId && yearsForProgram(programId).some((x) => String(x) === String(filters.yearNo)) ? filters.yearNo : '';
  const semesterNo = yearNo && semestersForProgramYear(programId, yearNo).some((x) => String(x) === String(filters.semesterNo)) ? filters.semesterNo : '';
  syncFilterValues({ facultyId, programId, yearNo, semesterNo });
  elements.courseSearch.value = snapshot.search || '';
  if (snapshot.wasSearch && snapshot.search?.trim()) performSearch(snapshot.search);
  const modalCourse = snapshot.modalCourseId && courseById(snapshot.modalCourseId);
  if (modalCourse) showCourseModal(modalCourse.id);
  else if (snapshot.modalCourseId) {
    closeModal();
    if (elements.navStatus) elements.navStatus.textContent = 'A course in the open details panel is no longer available.';
  }
  window.scrollTo({ top: snapshot.scrollY || 0, behavior: 'auto' });
}

async function loadData({ preserveCurrent = false } = {}) {
  if (catalogLoadPromise) return catalogLoadPromise;
  const snapshot = preserveCurrent ? (navigationToRestore || (rememberCurrentNavigation(), navigationToRestore)) : null;
  setCatalogInteractionEnabled(false);
  if (!state.catalogLoadedAt) showView(elements.loadingState);
  catalogLoadPromise = (async () => {
    try {
      state.data = normalizeCatalog(await fetchJson('/catalog'));
      state.data.academicProgress = null;
      try { state.data.academicProgress = await fetchJson('/student/academic-progress'); } catch { /* Progress remains optional until the academic migration is installed. */ }
      state.catalogLoadedAt = Date.now();
      updateStats();
      populateFilters();
      populateSearchSuggestions();
      state.history = state.history.filter((item) => item.type === 'faculty'
        ? !!facultyById(item.id) : item.type === 'program' ? !!programById(item.id) : !!courseById(item.id));
      renderHistory();
      if (snapshot) restoreNavigation(snapshot);
      else renderOverview();
      navigationToRestore = null;
      setCatalogInteractionEnabled(true);
      return true;
    } catch (error) {
      console.error('Failed to load canonical data:', error);
      state.catalogLoadedAt = 0;
      setCatalogInteractionEnabled(false);
      if (elements.retryCatalogBtn) elements.retryCatalogBtn.disabled = false;
      showError('Unable to refresh data. Please check the backend API connection and try again.');
      return false;
    } finally {
      catalogLoadPromise = null;
    }
  })();
  return catalogLoadPromise;
}

function initializeStudentPortal() {
  setupEventListeners();
  void loadData().finally(() => { const overlay = document.getElementById('studentLoadingOverlay'); if (overlay) overlay.hidden = true; });
}

// Session restoration uses top-level await.  Depending on browser timing,
// DOMContentLoaded may already have fired by the time this module continues.
// Initialize immediately in that case so the initial “All Faculties” view
// always renders its faculty cards.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeStudentPortal, { once: true });
} else {
  initializeStudentPortal();
}
