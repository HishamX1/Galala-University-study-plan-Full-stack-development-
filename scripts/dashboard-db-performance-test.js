import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

// Set DATABASE_URL only after the dedicated loopback database guard succeeds,
// then import code that reads database configuration at module initialization.
requireIsolatedTestDatabase();
const { withPostgresClient, closePool } = await import('../backend/src/db/client.js');
const { getDashboardSummary } = await import('../backend/src/services/adminOpsService.js');

const courseCount = 2500;
const relationshipsPerCourse = 4;
const warmupSamples = 5;
const measuredSamples = 30;
const marker = `perf-${randomUUID()}`;
let facultyId;

async function seedFixture() {
  await withPostgresClient(async (client) => {
    await client.query('BEGIN');
    try {
      const faculty = await client.query('INSERT INTO faculties (name) VALUES ($1) RETURNING id', [marker]);
      facultyId = faculty.rows[0].id;
      const program = await client.query(
        'INSERT INTO programs (faculty_id, name, duration_years) VALUES ($1, $2, 4) RETURNING id',
        [facultyId, `${marker}-program`]
      );
      const programId = program.rows[0].id;
      await client.query(
        `INSERT INTO courses (name)
         SELECT $1 || '-course-' || series::text FROM generate_series(1, $2) AS series`,
        [marker, courseCount]
      );
      await client.query(
        `INSERT INTO program_courses (program_id, course_id, code, year_no, semester_no, credits)
         SELECT $1, course.id, $2 || '-code-' || series::text,
                (((series - 1) / 500) % 5 + 1)::smallint,
                (((series - 1) / 250) % 2 + 1)::smallint,
                3
           FROM generate_series(1, $3) AS series
           JOIN courses course ON course.name = $2 || '-course-' || series::text`,
        [programId, marker, courseCount]
      );
      await client.query(
        `INSERT INTO course_prerequisites (course_id, prerequisite_course_id, visible_to_students)
         SELECT current_course.id, prerequisite.id, ((series + offset_no) % 5 <> 0)
           FROM generate_series(1, $1) AS series
           CROSS JOIN generate_series(1, $2) AS offset_no
           JOIN program_courses current_course
             ON current_course.program_id = $3 AND current_course.code = $4 || '-code-' || series::text
           JOIN program_courses prerequisite
             ON prerequisite.program_id = $3
            AND prerequisite.code = $4 || '-code-' || (((series + offset_no - 1) % $1) + 1)::text`,
        [courseCount, relationshipsPerCourse, programId, marker]
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    }
  });
}

async function refreshFixtureStatistics() {
  await withPostgresClient((client) => client.query(
    'ANALYZE faculties; ANALYZE programs; ANALYZE courses; ANALYZE program_courses; ANALYZE course_prerequisites'
  ));
}

async function explain(client, name, sql) {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`);
  const plan = result.rows[0]['QUERY PLAN'][0];
  return {
    query: name,
    planningMs: Number(plan['Planning Time'].toFixed(3)),
    executionMs: Number(plan['Execution Time'].toFixed(3)),
    rootNode: plan.Plan['Node Type'],
    rows: plan.Plan['Actual Rows'],
    sharedHitBlocks: plan.Plan['Shared Hit Blocks'],
    sharedReadBlocks: plan.Plan['Shared Read Blocks']
  };
}

function percentile(sorted, p) {
  return sorted[Math.ceil(p * sorted.length) - 1];
}

try {
  await seedFixture();
  await refreshFixtureStatistics();
  const queryPlans = await withPostgresClient(async (client) => {
    const plans = [];
    plans.push(await explain(client, 'active faculties', 'SELECT id, name, created_at, updated_at FROM faculties WHERE deleted_at IS NULL ORDER BY name'));
    plans.push(await explain(client, 'active programs', 'SELECT id, faculty_id, name, duration_years, created_at, updated_at FROM programs WHERE deleted_at IS NULL ORDER BY name'));
    plans.push(await explain(client, 'active program courses with course and program joins',
      `SELECT pc.id, pc.program_id, p.faculty_id, pc.course_id, pc.code, c.name, pc.year_no, pc.semester_no,
              pc.credits, pc.is_required, c.description, pc.created_at, pc.updated_at
         FROM program_courses pc
         JOIN programs p ON p.id = pc.program_id AND p.deleted_at IS NULL
         JOIN courses c ON c.id = pc.course_id AND c.deleted_at IS NULL
        WHERE pc.deleted_at IS NULL
        ORDER BY pc.program_id, pc.year_no, pc.semester_no, pc.code`));
    plans.push(await explain(client, 'active prerequisite relationships',
      `SELECT id, course_id, prerequisite_course_id, visible_to_students, created_at, updated_at
         FROM course_prerequisites WHERE deleted_at IS NULL
        ORDER BY course_id, prerequisite_course_id`));
    return plans;
  });

  for (let index = 0; index < warmupSamples; index += 1) await getDashboardSummary();
  const durations = [];
  for (let index = 0; index < measuredSamples; index += 1) {
    const started = performance.now();
    const summary = await getDashboardSummary();
    durations.push(performance.now() - started);
    if (summary.counts.programCourses < courseCount) throw new Error('Dashboard summary omitted synthetic program-course rows');
  }
  durations.sort((left, right) => left - right);
  console.log(JSON.stringify({
    result: 'dashboard database diagnostic completed',
    environment: 'guarded disposable local PostgreSQL test database',
    fixture: { programCourses: courseCount, relationships: courseCount * relationshipsPerCourse },
    dashboardServiceMs: {
      sampleCount: measuredSamples,
      warmupSamples,
      p50: Number(percentile(durations, 0.5).toFixed(2)),
      p95: Number(percentile(durations, 0.95).toFixed(2)),
      min: Number(durations[0].toFixed(2)),
      max: Number(durations.at(-1).toFixed(2))
    },
    catalogQueryPlans: queryPlans,
    note: 'Dashboard-service timings include PostgreSQL, pool wait, and JavaScript work; they are not HTTP or browser timings.'
  }, null, 2));
} finally {
  try {
    if (facultyId !== undefined) {
      await withPostgresClient(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query('DELETE FROM faculties WHERE id = $1', [facultyId]);
          await client.query("DELETE FROM courses WHERE name LIKE $1 || '-course-%'", [marker]);
          await client.query('COMMIT');
        } catch (error) {
          await client.query('ROLLBACK').catch(() => {});
          throw error;
        }
      });
    }
  } finally {
    await closePool();
  }
}
