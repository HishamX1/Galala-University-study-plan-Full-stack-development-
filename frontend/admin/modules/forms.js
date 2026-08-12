import { byId } from '../../shared/dom.js';
import { request } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { loadAdminOps } from './adminOps.js';
import { openConfirmDialog, openContentDialog, openFormDialog } from './dialogs.js';
import { renderLists } from './renderLists.js';
import { mapCodesToIds, parsePrerequisiteCodes, prerequisiteCodes, prerequisiteRelationItems, requiredForRelationItems } from './prerequisites.js';
import { cache, lookupName } from './state.js';
import { escapeHtml } from '../../shared/dom.js';

function clearEntityInputs() {
  ['facultyName', 'programName', 'courseYearNo', 'courseSemesterNo', 'courseCode', 'courseName', 'courseCredits', 'courseDescription', 'coursePrereqs']
    .forEach((id) => {
      const input = byId(id);
      if (input) input.value = '';
    });
}

function selectOptions(items, label = 'name') {
  return items.map((item) => ({ value: item.id, label: item[label] }));
}

function courseLabel(course) {
  return `${course.code} - ${course.name}`;
}

function findCourse(id) {
  return cache.programCourses.find((item) => Number(item.id) === Number(id));
}

function endpointFor(kind) {
  const endpoints = {
    faculty: 'faculties',
    program: 'programs',
    course: 'program-courses'
  };
  return endpoints[kind];
}

function summarizeCourseImpact(impact) {
  const prereqCount = impact?.prerequisiteLinks?.length || 0;
  const requiredForCount = impact?.requiredForLinks?.length || 0;
  const requiredFor = (impact?.requiredForLinks || [])
    .slice(0, 6)
    .map((link) => `${link.courseCode} depends on ${link.prerequisiteCode}`)
    .join(', ');
  return [
    `You are deleting ${impact?.course?.code || 'this course'}.`,
    `This removes ${prereqCount} prerequisite link(s) from this course and ${requiredForCount} required-for link(s) from other courses.`,
    requiredFor ? `Affected hierarchy links: ${requiredFor}${requiredForCount > 6 ? ', ...' : ''}.` : '',
    'Deleting this course may affect the hierarchy tree. Confirm only if this cleanup is intended.'
  ].filter(Boolean).join(' ');
}

function summarizeProgramImpact(impact) {
  return [
    `You are deleting ${impact?.program?.name || 'this program'}.`,
    `This removes ${impact?.courseCount || 0} program course row(s), ${impact?.prerequisiteLinkCount || 0} prerequisite link(s), and ${impact?.requiredForLinkCount || 0} required-for link(s) tied to those rows.`,
    'Shared course records remain when they are still used by another program. Confirm only if this cascade cleanup is intended.'
  ].join(' ');
}

async function confirmDeletion(kind, id) {
  if (kind === 'course') {
    const impact = await request(`/program-courses/${id}/delete-impact`);
    return openConfirmDialog({
      title: `Delete ${impact.course.code}`,
      description: summarizeCourseImpact(impact),
      submitLabel: 'Delete course'
    });
  }

  if (kind === 'program') {
    const impact = await request(`/programs/${id}/delete-impact`);
    return openConfirmDialog({
      title: `Delete ${impact.program.name}`,
      description: summarizeProgramImpact(impact),
      submitLabel: 'Delete program'
    });
  }

  return openConfirmDialog({
    title: `Delete ${kind}`,
    description: `This will delete the selected ${kind} and related child records.`
  });
}

async function coursePatch(course) {
  const result = await openFormDialog({
    title: `Edit ${course.code}`,
    description: 'Update course details and comma-separated prerequisite course codes.',
    fields: [
      { name: 'programId', label: 'Program', type: 'select', value: course.programId, options: selectOptions(cache.programs), required: true },
      { name: 'yearNo', label: 'Year Number', value: course.yearNo, type: 'number', min: 1, required: true },
      { name: 'semesterNo', label: 'Semester Number', value: course.semesterNo, type: 'number', min: 1, required: true },
      { name: 'code', label: 'Course Code', value: course.code, required: true },
      { name: 'name', label: 'Course Name', value: course.name, required: true },
      { name: 'credits', label: 'Credits', value: course.credits, type: 'number', min: 0, required: true },
      { name: 'description', label: 'Description', value: course.description || '', type: 'textarea' },
      { name: 'prerequisites', label: 'Prerequisites', value: prerequisiteCodes(course) }
    ]
  });
  if (!result) return null;
  return {
    programId: Number(result.programId),
    yearNo: Number(result.yearNo),
    semesterNo: Number(result.semesterNo),
    code: result.code.trim().toUpperCase(),
    name: result.name.trim(),
    credits: Number(result.credits),
    description: result.description.trim() || null,
    prerequisiteCourseIds: mapCodesToIds(parsePrerequisiteCodes(result.prerequisites))
  };
}

