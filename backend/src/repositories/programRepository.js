export async function programExists(id, executor) { return Boolean((await executor.query('SELECT 1 FROM programs WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount); }

export async function listActivePrograms(facultyId, executor) {
  return (await executor.query(`SELECT p.id,p.faculty_id,p.name,p.duration_years,to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at
    FROM programs p JOIN faculties f ON f.id=p.faculty_id AND f.deleted_at IS NULL
    WHERE ($1::bigint IS NULL OR p.faculty_id=$1) AND p.deleted_at IS NULL ORDER BY p.name`, [facultyId || null])).rows;
}

export async function insertProgram(data, executor) {
  return (await executor.query(`INSERT INTO programs (faculty_id,name,duration_years) VALUES ($1,$2,$3) RETURNING id,faculty_id,name,duration_years,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`, [data.facultyId, data.name.trim(), data.durationYears])).rows[0] || null;
}

export async function updateActiveProgram(id, data, executor, expectedUpdatedAt) {
  const values = [id, data.facultyId, data.name?.trim(), data.durationYears];
  const condition = expectedUpdatedAt ? (values.push(expectedUpdatedAt), ' AND updated_at=$5::timestamptz') : '';
  return await executor.query(`UPDATE programs SET faculty_id=COALESCE($2,faculty_id),name=COALESCE($3,name),duration_years=COALESCE($4,duration_years),updated_at=now()
    WHERE id=$1 AND deleted_at IS NULL${condition} RETURNING id,faculty_id,name,duration_years,to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at`, values);
}
export async function softDeleteProgramsForFaculty(facultyId, executor) { await executor.query("UPDATE programs SET deleted_at=now(),deleted_by='Admin',delete_reason='Parent faculty deleted',updated_at=now() WHERE faculty_id=$1 AND deleted_at IS NULL", [facultyId]); }
export async function findActiveProgram(id, executor) { return await executor.query('SELECT id,name FROM programs WHERE id=$1 AND deleted_at IS NULL', [id]); }
export async function softDeleteProgram(id, executor, expectedUpdatedAt) {
  return expectedUpdatedAt
    ? executor.query("UPDATE programs SET deleted_at=now(),deleted_by='Admin',delete_reason='Admin delete',updated_at=now() WHERE id=$1 AND deleted_at IS NULL AND updated_at=$2::timestamptz", [id, expectedUpdatedAt])
    : executor.query("UPDATE programs SET deleted_at=now(),deleted_by='Admin',delete_reason='Admin delete',updated_at=now() WHERE id=$1 AND deleted_at IS NULL", [id]);
}
