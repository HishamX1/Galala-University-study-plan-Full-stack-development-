import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const pg = await import('pg');
let measuredQueryCount = 0;
let measureQueries = false;
const originalPoolQuery = pg.default.Pool.prototype.query;
pg.default.Pool.prototype.query = function countMeasuredQuery(...args) {
  if (measureQueries) measuredQueryCount += 1;
  return originalPoolQuery.apply(this, args);
};

const { closePool, query, withPostgresClient } = await import('../backend/src/db/client.js');
const { getCatalog, updateFaculty } = await import('../backend/src/services/catalogService.js');

const suffix = crypto.randomUUID();
const names = {
  faculty: `Catalog cache faculty ${suffix}`,
  program: `Catalog cache program ${suffix}`,
  secondProgram: `Catalog cache shared program ${suffix}`,
  course: `Catalog cache course ${suffix}`
};
const ids = {};
const timings = { miss: [], hit: [] };
const queryCounts = { miss: [], hit: [] };

async function readRevision(executor = { query }) {
  return String((await executor.query('SELECT public.get_catalog_revision()::text AS revision')).rows[0].revision);
}

function percentile(values, fraction) {
  const ordered = [...values].sort((left, right) => left - right);
  return Number(ordered[Math.ceil(ordered.length * fraction) - 1].toFixed(2));
}

function catalogCourse(catalog, id) {
  return catalog.programCourses.find((item) => item.id === Number(id));
}

async function assertRevisionChanges(label, write, verify) {
  const before = await readRevision();
  await write();
  const after = await readRevision();
  assert.ok(BigInt(after) > BigInt(before), `${label} must advance the shared committed revision`);
  await verify();
}

