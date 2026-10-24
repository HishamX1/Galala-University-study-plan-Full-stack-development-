import assert from 'node:assert/strict';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { withPostgresClient } = await import('../backend/src/db/client.js');
const { restoreRecycleItem, permanentlyDeleteRecycleItem } = await import('../backend/src/services/adminOpsService.js');

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const facultyName = `Recycle Test Faculty ${suffix}`;
const programName = `Recycle Test Program ${suffix}`;
const courseName = `Recycle Test Course ${suffix}`;
const sharedCourseName = `Recycle Shared Course ${suffix}`;

const ids = {};

async function readRevision(executor) {
  return String((await executor.query('SELECT public.get_catalog_revision()::text AS revision')).rows[0].revision);
}

async function setup(client) {
  const faculty = await client.query('INSERT INTO faculties (name) VALUES ($1) RETURNING id', [facultyName]);
  ids.faculty = faculty.rows[0].id;
  const program = await client.query('INSERT INTO programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [faculty.rows[0].id, programName]);
  ids.program = program.rows[0].id;
  const course = await client.query('INSERT INTO courses (name) VALUES ($1) RETURNING id', [courseName]);
  ids.course = course.rows[0].id;
  const sharedCourse = await client.query('INSERT INTO courses (name) VALUES ($1) RETURNING id', [sharedCourseName]);
  ids.sharedCourse = sharedCourse.rows[0].id;
  const first = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 1, 1) RETURNING id`, [program.rows[0].id, course.rows[0].id, `RT-${suffix}`]);
  ids.first = first.rows[0].id;
  const secondProgram = await client.query('INSERT INTO programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [faculty.rows[0].id, `${programName} 2`]);
  ids.secondProgram = secondProgram.rows[0].id;
  const sharedOne = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 1, 2) RETURNING id`, [program.rows[0].id, sharedCourse.rows[0].id, `RS-${suffix}`]);
  ids.sharedOne = sharedOne.rows[0].id;
  const sharedTwo = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 2, 1) RETURNING id`, [secondProgram.rows[0].id, sharedCourse.rows[0].id, `RU-${suffix}`]);
  ids.second = sharedTwo.rows[0].id;
  const relation = await client.query('INSERT INTO course_prerequisites (course_id, prerequisite_course_id, visible_to_students) VALUES ($1, $2, false) RETURNING id', [first.rows[0].id, sharedOne.rows[0].id]);
  ids.relation = relation.rows[0].id;
  assert.equal(await permanentlyDeleteRecycleItem('faculty', ids.faculty), false,
    'permanent deletion must reject active catalog rows');
  const activeFaculty = await client.query('SELECT id FROM faculties WHERE id = $1', [ids.faculty]);
  assert.equal(activeFaculty.rowCount, 1, 'active faculty must remain intact after rejected purge');
}

async function run() {
  await withPostgresClient(async (client) => {
    await setup(client);
    const beforeRollback = await readRevision(client);
    await client.query('BEGIN');
    try {
      await client.query('UPDATE faculties SET deleted_at = now() WHERE id = $1', [ids.faculty]);
      await client.query(`INSERT INTO admin_audit_logs (admin_user, action, entity, entity_id)
        VALUES (NULL, 'Rollback probe', 'faculty', $1)`, [ids.faculty]);
      assert.fail('the invalid audit insert should fail');
    } catch {
      await client.query('ROLLBACK');
    }
    const rolledBack = await client.query('SELECT deleted_at FROM faculties WHERE id = $1', [ids.faculty]);
    assert.equal(rolledBack.rows[0].deleted_at, null, 'failed audit must roll back the mutation');
    assert.equal(await readRevision(client), beforeRollback, 'rolled-back recycle-bin mutation must not publish its catalog revision');
    await client.query('UPDATE faculties SET deleted_at = now() WHERE id = $1', [ids.faculty]);
    await client.query('UPDATE programs SET deleted_at = now() WHERE id IN ($1, $2)', [ids.program, ids.secondProgram]);
    await client.query('UPDATE program_courses SET deleted_at = now() WHERE id IN ($1, $2)', [ids.first, ids.second]);
    await client.query('UPDATE course_prerequisites SET deleted_at = now(), visible_to_students = false WHERE id = $1', [ids.relation]);
  });

  let beforeRestore;
  await withPostgresClient(async (client) => { beforeRestore = await readRevision(client); });
  assert.equal(await restoreRecycleItem('faculty', ids.faculty), true);
  await withPostgresClient(async (client) => {
    assert.ok(BigInt(await readRevision(client)) > BigInt(beforeRestore), 'faculty and dependent restore commits must advance the catalog revision');
    const restored = await client.query('SELECT deleted_at FROM faculties WHERE id = $1', [ids.faculty]);
    const dependents = await client.query('SELECT deleted_at FROM programs WHERE id IN ($1, $2)', [ids.program, ids.secondProgram]);
    const relations = await client.query('SELECT deleted_at, visible_to_students FROM course_prerequisites WHERE id = $1', [ids.relation]);
    assert.equal(restored.rows[0].deleted_at, null);
    assert.ok(dependents.rows.every((row) => row.deleted_at === null));
    assert.equal(relations.rows[0].deleted_at, null);
    assert.equal(relations.rows[0].visible_to_students, false);
    const restoreAudit = await client.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity = 'faculty' AND entity_id = $1 AND action = 'Restored faculty'", [ids.faculty]);
    assert.equal(restoreAudit.rows[0].count, 1, 'restoring a recycle-bin cascade is recorded in the audit log');
    await client.query('UPDATE program_courses SET deleted_at = now() WHERE id = $1', [ids.sharedOne]);
  });

  let beforePurge;
  await withPostgresClient(async (client) => { beforePurge = await readRevision(client); });
  assert.equal(await permanentlyDeleteRecycleItem('course', ids.sharedOne), true);
  await withPostgresClient(async (client) => {
    assert.ok(BigInt(await readRevision(client)) > BigInt(beforePurge), 'permanent recycle-bin deletion must advance the catalog revision');
    const shared = await client.query('SELECT id FROM courses WHERE id = $1', [ids.sharedCourse]);
    assert.equal(shared.rowCount, 1, 'shared course must survive while another program-course references it');
    const audit = await client.query("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity_id = $1 AND action = 'Permanently Deleted course'", [ids.sharedOne]);
    assert.equal(audit.rows[0].count, 1);
    await client.query('UPDATE program_courses SET deleted_at = now() WHERE id = $1', [ids.second]);
  });
  assert.equal(await permanentlyDeleteRecycleItem('course', ids.second), true);
  await withPostgresClient(async (client) => {
    const shared = await client.query('SELECT id FROM courses WHERE id = $1', [ids.sharedCourse]);
    assert.equal(shared.rowCount, 0, 'orphaned shared course must be removed after its final reference');
  });
  console.log('Recycle-bin restore, cascade, permanent-delete, orphan-cleanup, and audit regression test passed.');
}

try {
  await run();
} finally {
  const fixtureIds = Object.values(ids).filter((id) => id !== undefined && id !== null);
  if (fixtureIds.length) await withPostgresClient(async (client) => {
    await client.query(`DELETE FROM admin_audit_logs
      WHERE (entity = 'faculty' AND entity_id = $1 AND action = 'Restored faculty')
        OR (entity = 'course' AND entity_id = ANY($2::bigint[]) AND action = 'Permanently Deleted course')`, [
      ids.faculty ?? null,
      [ids.sharedOne, ids.second].filter((id) => id !== undefined && id !== null)
    ]);
    await client.query('DELETE FROM course_prerequisites WHERE id = ANY($1::bigint[])', [ids.relation ? [ids.relation] : []]);
    await client.query('DELETE FROM program_courses WHERE id = ANY($1::bigint[])', [[ids.first, ids.sharedOne, ids.second].filter(Boolean)]);
    await client.query('DELETE FROM programs WHERE id = ANY($1::bigint[])', [[ids.program, ids.secondProgram].filter(Boolean)]);
    await client.query('DELETE FROM faculties WHERE id = ANY($1::bigint[])', [ids.faculty ? [ids.faculty] : []]);
    await client.query('DELETE FROM courses WHERE id = ANY($1::bigint[])', [[ids.course, ids.sharedCourse].filter(Boolean)]);
  });
}
