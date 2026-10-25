import { query, withPostgresClient } from '../db/client.js';
import { getStudentProgress, listProgramCourseCredits, listProgramPrerequisiteGroups, saveStudentAttempts, upsertStudentAcademicProfile } from '../repositories/studentProgressRepository.js';
import { calculateTermGpa, gradePasses } from '../academic/gradeScale.js';
import { ValidationError, AuthorizationError } from '../utils/errors.js';

function ensureStudent(user) {
  if (user?.role !== 'student') throw new AuthorizationError();
}

function validatePayload(body) {
  if (!body || !Number.isInteger(body.programId) || body.programId <= 0 || !Array.isArray(body.attempts) || body.attempts.length > 500) {
    throw new ValidationError('Invalid academic progress payload.');
  }
  const seen = new Set();
  for (const attempt of body.attempts) {
    if (!attempt || (attempt.id !== undefined && !/^[0-9a-f-]{36}$/i.test(attempt.id))
      || !Number.isInteger(attempt.programCourseId) || attempt.programCourseId <= 0
      || !['A+','A','A-','B+','B','B-','C+','C','C-','D+','D','F'].includes(attempt.grade)
      || !Number.isInteger(attempt.academicYear) || attempt.academicYear < 2000 || attempt.academicYear > 2200
      || typeof attempt.term !== 'string' || attempt.term.trim().length < 1 || attempt.term.trim().length > 40) {
      throw new ValidationError('Invalid course attempt.');
    }
    if (attempt.id && seen.has(attempt.id)) throw new ValidationError('Duplicate course attempt id.');
    if (attempt.id) seen.add(attempt.id);
  }
}

export async function readOwnAcademicProgress(user, requestedProgramId = null) {
  ensureStudent(user);
  const stored = await getStudentProgress({ query }, user.id);
  const requested = requestedProgramId == null ? null : Number(requestedProgramId);
  const programId = requested || Number(stored.profile?.program_id) || 0;
  const selectedProgram = requested ? (await query('SELECT id,name FROM public.programs WHERE id=$1 AND deleted_at IS NULL', [requested])).rows[0] : stored.profile;
  if (requested && !selectedProgram) throw new ValidationError('Select an active program.');
  const courses = programId ? (await listProgramCourseCredits({ query }, programId)).rows : [];
  const attempts = stored.attempts.map((item) => ({
    id: item.id, programId: Number(item.program_id), programCourseId: Number(item.program_course_id),
    code: item.code, courseName: item.course_name, credits: Number(item.credits), grade: item.grade,
    academicYear: Number(item.academic_year), term: item.term
  }));
  const terms = new Map();
  for (const attempt of attempts.filter((item) => item.programId === programId)) {
    const key = `${attempt.academicYear}:${attempt.term}`;
    if (!terms.has(key)) terms.set(key, []);
    terms.get(key).push(attempt);
  }
  const allGroups = programId ? await listProgramPrerequisiteGroups({ query },programId) : [];
  const evaluated = evaluatePrerequisiteGroups(allGroups,attempts.filter((item)=>item.programId===programId));
  const eligibility=Object.fromEntries(courses.map(course=>{
    const result=evaluated[Number(course.id)] || {eligible:true,groups:[]};
    const blockers=(allGroups.filter(row=>Number(row.course_id)===Number(course.id))).some(row=>row.visible_to_students===false);
    const status=result.eligible?'eligible':result.uncertain?'unknown':'blocked';
    const reason=result.eligible?null:result.uncertain?'Eligibility cannot be determined because this prerequisite has multiple attempts and the repeat policy is not confirmed.':blockers?'One or more requirements are incomplete; some course details are hidden.':'Complete the listed prerequisite requirement groups.';
    const explanation=result.groups.map(group=>{
      const visibleMembers=group.members.filter(member=>member.visible).map(member=>({...member,code:courses.find(item=>Number(item.id)===member.id)?.code||'Course'}));
      return {label:group.label,type:group.type,satisfied:group.satisfied,passed:visibleMembers.filter(member=>member.passed).map(member=>member.code),remaining:visibleMembers.filter(member=>!member.passed).map(member=>member.code)};
    });
    return [Number(course.id),{eligible:result.eligible,status,reason,explanation}];
  }));
  return {
    selfReported: true,
    profile: selectedProgram ? { programId, programName: selectedProgram.program_name || selectedProgram.name, verified: false } : null,
    programs: (await query('SELECT id,name FROM public.programs WHERE deleted_at IS NULL ORDER BY name')).rows.map((row) => ({ id: Number(row.id), name: row.name })),
    courses,
    attempts,
    eligibility,
    termGpa: [...terms.entries()].map(([key, termAttempts]) => {
      const result = calculateTermGpa(termAttempts);
      const [academicYear, term] = key.split(':');
      return { academicYear: Number(academicYear), term, ...result };
    }),
    cgpa: { available: false, reason: 'CGPA is hidden until the university confirms how repeated courses and failed attempts count.' },
    gradeScale: 'Student-entered grades use the configured GU planning scale; the record is not verified against university records.'
  };
}

