import { json, parseBody } from '../middleware/http.js';
import { validateEntityId } from '../validation/schemas.js';
import { env } from '../config/env.js';
import { addPrerequisiteRelation, createFaculty, createProgram, createProgramCourse, deleteFaculty, deleteProgram, deleteProgramCourse, deletePrerequisiteRelation, getCatalog, getFaculties, getPrerequisites, getProgramCourseDeleteImpact, getProgramCourses, getProgramDeleteImpact, getPrograms, updateFaculty, updatePrerequisites, updatePrerequisiteVisibility, updateProgram, updateProgramCourse } from '../services/catalogService.js';
import { validateFaculty, validateFacultyPatch, validatePrerequisites, validatePrerequisiteRelation, validatePrerequisiteVisibility, validateProgram, validateProgramCourse, validateProgramCoursePatch } from '../validation/schemas.js';

// Shared HTTP translation for the existing catalog mutation endpoints. Domain
// services retain the mutation and transaction logic; routes only select it.
export async function handleCatalogUpdate(req, res, validator, updater, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const body = await parseBody(req);
  const err = validator(body);
  if (err) return json(res, 400, { error: err });
  const updated = await updater(id, body);
  if (updated === false) return json(res, 404, { error: `${label} not found` });
  if (!updated) return json(res, 409, { error: label === 'Program course' ? 'This course already exists.' : `${label} already exists` });
  return json(res, 200, updated);
}

export async function handleCatalogDelete(res, deleter, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const deleted = await deleter(id);
  if (!deleted) return json(res, 404, { error: `${label} not found` });
  return json(res, 200, { deleted: true, id });
}

const toNumber = (value) => value === undefined || value === null || value === '' || !Number.isInteger(Number(value)) ? undefined : Number(value);

export async function handleCatalogReadRequest(req, res, url) {
  if (req.method !== 'GET') return false;
  if (url.pathname === `${env.apiBasePath}/catalog`) { json(res, 200, await getCatalog({ includeHidden: url.searchParams.get('audience') === 'admin' })); return true; }
  if (url.pathname === `${env.apiBasePath}/faculties`) { json(res, 200, await getFaculties()); return true; }
  if (url.pathname === `${env.apiBasePath}/programs`) { json(res, 200, await getPrograms(toNumber(url.searchParams.get('facultyId')))); return true; }
  if (url.pathname === `${env.apiBasePath}/program-courses`) {
    json(res, 200, await getProgramCourses({ facultyId: toNumber(url.searchParams.get('facultyId')), programId: toNumber(url.searchParams.get('programId')), yearNo: toNumber(url.searchParams.get('yearNo')), semesterNo: toNumber(url.searchParams.get('semesterNo')) }, { includeHidden: url.searchParams.get('audience') === 'admin' }));
    return true;
  }
  return false;
}

function idFromPath(pathname) {
  return toNumber(pathname.split('/').filter(Boolean).at(-1));
}

