import { escapeHtml } from '../../shared/dom.js';
import { download, request } from './apiClient.js';
import { elements, setMessage } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { openConfirmDialog } from './dialogs.js';
import { cache } from './state.js';

function fmtDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function metric(label, value, note = '') {
  return `<div class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value ?? 0)}</strong><small>${escapeHtml(note)}</small></div>`;
}

function statusPill(label, value) {
  return `<div class="health-row"><span>${escapeHtml(label)}</span><strong class="status-dot ${escapeHtml(value || 'yellow')}">${escapeHtml(value || 'unknown')}</strong></div>`;
}

function downloadPayload(payload) {
  const blob = payload.content instanceof Blob ? payload.content : new Blob([payload.content || ''], { type: payload.mimeType || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = payload.filename || 'download.txt';
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function importPayload() {
  const file = elements.ids.importFile?.files?.[0];
  const format = elements.ids.importFormat.value;
  if (['xlsx', 'pdf'].includes(format) && !file) throw new Error('Choose an import file first.');
  if (file && !['xlsx', 'pdf'].includes(format)) {
    if (format !== 'csv') throw new Error('Use JSON text or select CSV format for a CSV file.');
    return { type: elements.ids.importType.value, format, content: await file.text() };
  }
  if (file) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return { type: elements.ids.importType.value, format, fileContent: btoa(binary), fileName: file.name };
  }
  return { type: elements.ids.importType.value, format, content: elements.ids.importContent.value };
}

export async function loadAdminOps() {
  const [dashboard, recycleBin, backups, health] = await Promise.all([
    request('/admin/dashboard'),
    request('/admin/recycle-bin'),
    request('/admin/backups'),
    request('/admin/system-health')
  ]);
  cache.dashboard = dashboard;
  cache.recycleBin = recycleBin;
  cache.backups = backups;
  cache.systemHealth = health;
  await loadAuditLogs();
  renderAdminOps();
}

export async function loadAuditLogs() {
  const params = new URLSearchParams({
    range: elements.ids.auditRange?.value || '',
    entity: elements.ids.auditEntity?.value || '',
    order: elements.ids.auditOrder?.value || 'newest',
    search: elements.ids.auditSearch?.value || ''
  });
  cache.auditLogs = await request(`/admin/audit-logs?${params.toString()}`);
}

export function renderAdminOps() {
  const dashboard = cache.dashboard;
  if (dashboard && elements.lists.metricCards) {
    elements.lists.metricCards.innerHTML = [
      metric('Faculties', dashboard.counts.faculties, `${dashboard.todayActivity} action(s) today`),
      metric('Programs', dashboard.counts.programs),
      metric('Courses', dashboard.counts.courses),
      metric('Program Courses', dashboard.counts.programCourses),
      metric('Relationships', dashboard.counts.relationships),
      metric('Hidden Relationships', dashboard.counts.hiddenRelationships),
      metric('Recycle Bin', dashboard.counts.recycleBin),
      metric('Avg Prerequisites', dashboard.analytics.averagePrerequisites)
    ].join('');
    elements.lists.analyticsCards.innerHTML = [
      metric('Visible Relationships', dashboard.analytics.visibleRelationships),
      metric('Courses Without Prerequisites', dashboard.analytics.coursesWithoutPrerequisites),
      metric('Courses Without Required-For', dashboard.analytics.coursesWithoutRequiredFor),
      metric('Largest Program', dashboard.analytics.largestProgram?.name || '-', `${dashboard.analytics.largestProgram?.count || 0} courses`),
      metric('Smallest Program', dashboard.analytics.smallestProgram?.name || '-', `${dashboard.analytics.smallestProgram?.count || 0} courses`),
      metric('Most Connected Course', dashboard.analytics.mostConnectedCourse?.code || '-', `${dashboard.analytics.mostConnectedCourse?.count || 0} links`),
      metric('Average Courses / Semester', dashboard.analytics.averageCoursesPerSemester),
      metric('Unused Courses', dashboard.analytics.unusedCourses)
    ].join('');
    elements.lists.activityList.innerHTML = dashboard.latestActivity?.length
      ? dashboard.latestActivity.map((log) => `<li><strong>${escapeHtml(log.action)}</strong> ${escapeHtml(log.entity)} <span>${escapeHtml(fmtDate(log.created_at))}</span></li>`).join('')
      : '<li class="empty-state">No audit activity yet.</li>';
  }

  if (elements.lists.auditLogs) {
    elements.lists.auditLogs.innerHTML = cache.auditLogs.map((log) => `<tr>
      <td>${escapeHtml(fmtDate(log.created_at))}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.entity)}</td>
      <td>${escapeHtml(log.entityId ?? '-')}</td>
      <td>${escapeHtml(log.description || '')}</td>
    </tr>`).join('') || '<tr><td colspan="5">No audit logs found.</td></tr>';
  }

  if (elements.lists.recycleBin) {
    elements.lists.recycleBin.innerHTML = cache.recycleBin.map((item) => `<tr>
      <td>${escapeHtml(item.kind)}</td>
      <td>${escapeHtml(item.label)}</td>
      <td>${escapeHtml(fmtDate(item.deleted_at))}</td>
      <td>${escapeHtml(item.deleted_by || '-')}</td>
      <td>${escapeHtml(item.dependencies)}</td>
      <td>
        <button type="button" data-restore="${item.id}" data-kind="${item.kind}">Restore</button>
        <button type="button" class="danger" data-purge="${item.id}" data-kind="${item.kind}">Permanent Delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6">Recycle bin is empty.</td></tr>';
  }

  if (elements.lists.backupList) {
    elements.lists.backupList.innerHTML = cache.backups.map((backup) => `<tr>
      <td>${escapeHtml(fmtDate(backup.created_at))}</td>
      <td>${escapeHtml(backup.format)}</td>
      <td>${escapeHtml(JSON.stringify(backup.record_counts))}</td>
      <td><button type="button" data-download-backup="${backup.id}">Download</button></td>
    </tr>`).join('') || '<tr><td colspan="4">No backups generated yet.</td></tr>';
  }

  if (elements.lists.healthList && cache.systemHealth) {
    const health = cache.systemHealth;
    elements.lists.healthList.innerHTML = [
      statusPill('Backend Status', health.backendStatus),
      statusPill('Database Status', health.databaseStatus),
      statusPill('Render API Status', health.renderApiStatus),
      statusPill('Supabase Status', health.supabaseStatus),
      metric('Last Backup', fmtDate(health.lastBackup)),
      metric('Last Import', fmtDate(health.lastImport)),
      metric('Last Export', fmtDate(health.lastExport)),
      metric('Migration Version', health.migrationVersion)
    ].join('');
  }
}

export function bindAdminOpsActions() {
  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-admin-tab]').forEach((item) => item.classList.toggle('is-active', item === button));
      document.querySelectorAll('[data-admin-panel]').forEach((panel) => {
        panel.hidden = panel.dataset.adminPanel !== button.dataset.adminTab;
      });
    });
  });

  [elements.ids.auditSearch, elements.ids.auditRange, elements.ids.auditEntity, elements.ids.auditOrder].forEach((field) => {
    field?.addEventListener('input', async () => {
      await loadAuditLogs();
      renderAdminOps();
    });
  });

  document.body.addEventListener('click', async (event) => {
    const quick = event.target.closest('[data-quick]');
    const restore = event.target.closest('[data-restore]');
    const purge = event.target.closest('[data-purge]');
    const exportBtn = event.target.closest('#exportCatalog');
    const backupBtn = event.target.closest('#createBackup');
    const downloadBackup = event.target.closest('[data-download-backup]');
    const validateImportBtn = event.target.closest('#validateImport');
    const runImportBtn = event.target.closest('#runImport');
    if (!quick && !restore && !purge && !exportBtn && !backupBtn && !downloadBackup && !validateImportBtn && !runImportBtn) return;

    try {
      if (quick) {
        document.querySelector(`[data-admin-tab="${quick.dataset.quick}"]`)?.click();
      }
      if (restore) {
        await request(`/admin/recycle-bin/${restore.dataset.kind}/${restore.dataset.restore}/restore`, { method: 'POST' });
        setMessage('success', 'Item restored.');
        await loadRelations();
        await loadAdminOps();
      }
      if (purge) {
        const confirmed = await openConfirmDialog({ title: 'Permanent Delete', description: 'This removes the item permanently after it has been reviewed in the recycle bin.', submitLabel: 'Permanent Delete' });
        if (!confirmed) return;
        await request(`/admin/recycle-bin/${purge.dataset.kind}/${purge.dataset.purge}`, { method: 'DELETE' });
        setMessage('success', 'Item permanently deleted.');
        await loadAdminOps();
      }
      if (exportBtn) {
        const payload = await download(`/admin/export?format=${encodeURIComponent(elements.ids.exportFormat.value)}`);
        downloadPayload(payload);
        await loadAdminOps();
      }
      if (backupBtn) {
        await request('/admin/backups', { method: 'POST', body: JSON.stringify({ format: elements.ids.backupFormat.value }) });
        setMessage('success', 'Backup generated.');
        await loadAdminOps();
      }
      if (downloadBackup) {
        downloadPayload(await download(`/admin/backups/${downloadBackup.dataset.downloadBackup}/download`));
      }
      if (validateImportBtn || runImportBtn) {
        const payload = await importPayload();
        const result = validateImportBtn
          ? await request('/admin/import/validate', { method: 'POST', body: JSON.stringify(payload) })
          : await request('/admin/import', { method: 'POST', body: JSON.stringify(payload) });
        elements.lists.importPreview.innerHTML = result.valid
          ? `<p class="success">${escapeHtml(result.inserted ? `Imported ${result.inserted} row(s).` : `${result.count} row(s) validated.`)}</p>`
          : `<ul>${result.errors.map((item) => `<li>Line ${escapeHtml(item.line)}: ${escapeHtml(item.error)}</li>`).join('')}</ul>`;
        await loadRelations();
        await loadAdminOps();
      }
    } catch (error) {
      setMessage('error', error.message);
    }
  });
}