export async function saveOwnAcademicProgress(user, body) {
  ensureStudent(user);
  validatePayload(body);
  return withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const program = await client.query('SELECT id FROM public.programs WHERE id=$1 AND deleted_at IS NULL', [body.programId]);
      if (!program.rowCount) throw new ValidationError('Select an active program.');
      const ids = [...new Set(body.attempts.map((attempt) => attempt.programCourseId))];
      if (ids.length) {
        const valid = await client.query('SELECT id FROM public.program_courses WHERE program_id=$1 AND id=ANY($2::bigint[]) AND deleted_at IS NULL', [body.programId, ids]);
        if (valid.rowCount !== ids.length) throw new ValidationError('Every attempted course must belong to the selected active program.');
      }
      await upsertStudentAcademicProfile(client, user.id, body.programId);
      await saveStudentAttempts(client, user.id, body.programId, body.attempts);
      await client.query('COMMIT');
      return readOwnAcademicProgress(user);
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

export function evaluatePrerequisiteGroups(groups, attempts) {
  const gradeByCourse = new Map();
  for (const attempt of attempts) {
    const id=Number(attempt.programCourseId);
    const list=gradeByCourse.get(id)||[]; list.push(attempt.grade); gradeByCourse.set(id,list);
  }
  const byCourse = new Map();
  for (const row of groups) {
    const item = byCourse.get(Number(row.course_id)) || [];
    item.push(row);
    byCourse.set(Number(row.course_id), item);
  }
  return Object.fromEntries([...byCourse.entries()].map(([courseId, rows]) => {
    const groupsById = new Map();
    for (const row of rows) {
      const group = groupsById.get(Number(row.group_id)) || { type: row.group_type, label: row.label, members: [] };
      const grades=gradeByCourse.get(Number(row.prerequisite_course_id))||[];
      const grade=grades.length===1?grades[0]:null;
      group.members.push({ id: Number(row.prerequisite_course_id), passed: grade ? gradePasses(grade,row.minimum_grade) : false, unknown:grades.length>1, visible:row.visible_to_students!==false, minimumGrade: row.minimum_grade });
      groupsById.set(Number(row.group_id), group);
    }
    const checks = [...groupsById.values()].map((group) => group.type === 'alternative'
      ? { ...group, satisfied: group.members.some((member) => member.passed), uncertain: !group.members.some((member) => member.passed) && group.members.some(member=>member.unknown) }
      : { ...group, satisfied: group.members.every((member) => member.passed), uncertain: group.members.some(member=>member.unknown) });
    const eligible=checks.every((item)=>item.satisfied);
    return [courseId, { eligible, uncertain:!eligible&&checks.some(item=>item.uncertain), groups: checks.map(({ label, type, satisfied, members }) => ({ label, type, satisfied, members })) }];
  }));
}
