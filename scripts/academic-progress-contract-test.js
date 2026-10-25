import assert from 'node:assert/strict';
import fs from 'node:fs';
import { calculateTermGpa, GRADE_POINTS, GRADE_SCALE } from '../backend/src/academic/gradeScale.js';
import { evaluatePrerequisiteGroups } from '../backend/src/services/studentProgressService.js';
import { hasPermission, Permissions } from '../backend/src/security/permissions.js';

assert.deepEqual(GRADE_POINTS, { 'A+': 4, A: 4, 'A-': 3.7, 'B+': 3.3, B: 3, 'B-': 2.7, 'C+': 2.3, C: 2, 'C-': 1.7, 'D+': 1.3, D: 1, F: 0 });
assert.equal(GRADE_SCALE[0].exclusiveMinimum, true, 'exactly 97% remains unassigned');
assert.deepEqual(calculateTermGpa([{ credits: 3, grade: 'A' }, { credits: 1, grade: 'B' }]), { available: true, value: 3.75, attemptedCredits: 4 });
assert.equal(calculateTermGpa([{ credits: 0, grade: 'A' }]).available, false);
assert.equal(calculateTermGpa([{ credits: 3, grade: '?' }]).available, false);
assert.equal(calculateTermGpa([{ programCourseId: 9, credits: 3, grade: 'F' }, { programCourseId: 9, credits: 3, grade: 'A' }]).available, false);
const eligibility = evaluatePrerequisiteGroups([
  { course_id: 30, group_id: 1, group_type: 'mandatory', label: 'Must pass', prerequisite_course_id: 10 },
  { course_id: 30, group_id: 2, group_type: 'alternative', label: 'Choose one', prerequisite_course_id: 11 },
  { course_id: 30, group_id: 2, group_type: 'alternative', label: 'Choose one', prerequisite_course_id: 12 }
], [{ programCourseId: 10, grade: 'C' }, { programCourseId: 12, grade: 'B+' }]);
assert.equal(eligibility[30].eligible, true);
assert.equal(evaluatePrerequisiteGroups([{ course_id: 31, group_id: 3, group_type: 'mandatory', label: 'Must pass', prerequisite_course_id: 10 }], [{ programCourseId: 10, grade: 'F' }])[31].eligible, false);
assert.equal(evaluatePrerequisiteGroups([{ course_id: 32, group_id: 4, group_type: 'mandatory', label: 'Must pass', prerequisite_course_id: 10, minimum_grade: 'B' }], [{ programCourseId: 10, grade: 'C' }])[32].eligible, false);
assert.equal(evaluatePrerequisiteGroups([
  { course_id: 33, group_id: 5, group_type: 'mandatory', label: 'A', prerequisite_course_id: 10 },
  { course_id: 33, group_id: 6, group_type: 'mandatory', label: 'B', prerequisite_course_id: 11 }
], [{ programCourseId: 10, grade: 'A' }])[33].eligible, false, 'all mandatory groups must pass');
assert.equal(evaluatePrerequisiteGroups([{ course_id: 34, group_id: 7, group_type: 'mandatory', label: 'A', prerequisite_course_id: 10 }], [{ programCourseId: 10, grade: 'F' }, { programCourseId: 10, grade: 'A' }])[34].uncertain, true, 'repeat policy ambiguity must not be treated as passed or failed');
assert.equal(hasPermission({ role: 'student' }, Permissions.academicProgress), true);
assert.equal(hasPermission({ role: 'regular_admin' }, Permissions.academicProgress), false);
const hierarchyCss=fs.readFileSync(new URL('../frontend/student/student.css',import.meta.url),'utf8');
const hierarchyJs=fs.readFileSync(new URL('../frontend/student/student.js',import.meta.url),'utf8');
assert.match(hierarchyCss,/\.hierarchy-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
assert.match(hierarchyCss,/flex: 0 0 calc\(\(100% - \(2 \* var\(--space-4\)\)\) \/ 3\)/);
assert.match(hierarchyJs,/mandatoryPrerequisites\.map\(item => hierarchyCard\(item\)\)/,'mandatory prerequisites share one horizontal strip');
assert.match(hierarchyJs,/Complete either one · \$\{escapeHtml\(group\.label\)\}/,'alternative groups stay labeled separately');
assert.match(hierarchyCss,/\.hierarchy-prerequisite-group--alternative\s*\{[^}]*border-top/s,'alternative groups remain visually distinct');
assert.doesNotMatch(hierarchyCss,/\.hierarchy-prerequisite-group\s*\{[^}]*padding:/s,'prerequisites no longer use oversized padded wrappers');
const preview=fs.readFileSync(new URL('../frontend/student/academic-preview.html',import.meta.url),'utf8');
const previewScript=preview.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(previewScript,'local preview script exists');
new Function(previewScript);
assert.match(preview,/academicDemo/);
assert.doesNotMatch(previewScript,/\bfetch\s*\(|localStorage/);
console.log('Academic progress and prerequisite rule contract tests passed.');