function relationButton(relation, relatedCourse, actionCourseId, actionPrerequisiteId) {
  return `
    <div class="relation-manager-row">
      <div>
        <strong>${escapeHtml(courseLabel(relatedCourse))}</strong>
        <span class="relation-status ${relation.visibleToStudents ? 'is-visible' : 'is-hidden'}">${relation.visibleToStudents ? 'Visible' : 'Hidden'}</span>
      </div>
      <div class="actions">
        <button class="secondary" type="button" data-dialog-toggle="${actionCourseId}" data-prerequisite-id="${actionPrerequisiteId}" data-visible="${relation.visibleToStudents ? 'false' : 'true'}">${relation.visibleToStudents ? 'Hide' : 'Show'}</button>
        <button class="danger" type="button" data-dialog-remove="${actionCourseId}" data-prerequisite-id="${actionPrerequisiteId}">Remove</button>
      </div>
    </div>
  `;
}

function relationManagerMarkup(course) {
  const prerequisites = prerequisiteRelationItems(course);
  const requiredFor = requiredForRelationItems(course);
  const options = cache.programCourses
    .filter((item) => Number(item.id) !== Number(course.id))
    .map((item) => `<option value="${item.id}">${escapeHtml(courseLabel(item))}</option>`)
    .join('');

  return `
    <div class="relation-manager" data-course-id="${course.id}">
      <div class="course-summary">
        <strong>${escapeHtml(courseLabel(course))}</strong>
        <span>${escapeHtml(lookupName(cache.programs, course.programId))} - Y${escapeHtml(course.yearNo)} S${escapeHtml(course.semesterNo)}</span>
      </div>

      <label>Search Relations</label>
      <input data-relation-search placeholder="Search current relations" />

      <h3>Prerequisites</h3>
      <div data-relation-section="prerequisites">
        ${prerequisites.length ? prerequisites.map((relation) => relationButton(relation, relation.prerequisite, course.id, relation.prerequisiteCourseId)).join('') : '<p class="empty-state">No prerequisites defined.</p>'}
      </div>

      <h3>Required For</h3>
      <div data-relation-section="requiredFor">
        ${requiredFor.length ? requiredFor.map((relation) => relationButton(relation, relation.dependent, relation.dependent.id, course.id)).join('') : '<p class="empty-state">No required-for relationships defined.</p>'}
      </div>

      <h3>Add Relation</h3>
      <label>Course</label>
      <select data-relation-course>${options}</select>
      <div class="radio-row">
        <label><input type="radio" name="relationType" value="prerequisite" checked /> Add as prerequisite</label>
        <label><input type="radio" name="relationType" value="requiredFor" /> Add as required-for</label>
      </div>
      <button type="button" data-add-relation>Add</button>
    </div>
  `;
}

async function refreshRelationManager(root, courseId) {
  await loadRelations();
  await loadAdminOps();
  const updated = findCourse(courseId);
  if (updated) root.innerHTML = relationManagerMarkup(updated);
}

async function openCourseView(course) {
  const compactRelations = (relations, key) => relations.length
    ? relations.map((relation) => `<span class="relation-pill ${relation.visibleToStudents ? 'is-visible' : 'is-hidden'}">${escapeHtml(courseLabel(relation[key]))}<span class="relation-status ${relation.visibleToStudents ? 'is-visible' : 'is-hidden'}">${relation.visibleToStudents ? 'Visible' : 'Hidden'}</span></span>`).join('')
    : '<span class="empty-state">None</span>';
  const prerequisites = prerequisiteRelationItems(course);
  const requiredFor = requiredForRelationItems(course);
  const hasHidden = [...prerequisites, ...requiredFor].some((relation) => !relation.visibleToStudents);
  await openContentDialog({
    title: courseLabel(course),
    description: `${lookupName(cache.programs, course.programId)} - Year ${course.yearNo}, Semester ${course.semesterNo}`,
    content: `
      <div class="course-detail-grid">
        <section><h3>Basic Info</h3><p><strong>Credits:</strong> ${escapeHtml(course.credits)}</p><p>${escapeHtml(course.description || 'No description')}</p></section>
        <section><h3>Visibility Status</h3><span class="relation-status ${hasHidden ? 'is-hidden' : 'is-visible'}">${hasHidden ? 'Contains hidden relations' : 'Visible'}</span></section>
        <section><h3>Prerequisites</h3><div class="relation-list">${compactRelations(prerequisites, 'prerequisite')}</div></section>
        <section><h3>Required For</h3><div class="relation-list">${compactRelations(requiredFor, 'dependent')}</div></section>
      </div>
      <div class="dialog-inline-actions"><button type="button" data-edit="${course.id}" data-kind="course">Edit Course</button><button type="button" data-manage-relations="${course.id}">Manage Relations</button></div>
    `
  });
}