try {
  const faculty = await query('INSERT INTO public.faculties (name) VALUES ($1) RETURNING id', [names.faculty]);
  ids.faculty = faculty.rows[0].id;
  const program = await query('INSERT INTO public.programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [ids.faculty, names.program]);
  ids.program = program.rows[0].id;
  const secondProgram = await query('INSERT INTO public.programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id', [ids.faculty, names.secondProgram]);
  ids.secondProgram = secondProgram.rows[0].id;
  const course = await query('INSERT INTO public.courses (name, description) VALUES ($1, $2) RETURNING id', [names.course, 'initial']);
  ids.course = course.rows[0].id;
  const firstCourse = await query(`INSERT INTO public.program_courses
      (program_id, course_id, code, year_no, semester_no, credits)
    VALUES ($1, $2, $3, 1, 1, 3) RETURNING id`, [ids.program, ids.course, `CC-${suffix.slice(0, 8)}`]);
  ids.programCourse = firstCourse.rows[0].id;
  const secondCourse = await query(`INSERT INTO public.program_courses
      (program_id, course_id, code, year_no, semester_no, credits)
    VALUES ($1, $2, $3, 1, 1, 3) RETURNING id`, [ids.secondProgram, ids.course, `CS-${suffix.slice(0, 8)}`]);
  ids.secondProgramCourse = secondCourse.rows[0].id;
  const relation = await query(`INSERT INTO public.course_prerequisites (course_id, prerequisite_course_id, visible_to_students)
    VALUES ($1, $2, false) RETURNING id`, [ids.programCourse, ids.secondProgramCourse]);
  ids.relation = relation.rows[0].id;

  const studentInitial = await getCatalog();
  const adminInitial = await getCatalog({ includeHidden: true });
  assert.equal(catalogCourse(studentInitial, ids.programCourse).prerequisiteRelations.length, 0,
    'student audience must not receive a hidden prerequisite relation');
  assert.equal(catalogCourse(adminInitial, ids.programCourse).prerequisiteRelations[0].visibleToStudents, false,
    'administrator audience receives hidden prerequisite visibility data');

  await assertRevisionChanges('faculty update',
    () => query('UPDATE public.faculties SET name = $2, updated_at = now() WHERE id = $1', [ids.faculty, `${names.faculty} updated`]),
    async () => assert.ok((await getCatalog()).faculties.some((item) => item.id === Number(ids.faculty) && item.name.endsWith('updated'))));

  await assertRevisionChanges('program update',
    () => query('UPDATE public.programs SET name = $2, updated_at = now() WHERE id = $1', [ids.program, `${names.program} updated`]),
    async () => assert.ok((await getCatalog()).programs.some((item) => item.id === Number(ids.program) && item.name.endsWith('updated'))));

  await assertRevisionChanges('shared course detail update',
    () => query('UPDATE public.courses SET description = $2, updated_at = now() WHERE id = $1', [ids.course, 'updated course detail']),
    async () => {
      const snapshot = await getCatalog();
      assert.equal(catalogCourse(snapshot, ids.programCourse).description, 'updated course detail');
      assert.equal(catalogCourse(snapshot, ids.secondProgramCourse).description, 'updated course detail',
        'course detail changes must update every program-course that shares the canonical course row');
    });

  await assertRevisionChanges('program-course update',
    () => query('UPDATE public.program_courses SET credits = credits + 1, updated_at = now() WHERE id = $1', [ids.programCourse]),
    async () => assert.equal(catalogCourse(await getCatalog(), ids.programCourse).credits, 4));

  await assertRevisionChanges('prerequisite visibility update',
    () => query('UPDATE public.course_prerequisites SET visible_to_students = true WHERE id = $1', [ids.relation]),
    async () => assert.equal(catalogCourse(await getCatalog(), ids.programCourse).prerequisiteRelations[0].visibleToStudents, true));

  await assertRevisionChanges('prerequisite delete',
    () => query('DELETE FROM public.course_prerequisites WHERE id = $1', [ids.relation]),
    async () => assert.equal(catalogCourse(await getCatalog(), ids.programCourse).prerequisiteRelations.length, 0));
  const restoredRelation = await query(`INSERT INTO public.course_prerequisites (course_id, prerequisite_course_id, visible_to_students)
    VALUES ($1, $2, false) RETURNING id`, [ids.programCourse, ids.secondProgramCourse]);
  ids.relation = restoredRelation.rows[0].id;
  await getCatalog({ includeHidden: true });

  const beforeTruncate = await readRevision();
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    await client.query('TRUNCATE public.course_prerequisite_group_members, public.course_prerequisite_groups, public.course_prerequisites');
    const afterNonEmptyTruncate = await readRevision(client);
    assert.ok(BigInt(afterNonEmptyTruncate) > BigInt(beforeTruncate), 'truncating non-empty catalog relationships advances the revision');
    await client.query('TRUNCATE public.course_prerequisite_group_members, public.course_prerequisite_groups, public.course_prerequisites');
    assert.equal(await readRevision(client), afterNonEmptyTruncate, 'truncating an already-empty catalog table does not advance the revision');
    await client.query('ROLLBACK');
  });
  assert.equal(await readRevision(), beforeTruncate, 'a rolled-back truncate also rolls back its revision change');

  const noOpRevision = await readRevision();
  await query('UPDATE public.faculties SET name = name WHERE id = -1');
  assert.equal(await readRevision(), noOpRevision, 'an unsuccessful zero-row write does not advance the revision');
  const failedServiceRevision = await readRevision();
  assert.equal(await updateFaculty(-1, { name: 'missing' }), false, 'unsuccessful service updates retain their established result');
  assert.equal(await readRevision(), failedServiceRevision, 'unsuccessful service operations do not advance the revision');

  await withPostgresClient(async (client) => {
    await client.query('CREATE TEMP TABLE new_rows (id bigint) ON COMMIT PRESERVE ROWS');
    const beforeShadowProbe = await readRevision(client);
    await client.query('UPDATE public.faculties SET updated_at = now() WHERE id = $1', [ids.faculty]);
    assert.ok(BigInt(await readRevision(client)) > BigInt(beforeShadowProbe),
      'a caller-created temporary table cannot shadow the trigger transition relation and suppress invalidation');
    await client.query('DROP TABLE new_rows');
  });

  const rollbackRevision = await readRevision();
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    await client.query('UPDATE public.faculties SET name = $2, updated_at = now() WHERE id = $1', [ids.faculty, 'uncommitted catalog name']);
    assert.ok(BigInt(await readRevision(client)) > BigInt(rollbackRevision), 'the trigger revision is visible inside the writing transaction');
    await client.query('ROLLBACK');
  });
  assert.equal(await readRevision(), rollbackRevision, 'rolling back a catalog mutation also rolls back its revision');
  assert.ok((await getCatalog()).faculties.some((item) => item.id === Number(ids.faculty) && item.name.endsWith('updated')),
    'the rolled-back name is never exposed by the cached catalog');

  const sampleCount = 30;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    await query('UPDATE public.courses SET description = $2 WHERE id = $1', [ids.course, `measurement-${sample}`]);
    const missStarted = performance.now();
    measuredQueryCount = 0;
    measureQueries = true;
    const miss = await getCatalog();
    measureQueries = false;
    timings.miss.push(performance.now() - missStarted);
    queryCounts.miss.push(measuredQueryCount);
    const hitStarted = performance.now();
    measuredQueryCount = 0;
    measureQueries = true;
    const hit = await getCatalog();
    measureQueries = false;
    timings.hit.push(performance.now() - hitStarted);
    queryCounts.hit.push(measuredQueryCount);
    assert.deepEqual(hit, miss, 'a cache hit preserves exact catalog response data');
  }

  const distinctQueryCounts = (values) => [...new Set(values)].sort((left, right) => left - right);
  assert.ok(Math.max(...queryCounts.miss) > Math.max(...queryCounts.hit),
    'a verified catalog hit executes fewer PostgreSQL queries than a miss');

  console.log(JSON.stringify({
    result: 'revisioned catalog cache integration passed',
    environment: 'guarded disposable PostgreSQL database',
    workload: { warmMissHitPairs: sampleCount, catalogRows: 'current disposable fixture plus UUID-scoped rows' },
    queryCountsBySourcePath: { miss: distinctQueryCounts(queryCounts.miss), hit: distinctQueryCounts(queryCounts.hit), samplesPerPath: sampleCount },
    latencyMs: {
      sampleCount,
      missP50: percentile(timings.miss, 0.5), missP95: percentile(timings.miss, 0.95),
      hitP50: percentile(timings.hit, 0.5), hitP95: percentile(timings.hit, 0.95)
    }
  }, null, 2));
} finally {
  if (ids.faculty) {
    await query('DELETE FROM public.faculties WHERE id = $1', [ids.faculty]).catch(() => {});
  }
  if (ids.course) await query('DELETE FROM public.courses WHERE id = $1', [ids.course]).catch(() => {});
  await closePool();
}
