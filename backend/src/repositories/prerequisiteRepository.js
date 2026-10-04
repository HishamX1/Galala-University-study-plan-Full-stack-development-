export async function prerequisiteExists(courseId, prerequisiteCourseId, executor) { return Boolean((await executor.query('SELECT 1 FROM course_prerequisites WHERE course_id=$1 AND prerequisite_course_id=$2 AND deleted_at IS NULL', [courseId, prerequisiteCourseId])).rowCount); }

export async function listActivePrerequisiteRows(courseIds, includeHidden, executor) {
  if (!courseIds.length) return [];
  return (await executor.query(`SELECT id,course_id,prerequisite_course_id,visible_to_students
    FROM course_prerequisites WHERE course_id=ANY($1::bigint[]) AND ($2::boolean=true OR visible_to_students=true) AND deleted_at IS NULL
    ORDER BY course_id,prerequisite_course_id`, [courseIds, includeHidden])).rows;
}

export async function listRelationshipImpactRows(programCourseIds, executor) {
  if (!programCourseIds.length) return [];
  return (await executor.query(`SELECT cp.id,cp.course_id,cp.prerequisite_course_id,cp.visible_to_students,cpc.code AS course_code,cc.name AS course_name,cpp.code AS prerequisite_code,pc.name AS prerequisite_name
    FROM course_prerequisites cp JOIN program_courses cpc ON cpc.id=cp.course_id JOIN courses cc ON cc.id=cpc.course_id JOIN program_courses cpp ON cpp.id=cp.prerequisite_course_id JOIN courses pc ON pc.id=cpp.course_id
    WHERE (cp.course_id=ANY($1::bigint[]) OR cp.prerequisite_course_id=ANY($1::bigint[])) AND cp.deleted_at IS NULL ORDER BY cpc.code,cpp.code`, [programCourseIds])).rows;
}
export async function replacePrerequisiteRows(courseId, prerequisiteIds, executor) { if (prerequisiteIds.length) await executor.query('DELETE FROM course_prerequisites WHERE course_id=$1 AND NOT (prerequisite_course_id=ANY($2::bigint[]))', [courseId, prerequisiteIds]); else await executor.query('DELETE FROM course_prerequisites WHERE course_id=$1', [courseId]); for (const prerequisiteCourseId of prerequisiteIds) await executor.query('INSERT INTO course_prerequisites (course_id,prerequisite_course_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [courseId, prerequisiteCourseId]); }
export async function createPrerequisiteRow(courseId, prerequisiteCourseId, executor) { return (await executor.query('INSERT INTO course_prerequisites (course_id,prerequisite_course_id) VALUES ($1,$2) RETURNING id,course_id,prerequisite_course_id,visible_to_students', [courseId, prerequisiteCourseId])).rows[0]; }
export async function softDeletePrerequisiteRow(courseId, prerequisiteCourseId, executor) { return await executor.query("UPDATE course_prerequisites SET deleted_at=now(),deleted_by='Admin',delete_reason='Admin delete',updated_at=now() WHERE course_id=$1 AND prerequisite_course_id=$2 AND deleted_at IS NULL RETURNING id,course_id,prerequisite_course_id,visible_to_students", [courseId, prerequisiteCourseId]); }
export async function updatePrerequisiteVisibilityRow(courseId, prerequisiteCourseId, visible, executor) { return await executor.query('UPDATE course_prerequisites SET visible_to_students=$3,updated_at=now() WHERE course_id=$1 AND prerequisite_course_id=$2 AND deleted_at IS NULL RETURNING id,course_id,prerequisite_course_id,visible_to_students', [courseId, prerequisiteCourseId, visible]); }
export async function softDeletePrerequisitesForCourses(ids, reason, executor) { await executor.query("UPDATE course_prerequisites SET deleted_at=now(),deleted_by='Admin',delete_reason=$2,updated_at=now() WHERE course_id=ANY($1::bigint[]) OR prerequisite_course_id=ANY($1::bigint[])", [ids, reason]); }
