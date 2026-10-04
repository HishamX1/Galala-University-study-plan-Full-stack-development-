import { json, parseBody } from '../middleware/http.js';
import { validateEntityId } from '../validation/schemas.js';
import { env } from '../config/env.js';
import { getCatalog, getFaculties, getProgramCourses, getPrograms } from '../services/catalogService.js';

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
