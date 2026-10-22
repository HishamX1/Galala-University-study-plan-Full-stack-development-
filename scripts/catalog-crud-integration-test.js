import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const {
  addPrerequisiteRelation,
  createFaculty,
  createProgram,
  createProgramCourse,
  deleteFaculty,
  deletePrerequisiteRelation,
  deleteProgram,
  deleteProgramCourse,
  getFaculties,
  getPrerequisites,
  getProgramCourses,
  getPrograms,
  updateFaculty,
  updatePrerequisiteVisibility,
  updatePrerequisites,
  updateProgram,
  updateProgramCourse
} = await import('../backend/src/services/catalogService.js');
const { createUser } = await import('../backend/src/services/authService.js');

const suffix = crypto.randomUUID().replaceAll('-', '').toUpperCase();
const facultyName = `AR1 Faculty ${suffix}`;
const updatedFacultyName = `AR1 Faculty Updated ${suffix}`;
const programName = `AR1 Program ${suffix}`;
const updatedProgramName = `AR1 Program Updated ${suffix}`;
const courseNames = [`AR1 Course A ${suffix}`, `AR1 Course B ${suffix}`, `AR1 Course C ${suffix}`];
const courseCodes = [`AR1A${suffix}`, `AR1B${suffix}`, `AR1C${suffix}`];
const failedCourseName = `AR1 Course Failed Create ${suffix}`;
const failedCourseCode = `AR1X${suffix}`;
const fixture = { facultyId: null, programId: null, programCourseIds: [], courseIds: [], relationIds: [], actorId: null };
const triggerNames = [];
const functionNames = [];

async function rows(sql, params = []) {
  return (await query(sql, params)).rows;
}

async function count(sql, params = []) {
  return Number((await query(sql, params)).rows[0].count);
}

async function installAuditFailure(action, entityId) {
  const token = `${suffix.toLowerCase()}_${triggerNames.length + 1}`;
  const triggerName = `ar1_catalog_audit_trigger_${token}`;
  const functionName = `ar1_catalog_audit_failure_${token}`;
  functionNames.push(functionName);
  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $phase1$
    BEGIN
      IF NEW.action = '${action}' AND NEW.entity_id = ${Number(entityId)} THEN
        RAISE EXCEPTION 'injected catalog audit failure';
      END IF;
      RETURN NEW;
    END;
  $phase1$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
  triggerNames.push(triggerName);
}

