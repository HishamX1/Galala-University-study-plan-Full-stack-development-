import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { requireIsolatedTestDatabase } from './helpers/require-isolated-test-database.js';

requireIsolatedTestDatabase();

const { closePool, query } = await import('../backend/src/db/client.js');
const { assignComplaint, createComplaint, createUser, getComplaintDetails, listComplaints, listCommunications, updateComplaint } = await import('../backend/src/services/authService.js');

const suffix = crypto.randomUUID().replaceAll('-', '');
const functionName = `complaint_fail_audit_${suffix}`;
const triggerName = `complaint_fail_audit_trigger_${suffix}`;
const createdUserIds = [];
let complaintId;
let legacyComplaintId;
let studentEmail;
let legacyEmail;
let failedComplaintEmail;
let performanceStudentId;
let performanceMessagePrefix;
const superAdmin = { id: null, role: 'super_admin', name: `Visibility Reviewer ${suffix}` };

async function count(sql, params = []) {
  return Number((await query(sql, params)).rows[0].count);
}

function summarizePlan(explain) {
  const scans = [];
  const visit = (node) => {
    if (node['Relation Name']) scans.push({
      type: node['Node Type'],
      relation: node['Relation Name'],
      index: node['Index Name'] || null,
      rows: node['Actual Rows'],
      executionMs: node['Actual Total Time'],
      sharedHitBlocks: node['Shared Hit Blocks'],
      sharedReadBlocks: node['Shared Read Blocks']
    });
    for (const child of node.Plans || []) visit(child);
  };
  visit(explain.Plan);
  return {
    executionMs: explain['Execution Time'],
    root: explain.Plan['Node Type'],
    scans
  };
}

