import { query } from '../db/client.js';
export async function listActiveFaculties(executor = { query }) { return (await executor.query('SELECT id, name FROM faculties WHERE deleted_at IS NULL ORDER BY name')).rows; }
export async function facultyExists(id, executor = { query }) { return Boolean((await executor.query('SELECT 1 FROM faculties WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount); }
export async function insertFaculty(name, executor) { return (await executor.query('INSERT INTO faculties (name) VALUES ($1) RETURNING id,name', [name])).rows[0]; }
export async function findActiveFaculty(id, executor) { return await executor.query('SELECT id,name FROM faculties WHERE id=$1 AND deleted_at IS NULL', [id]); }
export async function updateActiveFaculty(id, name, executor) { return await executor.query('UPDATE faculties SET name=COALESCE($2,name),updated_at=now() WHERE id=$1 RETURNING id,name', [id, name]); }
export async function listActiveFacultyProgramCourseIds(id, executor) { return (await executor.query('SELECT pc.id FROM program_courses pc JOIN programs p ON p.id=pc.program_id WHERE p.faculty_id=$1 AND pc.deleted_at IS NULL', [id])).rows; }
export async function softDeleteFaculty(id, executor) { return await executor.query("UPDATE faculties SET deleted_at=now(),deleted_by='Admin',delete_reason='Admin delete',updated_at=now() WHERE id=$1", [id]); }
