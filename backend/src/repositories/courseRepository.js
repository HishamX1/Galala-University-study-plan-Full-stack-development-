export async function courseExists(id, executor) { return Boolean((await executor.query('SELECT 1 FROM courses WHERE id=$1 AND deleted_at IS NULL', [id])).rowCount); }
export async function upsertCourse(name, description, executor) { return (await executor.query('INSERT INTO courses (name,description) VALUES ($1,$2) ON CONFLICT (name) DO UPDATE SET description=COALESCE(EXCLUDED.description,courses.description),updated_at=now() RETURNING id', [name, description])).rows[0]; }
export async function updateCourse(id, name, description, executor, expectedUpdatedAt) {
  return expectedUpdatedAt
    ? executor.query('UPDATE courses SET name=COALESCE($2,name),description=COALESCE($3,description),updated_at=now() WHERE id=$1 AND updated_at=$4::timestamptz RETURNING id,updated_at', [id, name, description, expectedUpdatedAt])
    : executor.query('UPDATE courses SET name=COALESCE($2,name),description=COALESCE($3,description),updated_at=now() WHERE id=$1 RETURNING id,updated_at', [id, name, description]);
}
