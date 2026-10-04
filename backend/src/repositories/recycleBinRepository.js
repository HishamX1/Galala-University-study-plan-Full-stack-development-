export async function listDeletedCatalog(executor) {
  return executor.query(`SELECT 'faculty' AS kind, id, name AS label, deleted_at, deleted_by, delete_reason,
            (SELECT count(*)::int FROM programs p WHERE p.faculty_id = faculties.id) AS dependencies
       FROM faculties WHERE deleted_at IS NOT NULL
     UNION ALL
     SELECT 'program', p.id, p.name, p.deleted_at, p.deleted_by, p.delete_reason,
            (SELECT count(*)::int FROM program_courses pc WHERE pc.program_id = p.id) AS dependencies
       FROM programs p WHERE p.deleted_at IS NOT NULL
     UNION ALL
     SELECT 'course', pc.id, pc.code || ' - ' || c.name, pc.deleted_at, pc.deleted_by, pc.delete_reason,
            (SELECT count(*)::int FROM course_prerequisites cp WHERE cp.course_id = pc.id OR cp.prerequisite_course_id = pc.id) AS dependencies
       FROM program_courses pc JOIN courses c ON c.id = pc.course_id WHERE pc.deleted_at IS NOT NULL
     UNION ALL
     SELECT 'relation', cp.id, cpc.code || ' requires ' || cpp.code, cp.deleted_at, cp.deleted_by, cp.delete_reason, 0
       FROM course_prerequisites cp
       JOIN program_courses cpc ON cpc.id = cp.course_id
       JOIN program_courses cpp ON cpp.id = cp.prerequisite_course_id
      WHERE cp.deleted_at IS NOT NULL
      ORDER BY deleted_at DESC`);
}

const entityTables = Object.freeze({
  faculty: 'faculties',
  program: 'programs',
  course: 'program_courses',
  relation: 'course_prerequisites'
});

function tableFor(kind) {
  const table = entityTables[kind];
  if (!table) throw new Error('INVALID_ENTITY');
  return table;
}

export async function findDeletedEntity(executor, kind, id) {
  return executor.query(`SELECT * FROM ${tableFor(kind)} WHERE id = $1 AND deleted_at IS NOT NULL`, [id]);
}

export async function findEntity(executor, kind, id) {
  return executor.query(`SELECT * FROM ${tableFor(kind)} WHERE id = $1`, [id]);
}

export async function restoreEntity(executor, kind, id) {
  return executor.query(`UPDATE ${tableFor(kind)}
    SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now()
    WHERE id = $1`, [id]);
}

export async function listProgramCourseIdsForFaculty(executor, facultyId) {
  return executor.query(`SELECT pc.id
    FROM program_courses pc
    JOIN programs p ON p.id = pc.program_id
    WHERE p.faculty_id = $1`, [facultyId]);
}

export async function restoreProgramsForFaculty(executor, facultyId) {
  return executor.query('UPDATE programs SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now() WHERE faculty_id = $1', [facultyId]);
}

export async function restoreProgramCoursesForFaculty(executor, facultyId) {
  return executor.query('UPDATE program_courses SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now() WHERE program_id IN (SELECT id FROM programs WHERE faculty_id = $1)', [facultyId]);
}

export async function listProgramCourseIdsForProgram(executor, programId) {
  return executor.query('SELECT id FROM program_courses WHERE program_id = $1', [programId]);
}

export async function restoreProgramCoursesForProgram(executor, programId) {
  return executor.query('UPDATE program_courses SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now() WHERE program_id = $1', [programId]);
}

export async function restorePrerequisitesForCourses(executor, courseIds) {
  return executor.query('UPDATE course_prerequisites SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now() WHERE course_id = ANY($1::bigint[]) OR prerequisite_course_id = ANY($1::bigint[])', [courseIds]);
}

export async function restorePrerequisitesForCourse(executor, courseId) {
  return executor.query('UPDATE course_prerequisites SET deleted_at = NULL, deleted_by = NULL, delete_reason = NULL, updated_at = now() WHERE course_id = $1 OR prerequisite_course_id = $1', [courseId]);
}

export async function deleteEntity(executor, kind, id) {
  return executor.query(`DELETE FROM ${tableFor(kind)} WHERE id = $1`, [id]);
}

export async function deleteProgramCourseAndOrphanCourse(executor, id, courseId) {
  await executor.query('DELETE FROM program_courses WHERE id = $1', [id]);
  return executor.query(`DELETE FROM courses c
    WHERE c.id = $1
      AND NOT EXISTS (SELECT 1 FROM program_courses pc WHERE pc.course_id = c.id)`, [courseId]);
}
