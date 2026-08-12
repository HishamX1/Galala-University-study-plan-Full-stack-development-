import { escapeHtml } from '../../shared/dom.js';
import { elements } from './adminDom.js';
import { cache, lookupName } from './state.js';
import { prerequisiteRelationItems, requiredForRelationItems } from './prerequisites.js';

export function renderOptions(el, items, label = 'name', value = 'id') {
  el.innerHTML = '<option value="">Select...</option>' + items
    .map((item) => `<option value="${escapeHtml(item[value])}">${escapeHtml(item[label])}</option>`)
    .join('');
}

function entityRow(label, id, kind) {
  return `<div class="entity-row"><span>${escapeHtml(label)}</span><div class="actions"><button data-edit="${id}" data-kind="${kind}">Edit</button><button class="danger" data-delete="${id}" data-kind="${kind}">Delete</button></div></div>`;
}

function relationPill({ courseId, relatedCourse, visibleToStudents, prerequisiteCourseId, labelPrefix = '' }) {
  return `
    <span class="relation-pill ${visibleToStudents ? 'is-visible' : 'is-hidden'}">
      <span>${escapeHtml(labelPrefix)}${escapeHtml(relatedCourse.code)}</span>
      <span>${visibleToStudents ? 'Visible' : 'Hidden'}</span>
      <button
        class="secondary relation-toggle"
        type="button"
        data-toggle-relation="true"
        data-course-id="${courseId}"
        data-prerequisite-id="${prerequisiteCourseId}"
        data-visible="${visibleToStudents ? 'false' : 'true'}"
      >${visibleToStudents ? 'Hide' : 'Show'}</button>
    </span>
  `;
}

function renderRelationList(relations, renderer) {
  return relations.length
    ? relations.map(renderer).join('')
    : '<span class="empty-state">None</span>';
}

export function renderLists() {
  elements.lists.faculties.innerHTML = cache.faculties
    .map((faculty) => entityRow(faculty.name, faculty.id, 'faculty'))
    .join('') || '<p class="empty-state">No faculties yet.</p>';

  elements.lists.programs.innerHTML = cache.programs
    .map((program) => entityRow(`${program.name} (${lookupName(cache.faculties, program.facultyId)})`, program.id, 'program'))
    .join('') || '<p class="empty-state">No programs yet.</p>';

  const query = (elements.ids.courseSearch?.value || '').trim().toLowerCase();
  const facultyFilter = Number(elements.ids.courseFilterFaculty?.value || 0);
  const programFilter = Number(elements.ids.courseFilterProgram?.value || 0);
  const yearFilter = Number(elements.ids.courseFilterYear?.value || 0);
  const semesterFilter = Number(elements.ids.courseFilterSemester?.value || 0);
  const relationFilter = elements.ids.courseFilterRelations?.value || '';
  const visibilityFilter = elements.ids.courseFilterVisibility?.value || '';
  const courses = cache.programCourses.filter((course) => {
    const programItem = cache.programs.find((item) => Number(item.id) === Number(course.programId));
    const program = programItem?.name || '-';
    const faculty = lookupName(cache.faculties, programItem?.facultyId);
    const prerequisites = prerequisiteRelationItems(course);
    const requiredFor = requiredForRelationItems(course);
    if (query && ![course.code, course.name, program, faculty, course.yearNo, course.semesterNo].join(' ').toLowerCase().includes(query)) return false;
    if (facultyFilter && Number(programItem?.facultyId) !== facultyFilter) return false;
    if (programFilter && Number(course.programId) !== programFilter) return false;
    if (yearFilter && Number(course.yearNo) !== yearFilter) return false;
    if (semesterFilter && Number(course.semesterNo) !== semesterFilter) return false;
    if (relationFilter === 'prerequisites' && !prerequisites.length) return false;
    if (relationFilter === 'required-for' && !requiredFor.length) return false;
    if (relationFilter === 'none' && (prerequisites.length || requiredFor.length)) return false;
    const hasHidden = [...prerequisites, ...requiredFor].some((item) => !item.visibleToStudents);
    if (visibilityFilter === 'hidden' && !hasHidden) return false;
    if (visibilityFilter === 'visible' && hasHidden) return false;
    return true;
  }).sort((left, right) => {
    const value = (course) => cache.courseSort.key === 'term' ? `${course.yearNo}-${course.semesterNo}` : String(course[cache.courseSort.key] || '').toLowerCase();
    return value(left).localeCompare(value(right), undefined, { numeric: true }) * (cache.courseSort.direction === 'asc' ? 1 : -1);
  });

  elements.lists.courses.innerHTML = courses.map((course) => {
    const semester = `Y${course.yearNo} S${course.semesterNo}`;
    const program = lookupName(cache.programs, course.programId);
    const prerequisites = prerequisiteRelationItems(course);
    const requiredFor = requiredForRelationItems(course);
    const hiddenCount = [...prerequisites, ...requiredFor].filter((relation) => !relation.visibleToStudents).length;
    return `<tr>
      <td>${escapeHtml(course.code)}</td>
      <td>${escapeHtml(course.name)}</td>
      <td>${escapeHtml(program)}</td>
      <td>${escapeHtml(semester)}</td>
      <td><span class="relation-status ${hiddenCount ? 'is-hidden' : 'is-visible'}">${hiddenCount ? `${hiddenCount} hidden` : 'Visible'}</span></td>
      <td>${prerequisites.length} prereq · ${requiredFor.length} required-for</td>
      <td><button data-view-course="${course.id}">Details</button> <button data-manage-relations="${course.id}">Relations</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="7">No courses found.</td></tr>';
}
