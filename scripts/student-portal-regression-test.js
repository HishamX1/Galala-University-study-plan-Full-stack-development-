import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import { handleApi } from '../backend/src/routes/catalogRoutes.js';
import { createUser } from '../backend/src/services/authService.js';
import { closePool, query } from '../backend/src/db/client.js';
import { normalizeCatalog } from '../frontend/shared/catalogNormalizer.js';

if (process.env.NODE_ENV === 'production') throw new Error('Student Portal regression tests must not run in production.');

const origin = 'http://127.0.0.1:5500';
const suffix = crypto.randomUUID();
const email = `student-portal-${suffix}@example.test`;
const password = 'StudentPortalPass!2026';
let userId;
let server;

function request(port, path, method = 'GET', body, cookie = '') {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers: { Origin: origin, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) } }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

try {
  const studentSource = fs.readFileSync(new URL('../frontend/student/student.js', import.meta.url), 'utf8');
  if (!studentSource.includes("document.readyState === 'loading'") || !studentSource.includes('initializeStudentPortal();')) {
    throw new Error('Student portal initialization is not protected against session-restoration / DOMContentLoaded timing.');
  }
  userId = (await createUser({ name: 'Student Portal Regression Test', email, studentId: `SP-${suffix}`, password, role: 'student', status: 'active' })).id;
  server = http.createServer(async (req, res) => {
    const handled = await handleApi(req, res, new URL(req.url, `http://${req.headers.host}`));
    if (handled === false) res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  if ((await request(port, '/api/catalog')).status !== 401) throw new Error('Student catalog must require an authenticated session.');
  const login = await request(port, '/api/auth/student-login', 'POST', { identifier: email, password });
  if (login.status !== 200) throw new Error('Student login failed.');
  const cookie = (login.headers['set-cookie'] || []).map((value) => value.split(';')[0]).join('; ');
  const me = await request(port, '/api/auth/me', 'GET', null, cookie);
  if (me.status !== 200 || JSON.parse(me.body).user.role !== 'student') throw new Error('Student session restoration contract failed.');
  const response = await request(port, '/api/catalog', 'GET', null, cookie);
  if (response.status !== 200) throw new Error(`Student catalog request failed with ${response.status}.`);

  const catalog = normalizeCatalog(JSON.parse(response.body));
  if (!catalog.faculties.length || !catalog.programs.length || !catalog.programCourses.length) throw new Error('Student catalog is missing faculty, program, or course data.');
  const faculty = catalog.faculties.find((item) => catalog.programs.some((program) => program.facultyId === item.id));
  const program = catalog.programs.find((item) => item.facultyId === faculty?.id);
  const programCourses = catalog.programCourses.filter((item) => item.programId === program?.id && item.facultyId === faculty?.id);
  const years = [...new Set(programCourses.map((item) => item.yearNo))];
  const semesters = [...new Set(programCourses.map((item) => item.semesterNo))];
  if (!faculty || !program || !programCourses.length || !years.length || !semesters.length) throw new Error('Faculty → Program → Year → Semester → Course hierarchy cannot be constructed.');
  const courseById = new Map(catalog.programCourses.map((item) => [item.id, item]));
  const prerequisiteCourse = catalog.programCourses.find((item) => item.prerequisiteCourseIds.length && item.prerequisiteCourseIds.every((id) => courseById.has(id)));
  if (!prerequisiteCourse) throw new Error('Student-safe prerequisite relationships were not received.');
  const requiredForCourse = catalog.programCourses.find((item) => catalog.programCourses.some((candidate) => candidate.prerequisiteCourseIds.includes(item.id)));
  if (!requiredForCourse) throw new Error('Required-for relationships cannot be constructed from the student catalog.');
  if (catalog.programCourses.some((item) => item.prerequisiteRelations.some((relation) => relation.visibleToStudents === false))) throw new Error('Hidden prerequisite relations leaked into the student catalog.');
  const hidden = await query('SELECT count(*)::int AS count FROM course_prerequisites WHERE deleted_at IS NULL AND visible_to_students = false');
  console.log(`Student Portal hierarchy regression test passed (${catalog.faculties.length} faculties, ${catalog.programs.length} programs, ${catalog.programCourses.length} courses; ${hidden.rows[0].count} hidden relations in current data).`);
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (userId) await query('DELETE FROM public.app_users WHERE id = $1', [userId]);
  await closePool();
}
