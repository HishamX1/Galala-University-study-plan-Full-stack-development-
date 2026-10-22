import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { summarizeDashboardCatalog } from '../backend/src/services/adminOpsService.js';

function makeFixture(courseCount = 2500, relationsPerCourse = 4) {
  const programCourses = Array.from({ length: courseCount }, (_, index) => ({
    id: index + 1,
    course_id: Math.floor(index / 2) + 1,
    program_id: Math.floor(index / 250) + 1,
    code: `C${index + 1}`,
    name: `Course ${index + 1}`,
    year_no: Math.floor(index / 50) % 5 + 1,
    semester_no: Math.floor(index / 25) % 2 + 1
  }));
  const relationships = [];
  for (let course = 1; course <= courseCount; course += 1) {
    for (let offset = 1; offset <= relationsPerCourse; offset += 1) {
      const prerequisite = ((course + offset - 2) % courseCount) + 1;
      relationships.push({
        course_id: course,
        prerequisite_course_id: prerequisite,
        visible_to_students: (course + offset) % 5 !== 0
      });
    }
  }
  return {
    faculties: [{ id: 1 }, { id: 2 }],
    programs: Array.from({ length: 10 }, (_, index) => ({ id: index + 1, name: `Program ${index + 1}` })),
    programCourses,
    relationships
  };
}

function summarizeWithRepeatedScans(catalog, deletedRows) {
  const relations = catalog.relationships;
  const programCounts = catalog.programs.map((program) => ({
    id: Number(program.id), name: program.name,
    count: catalog.programCourses.filter((course) => Number(course.program_id) === Number(program.id)).length
  }));
  const prerequisiteCounts = catalog.programCourses.map((course) => ({
    code: course.code, name: course.name,
    count: relations.filter((relation) => Number(relation.course_id) === Number(course.id) || Number(relation.prerequisite_course_id) === Number(course.id)).length
  }));
  return {
    counts: {
      faculties: catalog.faculties.length,
      programs: catalog.programs.length,
      courses: new Set(catalog.programCourses.map((course) => Number(course.course_id))).size,
      programCourses: catalog.programCourses.length,
      relationships: relations.length,
      hiddenRelationships: relations.filter((relation) => relation.visible_to_students === false).length,
      recycleBin: deletedRows.reduce((sum, row) => sum + Number(row.count || 0), 0)
    },
    todayActivity: 0,
    latestActivity: [],
    analytics: {
      visibleRelationships: relations.filter((relation) => relation.visible_to_students !== false).length,
      coursesWithoutPrerequisites: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.course_id) === Number(course.id))).length,
      coursesWithoutRequiredFor: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.prerequisite_course_id) === Number(course.id))).length,
      largestProgram: programCounts.sort((a, b) => b.count - a.count)[0] || null,
      smallestProgram: programCounts.sort((a, b) => a.count - b.count)[0] || null,
      averageCoursesPerSemester: catalog.programCourses.length
        ? Number((catalog.programCourses.length / new Set(catalog.programCourses.map((course) => `${course.program_id}:${course.year_no}:${course.semester_no}`)).size).toFixed(2)) : 0,
      averagePrerequisites: catalog.programCourses.length ? Number((relations.length / catalog.programCourses.length).toFixed(2)) : 0,
      mostConnectedCourse: prerequisiteCounts.sort((a, b) => b.count - a.count)[0] || null,
      unusedCourses: catalog.programCourses.filter((course) => !relations.some((relation) => Number(relation.course_id) === Number(course.id) || Number(relation.prerequisite_course_id) === Number(course.id))).length
    }
  };
}

const fixture = makeFixture();
const deleted = [{ count: 3 }, { count: 2 }];
const expected = summarizeWithRepeatedScans(fixture, deleted);
const actual = summarizeDashboardCatalog(fixture, deleted);
assert.deepEqual(actual, expected, 'optimized summary preserves dashboard metrics and tie ordering');

// Warm both implementations, then compare equal workloads. This synthetic CPU
// timing is diagnostic only and is not an API or production latency claim.
summarizeWithRepeatedScans(fixture, deleted);
summarizeDashboardCatalog(fixture, deleted);
const measure = (fn, samples = 3) => {
  const durations = [];
  for (let i = 0; i < samples; i += 1) {
    const start = performance.now();
    fn(fixture, deleted);
    durations.push(performance.now() - start);
  }
  return durations.sort((a, b) => a - b)[Math.floor(samples / 2)];
};
const beforeMs = measure(summarizeWithRepeatedScans);
const afterMs = measure(summarizeDashboardCatalog);
console.log(JSON.stringify({
  result: 'dashboard metric parity passed',
  fixture: { programCourses: fixture.programCourses.length, relationships: fixture.relationships.length },
  syntheticCpuMedianMs: { previousRepeatedScans: Number(beforeMs.toFixed(2)), optimizedLookups: Number(afterMs.toFixed(2)) },
  improvementPercent: Number(((beforeMs - afterMs) / beforeMs * 100).toFixed(1)),
  note: 'Synthetic in-process calculation only; not representative of PostgreSQL or end-to-end request latency.'
}, null, 2));