async function openRelationManager(course) {
  await openContentDialog({
    title: 'Manage Relations',
    description: 'Add, remove, hide, or show prerequisite relationships for this course.',
    content: relationManagerMarkup(course),
    onOpen(root) {
      root.addEventListener('input', (event) => {
        if (!event.target.matches('[data-relation-search]')) return;
        const query = event.target.value.trim().toLowerCase();
        root.querySelectorAll('.relation-manager-row').forEach((row) => {
          row.hidden = query && !row.textContent.toLowerCase().includes(query);
        });
      });

      root.addEventListener('click', async (event) => {
        const addBtn = event.target.closest('[data-add-relation]');
        const toggleBtn = event.target.closest('[data-dialog-toggle]');
        const removeBtn = event.target.closest('[data-dialog-remove]');
        if (!addBtn && !toggleBtn && !removeBtn) return;

        try {
          if (addBtn) {
            const baseCourseId = Number(root.querySelector('.relation-manager').dataset.courseId);
            const selectedCourseId = Number(root.querySelector('[data-relation-course]').value);
            const type = root.querySelector('input[name="relationType"]:checked')?.value || 'prerequisite';
            const courseId = type === 'prerequisite' ? baseCourseId : selectedCourseId;
            const prerequisiteCourseId = type === 'prerequisite' ? selectedCourseId : baseCourseId;
            await request(`/program-courses/${courseId}/prerequisites`, {
              method: 'POST',
              body: JSON.stringify({ prerequisiteCourseId })
            });
            setMessage('success', 'Relationship added.');
            await refreshRelationManager(root, baseCourseId);
          }

          if (toggleBtn) {
            const courseId = Number(toggleBtn.dataset.dialogToggle);
            const prerequisiteId = Number(toggleBtn.dataset.prerequisiteId);
            const visibleToStudents = toggleBtn.dataset.visible === 'true';
            await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}/visibility`, {
              method: 'PUT',
              body: JSON.stringify({ visibleToStudents })
            });
            setMessage('success', `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students.`);
            await refreshRelationManager(root, course.id);
          }

          if (removeBtn) {
            const courseId = Number(removeBtn.dataset.dialogRemove);
            const prerequisiteId = Number(removeBtn.dataset.prerequisiteId);
            await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}`, { method: 'DELETE' });
            setMessage('success', 'Relationship removed.');
            await refreshRelationManager(root, course.id);
          }
        } catch (error) {
          setMessage('error', error.message);
        }
      });
    }
  });
}

async function patchFor(kind, id) {
  if (kind === 'faculty') {
    const current = cache.faculties.find((item) => Number(item.id) === Number(id));
    const result = await openFormDialog({
      title: 'Edit Faculty',
      fields: [{ name: 'name', label: 'Faculty Name', value: current?.name || '', required: true }]
    });
    return result && { name: result.name.trim() };
  }

  if (kind === 'program') {
    const current = cache.programs.find((item) => Number(item.id) === Number(id));
    const result = await openFormDialog({
      title: 'Edit Program',
      fields: [
        { name: 'facultyId', label: 'Faculty', type: 'select', value: current?.facultyId, options: selectOptions(cache.faculties), required: true },
        { name: 'name', label: 'Program Name', value: current?.name || '', required: true },
        { name: 'durationYears', label: 'Duration Years', type: 'select', value: current?.durationYears || 4, options: [{ value: 4, label: '4' }, { value: 5, label: '5' }], required: true }
      ]
    });
    return result && { facultyId: Number(result.facultyId), name: result.name.trim(), durationYears: Number(result.durationYears) };
  }

  const current = cache.programCourses.find((item) => Number(item.id) === Number(id));
  return current ? coursePatch(current) : null;
}

