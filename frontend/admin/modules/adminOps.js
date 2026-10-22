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

function renderImportPreview(preview, diff = null) {
  if (!elements.lists.importPreview) return;
  const rows = Array.isArray(preview.rows) ? preview.rows : [];
  const shownRows = rows.slice(0, 100);
  const errorList = (preview.errors || []).map((item) => `<li>Line ${escapeHtml(item.line)}: ${escapeHtml(item.error)}</li>`).join('');
  const rowList = shownRows.map((row, index) => `<li><strong>${index + 1}.</strong> <code>${escapeHtml(JSON.stringify(row))}</code></li>`).join('');
  const changes = diff
    ? `<p class="warning">The catalog changed since this preview. Review the refreshed validation and explicitly publish again.</p>
       <p>${escapeHtml(diff.addedErrors?.length || 0)} new validation issue(s), ${escapeHtml(diff.resolvedErrors?.length || 0)} resolved; catalog reference context changed: ${diff.catalogReferencesChanged ? 'yes' : 'no'}.</p>`
    : '';
  elements.lists.importPreview.innerHTML = `<p>${preview.status === 'staged' ? 'Staged for review' : 'Validation preview'}: ${escapeHtml(preview.count ?? rows.length)} row(s); ${preview.valid ? 'valid' : 'has errors'}${preview.previewVersion ? `; preview v${escapeHtml(preview.previewVersion)}` : ''}${preview.expiresAt ? `; expires ${escapeHtml(fmtDate(preview.expiresAt))}` : ''}.</p>
    ${changes}${errorList ? `<ul>${errorList}</ul>` : '<p>No validation errors.</p>'}
    ${rowList ? `<details><summary>Preview rows${rows.length > shownRows.length ? ` (first ${shownRows.length} of ${rows.length})` : ''}</summary><ol>${rowList}</ol></details>` : ''}`;
}

function renderImportStages() {
  if (!elements.lists.importStages) return;
  elements.lists.importStages.innerHTML = cache.importStages.map((stage) => `<div class="import-stage-row">
    <span><strong>${escapeHtml(stage.type)}</strong> · ${escapeHtml(stage.count)} row(s) · expires ${escapeHtml(fmtDate(stage.expiresAt))}</span>
    <button type="button" data-import-review="${escapeHtml(stage.id)}">Review</button>
    <button type="button" data-import-publish="${escapeHtml(stage.id)}" data-preview-version="${escapeHtml(stage.previewVersion)}" ${stage.valid ? '' : 'disabled'}>Publish</button>
    <button type="button" data-import-cancel="${escapeHtml(stage.id)}">Cancel</button>
  </div>`).join('') || '<p class="empty-state">No active staged imports.</p>';
}

export async function loadAdminOps() {
  const [dashboard, recycleBin, backups, health, importStages] = await Promise.all([
    request('/admin/dashboard'),
    cache.adminRole === 'super_admin' ? request('/admin/recycle-bin') : Promise.resolve([]),
    request('/admin/backups'),
    cache.adminRole === 'super_admin' ? request('/admin/system-health') : Promise.resolve(null),
    request('/admin/import/stages')
  ]);
  cache.dashboard = dashboard;
  cache.recycleBin = recycleBin;
  cache.backups = backups;
  cache.systemHealth = health;
  cache.importStages = importStages;
  await loadAuditLogs();
  renderAdminOps();
}

