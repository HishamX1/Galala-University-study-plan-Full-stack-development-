import assert from 'node:assert/strict';
import { withPostgresClient } from '../backend/src/db/client.js';
import { restoreRecycleItem, permanentlyDeleteRecycleItem } from '../backend/src/services/adminOpsService.js';

const suffix = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const facultyName = `Recycle Test Faculty ${suffix}`;
const programName = `Recycle Test Program ${suffix}`;
const courseName = `Recycle Test Course ${suffix}`;
const sharedCourseName = `Recycle Shared Course ${suffix}`;

let ids;

async function removeStaleAttempt(client) {
  await client.query("DELETE FROM faculties WHERE name = 'Recycle Test Faculty 1791146783351_eb83ve'");
  await client.query("DELETE FROM courses WHERE name IN ('Recycle Test Course 1791146783351_eb83ve', 'Recycle Shared Course 1791146783351_eb83ve')");
}

async function setup(client) {
  const faculty = await client.query('INSERT INTO faculties (name) VALUES ($1) RETURNING id', [facultyName]);
  const program = await client.query('INSERT INTO programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [faculty.rows[0].id, programName]);
  const course = await client.query('INSERT INTO courses (name) VALUES ($1) RETURNING id', [courseName]);
  const sharedCourse = await client.query('INSERT INTO courses (name) VALUES ($1) RETURNING id', [sharedCourseName]);
  const first = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 1, 1) RETURNING id`, [program.rows[0].id, course.rows[0].id, `RT-${suffix}`]);
  const secondProgram = await client.query('INSERT INTO programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [faculty.rows[0].id, `${programName} 2`]);
  const sharedOne = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 1, 2) RETURNING id`, [program.rows[0].id, sharedCourse.rows[0].id, `RS-${suffix}`]);
  const sharedTwo = await client.query(`INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no)
    VALUES ($1, $2, $3, 2, 1) RETURNING id`, [secondProgram.rows[0].id, sharedCourse.rows[0].id, `RU-${suffix}`]);
  const relation = await client.query('INSERT INTO course_prerequisites (course_id, prerequisite_course_id, visible_to_students) VALUES ($1, $2, false) RETURNING id', [first.rows[0].id, sharedOne.rows[0].id]);
  ids = { faculty: faculty.rows[0].id, program: program.rows[0].id, secondProgram: secondProgram.rows[0].id, course: course.rows[0].id, sharedCourse: sharedCourse.rows[0].id, first: first.rows[0].id, sharedOne: sharedOne.rows[0].id, second: sharedTwo.rows[0].id, relation: relation.rows[0].id };
}

async function run() {
  await withPostgresClient(async (client) => {
    await removeStaleAttempt(client);
    await setup(client);
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
    await client.query('UPDATE faculties SET deleted_at = now() WHERE id = $1', [ids.faculty]);
    await client.query('UPDATE programs SET deleted_at = now() WHERE id IN ($1, $2)', [ids.program, ids.secondProgram]);
    await client.query('UPDATE program_courses SET deleted_at = now() WHERE id IN ($1, $2)', [ids.first, ids.second]);
    await client.query('UPDATE course_prerequisites SET deleted_at = now(), visible_to_students = false WHERE id = $1', [ids.relation]);
  });

  assert.equal(await restoreRecycleItem('faculty', ids.faculty), true);
  await withPostgresClient(async (client) => {
    const restored = await client.query('SELECT deleted_at FROM faculties WHERE id = $1', [ids.faculty]);
    const dependents = await client.query('SELECT deleted_at FROM programs WHERE id IN ($1, $2)', [ids.program, ids.secondProgram]);
    const relations = await client.query('SELECT deleted_at, visible_to_students FROM course_prerequisites WHERE id = $1', [ids.relation]);
    assert.equal(restored.rows[0].deleted_at, null);
    assert.ok(dependents.rows.every((row) => row.deleted_at === null));
    assert.equal(relations.rows[0].deleted_at, null);
    assert.equal(relations.rows[0].visible_to_students, false);
    await client.query('UPDATE program_courses SET deleted_at = now() WHERE id = $1', [ids.sharedOne]);
  });

  assert.equal(await permanentlyDeleteRecycleItem('course', ids.sharedOne), true);
  await withPostgresClient(async (client) => {
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
  await withPostgresClient(async (client) => {
    if (!ids) return;
    await client.query('DELETE FROM admin_audit_logs WHERE entity_id = ANY($1::bigint[])', [[ids.faculty, ids.program, ids.secondProgram, ids.first, ids.sharedOne, ids.second, ids.relation]]);
    await client.query('DELETE FROM course_prerequisites WHERE id = $1', [ids.relation]);
    await client.query('DELETE FROM program_courses WHERE id IN ($1, $2)', [ids.first, ids.second]);
    await client.query('DELETE FROM programs WHERE id IN ($1, $2)', [ids.program, ids.secondProgram]);
    await client.query('DELETE FROM faculties WHERE id = $1', [ids.faculty]);
    await client.query('DELETE FROM courses WHERE id IN ($1, $2)', [ids.course, ids.sharedCourse]);
  });
}
