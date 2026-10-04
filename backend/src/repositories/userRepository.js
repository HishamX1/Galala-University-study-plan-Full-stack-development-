export async function findActiveUserByIdentifier(identifier, executor) {
  return (await executor.query('SELECT * FROM public.app_users WHERE (lower(email)=lower($1) OR student_id=$1) AND status=$2 LIMIT 1', [identifier, 'active'])).rows[0] || null;
}

export async function findActiveUserById(id, executor) {
  return (await executor.query('SELECT * FROM public.app_users WHERE id=$1 AND status=$2', [id, 'active'])).rows[0] || null;
}

export async function listUsers(executor) {
  return (await executor.query('SELECT id,name,email,student_id,role,status,created_at,updated_at FROM public.app_users ORDER BY created_at DESC')).rows;
}

export async function countUsers(executor) {
  return Number((await executor.query('SELECT count(*)::int AS count FROM public.app_users')).rows[0].count);
}

export async function countSuperAdmins(executor) {
  return Number((await executor.query("SELECT count(*)::int AS count FROM public.app_users WHERE role='super_admin'")).rows[0].count);
}

export async function insertUser(input, passwordHash, username, executor) {
  return (await executor.query('INSERT INTO public.app_users (name,email,username,student_id,password_hash,role,status,password_changed_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *', [input.name, input.email.toLowerCase(), username, input.studentId || null, passwordHash, input.role, input.status || 'active'])).rows[0] || null;
}

export async function updateManagedUser(id, input, passwordHash, executor) {
  const sets = ['name=$2', 'email=$3', 'student_id=$4', 'role=$5', 'status=$6', 'updated_at=now()'];
  const values = [id, input.name, input.email.toLowerCase(), input.studentId || null, input.role, input.status];
  if (passwordHash) { sets.push(`password_hash=$${values.length + 1}`); values.push(passwordHash); }
  return (await executor.query(`UPDATE public.app_users SET ${sets.join(', ')} WHERE id=$1 RETURNING id,name,email,student_id,password_hash,role,status,created_at,updated_at`, values)).rows[0] || null;
}

export async function updateProfile(id, changes, executor) {
  const sets = ['updated_at=now()'];
  const values = [id];
  for (const [column, value] of changes) {
    if (column === 'avatar_data_null') { sets.push('avatar_data=NULL'); continue; }
    sets.push(`${column}=$${values.length + 1}`);
    values.push(value);
  }
  return (await executor.query(`UPDATE public.app_users SET ${sets.join(', ')} WHERE id=$1 RETURNING *`, values)).rows[0] || null;
}

export async function deleteUser(id, executor) {
  return (await executor.query('DELETE FROM public.app_users WHERE id=$1 RETURNING id,name,email,student_id,role,status', [id])).rows[0] || null;
}

export async function findUserByIdentifier(identifier, executor) {
  return (await executor.query('SELECT id,name,email,student_id,role,status FROM public.app_users WHERE lower(email)=lower($1) OR student_id=$1 LIMIT 1', [identifier])).rows[0] || null;
}

export async function updatePassword(id, passwordHash, executor) {
  return (await executor.query('UPDATE public.app_users SET password_hash=$2,updated_at=now() WHERE id=$1 RETURNING id,name,email,student_id,password_hash,role,status,created_at,updated_at', [id, passwordHash])).rows[0] || null;
}
