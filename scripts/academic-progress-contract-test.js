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
const adminForms=fs.readFileSync(new URL('../frontend/admin/modules/forms.js',import.meta.url),'utf8');
assert.match(hierarchyCss,/\.hierarchy-row\s*\{[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;/s);
assert.match(hierarchyCss,/flex: 0 0 calc\(\(100% - \(2 \* var\(--space-4\)\)\) \/ 3\)/);
assert.match(hierarchyJs,/mandatoryPrerequisites\.map\(item => hierarchyCard\(item, false, 'prerequisite'\)\)/,'mandatory prerequisites keep one horizontal strip and bidirectional focus metadata');
assert.match(hierarchyJs,/querySelectorAll\(isPrerequisite \? '\.hierarchy-level--dependents \.hierarchy-row' : '\.hierarchy-prerequisite-groups \.hierarchy-row'\)[\s\S]*?oppositeCards\.filter/,'reverse lookup searches every opposite strip and retains all matches');
assert.match(hierarchyJs,/function centeredScrollPosition\(card, row\)/,'matching cards align using measured row geometry');
assert.match(hierarchyJs,/function courseCompletionState\(course\)/,'unlock guidance uses the authenticated student progress record');
assert.match(hierarchyJs,/statusMessage = `Complete \$\{prerequisite\.code\} to satisfy a prerequisite requirement for \$\{dependent\.code\}\.`/,'incomplete mandatory prerequisite links explain what course requirement they satisfy');
assert.match(hierarchyJs,/pointerout', event => \{[\s\S]*?focusTarget\(inputMode === 'keyboard'[\s\S]*?null\);/,'pointer focus clears when the pointer leaves a card');
assert.match(hierarchyJs,/event\.pointerType === 'touch' \? 'touch' : 'pointer'/,'touch input is distinguished from mouse hover');
assert.match(hierarchyJs,/Tap the highlighted course again to open its actions/,'touch users can inspect a relationship before opening course actions');
assert.match(hierarchyJs,/oppositeRow\.scrollTo\(\{ left: centeredScrollPosition\(paired, oppositeRow\)/,'paired cards animate into view in either direction');
assert.match(hierarchyJs,/setTimeout\(resolve, 700\)/,'shared relationships are traced one by one so each target scroll can be seen');
assert.match(hierarchyJs,/Prerequisite \$\{card\.dataset\.courseCode\} is linked to \$\{pairedCards\.length\} required-for course[\s\S]*?relatedCodes\.join\(', '\)/,'the live explanation names every matching dependent course');
assert.match(hierarchyJs,/\$\{card\.dataset\.courseCode\} requires \$\{pairedCards\.length\} prerequisite course[\s\S]*?relatedCodes\.join\(', '\)/,'reverse focus names every matching prerequisite');
assert.match(hierarchyJs,/if \(!hoveredRow \|\| Math\.abs\(event\.deltaY\) <= Math\.abs\(event\.deltaX\)\) return/,'vertical wheel input outside a course strip remains page scrolling');
assert.match(hierarchyJs,/hoveredRow\.scrollLeft \+= event\.deltaY/,'vertical wheel input over a course strip scrolls only that row horizontally');
assert.match(hierarchyJs,/firstPath\.setAttribute\('marker-end', '[^']+'\)[\s\S]*?secondPath\.setAttribute\('marker-end', '[^']+'\)/,'both arrow segments show prerequisite-to-dependent direction');
assert.match(hierarchyCss,/prefers-reduced-motion: reduce/,'hierarchy animation respects reduced motion');
assert.match(hierarchyJs,/Complete either one · \$\{escapeHtml\(group\.label\)\}/,'alternative groups stay labeled separately');
assert.match(hierarchyCss,/\.hierarchy-prerequisite-group--alternative\s*\{[^}]*border-top/s,'alternative groups remain visually distinct');
assert.match(hierarchyJs,/is another option and is not needed for eligibility[\s\S]*?OR OPTION ALREADY SATISFIED/,'the OR animation identifies alternatives that are already unnecessary because another option passed');
assert.match(hierarchyJs,/Choose one course in “\$\{alternativeGroup\.label\}”[\s\S]*?Completing \$\{prerequisite\.code\} is one way[\s\S]*?CHOOSE ANY ONE OPTION/,'an unsatisfied OR path explains that one course can satisfy the group');
assert.match(adminForms,/Alternative prerequisite groups[\s\S]*?alternativeGroups:/,'administrators have a dedicated OR-group editor');
assert.match(adminForms,/Each alternative group needs a label and at least two course codes/,'invalid one-member OR groups are rejected before submission');
assert.match(adminForms,/Required ALL:[\s\S]*?Alternative groups, ANY ONE per group/,'the administrator preview explains AND versus OR semantics');
assert.doesNotMatch(hierarchyCss,/\.hierarchy-prerequisite-group\s*\{[^}]*padding:/s,'prerequisites no longer use oversized padded wrappers');
const profileMigration=fs.readFileSync(new URL('../supabase/migrations/20261026120000_student_profile_goals.sql',import.meta.url),'utf8');
assert.match(profileMigration,/total_program_credits smallint CHECK \(total_program_credits BETWEEN 1 AND 1000\)/,'profile stores a bounded student-reported credit total');
assert.match(profileMigration,/target_gpa numeric\(3,2\) CHECK \(target_gpa BETWEEN 0 AND 4\)/,'profile stores a bounded GPA target');
const progressRepository=fs.readFileSync(new URL('../backend/src/repositories/studentProgressRepository.js',import.meta.url),'utf8');
assert.match(progressRepository,/CASE WHEN \$3::boolean THEN EXCLUDED\.total_program_credits[\s\S]*?program_id=EXCLUDED\.program_id THEN student_academic_profiles\.total_program_credits ELSE NULL END/,'old clients preserve same-program settings without copying them to a different program');
assert.match(progressRepository,/CASE WHEN \$4::boolean THEN EXCLUDED\.target_gpa[\s\S]*?program_id=EXCLUDED\.program_id THEN student_academic_profiles\.target_gpa ELSE NULL END/,'old clients preserve same-program GPA goals without copying them to a different program');
const dashboard=fs.readFileSync(new URL('../frontend/dashboard.js',import.meta.url),'utf8');
assert.match(dashboard,/name="totalProgramCredits"/,'dashboard lets each student save the total program credits');
assert.match(dashboard,/name="targetGpa"/,'dashboard lets each student save a target GPA');
assert.match(dashboard,/facultyName/,'dashboard displays the faculty linked to the selected program');
assert.match(dashboard,/attempted hours/,'attempted hours remain distinct from passed-course planning hours');
assert.match(dashboard,/Planning estimate only[\s\S]*?repeat rules determine official completed credits/,'planning progress is not presented as official earned credits');
assert.match(dashboard,/Best term estimate[\s\S]*?Term estimates[\s\S]*?CGPA is hidden until university credit and retake rules are confirmed/,'only term estimates are shown while CGPA policy is unknown');
assert.doesNotMatch(dashboard,/Course eligibility|eligibleCourses|blockedCourses|academicState\.eligibility/,'the student dashboard does not show a course eligibility list');
assert.match(dashboard,/Browse courses[\s\S]*?#programs[\s\S]*?data-dashboard-action="profile"/,'student quick actions use the real course search anchor and open profile settings');
const studentHtml=fs.readFileSync(new URL('../frontend/student/index.html',import.meta.url),'utf8');
assert.match(studentHtml,/id="programs"/,'the Browse courses shortcut points to an existing student portal section');
assert.match(dashboard,/academic-save-bar[\s\S]*?Save profile &amp; progress/,'the profile save action remains easy to reach with a status explanation');
const preview=fs.readFileSync(new URL('../frontend/student/academic-preview.html',import.meta.url),'utf8');
const previewScript=preview.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(previewScript,'local preview script exists');
new Function(previewScript);
assert.match(preview,/academicDemo/);
assert.doesNotMatch(previewScript,/\bfetch\s*\(|localStorage/);
console.log('Academic progress and prerequisite rule contract tests passed.');
