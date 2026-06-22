import http from 'node:http';

function request(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1',
      port: 4000,
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch { json = null; }
        resolve({ status: res.statusCode, body: raw, json });
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const health = await request('/api/health');
if (health.status !== 200 || health.json?.schema !== 'canonical') throw new Error(`Health check failed: ${health.status}`);

const catalog = await request('/api/catalog');
if (catalog.status !== 200 || !Array.isArray(catalog.json?.faculties) || !Array.isArray(catalog.json?.programCourses)) {
  throw new Error(`Catalog fetch failed: ${catalog.status}`);
}

const faculties = await request('/api/faculties');
if (faculties.status !== 200 || !Array.isArray(faculties.json)) throw new Error(`Faculties fetch failed: ${faculties.status}`);

const programs = await request('/api/programs');
if (programs.status !== 200 || !Array.isArray(programs.json)) throw new Error(`Programs fetch failed: ${programs.status}`);

const programCourses = await request('/api/program-courses');
if (programCourses.status !== 200 || !Array.isArray(programCourses.json)) {
  throw new Error(`Program courses fetch failed: ${programCourses.status}`);
}

const createdFaculty = await request('/api/faculties', 'POST', { name: `Smoke Faculty ${Date.now()}` });
if (createdFaculty.status !== 201 || !createdFaculty.json?.id) throw new Error(`Create faculty failed: ${createdFaculty.status}`);
const createdFacultyId = Number(createdFaculty.json.id);

const updatedFaculty = await request(`/api/faculties/${createdFacultyId}`, 'PUT', { name: `${createdFaculty.json.name} Updated` });
if (updatedFaculty.status !== 200 || !updatedFaculty.json?.name?.endsWith('Updated')) {
  throw new Error(`Update faculty failed: ${updatedFaculty.status}`);
}

const createdProgram = await request('/api/programs', 'POST', {
  facultyId: createdFacultyId,
  name: 'Smoke Program',
  durationYears: 4
});
if (createdProgram.status !== 201 || !createdProgram.json?.id) throw new Error(`Create program failed: ${createdProgram.status}`);
const createdProgramId = Number(createdProgram.json.id);

const updatedProgram = await request(`/api/programs/${createdProgramId}`, 'PUT', {
  name: 'Smoke Program Updated',
  durationYears: 5
});
if (updatedProgram.status !== 200 || updatedProgram.json?.durationYears !== 5) {
  throw new Error(`Update program failed: ${updatedProgram.status}`);
}

const courseCodeA = `SMK${Date.now()}A`;
const courseA = await request('/api/program-courses', 'POST', {
  programId: createdProgramId,
  code: courseCodeA,
  name: 'Smoke Course 101',
  yearNo: 1,
  semesterNo: 1,
  credits: 3,
  prerequisiteCourseIds: []
});
if (courseA.status !== 201 || !courseA.json?.id) throw new Error(`Create course A failed: ${courseA.status}`);
const courseAId = Number(courseA.json.id);

const updatedCourseA = await request(`/api/program-courses/${courseAId}`, 'PUT', {
  code: courseCodeA,
  name: 'Smoke Course 101 Updated',
  yearNo: 1,
  semesterNo: 1,
  credits: 4,
  prerequisiteCourseIds: []
});
if (updatedCourseA.status !== 200 || updatedCourseA.json?.credits !== 4) {
  throw new Error(`Update program course failed: ${updatedCourseA.status}`);
}

const courseB = await request('/api/program-courses', 'POST', {
  programId: createdProgramId,
  code: `SMK${Date.now()}B`,
  name: 'Smoke Course 102',
  yearNo: 1,
  semesterNo: 2,
  credits: 3,
  prerequisiteCourseIds: [courseAId]
});
if (courseB.status !== 201 || !courseB.json?.id) throw new Error(`Create course B failed: ${courseB.status}`);
const courseBId = Number(courseB.json.id);

const prerequisites = await request(`/api/program-courses/${courseBId}/prerequisites`);
if (prerequisites.status !== 200 || !prerequisites.json?.prerequisiteCourseIds?.map(Number).includes(courseAId)) {
  throw new Error(`Prerequisite fetch failed: ${prerequisites.status}`);
}

const deletedCourseB = await request(`/api/program-courses/${courseBId}`, 'DELETE');
if (deletedCourseB.status !== 200) throw new Error(`Delete course B failed: ${deletedCourseB.status}`);

const deletedCourseA = await request(`/api/program-courses/${courseAId}`, 'DELETE');
if (deletedCourseA.status !== 200) throw new Error(`Delete course A failed: ${deletedCourseA.status}`);

const deletedProgram = await request(`/api/programs/${createdProgramId}`, 'DELETE');
if (deletedProgram.status !== 200) throw new Error(`Delete program failed: ${deletedProgram.status}`);

const deletedFaculty = await request(`/api/faculties/${createdFacultyId}`, 'DELETE');
if (deletedFaculty.status !== 200) throw new Error(`Delete faculty failed: ${deletedFaculty.status}`);

console.log('Canonical CRUD smoke flow passed.');
