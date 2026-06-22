import {
  createFaculty,
  createProgram,
  createProgramCourse,
  deleteFaculty,
  deleteProgram,
  deleteProgramCourse,
  getCatalog,
  getFaculties,
  getPrerequisites,
  getProgramCourses,
  getPrograms,
  updateFaculty,
  updatePrerequisites,
  updateProgram,
  updateProgramCourse
} from '../services/catalogService.js';
import {
  validateEntityId,
  validateFaculty,
  validateFacultyPatch,
  validatePrerequisites,
  validateProgram,
  validateProgramCourse,
  validateProgramCoursePatch,
  validateProgramPatch
} from '../validation/schemas.js';
import { env } from '../config/env.js';

function json(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': env.allowCorsOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    ...extraHeaders
  });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString('utf8') || '{}';
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('INVALID_JSON');
  }
}

function toNumber(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function idFromPath(pathname) {
  return toNumber(pathname.split('/').filter(Boolean).at(-1));
}

async function handleUpdate(req, res, validator, updater, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const body = await parseBody(req);
  const err = validator(body);
  if (err) return json(res, 400, { error: err });
  const updated = await updater(id, body);
  if (updated === false) return json(res, 404, { error: `${label} not found` });
  if (!updated) return json(res, 409, { error: `${label} already exists` });
  return json(res, 200, updated);
}

async function handleDelete(res, deleter, id, label) {
  const idErr = validateEntityId(id, `${label} id`);
  if (idErr) return json(res, 400, { error: idErr });
  const deleted = await deleter(id);
  if (!deleted) return json(res, 404, { error: `${label} not found` });
  return json(res, 200, { deleted: true, id });
}

export async function handleApi(req, res, url) {
  if (!url.pathname.startsWith(env.apiBasePath)) return false;
  if (req.method === 'OPTIONS') return json(res, 204, {});

  try {
    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/health`) {
      return json(res, 200, { status: 'ok', mode: 'postgres', schema: 'canonical' });
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/catalog`) {
      return json(res, 200, await getCatalog());
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/faculties`) {
      return json(res, 200, await getFaculties());
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/faculties`) {
      const body = await parseBody(req);
      const err = validateFaculty(body);
      if (err) return json(res, 400, { error: err });
      const created = await createFaculty(body);
      if (!created) return json(res, 409, { error: 'Faculty already exists' });
      return json(res, 201, created);
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) {
      return handleUpdate(req, res, validateFacultyPatch, updateFaculty, idFromPath(url.pathname), 'Faculty');
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/faculties/`)) {
      return handleDelete(res, deleteFaculty, idFromPath(url.pathname), 'Faculty');
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/programs`) {
      return json(res, 200, await getPrograms(toNumber(url.searchParams.get('facultyId'))));
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/programs`) {
      const body = await parseBody(req);
      const err = validateProgram(body);
      if (err) return json(res, 400, { error: err });
      const created = await createProgram(body);
      if (!created) return json(res, 409, { error: 'Program already exists for this faculty' });
      return json(res, 201, created);
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) {
      return handleUpdate(req, res, validateProgramPatch, updateProgram, idFromPath(url.pathname), 'Program');
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/programs/`)) {
      return handleDelete(res, deleteProgram, idFromPath(url.pathname), 'Program');
    }

    if (req.method === 'GET' && url.pathname === `${env.apiBasePath}/program-courses`) {
      return json(res, 200, await getProgramCourses({
        facultyId: toNumber(url.searchParams.get('facultyId')),
        programId: toNumber(url.searchParams.get('programId')),
        yearNo: toNumber(url.searchParams.get('yearNo')),
        semesterNo: toNumber(url.searchParams.get('semesterNo'))
      }));
    }

    if (req.method === 'POST' && url.pathname === `${env.apiBasePath}/program-courses`) {
      const body = await parseBody(req);
      const err = validateProgramCourse(body);
      if (err) return json(res, 400, { error: err });
      const created = await createProgramCourse(body);
      if (!created) return json(res, 409, { error: 'Program course already exists' });
      return json(res, 201, created);
    }

    if (url.pathname.match(new RegExp(`^${env.apiBasePath}/program-courses/\\d+/prerequisites$`))) {
      const id = toNumber(url.pathname.split('/').at(-2));
      const idErr = validateEntityId(id, 'program course id');
      if (idErr) return json(res, 400, { error: idErr });
      if (req.method === 'GET') return json(res, 200, { prerequisiteCourseIds: await getPrerequisites(id) });
      if (req.method === 'PUT') {
        const body = await parseBody(req);
        const err = validatePrerequisites(body);
        if (err) return json(res, 400, { error: err });
        return json(res, 200, { prerequisiteCourseIds: await updatePrerequisites(id, body.prerequisiteCourseIds || []) });
      }
    }

    if (req.method === 'PUT' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) {
      return handleUpdate(req, res, validateProgramCoursePatch, updateProgramCourse, idFromPath(url.pathname), 'Program course');
    }

    if (req.method === 'DELETE' && url.pathname.startsWith(`${env.apiBasePath}/program-courses/`)) {
      return handleDelete(res, deleteProgramCourse, idFromPath(url.pathname), 'Program course');
    }

    return json(res, 404, { error: 'API route not found' });
  } catch (error) {
    console.error('API route error:', error);
    if (error.message === 'INVALID_JSON') return json(res, 400, { error: 'Invalid JSON payload' });
    if (error.message === 'PG_DRIVER_MISSING') return json(res, 500, { error: 'PostgreSQL driver is missing. Install pg.' });
    if (error.message === 'DB_NOT_CONFIGURED') return json(res, 500, { error: 'Database is not configured. Check DATABASE_URL.' });
    if (String(error.message || '').startsWith('FK_')) return json(res, 400, { error: 'Invalid relation id provided.' });
    return json(res, 500, { error: error.message || 'Internal server error' });
  }
}
