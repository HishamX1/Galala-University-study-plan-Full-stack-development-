import { byId } from '../../shared/dom.js';
import { request } from './apiClient.js';
import { elements, setMessage, withButtonBusy } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { loadAdminOps } from './adminOps.js';
import { openConfirmDialog, openContentDialog, openFormDialog } from './dialogs.js';
import { renderLists } from './renderLists.js';
import { expectedRelationVersion, mapCodesToIds, parsePrerequisiteCodes, prerequisiteCodes, prerequisiteRelationItems, requiredForRelationItems } from './prerequisites.js';
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

function hasUncertainMutationOutcome(error) {
  return error?.code === 'API_NETWORK_ERROR' || error?.code === 'REQUEST_TIMEOUT';
}

function reportActionError(error, message) {
  if (typeof window !== 'undefined') {
    window.__GU_LAST_API_ERROR__ = { ...error, message };
  }
  setMessage('error', message);
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
    'The course is moved to the recycle bin and disappears from the active student catalog until restored. Confirm only if that is intended.'
  ].filter(Boolean).join(' ');
}

function summarizeProgramImpact(impact) {
  return [
    `You are deleting ${impact?.program?.name || 'this program'}.`,
    `This moves ${impact?.courseCount || 0} program course row(s), ${impact?.prerequisiteLinkCount || 0} prerequisite link(s), and ${impact?.requiredForLinkCount || 0} required-for link(s) tied to those rows to the recycle bin.`,
    'Shared course records remain when they are still used by another program. These records can be restored from the recycle bin.'
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

  if (kind === 'faculty') {
    const faculty = cache.faculties.find((item) => Number(item.id) === Number(id));
    return openConfirmDialog({
      title: `Delete faculty ${faculty?.name || ''}?`,
      description: 'The faculty and its programs, curriculum rows, and related prerequisite links will move to the recycle bin and disappear from the active student catalog. They can be reviewed and restored there.',
      submitLabel: 'Move faculty to recycle bin'
    });
  }

  return openConfirmDialog({
    title: `Delete ${kind}`,
    description: `This will delete the selected ${kind} and related child records.`
  });
}

async function coursePatch(course) {
  const groups = course.prerequisiteGroups || [];
  const mandatoryCodes = (Array.isArray(course.prerequisiteGroups) ? groups.filter(group => group.type === 'mandatory').flatMap(group => group.members || []).map(member => cache.programCourses.find(item => Number(item.id) === Number(member.courseId))?.code).filter(Boolean) : prerequisiteCodes(course).split(',').map(code=>code.trim()).filter(Boolean));
  const alternativeText = groups.filter(group => group.type === 'alternative').map(group => `${group.label}: ${(group.members || []).map(member => cache.programCourses.find(item => Number(item.id) === Number(member.courseId))?.code).filter(Boolean).join(', ')}`).join('\n');
  const result = await openFormDialog({
    title: `Edit ${course.code}`,
    description: 'Existing relationships remain mandatory. Add alternative groups as “Label: CODE, CODE”, one group per line.',
    fields: [
      { name: 'programId', label: 'Program', type: 'select', value: course.programId, options: selectOptions(cache.programs), required: true },
      { name: 'yearNo', label: 'Year Number', value: course.yearNo, type: 'number', min: 1, required: true },
      { name: 'semesterNo', label: 'Semester Number', value: course.semesterNo, type: 'number', min: 1, required: true },
      { name: 'code', label: 'Course Code', value: course.code, required: true },
      { name: 'name', label: 'Course Name', value: course.name, required: true },
      { name: 'credits', label: 'Credits', value: course.credits, type: 'number', min: 0, required: true },
      { name: 'description', label: 'Description', value: course.description || '', type: 'textarea' },
      { name: 'prerequisites', label: 'Mandatory prerequisites', type: 'textarea', value: mandatoryCodes.join(', ') },
      { name: 'alternativePrerequisiteGroups', label: 'Alternative prerequisite groups', type: 'textarea', value: alternativeText }
    ],
    onOpen: (root) => {
      const preview=document.createElement('p'); preview.className='prerequisite-rule-preview'; preview.setAttribute('aria-live','polite');
      const mandatory=root.querySelector('[name="prerequisites"]'); const alternatives=root.querySelector('[name="alternativePrerequisiteGroups"]');
      const update=()=>{
        const required=String(mandatory?.value||'').split(',').map(item=>item.trim()).filter(Boolean);
        const groups=String(alternatives?.value||'').split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const index=line.indexOf(':');return index>0?`${line.slice(0,index).trim()} (${line.slice(index+1).split(',').map(item=>item.trim()).filter(Boolean).join(' OR ')})`:line});
        preview.textContent=`Rule preview — Required ALL: ${required.join(' AND ')||'none'}${groups.length?`; Alternative groups, ANY ONE per group: ${groups.join('; ')}`:''}`;
      };
      mandatory?.addEventListener('input',update); alternatives?.addEventListener('input',update); root.append(preview); update();
    }
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
    prerequisiteCourseIds: mapCodesToIds(parsePrerequisiteCodes(result.prerequisites)),
    prerequisiteGroups: {
      mandatoryCourseIds: mapCodesToIds(parsePrerequisiteCodes(result.prerequisites)),
      alternativeGroups: String(result.alternativePrerequisiteGroups || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => {
        const separator = line.indexOf(':');
        if (separator < 1) throw new Error('Alternative groups must use “Label: CODE, CODE”.');
        const label = line.slice(0, separator).trim();
        const codes = parsePrerequisiteCodes(line.slice(separator + 1));
        if (!label || codes.length < 2) throw new Error('Each alternative group needs a label and at least two course codes.');
        return { label, prerequisiteCourseIds: mapCodesToIds(codes) };
      })
    },
    expectedVersion: course.version
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
  root.innerHTML = updated
    ? relationManagerMarkup(updated)
    : '<p class="empty-state">This course is no longer active. The latest catalog has been loaded.</p>';
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
      <div class="dialog-inline-actions"><button type="button" data-edit="${course.id}" data-kind="course">Edit Course</button><button type="button" data-manage-relations="${course.id}">Manage Relations</button><button type="button" class="danger" data-delete="${course.id}" data-kind="course" aria-label="Move ${escapeHtml(course.code)} to recycle bin">Move course to recycle bin</button></div>
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

        const actionButton = addBtn || toggleBtn || removeBtn;
        await withButtonBusy(actionButton, async () => {
        setMessage('progress', addBtn ? 'Adding the relationship…' : toggleBtn ? 'Updating relationship visibility…' : 'Removing the relationship…');
        let relationMutation = null;
        try {
          if (addBtn) {
            const baseCourseId = Number(root.querySelector('.relation-manager').dataset.courseId);
            const selectedCourseId = Number(root.querySelector('[data-relation-course]').value);
            const type = root.querySelector('input[name="relationType"]:checked')?.value || 'prerequisite';
            const courseId = type === 'prerequisite' ? baseCourseId : selectedCourseId;
            const prerequisiteCourseId = type === 'prerequisite' ? selectedCourseId : baseCourseId;
            relationMutation = { type: 'add', courseId, prerequisiteCourseId };
            await request(`/program-courses/${courseId}/prerequisites`, {
              method: 'POST',
              body: JSON.stringify({ prerequisiteCourseId, expectedVersion: expectedRelationVersion(findCourse(courseId)) })
            });
            setMessage('success', 'Relationship added.');
            await refreshRelationManager(root, baseCourseId);
            relationMutation = null;
          }

          if (toggleBtn) {
            const courseId = Number(toggleBtn.dataset.dialogToggle);
            const prerequisiteId = Number(toggleBtn.dataset.prerequisiteId);
            const visibleToStudents = toggleBtn.dataset.visible === 'true';
            relationMutation = { type: 'visibility', courseId, prerequisiteCourseId: prerequisiteId, visibleToStudents };
            await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}/visibility`, {
              method: 'PUT',
              body: JSON.stringify({ visibleToStudents, expectedVersion: expectedRelationVersion(findCourse(courseId)) })
            });
            setMessage('success', `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students.`);
            await refreshRelationManager(root, course.id);
            relationMutation = null;
          }

          if (removeBtn) {
            const courseId = Number(removeBtn.dataset.dialogRemove);
            const prerequisiteId = Number(removeBtn.dataset.prerequisiteId);
            relationMutation = { type: 'remove', courseId, prerequisiteCourseId: prerequisiteId };
            await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}`, {
              method: 'DELETE', body: JSON.stringify({ expectedVersion: expectedRelationVersion(findCourse(courseId)) })
            });
            setMessage('success', 'Relationship removed.');
            await refreshRelationManager(root, course.id);
            relationMutation = null;
          }
        } catch (error) {
          const shouldRefresh = error.code === 'STALE_WRITE' || error.status === 404 || hasUncertainMutationOutcome(error);
          let refreshed = false;
          if (shouldRefresh) {
            try {
              await refreshRelationManager(root, course.id);
              refreshed = true;
            } catch { /* Keep the original operation failure; never replay a mutation automatically. */ }
          }

          if (error.status === 404) {
            reportActionError(error, refreshed
              ? 'That relationship is no longer active. The latest catalog has been loaded; choose from the current relationships.'
              : 'That relationship could not be found, and the catalog refresh also failed. Reconnect and refresh before trying again.');
          } else if (hasUncertainMutationOutcome(error)) {
            const currentCourse = relationMutation && findCourse(relationMutation.courseId);
            const relation = currentCourse?.prerequisiteRelations?.find((item) => Number(item.prerequisiteCourseId) === Number(relationMutation.prerequisiteCourseId));
            const confirmed = refreshed && relationMutation && (
              (relationMutation.type === 'add' && relation)
              || (relationMutation.type === 'remove' && !relation)
              || (relationMutation.type === 'visibility' && relation && relation.visibleToStudents === relationMutation.visibleToStudents)
            );
            if (confirmed) {
              const label = relationMutation.type === 'add' ? 'added'
                : relationMutation.type === 'remove' ? 'removed'
                  : relationMutation.visibleToStudents ? 'shown to students' : 'hidden from students';
              setMessage('success', `The latest catalog confirms that the relationship was ${label}.`);
              return;
            }
            reportActionError(error, refreshed
              ? 'The connection was interrupted. The latest relationships were reloaded, but they do not confirm that action. Review the current state before trying again.'
              : 'The connection was interrupted and the result could not be verified. Do not retry until the connection returns and the catalog refreshes.');
          } else {
            reportActionError(error, error.code === 'STALE_WRITE'
              ? 'This item changed while you were editing. The catalog has been refreshed; compare the latest values and reapply your change if appropriate.'
              : error.message);
          }
        }
        });
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
    return result && { name: result.name.trim(), expectedVersion: current?.version };
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
    return result && { facultyId: Number(result.facultyId), name: result.name.trim(), durationYears: Number(result.durationYears), expectedVersion: current?.version };
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

    let deleteFlow = null;
    try {
      if (viewBtn) {
        const course = findCourse(viewBtn.dataset.viewCourse);
        if (course) {
          await openCourseView(course);
          return;
        }
      }

      if (manageBtn) {
        const course = findCourse(manageBtn.dataset.manageRelations);
        if (course) {
          await openRelationManager(course);
          return;
        }
      }

      if (toggleBtn) {
        const courseId = Number(toggleBtn.dataset.courseId);
        const prerequisiteId = Number(toggleBtn.dataset.prerequisiteId);
        const visibleToStudents = toggleBtn.dataset.visible === 'true';
        await withButtonBusy(toggleBtn, async () => {
          setMessage('progress', 'Updating relationship visibility…');
          await request(`/program-courses/${courseId}/prerequisites/${prerequisiteId}/visibility`, {
            method: 'PUT',
            body: JSON.stringify({ visibleToStudents, expectedVersion: expectedRelationVersion(findCourse(courseId)) })
          });
        });
        setMessage('success', `Relation ${visibleToStudents ? 'shown to' : 'hidden from'} students.`);
      }

      if (editBtn) {
        const id = Number(editBtn.dataset.edit);
        const kind = editBtn.dataset.kind;
        const patch = await patchFor(kind, id);
        if (!patch) return;
        await withButtonBusy(editBtn, async () => {
          setMessage('progress', `Updating the ${kind}…`);
          const { prerequisiteGroups, ...entityPatch } = patch;
          const updatePayload = kind === 'course' && prerequisiteGroups ? { ...entityPatch, prerequisiteGroups } : entityPatch;
          await request(`/${endpointFor(kind)}/${id}`, { method: 'PUT', body: JSON.stringify(updatePayload) });
        });
        setMessage('success', `${kind[0].toUpperCase()}${kind.slice(1)} updated successfully.`);
      }

      if (deleteBtn) {
        const id = Number(deleteBtn.dataset.delete);
        const kind = deleteBtn.dataset.kind;
        const current = kind === 'faculty'
          ? cache.faculties.find((item) => Number(item.id) === id)
          : kind === 'program'
            ? cache.programs.find((item) => Number(item.id) === id)
            : cache.programCourses.find((item) => Number(item.id) === id);
        const fromCourseDetails = kind === 'course' && elements.dialog.fields.contains(deleteBtn);
        deleteFlow = { id, kind, current, fromCourseDetails, submitted: false };
        const confirmed = await confirmDeletion(kind, id);
        if (!confirmed) {
          if (fromCourseDetails && current) await openCourseView(current);
          return;
        }
        await withButtonBusy(deleteBtn, async () => {
          setMessage('progress', `Deleting the ${kind}…`);
          deleteFlow.submitted = true;
          await request(`/${endpointFor(kind)}/${id}`, {
            method: 'DELETE', body: JSON.stringify({ expectedVersion: current?.version })
          });
          deleteFlow.completed = true;
        });
        if (fromCourseDetails) elements.dialog.backdrop.hidden = true;
        setMessage('success', `${kind[0].toUpperCase()}${kind.slice(1)} moved to the recycle bin successfully.`);
      }

      await loadRelations();
      await loadAdminOps();
      deleteFlow = null;
    } catch (error) {
      const shouldRefresh = error.code === 'STALE_WRITE'
        || (deleteFlow && (error.status === 404 || hasUncertainMutationOutcome(error)));
      let refreshed = false;
      if (shouldRefresh) {
        try {
          await loadRelations();
          await loadAdminOps();
          refreshed = true;
        } catch { /* Preserve the original failure when the API is still unavailable. */ }
      }

      if (deleteFlow?.kind === 'course' && !deleteFlow.submitted && hasUncertainMutationOutcome(error)) {
        reportActionError(error, refreshed
          ? 'The deletion preview could not reach the API, so no deletion was submitted. The catalog was refreshed; check the connection before opening the preview again.'
          : 'The deletion preview could not reach the API, and the result could not be checked. No deletion was submitted. Reconnect and refresh before trying again.');
      } else if (deleteFlow?.completed && hasUncertainMutationOutcome(error)) {
        reportActionError(error, refreshed
          ? 'The server confirmed the deletion, and the catalog has now been refreshed.'
          : 'The server confirmed the deletion, but the follow-up catalog refresh could not reach the API. The deletion is complete; refresh the page when the connection returns.');
      } else if (deleteFlow?.kind === 'course' && deleteFlow.submitted && hasUncertainMutationOutcome(error)) {
        const courseStillActive = cache.programCourses.some((item) => Number(item.id) === deleteFlow.id);
        if (refreshed && !courseStillActive) {
          if (deleteFlow.fromCourseDetails) elements.dialog.backdrop.hidden = true;
          setMessage('success', 'The latest catalog confirms the course is no longer active and has been moved out of the active catalog.');
        } else {
          reportActionError(error, refreshed
            ? 'The connection was interrupted. The latest catalog still shows this course as active; wait, refresh again, and verify its state before retrying. No automatic retry was made.'
            : 'The connection was interrupted and the result could not be verified. Do not retry until the connection returns and the catalog refreshes.');
        }
      } else if (deleteFlow && error.status === 404) {
        if (deleteFlow.fromCourseDetails && refreshed && !cache.programCourses.some((item) => Number(item.id) === deleteFlow.id)) {
          elements.dialog.backdrop.hidden = true;
        }
        reportActionError(error, refreshed
          ? 'This catalog item is no longer active. The latest catalog has been loaded; review it before continuing.'
          : 'This catalog item could not be found, and the catalog refresh failed. Reconnect and refresh before trying again.');
      } else {
        reportActionError(error, error.code === 'STALE_WRITE'
          ? 'This item changed while you were editing. The catalog has been refreshed; compare the latest values and reopen the edit to reapply your change.'
          : error.message);
      }
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

  byId('addFaculty').onclick = async (event) => withButtonBusy(event.currentTarget, async () => {
    setMessage('progress', 'Adding the faculty…');
    try {
      const name = byId('facultyName').value.trim();
      if (!name) throw new Error('Faculty name is required');
      await request('/faculties', { method: 'POST', body: JSON.stringify({ name }) });
      setMessage('success', 'Faculty added successfully. You can now select it when creating a program.');
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  });

  byId('addProgram').onclick = async (event) => withButtonBusy(event.currentTarget, async () => {
    setMessage('progress', 'Adding the program…');
    try {
      const facultyId = Number(elements.ids.programFaculty.value);
      const name = byId('programName').value.trim();
      const durationYears = Number(byId('programDurationYears').value);
      if (!facultyId || !name || !durationYears) throw new Error('Program fields are required');
      await request('/programs', { method: 'POST', body: JSON.stringify({ facultyId, name, durationYears }) });
      setMessage('success', 'Program added successfully. You can now add courses to it.');
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  });

  byId('addCourse').onclick = async (event) => withButtonBusy(event.currentTarget, async () => {
    setMessage('progress', 'Adding the course…');
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
      setMessage('success', `Course ${code} added successfully to the selected program.`);
      clearEntityInputs();
      await loadRelations();
      await loadAdminOps();
    } catch (error) { setMessage('error', error.message); }
  });
}