try {
  const actor = await createUser({ name: `Audit Actor ${suffix}`, email: `audit-${suffix.toLowerCase()}@example.invalid`, password: 'AuditActorPass!2026', role: 'super_admin', status: 'active' });
  fixture.actorId = actor.id;
  const faculty = await createFaculty({ name: facultyName }, { ...actor, requestId: `catalog-${suffix.slice(0, 24)}` });
  assert.ok(faculty?.id);
  assert.ok(faculty.version?.updatedAt);
  fixture.facultyId = faculty.id;
  assert.equal(faculty.name, facultyName);
  const actorAudit = (await rows("SELECT actor_id,actor_role,actor_name,category,request_id,target_id FROM admin_audit_logs WHERE entity='faculty' AND entity_id=$1 AND action='Created Faculty'", [faculty.id]))[0];
  assert.deepEqual(actorAudit, { actor_id: actor.id, actor_role: 'super_admin', actor_name: actor.name, category: 'catalog', request_id: `catalog-${suffix.slice(0, 24)}`, target_id: String(faculty.id) },
    'catalog audit entries retain authenticated actor, category, target, and request context');
  assert.ok((await getFaculties()).some((item) => item.id === faculty.id));

  const staleFacultyVersion = faculty.version;
  const updatedFaculty = await updateFaculty(faculty.id, { name: updatedFacultyName, expectedVersion: staleFacultyVersion });
  assert.equal(updatedFaculty.name, updatedFacultyName);
  assert.ok(updatedFaculty.version.updatedAt);
  const parallelFacultyWrites = await Promise.allSettled([
    updateFaculty(faculty.id, { name: `${updatedFacultyName} A`, expectedVersion: updatedFaculty.version }),
    updateFaculty(faculty.id, { name: `${updatedFacultyName} B`, expectedVersion: updatedFaculty.version })
  ]);
  const winningFacultyWrite = parallelFacultyWrites.filter((result) => result.status === 'fulfilled');
  const rejectedFacultyWrite = parallelFacultyWrites.filter((result) => result.status === 'rejected');
  assert.equal(winningFacultyWrite.length, 1, 'only one simultaneous write with the same faculty revision may commit');
  assert.equal(rejectedFacultyWrite.length, 1);
  assert.equal(rejectedFacultyWrite[0].reason.code, 'STALE_WRITE');
  const winningFacultyName = winningFacultyWrite[0].value.name;
  await assert.rejects(() => deleteFaculty(faculty.id, staleFacultyVersion),
    (error) => error.code === 'STALE_WRITE', 'a stale faculty delete must not soft-delete the current record');
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE id = $1 AND deleted_at IS NULL', [faculty.id]), 1);
  await assert.rejects(() => updateFaculty(faculty.id, { name: facultyName, expectedVersion: staleFacultyVersion }),
    (error) => error.code === 'STALE_WRITE', 'faculty updates reject a stale revision');
  assert.equal((await getFaculties()).find((item) => item.id === faculty.id).name, winningFacultyName,
    'a rejected stale faculty update must leave the committed value unchanged');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Updated Faculty' AND entity_id = $1", [faculty.id]), 2,
    'the rejected concurrent and stale writes must not create audit rows');

  const program = await createProgram({ facultyId: faculty.id, name: programName, durationYears: 4 });
  assert.ok(program?.id);
  fixture.programId = program.id;
  const originalProgramVersion = program.version;
  const updatedProgram = await updateProgram(program.id, { name: updatedProgramName, expectedVersion: originalProgramVersion });
  assert.equal(updatedProgram.name, updatedProgramName);
  assert.ok(updatedProgram.version.updatedAt);
  await assert.rejects(() => deleteProgram(program.id, originalProgramVersion),
    (error) => error.code === 'STALE_WRITE', 'a stale program delete must preserve its active hierarchy');
  assert.ok((await getPrograms(faculty.id)).some((item) => item.id === program.id && item.name === updatedProgramName));

  await assert.rejects(() => createProgramCourse({
    programId: program.id, name: failedCourseName, code: failedCourseCode, yearNo: 1, semesterNo: 3,
    credits: 1, isRequired: false, description: null, prerequisiteCourseIds: [Number.MAX_SAFE_INTEGER]
  }), (error) => error.code === '23503');
  assert.equal(await count('SELECT count(*)::int AS count FROM courses WHERE name = $1', [failedCourseName]), 0,
    'failed multi-write course creation must roll back the shared course insert');
  assert.equal(await count('SELECT count(*)::int AS count FROM program_courses WHERE code = $1', [failedCourseCode]), 0,
    'failed multi-write course creation must roll back its program-course insert');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity = 'course' AND new_values->>'code' = $1", [failedCourseCode]), 0,
    'failed course creation must not write an audit event');

  const first = await createProgramCourse({
    programId: program.id, name: courseNames[0], code: courseCodes[0], yearNo: 1, semesterNo: 1,
    credits: 3, isRequired: true, description: 'fixture A', prerequisiteCourseIds: []
  });
  const second = await createProgramCourse({
    programId: program.id, name: courseNames[1], code: courseCodes[1], yearNo: 1, semesterNo: 2,
    credits: 3, isRequired: true, description: 'fixture B', prerequisiteCourseIds: [first.id]
  });
  const third = await createProgramCourse({
    programId: program.id, name: courseNames[2], code: courseCodes[2], yearNo: 2, semesterNo: 1,
    credits: 2, isRequired: false, description: null, prerequisiteCourseIds: []
  });
  for (const course of [first, second, third]) {
    fixture.programCourseIds.push(course.id);
    fixture.courseIds.push(course.courseId);
    assert.ok(course.id && course.courseId);
    assert.ok(course.version?.updatedAt && course.version?.relatedUpdatedAt);
  }
  assert.deepEqual(await getPrerequisites(second.id), [first.id]);
  const listedProgramCourses = await getProgramCourses({ programId: program.id });
  assert.ok([first.id, second.id, third.id].every((id) => listedProgramCourses.some((course) => course.id === id)));

  const relation = await addPrerequisiteRelation(third.id, first.id);
  fixture.relationIds.push(relation.id);
  assert.equal(relation.courseId, third.id);
  assert.equal(await addPrerequisiteRelation(third.id, first.id), null, 'duplicate prerequisite keeps the established null result');
  const thirdAfterRelationAdd = (await getProgramCourses({ programId: program.id }, { includeHidden: true })).find((course) => course.id === third.id);
  assert.equal(await updatePrerequisiteVisibility(third.id, first.id, false, thirdAfterRelationAdd.version.updatedAt), true);
  await assert.rejects(() => updatePrerequisiteVisibility(third.id, first.id, true, thirdAfterRelationAdd.version.updatedAt),
    (error) => error.code === 'STALE_WRITE', 'relation changes reject a stale owning-course revision');
  const hiddenCatalog = await getProgramCourses({ programId: program.id }, { includeHidden: true });
  assert.equal(hiddenCatalog.find((course) => course.id === third.id).prerequisiteRelations[0].visibleToStudents, false);
  assert.equal(await updatePrerequisiteVisibility(third.id, first.id, true), true);
  assert.equal(await deletePrerequisiteRelation(third.id, first.id), true);
  assert.deepEqual(await getPrerequisites(third.id), []);

  const updatedSecond = await updateProgramCourse(second.id, {
    name: `AR1 Course B Updated ${suffix}`,
    code: `AR1BU${suffix}`,
    description: 'updated fixture B',
    credits: 4,
    prerequisiteCourseIds: [first.id, third.id],
    expectedVersion: second.version
  });
  assert.equal(updatedSecond.name, `AR1 Course B Updated ${suffix}`);
  assert.deepEqual(new Set(await getPrerequisites(second.id)), new Set([first.id, third.id]));

  await assert.rejects(() => updateProgramCourse(second.id, {
    name: `AR1 Course B Related-Stale ${suffix}`,
    expectedVersion: { updatedAt: updatedSecond.version.updatedAt, relatedUpdatedAt: second.version.relatedUpdatedAt }
  }), (error) => error.code === 'STALE_WRITE', 'course updates also reject a stale shared-course revision');
  const unchangedAfterRelatedStale = (await getProgramCourses({ programId: program.id })).find((course) => course.id === second.id);
  assert.equal(unchangedAfterRelatedStale.name, `AR1 Course B Updated ${suffix}`);
  assert.equal(unchangedAfterRelatedStale.version.updatedAt, updatedSecond.version.updatedAt,
    'the program-course revision bump must roll back when the related shared-course revision is stale');

  await assert.rejects(() => updateProgramCourse(second.id, {
    name: `AR1 Course B Stale ${suffix}`, code: `AR1BS${suffix}`, description: 'must not overwrite',
    expectedVersion: second.version
  }), (error) => error.code === 'STALE_WRITE', 'course updates reject stale row revisions');
  const unchangedAfterStaleCourse = (await rows(`SELECT pc.code,c.name,c.description
    FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.id=$1`, [second.id]))[0];
  assert.equal(unchangedAfterStaleCourse.code, `AR1BU${suffix}`);
  assert.equal(unchangedAfterStaleCourse.name, `AR1 Course B Updated ${suffix}`);
  assert.equal(unchangedAfterStaleCourse.description, 'updated fixture B');
  await assert.rejects(() => deleteProgramCourse(second.id, second.version),
    (error) => error.code === 'STALE_WRITE', 'a stale course delete must roll back its relation soft-deletes');
  assert.deepEqual(new Set(await getPrerequisites(second.id)), new Set([first.id, third.id]));

  await assert.rejects(() => updatePrerequisites(second.id, [Number.MAX_SAFE_INTEGER]), (error) => error.code === '23503');
  assert.deepEqual(new Set(await getPrerequisites(second.id)), new Set([first.id, third.id]),
    'failed prerequisite replacement must restore the links deleted earlier in the same transaction');

  await installAuditFailure('Updated Course', second.id);
  await assert.rejects(() => updateProgramCourse(second.id, {
    name: `AR1 Course B Failed Update ${suffix}`,
    code: `AR1BF${suffix}`,
    description: 'must roll back',
    prerequisiteCourseIds: [first.id]
  }), /injected catalog audit failure/);
  await query(`DROP TRIGGER "${triggerNames.at(-1)}" ON public.admin_audit_logs`);
  triggerNames.pop();
  await query(`DROP FUNCTION public."${functionNames.at(-1)}"()`);
  functionNames.pop();
  const unchangedCourse = (await rows(`SELECT pc.code, c.name, c.description
    FROM program_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.id = $1`, [second.id]))[0];
  assert.equal(unchangedCourse.code, `AR1BU${suffix}`);
  assert.equal(unchangedCourse.name, `AR1 Course B Updated ${suffix}`);
  assert.equal(unchangedCourse.description, 'updated fixture B');
  assert.deepEqual(new Set(await getPrerequisites(second.id)), new Set([first.id, third.id]));
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Updated Course' AND entity_id = $1", [second.id]), 1,
    'failed update must not append a second update audit');

  await installAuditFailure('Deleted Faculty', faculty.id);
  await assert.rejects(() => deleteFaculty(faculty.id), /injected catalog audit failure/);
  await query(`DROP TRIGGER "${triggerNames.at(-1)}" ON public.admin_audit_logs`);
  triggerNames.pop();
  await query(`DROP FUNCTION public."${functionNames.at(-1)}"()`);
  functionNames.pop();
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE id = $1 AND deleted_at IS NULL', [faculty.id]), 1);
  assert.equal(await count('SELECT count(*)::int AS count FROM programs WHERE id = $1 AND deleted_at IS NULL', [program.id]), 1);
  assert.equal(await count('SELECT count(*)::int AS count FROM program_courses WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL', [fixture.programCourseIds]), 3);
  assert.equal(await count('SELECT count(*)::int AS count FROM course_prerequisites WHERE course_id = $1 AND prerequisite_course_id = $2 AND deleted_at IS NULL', [second.id, first.id]), 1);
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE action = 'Deleted Faculty' AND entity_id = $1", [faculty.id]), 0);

  assert.equal(await deleteProgramCourse(third.id), true);
  assert.equal(await count('SELECT count(*)::int AS count FROM program_courses WHERE id = $1 AND deleted_at IS NOT NULL', [third.id]), 1);
  assert.equal(await deleteProgram(program.id), true);
  assert.equal(await count('SELECT count(*)::int AS count FROM programs WHERE id = $1 AND deleted_at IS NOT NULL', [program.id]), 1);
  assert.equal(await count('SELECT count(*)::int AS count FROM program_courses WHERE id = ANY($1::bigint[]) AND deleted_at IS NOT NULL', [fixture.programCourseIds]), 3);
  assert.equal(await deleteFaculty(faculty.id), true);
  assert.equal(await count('SELECT count(*)::int AS count FROM faculties WHERE id = $1 AND deleted_at IS NOT NULL', [faculty.id]), 1);

  console.log('Catalog CRUD, prerequisite rollback, and shared-executor transaction integration tests passed.');
} finally {
  for (const triggerName of triggerNames) {
    await query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.admin_audit_logs`).catch(() => {});
  }
  for (const functionName of functionNames) {
    await query(`DROP FUNCTION IF EXISTS public."${functionName}"()`).catch(() => {});
  }
  if (fixture.facultyId || fixture.programId || fixture.programCourseIds.length || fixture.courseIds.length) {
    const programCourseRows = await query(`SELECT id, course_id FROM program_courses
      WHERE id = ANY($1::bigint[]) OR code = ANY($2::text[])`, [fixture.programCourseIds, [...courseCodes, failedCourseCode]]).then((result) => result.rows).catch(() => []);
    const programCourseIds = [...new Set([...fixture.programCourseIds, ...programCourseRows.map((row) => Number(row.id))])];
    const courseRows = await query('SELECT id FROM courses WHERE id = ANY($1::bigint[]) OR name = ANY($2::text[])', [fixture.courseIds, [...courseNames, failedCourseName]]).then((result) => result.rows).catch(() => []);
    const courseIds = [...new Set([...fixture.courseIds, ...programCourseRows.map((row) => Number(row.course_id)), ...courseRows.map((row) => Number(row.id))])];
    const facultyIds = fixture.facultyId ? [fixture.facultyId] : [];
    const programIds = fixture.programId ? [fixture.programId] : [];
    await query(`DELETE FROM admin_audit_logs
      WHERE (entity = 'faculty' AND entity_id = ANY($1::bigint[]))
         OR (entity = 'program' AND entity_id = ANY($2::bigint[]))
         OR (entity = 'course' AND entity_id = ANY($3::bigint[]))
         OR (entity = 'relation' AND entity_id = ANY($4::bigint[]))`, [facultyIds, programIds, programCourseIds, fixture.relationIds]).catch(() => {});
    if (fixture.actorId) await query('DELETE FROM admin_audit_logs WHERE actor_id=$1', [fixture.actorId]).catch(() => {});
    await query('DELETE FROM course_prerequisites WHERE course_id = ANY($1::bigint[]) OR prerequisite_course_id = ANY($1::bigint[])', [programCourseIds]).catch(() => {});
    await query('DELETE FROM program_courses WHERE id = ANY($1::bigint[])', [programCourseIds]).catch(() => {});
    await query('DELETE FROM programs WHERE id = ANY($1::bigint[])', [programIds]).catch(() => {});
    await query('DELETE FROM faculties WHERE id = ANY($1::bigint[])', [facultyIds]).catch(() => {});
    await query('DELETE FROM courses WHERE id = ANY($1::bigint[])', [courseIds]).catch(() => {});
  }
  if (fixture.actorId) await query('DELETE FROM public.app_users WHERE id=$1', [fixture.actorId]).catch(() => {});
  await closePool();
}
