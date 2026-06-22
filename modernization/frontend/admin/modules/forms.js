import { byId } from '../../shared/dom.js';
import { request } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { openConfirmDialog, openFormDialog } from './dialogs.js';
import { mapCodesToIds, parsePrerequisiteCodes, prerequisiteCodes } from './prerequisites.js';
import { cache } from './state.js';

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

function endpointFor(kind) {
  const endpoints = {
    faculty: 'faculties',
    program: 'programs',
    course: 'program-courses'
  };
  return endpoints[kind];
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
    if (!editBtn && !deleteBtn) return;

    try {
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
        const confirmed = await openConfirmDialog({
          title: `Delete ${kind}`,
          description: `This will delete the selected ${kind} and related child records.`
        });
        if (!confirmed) return;
        await request(`/${endpointFor(kind)}/${id}`, { method: 'DELETE' });
        setMessage('success', `${kind} deleted.`);
      }

      await loadRelations();
    } catch (error) {
      setMessage('error', error.message);
    }
  });
}

export function bindAdminActions() {
  byId('addFaculty').onclick = async () => {
    try {
      const name = byId('facultyName').value.trim();
      if (!name) throw new Error('Faculty name is required');
      await request('/faculties', { method: 'POST', body: JSON.stringify({ name }) });
      setMessage('success', 'Faculty added');
      clearEntityInputs();
      await loadRelations();
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
    } catch (error) { setMessage('error', error.message); }
  };
}
