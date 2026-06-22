import { getApiCandidates, saveApiBase } from '../shared/apiConfig.js';
import { normalizeCatalog } from '../shared/catalogNormalizer.js';

const apiCandidates = getApiCandidates();
let workingApiBase = apiCandidates[0] || '/api';

const state = {
  viewStack: [],
  history: [],
  data: {
    faculties: [],
    programs: [],
    programCourses: []
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
  historyList: document.getElementById('history-list')
};

async function fetchJson(path) {
  let lastError = null;

  for (const base of [workingApiBase, ...apiCandidates.filter((candidate) => candidate !== workingApiBase)]) {
    try {
      const res = await fetch(`${base}${path}`, { headers: { Accept: 'application/json' } });
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('API did not return JSON');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      workingApiBase = base;
      saveApiBase(base);
      return data;
    } catch (error) {
      lastError = error;
    }
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
  return `<option value="">${empty}</option>${items.map((item) => `<option value="${item[value]}">${item[label]}</option>`).join('')}`;
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
    .map((label) => `<span class="active-filter-chip">${label}</span>`)
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
      ? `<span class="breadcrumb-item active">${item.label}</span>`
      : `<button class="breadcrumb-item" data-action="${item.action}">${item.label}</button>`;
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
  elements.historyList.innerHTML = state.history.map((item) => `<button class="history-item" data-type="${item.type}" data-id="${item.id}"><span>${item.label}</span></button>`).join('');
  elements.historyList.querySelectorAll('.history-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (btn.dataset.type === 'faculty') renderProgramsForFaculty(btn.dataset.id);
      if (btn.dataset.type === 'program') renderProgramSemesters(btn.dataset.id);
      if (btn.dataset.type === 'course') showCourseModal(Number(btn.dataset.id));
    });
  });
}

