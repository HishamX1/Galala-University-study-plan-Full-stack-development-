import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();
const { closePool, query } = await import('../backend/src/db/client.js');
const { readOwnAcademicProgress, saveOwnAcademicProgress } = await import('../backend/src/services/studentProgressService.js');
const { updatePrerequisiteGroups } = await import('../backend/src/services/catalogService.js');
const { evaluatePrerequisiteGroups } = await import('../backend/src/services/studentProgressService.js');
const suffix=crypto.randomUUID();
const first={id:crypto.randomUUID(),role:'student'};
const second={id:crypto.randomUUID(),role:'student'};
try {
  const integrity=await query(`SELECT count(*)::int AS missing FROM public.course_prerequisites cp
    WHERE cp.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM public.course_prerequisite_group_members m
      JOIN public.course_prerequisite_groups g ON g.id=m.group_id WHERE g.course_id=cp.course_id AND m.prerequisite_course_id=cp.prerequisite_course_id)`);
  assert.equal(integrity.rows[0].missing,0,'preexisting prerequisite links must be backfilled');
  await query(`INSERT INTO public.app_users(id,name,email,username,password_hash,role,status) VALUES($1,'Academic test',$2,$3,'not-used','student','active'),($4,'Academic test 2',$5,$6,'not-used','student','active')`,[first.id,`academic-${suffix}@example.test`,`academic_${suffix.slice(0,10)}`,second.id,`academic2-${suffix}@example.test`,`academic2_${suffix.slice(0,10)}`]);
  const program=(await query('SELECT id FROM public.programs WHERE deleted_at IS NULL ORDER BY id LIMIT 1')).rows[0];
  const course=(await query('SELECT id,credits FROM public.program_courses WHERE program_id=$1 AND deleted_at IS NULL AND credits>0 ORDER BY id LIMIT 1',[program.id])).rows[0];
  assert.ok(program && course,'seeded program and positive-credit course are required');
  const saved=await saveOwnAcademicProgress(first,{programId:Number(program.id),attempts:[{programCourseId:Number(course.id),grade:'B+',academicYear:2026,term:'Fall'}]});
  assert.equal(saved.attempts.length,1);
  assert.equal(saved.termGpa[0].available,true);
  assert.equal((await readOwnAcademicProgress(second)).attempts.length,0,'one student cannot read another student attempts');
  await assert.rejects(()=>saveOwnAcademicProgress({id:first.id,role:'regular_admin'},{programId:Number(program.id),attempts:[]}),/permission/i);
  await assert.rejects(()=>saveOwnAcademicProgress(first,{programId:Number(program.id),attempts:[{programCourseId:999999,grade:'A',academicYear:2026,term:'Fall'}]}));
  assert.equal((await readOwnAcademicProgress(first)).attempts.length,1,'invalid save must preserve the prior record');
  const programCourses=(await query(`SELECT pc.id,pc.program_id FROM public.program_courses pc
    WHERE pc.program_id=$1 AND pc.deleted_at IS NULL ORDER BY pc.year_no,pc.semester_no,pc.id LIMIT 4`,[program.id])).rows;
  assert.ok(programCourses.length>=4,'at least four seeded courses are required for an AND/OR rule round trip');
  const target=programCourses[0];
  const oldRows=(await query(`SELECT g.id,g.group_type,g.label,m.prerequisite_course_id,m.minimum_grade,m.position
    FROM public.course_prerequisite_groups g LEFT JOIN public.course_prerequisite_group_members m ON m.group_id=g.id
    WHERE g.course_id=$1 ORDER BY g.position,g.id,m.position,m.id`,[target.id])).rows;
  const oldRule={mandatoryCourseIds:oldRows.filter(row=>row.group_type==='mandatory'&&row.prerequisite_course_id).map(row=>Number(row.prerequisite_course_id)),alternativeGroups:[...new Map(oldRows.filter(row=>row.group_type==='alternative').map(row=>[row.id,{label:row.label,prerequisiteCourseIds:[]}])).entries()].map(([id,group])=>({...group,prerequisiteCourseIds:oldRows.filter(row=>row.id===id&&row.prerequisite_course_id).map(row=>Number(row.prerequisite_course_id))}))};
  try {
    await updatePrerequisiteGroups(Number(target.id),{mandatoryCourseIds:[Number(programCourses[1].id)],alternativeGroups:[{label:'Disposable integration pathway',prerequisiteCourseIds:[Number(programCourses[2].id),Number(programCourses[3].id)]}]},{id:first.id,role:'super_admin',name:'Integration test'});
    const savedRows=(await query(`SELECT g.course_id,g.id AS group_id,g.group_type,g.label,m.prerequisite_course_id,m.minimum_grade,cp.visible_to_students
      FROM public.course_prerequisite_groups g JOIN public.course_prerequisite_group_members m ON m.group_id=g.id
      JOIN public.course_prerequisites cp ON cp.course_id=g.course_id AND cp.prerequisite_course_id=m.prerequisite_course_id AND cp.deleted_at IS NULL
      WHERE g.course_id=$1 ORDER BY g.position,g.id,m.position,m.id`,[target.id])).rows;
    assert.equal(savedRows.some(row=>row.group_type==='alternative'),true,'alternative group must round-trip to PostgreSQL');
    assert.equal(evaluatePrerequisiteGroups(savedRows,[{programCourseId:Number(programCourses[1].id),grade:'B'},{programCourseId:Number(programCourses[2].id),grade:'C'}])[Number(target.id)].eligible,true,'one completed alternative satisfies its group');
    assert.equal(evaluatePrerequisiteGroups(savedRows,[{programCourseId:Number(programCourses[1].id),grade:'B'}])[Number(target.id)].eligible,false,'an unmet alternative group remains blocking');
    await assert.rejects(()=>updatePrerequisiteGroups(Number(target.id),{mandatoryCourseIds:[Number(target.id)],alternativeGroups:[]},{id:first.id,role:'super_admin'}));
  } finally {
    await updatePrerequisiteGroups(Number(target.id),oldRule,{id:first.id,role:'super_admin',name:'Integration test'});
  }
  await query('DELETE FROM public.app_users WHERE id=ANY($1::uuid[])',[[first.id,second.id]]);
  console.log('Academic progress PostgreSQL integration tests passed.');
} finally {
  await query('DELETE FROM public.app_users WHERE id=ANY($1::uuid[])',[[first.id,second.id]]).catch(()=>{});
  await closePool();
}