export function bindCrudDelegates() {
  document.body.addEventListener('click', async (event) => {
    const editBtn = event.target.closest('[data-edit]');
    const deleteBtn = event.target.closest('[data-delete]');
    const toggleBtn = event.target.closest('[data-toggle-relation]');
    const viewBtn = event.target.closest('[data-view-course]');
    const manageBtn = event.target.closest('[data-manage-relations]');
    if (!editBtn && !deleteBtn && !toggleBtn && !viewBtn && !manageBtn) return;

    try {
      if (viewBtn) {
        const course = findCourse(viewBtn.dataset.viewCourse);
        if (course) await openCourseView(course);
      }

      if (manageBtn) {
        const course = findCourse(manageBtn.dataset.manageRelations);
        if (course) await openRelationManager(course);
      }

      if (toggleBtn) {
        const courseId = Number(toggleBtn.dataset.courseId);
        const prerequisiteId = Number(toggleBtn.dataset.prerequisiteId);
        const visibleToStudents = toggleBtn.dataset.visible === 'true';
        await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}/visibility`, {
          method: 'PUT',
          body: JSON.stringify({ visibleToStudents })
        });
        setMessage('success', `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students.`);
      }

      if (editBtn) {
        const id = Number(editBtn.dataset.edit);
        const kind = editBtn.dataset.kind;
        const patch = await patchFor(kind, id);
        if (!patch) return;
        await request(`/${endpointFor(kind)}/${id}`, { method: 'PUT', body: JSON.stringify(patch) });
        setMessage('success', `${kind} updated.`);
      }

      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.delete);
        const kind = deleteBtn.dataset.kind;
        const confirmed = await confirmDeletion(kind, id);
        if (!confirmed) return;
        await request(`/${endpointFor(kind)}/${id}`, { method: 'DELETE' });
        setMessage('success', `${kind} deleted.`);
      }

      await loadRelations();
      await loadAdminOps();
    } catch (error) {
      setMessage('error', error.message);
    }
  });
}

export function bindAdminActions() {
  elements.ids.courseSearch?.addEventListener('input', () => renderLists());
  [elements.ids.courseFilterFaculty, elements.ids.courseFilterProgram, elements.ids.courseFilterYear, elements.ids.courseFilterSemester, elements.ids.courseFilterRelations, elements.ids.courseFilterVisibility]
    .forEach((field) => field?.addEventListener('change', () => renderLists()));
  document.querySelectorAll('[data-course-sort]').forEach((button) => button.addEventListener('click', () => {
    const key = button.dataset.courseSort;
    cache.courseSort.direction = cache.courseSort.key === key && cache.courseSort.direction === 'asc' ? 'desc' : 'asc';
    cache.courseSort.key = key;
    renderLists();
  }));

  byId('addFaculty').onclick = async () => {
    try {
      const name = byId('facultyName').value.trim();
      if (!name) throw new Error('Faculty name is required');
      await request('/faculties', { method: 'POST', body: JSON.stringify({ name }) });
      setMessage('success', 'Faculty added');
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  };

  byId('addProgram').onclick = async () => {
    try {
      const facultyId = Number(elements.ids.programFaculty.value);
      const name = byId('programName').value.trim();
      const durationYears = Number(byId('programDurationYears').value);
      if (!facultyId || !name || !durationYears) throw new Error('Program fields are required');
      await request('/programs', { method: 'POST', body: JSON.stringify({ facultyId, name, durationYears }) });
      setMessage('success', 'Program added');
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  };

  byId('addCourse').onclick = async () => {
    try {
      const programId = Number(elements.ids.courseProgram.value);
      const yearNo = Number(byId('courseYearNo').value);
      const semesterNo = Number(byId('courseSemesterNo').value);
      const code = byId('courseCode').value.trim().toUpperCase();
      const name = byId('courseName').value.trim();
      const credits = Number(byId('courseCredits').value);
      const description = byId('courseDescription').value.trim() || null;
      const prerequisiteCourseIds = mapCodesToIds(parsePrerequisiteCodes(byId('coursePrereqs').value));
      if (!programId || !yearNo || !semesterNo || !code || !name || !Number.isInteger(credits)) {
        throw new Error('All course fields are required');
      }
      await request('/program-courses', {
        method: 'POST',
        body: JSON.stringify({ programId, yearNo, semesterNo, code, name, credits, description, prerequisiteCourseIds })
      });
      setMessage('success', 'Course added');
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  };
}