function renderOverview() {
  showView(elements.overviewView);
  setBackgroundDepth(0);
  state.viewStack = [{ view: 'overview' }];
  if (elements.programsBackBtn) elements.programsBackBtn.style.display = 'none';
  updateBreadcrumb([{ label: 'Home', active: true }]);
  syncFilterValues();

  elements.facultyGrid.innerHTML = state.data.faculties.map((faculty) => {
    const programs = state.data.programs.filter((program) => program.facultyId === faculty.id);
    const courseCount = state.data.programCourses.filter((course) => course.facultyId === faculty.id).length;
    return `
      <div class="faculty-card" data-faculty-id="${faculty.id}" role="button" tabindex="0" aria-label="View ${faculty.name}">
        <h3>${faculty.name}</h3>
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
}

function renderProgramsForFaculty(facultyId) {
  showView(elements.overviewView);
  setBackgroundDepth(1);
  state.viewStack.push({ view: 'faculty', facultyId });
  if (elements.programsBackBtn) elements.programsBackBtn.style.display = 'inline-flex';

  const faculty = facultyById(facultyId);
  const programs = state.data.programs.filter((program) => program.facultyId === Number(facultyId));
  if (faculty) addHistory('faculty', faculty.id, faculty.name);
  updateBreadcrumb([{ label: 'Home', action: 'overview' }, { label: faculty?.name || 'Faculty', active: true }]);
  syncFilterValues({ facultyId });

  elements.facultyGrid.innerHTML = programs.map((program) => {
    const courseCount = state.data.programCourses.filter((course) => course.programId === program.id).length;
    return `
      <div class="faculty-card program-card" data-program-id="${program.id}" role="button" tabindex="0">
        <h3>${program.name}</h3>
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
}

function renderProgramSemesters(programId) {
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
        <div class="semester-card" data-program-id="${programId}" data-year-no="${yearNo}" data-semester-no="${semesterNo}" role="button" tabindex="0">
          <div class="semester-card-header"><h3>Semester ${semesterNo}</h3></div>
          <div class="semester-stats">
            <span><strong>${courses.length}</strong> Courses</span>
            <span><strong>${credits}</strong> Credits</span>
          </div>
          <div class="course-tags">${courses.slice(0, 4).map((course) => `<span class="course-tag">${course.code}</span>`).join('')}</div>
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
        <td class="course-code-cell">${course.code}</td>
        <td class="course-name-cell">${course.name}</td>
        <td><strong>${course.credits}</strong></td>
        <td class="prereq-cell">${prereqs.length ? prereqs.map((item) => `<span class="prereq-tag">${item.code}</span>`).join('') : '<span class="no-prereq">None</span>'}</td>
        <td class="actions-cell">
          <button class="gu-btn gu-btn--primary gu-btn--sm" data-action="view-course" data-course-id="${course.id}">View</button>
          <button class="gu-btn gu-btn--secondary gu-btn--sm" data-action="view-hierarchy" data-course-id="${course.id}">Hierarchy</button>
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
    .map((course) => `<option value="${course.code}: ${course.name}">`)
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
    <div class="search-result-card" data-course-id="${course.id}" role="button" tabindex="0">
      <div class="search-result-content">
        <h4>${course.code} - ${course.name}</h4>
        <p class="search-result-meta">${course.credits || 0} credits</p>
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
      <div class="detail-group"><span class="detail-label">Faculty</span><span class="detail-value">${faculty?.name || 'N/A'}</span></div>
      <div class="detail-group"><span class="detail-label">Program</span><span class="detail-value">${program?.name || 'N/A'}</span></div>
      <div class="detail-group"><span class="detail-label">Year</span><span class="detail-value">${course.yearNo}</span></div>
      <div class="detail-group"><span class="detail-label">Semester</span><span class="detail-value">${course.semesterNo}</span></div>
      <div class="detail-group"><span class="detail-label">Credits</span><span class="detail-value">${course.credits || 0}</span></div>
      <div class="detail-group"><span class="detail-label">Prerequisites</span><span class="detail-value">${prereqs.length ? prereqs.map((item) => item.code).join(', ') : 'None'}</span></div>
    </div>
  `;
  elements.viewHierarchyBtn.onclick = () => showHierarchyView(course.id);
  elements.courseModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function showHierarchyView(courseId) {
  const course = courseById(courseId);
  if (!course) return;
  addHistory('course', course.id, course.code);
  const prerequisites = (course.prerequisiteCourseIds || []).map(courseById).filter(Boolean);
  const dependents = state.data.programCourses.filter((item) => (item.prerequisiteCourseIds || []).includes(course.id));
  elements.modalTitle.textContent = `Course Hierarchy - ${course.code}`;
  elements.modalBody.innerHTML = `
    <div class="hierarchy-view-boxes">
      <div class="hierarchy-level"><h6>Prerequisites (${prerequisites.length})</h6><div class="hierarchy-row">${prerequisites.map((item) => hierarchyCard(item)).join('') || '<span class="no-prereq">None</span>'}</div></div>
      <div class="hierarchy-center-wrapper">${hierarchyCard(course, true)}</div>
      <div class="hierarchy-level"><h6>Required For (${dependents.length})</h6><div class="hierarchy-row">${dependents.map((item) => hierarchyCard(item)).join('') || '<span class="no-prereq">None</span>'}</div></div>
    </div>
  `;
  const hierarchyRoot = elements.modalBody.querySelector('.hierarchy-view-boxes');
  hierarchyRoot?.addEventListener('click', (event) => {
    const card = event.target.closest('.hierarchy-card[data-course-id]:not(.current)');
    if (!card || !hierarchyRoot.contains(card)) return;
    openRelatedCourse(Number(card.dataset.courseId));
  });
  hierarchyRoot?.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('.hierarchy-card[data-course-id]:not(.current)');
    if (!card || !hierarchyRoot.contains(card)) return;
    event.preventDefault();
    openRelatedCourse(Number(card.dataset.courseId));
  });
  elements.courseModal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function hierarchyCard(course, current = false) {
  return `<div class="hierarchy-card ${current ? 'current' : ''}" data-course-id="${course.id}" ${current ? '' : 'role="button" tabindex="0"'} aria-label="${current ? 'Current course' : 'Open related course'} ${course.code}">
    <div class="hierarchy-card-header"><span class="hierarchy-card-code">${course.code}</span></div>
    <div class="hierarchy-card-body"><h4 class="hierarchy-card-title">${course.name}</h4></div>
  </div>`;
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
      <h4 id="related-course-choice-title">${course.code} - ${course.name}</h4>
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
}

async function loadData() {
  showView(elements.loadingState);
  try {
    state.data = normalizeCatalog(await fetchJson('/catalog'));
    updateStats();
    populateFilters();
    populateSearchSuggestions();
    renderHistory();
    renderOverview();
  } catch (error) {
    console.error('Failed to load canonical data:', error);
    showError('Unable to load data. Please check the backend API connection and try again.');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadData();
});