export async function loadAuditLogs() {
  const params = new URLSearchParams({
    range: elements.ids.auditRange?.value || '',
    entity: elements.ids.auditEntity?.value || '',
    order: elements.ids.auditOrder?.value || 'newest',
    search: elements.ids.auditSearch?.value || '',
    category: elements.ids.auditCategory?.value || '',
    actor: elements.ids.auditActor?.value || '',
    from: elements.ids.auditFrom?.value || '',
    to: elements.ids.auditTo?.value || '',
    limit: '50',
    offset: String(cache.auditOffset)
  });
  cache.auditLogs = await request(`/admin/audit-logs?${params.toString()}`);
  if (elements.ids.auditPrevious) elements.ids.auditPrevious.disabled = cache.auditOffset === 0;
  if (elements.ids.auditNext) elements.ids.auditNext.disabled = cache.auditLogs.length < 50;
  if (elements.ids.auditPage) elements.ids.auditPage.textContent = `Page ${Math.floor(cache.auditOffset / 50) + 1}`;
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
      ? dashboard.latestActivity.map((log) => `<li><strong>${escapeHtml(log.action)}</strong> ${escapeHtml(log.entity)} <span>by ${escapeHtml(log.actor_name || 'Legacy event')} · ${escapeHtml(fmtDate(log.created_at))}</span></li>`).join('')
      : '<li class="empty-state">No audit activity yet.</li>';
  }

  if (elements.lists.auditLogs) {
    elements.lists.auditLogs.innerHTML = cache.auditLogs.map((log) => `<tr>
      <td>${escapeHtml(fmtDate(log.created_at))}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.entity)}</td>
      <td>${escapeHtml(log.entityId ?? log.target_id ?? '-')}</td>
      <td>${escapeHtml(log.actor_name || 'Legacy event')}${log.actor_role ? ` (${escapeHtml(log.actor_role)})` : ''}</td>
      <td>${escapeHtml(log.category || 'admin')}</td>
      <td>${escapeHtml(log.outcome || 'success')}</td>
      <td>${escapeHtml(log.request_id || '-')}</td>
      <td>${escapeHtml(log.description || '')}</td>
    </tr>`).join('') || '<tr><td colspan="9">No audit logs found.</td></tr>';
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
  renderImportStages();
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

  [elements.ids.auditSearch, elements.ids.auditRange, elements.ids.auditEntity, elements.ids.auditOrder, elements.ids.auditCategory, elements.ids.auditActor, elements.ids.auditFrom, elements.ids.auditTo].forEach((field) => {
    field?.addEventListener('input', async () => {
      cache.auditOffset = 0;
      await loadAuditLogs();
      renderAdminOps();
    });
  });

  elements.ids.auditPrevious?.addEventListener('click', async () => { cache.auditOffset = Math.max(0, cache.auditOffset - 50); await loadAuditLogs(); renderAdminOps(); });
  elements.ids.auditNext?.addEventListener('click', async () => { if (cache.auditLogs.length < 50) return; cache.auditOffset += 50; await loadAuditLogs(); renderAdminOps(); });

  document.body.addEventListener('click', async (event) => {
    const quick = event.target.closest('[data-quick]');
    const restore = event.target.closest('[data-restore]');
    const purge = event.target.closest('[data-purge]');
    const exportBtn = event.target.closest('#exportCatalog');
    const backupBtn = event.target.closest('#createBackup');
    const downloadBackup = event.target.closest('[data-download-backup]');
    const validateImportBtn = event.target.closest('#validateImport');
    const stageImportBtn = event.target.closest('#stageImport');
    const reviewImport = event.target.closest('[data-import-review]');
    const publishImport = event.target.closest('[data-import-publish]');
    const cancelImport = event.target.closest('[data-import-cancel]');
    if (!quick && !restore && !purge && !exportBtn && !backupBtn && !downloadBackup && !validateImportBtn && !stageImportBtn && !reviewImport && !publishImport && !cancelImport) return;

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
      if (validateImportBtn || stageImportBtn) {
        const payload = await importPayload();
        const result = validateImportBtn
          ? await request('/admin/import/validate', { method: 'POST', body: JSON.stringify(payload) })
          : await request('/admin/import/stages', { method: 'POST', body: JSON.stringify(payload) });
        renderImportPreview(result);
        if (stageImportBtn) {
          elements.ids.importContent.value = '';
          if (elements.ids.importFile) elements.ids.importFile.value = '';
          cache.importStages = await request('/admin/import/stages');
          renderImportStages();
          setMessage('success', 'Import staged. Review the saved preview before publishing.');
        }
      }
      if (reviewImport) {
        const stage = await request(`/admin/import/stages/${encodeURIComponent(reviewImport.dataset.importReview)}`);
        renderImportPreview(stage);
      }
      if (cancelImport) {
        const confirmed = await openConfirmDialog({ title: 'Cancel Staged Import', description: 'This prevents publication. The staged data is retained only until its 24-hour expiry and then cleaned up.', submitLabel: 'Cancel Import' });
        if (!confirmed) return;
        await request(`/admin/import/stages/${encodeURIComponent(cancelImport.dataset.importCancel)}`, { method: 'DELETE' });
        cache.importStages = await request('/admin/import/stages');
        renderImportStages();
        setMessage('success', 'Staged import cancelled.');
      }
      if (publishImport) {
        const stage = cache.importStages.find((item) => item.id === publishImport.dataset.importPublish);
        if (!stage?.valid) throw new Error('Review a valid staged import before publishing.');
        const confirmed = await openConfirmDialog({ title: 'Publish Catalog Import', description: `Publish ${stage.count} ${stage.type} row(s)? This will write catalog changes and an audit record in one transaction.`, submitLabel: 'Publish Import' });
        if (!confirmed) return;
        const result = await request(`/admin/import/stages/${encodeURIComponent(stage.id)}/publish`, {
          method: 'POST', body: JSON.stringify({ previewVersion: Number(publishImport.dataset.previewVersion) })
        });
        renderImportPreview({ ...result.stage, valid: true, count: result.inserted, rows: [] });
        cache.importStages = await request('/admin/import/stages');
        renderImportStages();
        await loadRelations();
        await loadAdminOps();
        setMessage('success', `Published ${result.inserted} import row(s).`);
      }
    } catch (error) {
      if (error.data?.stage) renderImportPreview(error.data.stage, error.data.diff || null);
      if (['IMPORT_PREVIEW_STALE', 'IMPORT_PREVIEW_VERSION_CONFLICT'].includes(error.code)) {
        cache.importStages = await request('/admin/import/stages').catch(() => cache.importStages);
        renderImportStages();
      }
      setMessage('error', error.message);
    }
  });
}
