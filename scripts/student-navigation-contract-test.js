import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { reconcileStudentViewStack, resolveProgramFacultyId } from '../frontend/student/navigation.js';

const catalog = {
  faculties: [{ id: 1 }, { id: 2 }],
  programs: [{ id: 10, facultyId: 1 }, { id: 20, facultyId: 2 }],
  programCourses: [{ programId: 10, yearNo: 1, semesterNo: 1 }]
};

assert.equal(resolveProgramFacultyId([{ view: 'overview' }, { view: 'program', programId: 10 }], catalog), 1);
assert.equal(resolveProgramFacultyId([{ view: 'overview' }], catalog, '2'), 2);
assert.equal(resolveProgramFacultyId([{ view: 'overview' }], catalog), null);
assert.deepEqual(reconcileStudentViewStack([
  { view: 'overview' }, { view: 'faculty', facultyId: 1 }, { view: 'program', programId: 10 },
  { view: 'courses', programId: 10, yearNo: 1, semesterNo: 1 }
], catalog), [
  { view: 'overview' }, { view: 'faculty', facultyId: 1 }, { view: 'program', programId: 10 },
  { view: 'courses', programId: 10, yearNo: 1, semesterNo: 1 }
]);
assert.deepEqual(reconcileStudentViewStack([
  { view: 'overview' }, { view: 'faculty', facultyId: 99 }, { view: 'program', programId: 99 },
  { view: 'program', programId: 20 }, { view: 'courses', programId: 20, yearNo: 1, semesterNo: 1 }
], catalog), [{ view: 'overview' }, { view: 'faculty', facultyId: 2 }, { view: 'program', programId: 20 }]);
assert.deepEqual(reconcileStudentViewStack([
  { view: 'overview' }, { view: 'faculty', facultyId: 1 }, { view: 'program', programId: 10 },
  { view: 'faculty', facultyId: 2 }, { view: 'program', programId: 20 }
], catalog), [{ view: 'overview' }, { view: 'faculty', facultyId: 2 }, { view: 'program', programId: 20 }],
'changing faculties removes the previous faculty/program path before the new program');
assert.deepEqual(reconcileStudentViewStack([
  { view: 'overview' }, { view: 'faculty', facultyId: 1 }, { view: 'program', programId: 10 },
  { view: 'courses', programId: 10, yearNo: 1, semesterNo: 1 }, { view: 'program', programId: 11 }
], { ...catalog, programs: [...catalog.programs, { id: 11, facultyId: 1 }] }), [
  { view: 'overview' }, { view: 'faculty', facultyId: 1 }, { view: 'program', programId: 11 }
], 'switching programs removes the old course path');

const [html, js, css] = await Promise.all([
  readFile(new URL('../frontend/student/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/student/student.js', import.meta.url), 'utf8'),
  readFile(new URL('../frontend/student/student.css', import.meta.url), 'utf8')
]);
assert.match(html, /id="faculty-nav-btn"[^>]*>Faculty/);
assert.match(html, /id="programs-nav-btn"[^>]*>Programs/);
assert.match(html, /id="student-nav-status"[^>]*role="status"/);
assert.doesNotMatch(html, /programs-dropdown|aria-haspopup="true"/);
assert.doesNotMatch(css, /programs-dropdown|programs-flyout/);
assert.match(js, /addEventListener\('click', openFacultyNavigation\)/);
assert.match(js, /addEventListener\('click', openProgramsNavigation\)/);
assert.match(js, /CATALOG_FRESHNESS_MS = 30_000/);
assert.match(js, /visibilitychange/);
assert.match(js, /catalogLoadPromise/);

console.log('Student navigation contract passed.');
