export const GRADE_SCALE = Object.freeze([
  { grade: 'A+', minimumPercent: 97, exclusiveMinimum: true, points: 4.0 },
  { grade: 'A', minimumPercent: 93, points: 4.0 },
  { grade: 'A-', minimumPercent: 89, points: 3.7 },
  { grade: 'B+', minimumPercent: 84, points: 3.3 },
  { grade: 'B', minimumPercent: 80, points: 3.0 },
  { grade: 'B-', minimumPercent: 76, points: 2.7 },
  { grade: 'C+', minimumPercent: 73, points: 2.3 },
  { grade: 'C', minimumPercent: 70, points: 2.0 },
  { grade: 'C-', minimumPercent: 67, points: 1.7 },
  { grade: 'D+', minimumPercent: 64, points: 1.3 },
  { grade: 'D', minimumPercent: 60, points: 1.0 },
  { grade: 'F', minimumPercent: 0, points: 0.0 }
]);

export const GRADE_POINTS = Object.freeze(Object.fromEntries(GRADE_SCALE.map(({ grade, points }) => [grade, points])));

export function calculateTermGpa(attempts) {
  if (!Array.isArray(attempts) || attempts.length === 0) return { available: false, reason: 'Add course attempts for a term.' };
  const courseIds=attempts.map(attempt=>attempt.programCourseId).filter(id=>id!=null);
  if(new Set(courseIds).size!==courseIds.length) return { available:false, reason:'Term GPA is unavailable because the same course has multiple attempts in this term and the university repeat policy is unconfirmed.' };
  if (attempts.some((attempt) => !Number.isFinite(Number(attempt.credits)) || Number(attempt.credits) <= 0)) {
    return { available: false, reason: 'Term GPA is unavailable because one or more course credit values are missing or zero.' };
  }
  if (attempts.some((attempt) => !Object.hasOwn(GRADE_POINTS, attempt.grade))) return { available: false, reason: 'Term GPA is unavailable because a grade is unmapped.' };
  const credits = attempts.reduce((sum, attempt) => sum + Number(attempt.credits), 0);
  const qualityPoints = attempts.reduce((sum, attempt) => sum + Number(attempt.credits) * GRADE_POINTS[attempt.grade], 0);
  return { available: true, value: Number((qualityPoints / credits).toFixed(2)), attemptedCredits: credits };
}

export function gradePasses(grade, minimumGrade = null) {
  if (!Object.hasOwn(GRADE_POINTS, grade) || grade === 'F') return false;
  return minimumGrade ? GRADE_POINTS[grade] >= GRADE_POINTS[minimumGrade] : true;
}