try {
  const student = await createUser({ name: `Student ${suffix}`, email: `student-${suffix}@example.test`, studentId: `S${suffix.slice(0, 12)}`, password: 'Complaint-Test-Password-123!', role: 'student' });
  createdUserIds.push(student.id);
  const firstAdmin = await createUser({ name: `First Admin ${suffix}`, email: `first-admin-${suffix}@example.test`, password: 'Complaint-Test-Password-123!', role: 'regular_admin' });
  createdUserIds.push(firstAdmin.id);
  const secondAdmin = await createUser({ name: `Second Admin ${suffix}`, email: `second-admin-${suffix}@example.test`, password: 'Complaint-Test-Password-123!', role: 'regular_admin' });
  createdUserIds.push(secondAdmin.id);
  const reviewer = await createUser({ name: superAdmin.name, email: `reviewer-${suffix}@example.test`, password: 'Complaint-Test-Password-123!', role: 'super_admin' });
  createdUserIds.push(reviewer.id);
  superAdmin.id = reviewer.id;
  studentEmail = student.email;

  const created = await createComplaint(student, `Private test complaint ${suffix}`, `request-${suffix}`);
  complaintId = created.id;
  assert.equal(created.submitted_by, student.id, 'complaint stores its authenticated server-side submitter ID');
  assert.equal(created.submitted_name, student.name, 'complaint stores the submitter display-name snapshot');

  const listed = (await listComplaints()).find((item) => item.id === complaintId);
  assert.equal(listed.current_submitter_name, student.name);
  assert.equal(listed.email, student.email);
  assert.equal(listed.assigned_to, null);
  performanceStudentId = student.id;
  performanceMessagePrefix = `Synthetic pagination fixture ${suffix}`;
  await query(`INSERT INTO public.student_complaints (student_id,email,message,submitted_by,submitted_name)
    SELECT $1,$2,$3 || ' ' || series::text,$4,$5
      FROM generate_series(1,20000) AS series`, [`PERF-${suffix.slice(0, 12)}`, student.email, performanceMessagePrefix, student.id, student.name]);
  await query(`INSERT INTO public.communication_outbox (recipient_id,sender_id,kind,subject,body,status)
    SELECT $1,$2,'message','Synthetic pagination fixture',repeat('x',1024),'queued'
      FROM generate_series(1,20000)`, [student.id, reviewer.id]);
  await query('ANALYZE public.student_complaints');
  await query('ANALYZE public.communication_outbox');
  const plans = {};
  const planCases = [
    {
      tableName: 'student_complaints',
      indexName: 'idx_student_complaints_created_id',
      sql: `SELECT c.*, submitter.name AS current_submitter_name,
        modifier.name AS last_modified_by_name, assignee.name AS assigned_to_name,
        assigner.name AS assigned_by_name FROM public.student_complaints c
        LEFT JOIN public.app_users submitter ON submitter.id=c.submitted_by
        LEFT JOIN public.app_users modifier ON modifier.id=c.last_modified_by
        LEFT JOIN public.app_users assignee ON assignee.id=c.assigned_to
        LEFT JOIN public.app_users assigner ON assigner.id=c.assigned_by
        ORDER BY c.created_at DESC,c.id DESC LIMIT 50 OFFSET 0`
    },
    {
      tableName: 'communication_outbox',
      indexName: 'idx_communication_outbox_created_id',
      sql: `SELECT c.id,c.kind,c.subject,c.body,c.status,c.created_at,
        u.name AS recipient_name,u.email AS recipient_email FROM public.communication_outbox c
        JOIN public.app_users u ON u.id=c.recipient_id
        ORDER BY c.created_at DESC,c.id DESC LIMIT 50 OFFSET 0`
    }
  ];
  for (const { tableName, indexName, sql } of planCases) {
    await query(`DROP INDEX IF EXISTS public.${indexName}`);
    const withoutIndex = (await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
    plans[`${tableName}WithoutIndex`] = summarizePlan(withoutIndex);
    await query(`CREATE INDEX ${indexName} ON public.${tableName} (created_at DESC, id DESC)`);
    const withIndex = (await query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)).rows[0]['QUERY PLAN'][0];
    plans[`${tableName}WithIndex`] = summarizePlan(withIndex);
    assert.equal(plans[`${tableName}WithIndex`].scans.some((scan) => scan.index === indexName), true,
      `${indexName} should support the ordered page query in the synthetic fixture`);
    plans[`${tableName}IndexBytes`] = Number((await query('SELECT pg_relation_size($1::regclass) AS bytes', [`public.${indexName}`])).rows[0].bytes);
  }
  console.log(JSON.stringify({ supportPaginationPlans: plans }));
  await query('DROP INDEX IF EXISTS public.idx_student_complaints_created_id');
  await query('DROP INDEX IF EXISTS public.idx_communication_outbox_created_id');

  const fullComplaintList = await listComplaints();
  const complaintPage = await listComplaints({ limit: 1, offset: 0 });
  assert.equal(complaintPage.items.length, 1);
  assert.ok(complaintPage.total >= 120);
  assert.equal(complaintPage.limit, 1);
  assert.equal(complaintPage.total, fullComplaintList.length);
  assert.ok(Buffer.byteLength(JSON.stringify(complaintPage)) < Buffer.byteLength(JSON.stringify(fullComplaintList)));
  const complaintPayloadBytes = {
    fullHistory: Buffer.byteLength(JSON.stringify(fullComplaintList)),
    page: Buffer.byteLength(JSON.stringify(await listComplaints({ limit: 50, offset: 0 })))
  };
  assert.equal(complaintPayloadBytes.page < complaintPayloadBytes.fullHistory, true);

  const fullCommunicationList = await listCommunications();
  const communicationPage = await listCommunications({ limit: 5, offset: 0 });
  assert.ok(communicationPage.items.length <= 5);
  assert.equal(communicationPage.total, fullCommunicationList.length);
  const communicationPayloadBytes = {
    fullHistory: Buffer.byteLength(JSON.stringify(fullCommunicationList)),
    page: Buffer.byteLength(JSON.stringify(await listCommunications({ limit: 50, offset: 0 })))
  };
  assert.equal(communicationPayloadBytes.page < communicationPayloadBytes.fullHistory, true);
  console.log(JSON.stringify({
    supportPaginationPayloadBytes: {
      complaints: { records: fullComplaintList.length, ...complaintPayloadBytes },
      communications: { records: fullCommunicationList.length, ...communicationPayloadBytes }
    }
  }));

  legacyEmail = `legacy-complaint-${suffix}@example.test`;
  legacyComplaintId = (await query('INSERT INTO public.student_complaints (student_id,email,message) VALUES ($1,$2,$3) RETURNING id', [`LEGACY-${suffix.slice(0, 12)}`, legacyEmail, 'Historical fixture without identity metadata'])).rows[0].id;
  const legacyRecord = (await listComplaints()).find((item) => item.id === legacyComplaintId);
  assert.equal(legacyRecord.submitted_by, null, 'unmatched historical complaints stay usable without fabricated identity');
  assert.equal(legacyRecord.submitted_name, null);

  await assignComplaint(complaintId, firstAdmin.id, superAdmin);
  let persisted = await getComplaintDetails(complaintId);
  assert.equal(persisted.complaint.assigned_to, firstAdmin.id);
  assert.equal(persisted.complaint.assigned_by, reviewer.id);
  assert.equal(persisted.complaint.assigned_to_name, firstAdmin.name);
  assert.equal(persisted.history.some((event) => event.action === 'Complaint Assigned'), true);

  await assignComplaint(complaintId, secondAdmin.id, superAdmin);
  persisted = await getComplaintDetails(complaintId);
  assert.equal(persisted.complaint.assigned_to, secondAdmin.id);
  assert.equal(persisted.complaint.assigned_to_name, secondAdmin.name);
  const reassignment = persisted.history.find((event) => event.action === 'Complaint Reassigned');
  assert.equal(reassignment.actor_id, reviewer.id);
  assert.equal(reassignment.old_values.assignedTo, firstAdmin.id);
  assert.equal(reassignment.old_values.assignedToName, firstAdmin.name);
  assert.equal(reassignment.new_values.assignedTo, secondAdmin.id);
  assert.equal(reassignment.new_values.assignedToName, secondAdmin.name);

  await updateComplaint(complaintId, 'in_progress', 'Reply recorded for test.', reviewer.id, superAdmin);
  persisted = await getComplaintDetails(complaintId);
  assert.equal(persisted.complaint.last_modified_by, reviewer.id);
  assert.equal(persisted.complaint.last_modified_by_name, reviewer.name);
  assert.equal(persisted.complaint.status, 'in_progress');
  assert.equal(persisted.history.some((event) => event.action === 'Complaint Updated' && event.actor_id === reviewer.id), true);

  const auditCountBeforeFailure = await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity='complaint' AND target_id=$1", [complaintId]);
  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $complaint_test$
    BEGIN
      IF NEW.entity='complaint' AND NEW.action='Complaint Reassigned' AND NEW.target_id=TG_ARGV[0] THEN
        RAISE EXCEPTION 'injected complaint assignment audit failure';
      END IF;
      RETURN NEW;
    END;
  $complaint_test$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON public.admin_audit_logs
    FOR EACH ROW EXECUTE FUNCTION public."${functionName}"('${complaintId}')`);
  await assert.rejects(() => assignComplaint(complaintId, firstAdmin.id, superAdmin), /injected complaint assignment audit failure/);
  await query(`DROP TRIGGER "${triggerName}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${functionName}"()`);
  persisted = await getComplaintDetails(complaintId);
  assert.equal(persisted.complaint.assigned_to, secondAdmin.id, 'failed assignment and its state change roll back together');
  assert.equal(await count("SELECT count(*)::int AS count FROM admin_audit_logs WHERE entity='complaint' AND target_id=$1", [complaintId]), auditCountBeforeFailure,
    'failed reassignment must not leave a success audit event');

  failedComplaintEmail = `failed-complaint-${suffix}@example.test`;
  await query(`CREATE FUNCTION public."${functionName}"() RETURNS trigger LANGUAGE plpgsql AS $complaint_test$
    BEGIN
      IF NEW.entity='complaint' AND NEW.action='Complaint Submitted' THEN
        RAISE EXCEPTION 'injected complaint submission audit failure';
      END IF;
      RETURN NEW;
    END;
  $complaint_test$`);
  await query(`CREATE TRIGGER "${triggerName}" BEFORE INSERT ON public.admin_audit_logs FOR EACH ROW EXECUTE FUNCTION public."${functionName}"()`);
  await assert.rejects(() => createComplaint({ ...student, email: failedComplaintEmail }, `Failed submission ${suffix}`), /injected complaint submission audit failure/);
  await query(`DROP TRIGGER "${triggerName}" ON public.admin_audit_logs`);
  await query(`DROP FUNCTION public."${functionName}"()`);
  assert.equal(await count('SELECT count(*)::int AS count FROM public.student_complaints WHERE email=$1', [failedComplaintEmail]), 0,
    'failed submission audit must roll the complaint insert back');

  console.log('Complaint submitter, assignment history, modification attribution, and audit rollback integration tests passed.');
} finally {
  await query('DROP INDEX IF EXISTS public.idx_student_complaints_created_id').catch(() => {});
  await query('DROP INDEX IF EXISTS public.idx_communication_outbox_created_id').catch(() => {});
  await query(`DROP TRIGGER IF EXISTS "${triggerName}" ON public.admin_audit_logs`).catch(() => {});
  await query(`DROP FUNCTION IF EXISTS public."${functionName}"()`).catch(() => {});
  if (complaintId) {
    await query("DELETE FROM public.admin_audit_logs WHERE entity='complaint' AND target_id=$1", [complaintId]).catch(() => {});
    await query('DELETE FROM public.student_complaints WHERE id=$1', [complaintId]).catch(() => {});
  }
  if (legacyComplaintId) await query('DELETE FROM public.student_complaints WHERE id=$1', [legacyComplaintId]).catch(() => {});
  if (studentEmail) await query('DELETE FROM public.student_complaints WHERE email=$1', [studentEmail]).catch(() => {});
  if (failedComplaintEmail) await query('DELETE FROM public.student_complaints WHERE email=$1', [failedComplaintEmail]).catch(() => {});
  if (performanceStudentId && performanceMessagePrefix) {
    await query('DELETE FROM public.student_complaints WHERE submitted_by=$1 AND message LIKE $2', [performanceStudentId, `${performanceMessagePrefix}%`]).catch(() => {});
    await query('DELETE FROM public.communication_outbox WHERE recipient_id=$1 AND subject=$2', [performanceStudentId, 'Synthetic pagination fixture']).catch(() => {});
  }
  if (createdUserIds.length) {
    await query('DELETE FROM public.admin_audit_logs WHERE actor_id=ANY($1::uuid[])', [createdUserIds]).catch(() => {});
    await query('DELETE FROM public.app_users WHERE id=ANY($1::uuid[])', [createdUserIds]).catch(() => {});
  }
  await closePool();
}
