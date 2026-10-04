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
