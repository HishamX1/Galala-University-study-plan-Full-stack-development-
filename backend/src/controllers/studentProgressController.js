import { env } from '../config/env.js';
import { json, parseBody } from '../middleware/http.js';
import { readOwnAcademicProgress, saveOwnAcademicProgress } from '../services/studentProgressService.js';

export async function handleStudentProgressRequest(req, res, url, user) {
  const path = `${env.apiBasePath}/student/academic-progress`;
  if (url.pathname !== path) return false;
  if (user?.role !== 'student') return json(res, 403, { error: 'Student account required.' });
  if (req.method === 'GET') return json(res, 200, await readOwnAcademicProgress(user, url.searchParams.get('programId')));
  if (req.method === 'PUT') return json(res, 200, await saveOwnAcademicProgress(user, await parseBody(req)));
  return false;
}