export async function handleCatalogRequest(req, res, url) {
  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/faculties`) {
    const body = await parseBody(req);
    const err = validateFaculty(body);
    if (err) return json(res, 400, { error: err });
    const created = await createFaculty(body);
    return created ? json(res, 201, created) : json(res, 409, { error: 'Faculty already exists' });
  }
  if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) return handleCatalogUpdate(req, res, validateFacultyPatch, updateFaculty, idFromPath(url.pathname), 'Faculty');
  if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) return handleCatalogDelete(res, deleteFaculty, idFromPath(url.pathname), 'Faculty');

  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/programs`) {
    const body = await parseBody(req);
    const err = validateProgram(body);
    if (err) return json(res, 400, { error: err });
    const created = await createProgram(body);
    return created ? json(res, 201, created) : json(res, 409, { error: 'Program already exists for this faculty' });
  }
  if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) return handleCatalogUpdate(req, res, validateProgramPatch, updateProgram, idFromPath(url.pathname), 'Program');
  if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/programs/\\d+/delete-impact$`))) {
    const id = toNumber(url.pathname.split('/').at(-2));
    const idErr = validateEntityId(id, 'program id');
    if (idErr) return json(res, 400, { error: idErr });
    const impact = await getProgramDeleteImpact(id);
    return impact ? json(res, 200, impact) : json(res, 404, { error: 'Program not found' });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) return handleCatalogDelete(res, deleteProgram, idFromPath(url.pathname), 'Program');

  if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/program-courses`) {
    const body = await parseBody(req);
    const err = validateProgramCourse(body);
    if (err) return json(res, 400, { error: err });
    const created = await createProgramCourse(body);
    return created ? json(res, 201, created) : json(res, 409, { error: 'This course already exists.' });
  }
  if (url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites$`))) {
    const id = toNumber(url.pathname.split('/').at(-2));
    const idErr = validateEntityId(id, 'program course id');
    if (idErr) return json(res, 400, { error: idErr });
    if (req.method === 'GET') return json(res, 200, { prerequisiteCourseIds: await getPrerequisites(id) });
    if (req.method === 'POST') {
      const body = await parseBody(req);
      const err = validatePrerequisiteRelation(body);
      if (err) return json(res, 400, { error: err });
      const created = await addPrerequisiteRelation(id, body.prerequisiteCourseId);
      return created ? json(res, 201, created) : json(res, 409, { error: 'This relationship is already defined.' });
    }
    if (req.method === 'PUT') {
      const body = await parseBody(req);
      const err = validatePrerequisites(body);
      if (err) return json(res, 400, { error: err });
      return json(res, 200, { prerequisiteCourseIds: await updatePrerequisites(id, body.prerequisiteCourseIds || []) });
    }
  }
  if (req.method === 'PUT' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites/\\d+/visibility$`))) {
    const parts = url.pathname.split('/');
    const id = toNumber(parts.at(-4)); const prerequisiteId = toNumber(parts.at(-2));
    const idErr = validateEntityId(id, 'program course id') || validateEntityId(prerequisiteId, 'prerequisite course id');
    if (idErr) return json(res, 400, { error: idErr });
    const body = await parseBody(req); const err = validatePrerequisiteVisibility(body);
    if (err) return json(res, 400, { error: err });
    const updated = await updatePrerequisiteVisibility(id, prerequisiteId, body.visibleToStudents);
    return updated ? json(res, 200, { updated: true, courseId: id, prerequisiteCourseId: prerequisiteId, visibleToStudents: body.visibleToStudents }) : json(res, 404, { error: 'Prerequisite relation not found' });
  }
  if (req.method === 'DELETE' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites/\\d+$`))) {
    const parts = url.pathname.split('/'); const id = toNumber(parts.at(-3)); const prerequisiteId = toNumber(parts.at(-1));
    const idErr = validateEntityId(id, 'program course id') || validateEntityId(prerequisiteId, 'prerequisite course id');
    if (idErr) return json(res, 400, { error: idErr });
    const deleted = await deletePrerequisiteRelation(id, prerequisiteId);
    return deleted ? json(res, 200, { deleted: true, courseId: id, prerequisiteCourseId: prerequisiteId }) : json(res, 404, { error: 'Prerequisite relation not found' });
  }
  if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) return handleCatalogUpdate(req, res, validateProgramCoursePatch, updateProgramCourse, idFromPath(url.pathname), 'Program course');
  if (req.method === 'GET' && url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/delete-impact$`))) {
    const id = toNumber(url.pathname.split('/').at(-2));
    const idErr = validateEntityId(id, 'program course id');
    if (idErr) return json(res, 400, { error: idErr });
    const impact = await getProgramCourseDeleteImpact(id);
    return impact ? json(res, 200, impact) : json(res, 404, { error: 'Program course not found' });
  }
  if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) return handleCatalogDelete(res, deleteProgramCourse, idFromPath(url.pathname), 'Program course');
  return false;
}
