import { escapeHtml } from '../../shared/dom.js';
import { elements } from './adminDom.js';
import { cache, lookupName } from './state.js';
import { prerequisiteCodes } from './prerequisites.js';

export function renderOptions(el, items, label = 'name', value = 'id') {
  el.innerHTML = '<option value="">Select...</option>' + items
    .map((item) => `<option value="${escapeHtml(item[value])}">${escapeHtml(item[label])}</option>`)
    .join('');
}

function entityRow(label, id, kind) {
  return `<div class="entity-row"><span>${escapeHtml(label)}</span><div class="actions"><button data-edit="${id}" data-kind="${kind}">Edit</button><button class="danger" data-delete="${id}" data-kind="${kind}">Delete</button></div></div>`;
}

export function renderLists() {
  elements.lists.faculties.innerHTML = cache.faculties
    .map((faculty) => entityRow(faculty.name, faculty.id, 'faculty'))
    .join('') || '<p class="empty-state">No faculties yet.</p>';

  elements.lists.programs.innerHTML = cache.programs
    .map((program) => entityRow(`${program.name} (${lookupName(cache.faculties, program.facultyId)})`, program.id, 'program'))
    .join('') || '<p class="empty-state">No programs yet.</p>';

  elements.lists.courses.innerHTML = cache.programCourses.map((course) => {
    const semester = `Y${course.yearNo} S${course.semesterNo}`;
    return `<tr><td>${escapeHtml(course.code)}</td><td>${escapeHtml(course.name)}</td><td>${escapeHtml(course.credits)}</td><td>${escapeHtml(semester)}</td><td>${escapeHtml(prerequisiteCodes(course) || '-')}</td><td><button data-edit="${course.id}" data-kind="course">Edit</button> <button class="danger" data-delete="${course.id}" data-kind="course">Delete</button></td></tr>`;
  }).join('') || '<tr><td colspan="6">No courses yet.</td></tr>';
}
