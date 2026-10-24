import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRevisionedCatalogCache } from '../backend/src/services/catalogCache.js';

let revision = '1';
let builds = 0;
const cache = createRevisionedCatalogCache({
  readRevision: async () => revision,
  buildCatalog: async (audience) => {
    builds += 1;
    return { audience, programCourses: [{ id: 1, prerequisiteRelations: audience === 'admin' ? [{ visibleToStudents: false }] : [] }] };
  }
});
const studentSnapshot = await cache.getCatalog('student');
assert.deepEqual(studentSnapshot.programCourses[0].prerequisiteRelations, [], 'student cache omits hidden prerequisite links');
const adminSnapshot = await cache.getCatalog('admin');
assert.equal(adminSnapshot.programCourses[0].prerequisiteRelations[0].visibleToStudents, false, 'admin receives its isolated relation payload');
assert.equal(builds, 2, 'each audience builds a separate cache entry');
studentSnapshot.programCourses[0].id = 999;
assert.equal((await cache.getCatalog('student')).programCourses[0].id, 1, 'caller mutation cannot alter a cached snapshot');
assert.equal(builds, 2, 'a repeated read with the same committed revision hits the cache');

let time = 0;
let expiryBuilds = 0;
const expiringCache = createRevisionedCatalogCache({
  readRevision: async () => 'same',
  buildCatalog: async () => ({ build: ++expiryBuilds }),
  ttlMs: 50,
  maxEntries: 1,
  now: () => time
});
assert.deepEqual(await expiringCache.getCatalog(), { build: 1 });
time = 51;
assert.deepEqual(await expiringCache.getCatalog(), { build: 2 }, 'expired values are rebuilt, never served stale');
assert.equal(expiryBuilds, 2);

let boundedRevision = 1;
let boundedBuilds = 0;
const boundedCache = createRevisionedCatalogCache({
  readRevision: async () => String(boundedRevision),
  buildCatalog: async () => ({ build: ++boundedBuilds }),
  maxEntries: 2
});
await boundedCache.getCatalog();
boundedRevision = 2;
await boundedCache.getCatalog();
boundedRevision = 3;
await boundedCache.getCatalog();
boundedRevision = 1;
await boundedCache.getCatalog();
assert.equal(boundedBuilds, 4, 'the cache evicts older revisions after reaching its configured entry bound');

let releaseBuild;
let sharedBuilds = 0;
const sharedCache = createRevisionedCatalogCache({
  readRevision: async () => 'stable',
  buildCatalog: () => {
    sharedBuilds += 1;
    return new Promise((resolve) => { releaseBuild = () => resolve({ faculties: [{ id: 7 }] }); });
  }
});
const concurrentReads = Array.from({ length: 8 }, () => sharedCache.getCatalog());
await Promise.resolve();
assert.equal(sharedBuilds, 1, 'concurrent misses for one revision and audience share one build');
releaseBuild();
assert.deepEqual(await Promise.all(concurrentReads), Array.from({ length: 8 }, () => ({ faculties: [{ id: 7 }] })));

let versionReads = 0;
let versionBuilds = 0;
const changingCache = createRevisionedCatalogCache({
  readRevision: async () => (++versionReads === 1 ? '1' : '2'),
  buildCatalog: async () => ({ revision: String(++versionBuilds) })
});
assert.deepEqual(await changingCache.getCatalog(), { revision: '2' }, 'a mid-fill version change retries using the new revision');
assert.equal(versionBuilds, 2);

let failRevision = false;
const failingCache = createRevisionedCatalogCache({
  readRevision: async () => { if (failRevision) throw new Error('revision unavailable'); return '1'; },
  buildCatalog: async () => ({ data: 'fresh' }),
  ttlMs: 10,
  now: () => 0
});
assert.deepEqual(await failingCache.getCatalog(), { data: 'fresh' });
failRevision = true;
await assert.rejects(failingCache.getCatalog(), /revision unavailable/, 'database revision errors never serve cached catalog data');

const [controllerSource, routeSource] = await Promise.all([
  readFile(new URL('../backend/src/controllers/catalogController.js', import.meta.url), 'utf8'),
  readFile(new URL('../backend/src/routes/catalogRoutes.js', import.meta.url), 'utf8')
]);
assert.match(controllerSource, /getCatalog\(\{ includeHidden: user\?\.role !== 'student' \}\)/,
  'administrator catalog visibility is derived from the authenticated server user');
assert.match(routeSource, /handleCatalogReadRequest\(req, res, url, user\)/,
  'the authenticated principal reaches the catalog controller');
assert.doesNotMatch(controllerSource, /url\.searchParams\.get\('audience'\)/,
  'a query parameter cannot select hidden administrator catalog relationships');

console.log('Revisioned catalog cache contract tests passed (audience isolation, cache hits, immutable copies, shared misses, revision races, and fail-closed reads).');
