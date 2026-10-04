export async function programCourseExists(id, executor) { return Boolean((await executor.query('SELECT 1 FROM program_courses WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount); }
export async function programCourseRecordExists(id, executor) { return Boolean((await executor.query('SELECT 1 FROM program_courses WHERE id=$1', [id])).rowCount); }
export async function findActiveProgramCourseDetail(id, executor) { return (await executor.query(`SELECT pc.id,pc.program_id,p.faculty_id,pc.course_id,c.name,pc.code,pc.year_no,pc.semester_no,pc.credits,pc.is_required,c.description FROM program_courses pc JOIN courses c ON c.id=pc.course_id JOIN programs p ON p.id=pc.program_id WHERE pc.id=$1 AND pc.deleted_at IS NULL AND p.deleted_at IS NULL AND c.deleted_at IS NULL LIMIT 1`, [id])).rows; }

export async function listActiveProgramCourses(filters, executor) {
  const params = [];
  const conditions = [];
  const add = (column, value) => { if (value != null) { params.push(value); conditions.push(`${column}=$${params.length}`); } };
  add('p.faculty_id', filters.facultyId);
  add('pc.program_id', filters.programId);
  add('pc.year_no', filters.yearNo);
  add('pc.semester_no', filters.semesterNo);
  return (await executor.query(`SELECT pc.id,pc.program_id,p.faculty_id,pc.course_id,c.name,pc.code,pc.year_no,pc.semester_no,pc.credits,pc.is_required,c.description
    FROM program_courses pc JOIN courses c ON c.id=pc.course_id JOIN programs p ON p.id=pc.program_id
    WHERE pc.deleted_at IS NULL AND c.deleted_at IS NULL AND p.deleted_at IS NULL ${conditions.length ? `AND ${conditions.join(' AND ')}` : ''}
    ORDER BY pc.program_id,pc.year_no,pc.semester_no,pc.code`, params)).rows;
}
export async function findDuplicateProgramCourse(code, name, excludeId, executor) { return await executor.query(`SELECT 1 FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.deleted_at IS NULL ${excludeId ? 'AND pc.id <> $3' : ''} AND (lower(pc.code)=lower($1) OR lower(c.name)=lower($2)) LIMIT 1`, excludeId ? [code, name, excludeId] : [code, name]); }
export async function insertProgramCourse(data, courseId, executor) { return (await executor.query('INSERT INTO program_courses (program_id,course_id,code,year_no,semester_no,is_required,credits) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [data.programId, courseId, data.code.trim(), data.yearNo, data.semesterNo, data.isRequired ?? true, data.credits])).rows[0]; }
export async function findProgramCourseWithCourse(id, executor) { return await executor.query('SELECT pc.*,c.name,c.description FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.id=$1 AND pc.deleted_at IS NULL', [id]); }
export async function updateProgramCourseRow(id, data, executor) { await executor.query('UPDATE program_courses SET program_id=COALESCE($2,program_id),code=COALESCE($3,code),year_no=COALESCE($4,year_no),semester_no=COALESCE($5,semester_no),is_required=COALESCE($6,is_required),credits=COALESCE($7,credits) WHERE id=$1', [id,data.programId,data.code?.trim(),data.yearNo,data.semesterNo,data.isRequired,data.credits]); }
export async function softDeleteProgramCourses(ids, reason, executor) { await executor.query("UPDATE program_courses SET deleted_at=now(),deleted_by='Admin',delete_reason=$2,updated_at=now() WHERE id=ANY($1::bigint[])", [ids, reason]); }
export async function listActiveProgramCourseSummaries(programId, executor) { return await executor.query('SELECT pc.id,pc.course_id,pc.code,c.name FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.program_id=$1 AND pc.deleted_at IS NULL ORDER BY pc.code', [programId]); }
export async function findActiveProgramCourseSummary(id, executor) { return await executor.query('SELECT pc.id,pc.course_id,pc.code,c.name FROM program_courses pc JOIN courses c ON c.id=pc.course_id WHERE pc.id=$1 AND pc.deleted_at IS NULL', [id]); }
export async function softDeleteProgramCourse(id, executor) { return await executor.query("UPDATE program_courses SET deleted_at=now(),deleted_by='Admin',delete_reason='Admin delete',updated_at=now() WHERE id=$1", [id]); }
