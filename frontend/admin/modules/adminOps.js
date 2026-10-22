import { escapeHtml } from '../../shared/dom.js';
import { download, request } from './apiClient.js';
import { elements, setMessage, withButtonBusy } from './adminDom.js';
import { loadRelations } from './dataLoader.js';
import { openConfirmDialog } from './dialogs.js';
import { cache } from './state.js';
import { activateAdminTab } from '../../shared/adminNavigation.js';

const loadedSections = new Set();
const sectionRequests = new Map();
const sectionRequestVersions = new Map();
let auditRequestVersion = 0;

function fmtDate(value) {
  return value ? new Date(value).toLocaleString() : '-';
}

function supportRequestHref(log) {
  const id = log.target_id || log.entityId || log.entity_id;
  if (cache.adminRole !== 'super_admin' || !['complaint', 'password_reset_request'].includes(log.entity) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(id || ''))) return null;
  const params = new URLSearchParams({ tab: 'requests', [log.entity === 'complaint' ? 'complaint' : 'resetRequest']: String(id) });
  return `index.html?${params.toString()}`;
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
    <button type="button" data-import-review="${escapeHtml(stage.id)}" aria-label="Review staged ${escapeHtml(stage.type)} import">Review preview</button>
    <button type="button" data-import-publish="${escapeHtml(stage.id)}" data-preview-version="${escapeHtml(stage.previewVersion)}" aria-label="Publish reviewed ${escapeHtml(stage.type)} import" ${stage.valid ? '' : 'disabled'}>Publish</button>
    <button type="button" class="secondary" data-import-cancel="${escapeHtml(stage.id)}" aria-label="Cancel staged ${escapeHtml(stage.type)} import">Cancel stage</button>
  </div>`).join('') || '<p class="empty-state">No active staged imports.</p>';
}

export async function loadAdminSection(section, { refresh = false } = {}) {
  if (loadedSections.has(section) && !refresh) return;
  if (sectionRequests.has(section) && !refresh) return sectionRequests.get(section);
  const requestVersion = (sectionRequestVersions.get(section) || 0) + 1;
  sectionRequestVersions.set(section, requestVersion);
  const task = (async () => {
    if (section === 'dashboard') {
      const dashboard = await request('/admin/dashboard');
      if (sectionRequestVersions.get(section) === requestVersion) cache.dashboard = dashboard;
    }
    else if (section === 'audit') await loadAuditLogs();
    else if (section === 'recycle' && cache.adminRole === 'super_admin') {
      const recycleBin = await request('/admin/recycle-bin');
      if (sectionRequestVersions.get(section) === requestVersion) cache.recycleBin = recycleBin;
    } else if (section === 'backup') {
      const backups = await request('/admin/backups');
      if (sectionRequestVersions.get(section) === requestVersion) cache.backups = backups;
    } else if (section === 'health' && cache.adminRole === 'super_admin') {
      const health = await request('/admin/system-health');
      if (sectionRequestVersions.get(section) === requestVersion) cache.systemHealth = health;
    } else if (section === 'transfer') {
      const importStages = await request('/admin/import/stages');
      if (sectionRequestVersions.get(section) === requestVersion) cache.importStages = importStages;
    }
    else return;
    if (sectionRequestVersions.get(section) !== requestVersion) return;
    loadedSections.add(section);
    renderAdminOps();
  })();
  sectionRequests.set(section, task);
  try {
    await task;
  } finally {
    if (sectionRequests.get(section) === task) sectionRequests.delete(section);
  }
}

export async function loadAdminOps() {
  const sections = new Set(['dashboard', ...loadedSections]);
  await Promise.all([...sections].map((section) => loadAdminSection(section, { refresh: true })));
  renderAdminOps();
}

export async function loadAuditLogs() {
  const requestVersion = ++auditRequestVersion;
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
  const auditLogs = await request(`/admin/audit-logs?${params.toString()}`);
  if (requestVersion !== auditRequestVersion) return;
  cache.auditLogs = auditLogs;
  loadedSections.add('audit');
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
      ? dashboard.latestActivity.map((log) => {
        const href = supportRequestHref(log);
        const destination = log.entity === 'complaint' ? 'complaint details' : 'request';
        return `<li><strong>${escapeHtml(log.action)}</strong> ${escapeHtml(log.description || log.entity)} <span>by ${escapeHtml(log.actor_name || 'Legacy event')} · ${escapeHtml(fmtDate(log.created_at))}</span>${href ? ` <a href="${escapeHtml(href)}">View ${destination}</a>` : ''}</li>`;
      }).join('')
      : '<li class="empty-state">No audit activity yet.</li>';
  }

  if (elements.lists.auditLogs) {
    elements.lists.auditLogs.innerHTML = cache.auditLogs.map((log) => `<tr>
      <td>${escapeHtml(fmtDate(log.created_at))}</td>
      <td>${escapeHtml(log.action)}</td>
      <td>${escapeHtml(log.entity)}</td>
      <td>${supportRequestHref(log) ? `<a href="${escapeHtml(supportRequestHref(log))}">${escapeHtml(log.entityId ?? log.target_id ?? '-')} · View</a>` : escapeHtml(log.entityId ?? log.target_id ?? '-')}</td>
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
        <button type="button" data-restore="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" aria-label="Restore ${escapeHtml(item.kind)}: ${escapeHtml(item.label)}">Restore</button>
        <button type="button" class="danger" data-purge="${escapeHtml(item.id)}" data-kind="${escapeHtml(item.kind)}" aria-label="Permanently delete ${escapeHtml(item.kind)}: ${escapeHtml(item.label)}">Permanently delete</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="6">Recycle bin is empty.</td></tr>';
  }

  if (elements.lists.backupList) {
    elements.lists.backupList.innerHTML = cache.backups.map((backup) => `<tr>
      <td>${escapeHtml(fmtDate(backup.created_at))}</td>
      <td>${escapeHtml(backup.format)}</td>
      <td>${escapeHtml(JSON.stringify(backup.record_counts))}</td>
      <td><button type="button" data-download-backup="${escapeHtml(backup.id)}" aria-label="Download ${escapeHtml(backup.format)} backup created ${escapeHtml(fmtDate(backup.created_at))}">Download backup</button></td>
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
  document.querySelector('[role="tablist"]')?.addEventListener('keydown', (event) => {
    const current = event.target.closest('[role="tab"][data-admin-tab]');
    if (!current) return;
    const tabs = [...document.querySelectorAll('[role="tab"][data-admin-tab]:not([hidden]):not([disabled])')];
    const index = tabs.indexOf(current);
    if (index < 0) return;
    let nextIndex = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % tabs.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = tabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex].dataset.adminTab;
    activateAdminTab(nextTab, cache.adminRole, document, window, { focus: true });
    loadAdminSection(nextTab).catch((error) => setMessage('error', error.message));
  });

  document.querySelectorAll('[data-admin-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      activateAdminTab(button.dataset.adminTab, cache.adminRole);
      loadAdminSection(button.dataset.adminTab).catch((error) => setMessage('error', error.message));
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
    if (quick) {
      if (!activateAdminTab(quick.dataset.quick, cache.adminRole)) setMessage('error', 'That administrator section is not available to your account.');
      else loadAdminSection(quick.dataset.quick).catch((error) => setMessage('error', error.message));
      return;
    }

    const actionButton = restore || purge || exportBtn || backupBtn || downloadBackup || validateImportBtn || stageImportBtn || reviewImport || publishImport || cancelImport;
    await withButtonBusy(actionButton, async () => {
    const progress = restore ? 'Restoring the catalog item…' : purge ? 'Permanently deleting the catalog item…' : exportBtn ? 'Preparing the catalog export…' : backupBtn ? 'Generating the catalog backup…' : downloadBackup ? 'Preparing the backup download…' : validateImportBtn ? 'Validating the import…' : stageImportBtn ? 'Saving the staged import…' : reviewImport ? 'Loading the saved preview…' : publishImport ? 'Publishing the reviewed catalog changes…' : 'Cancelling the staged import…';
    setMessage('progress', progress);
    try {
      if (restore) {
        await request(`/admin/recycle-bin/${restore.dataset.kind}/${restore.dataset.restore}/restore`, { method: 'POST' });
        setMessage('success', 'Item restored.');
        await loadRelations();
        await loadAdminOps();
      }
      if (purge) {
        const item = cache.recycleBin.find((entry) => String(entry.id) === purge.dataset.purge);
        const label = item?.label || `${purge.dataset.kind} record`;
        const confirmed = await openConfirmDialog({ title: `Permanently delete ${label}?`, description: `This permanently removes ${label} from the recycle bin. It cannot be restored afterward. Review its listed dependencies before continuing.`, submitLabel: 'Permanently delete' });
        if (!confirmed) return;
        await request(`/admin/recycle-bin/${purge.dataset.kind}/${purge.dataset.purge}`, { method: 'DELETE' });
        setMessage('success', 'Item permanently deleted.');
        await loadAdminOps();
      }
      if (exportBtn) {
        const payload = await download(`/admin/export?format=${encodeURIComponent(elements.ids.exportFormat.value)}`);
        downloadPayload(payload);
        setMessage('success', 'The catalog export is ready; your browser should begin downloading it.');
        await loadAdminOps();
      }
      if (backupBtn) {
        await request('/admin/backups', { method: 'POST', body: JSON.stringify({ format: elements.ids.backupFormat.value }) });
        setMessage('success', 'Backup generated.');
        await loadAdminOps();
      }
      if (downloadBackup) {
        downloadPayload(await download(`/admin/backups/${downloadBackup.dataset.downloadBackup}/download`));
        setMessage('success', 'The backup download is ready; your browser should begin downloading it.');
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
        const stage = cache.importStages.find((item) => item.id === cancelImport.dataset.importCancel);
        const summary = stage ? `${stage.count} ${stage.type} row(s) will no longer be publishable.` : 'The selected staged import will no longer be publishable.';
        const confirmed = await openConfirmDialog({ title: 'Cancel this staged import?', description: `${summary} The stage will remain listed only until its 24-hour expiry.`, submitLabel: 'Cancel staged import', danger: false });
        if (!confirmed) return;
        await request(`/admin/import/stages/${encodeURIComponent(cancelImport.dataset.importCancel)}`, { method: 'DELETE' });
        cache.importStages = await request('/admin/import/stages');
        renderImportStages();
        setMessage('success', 'Staged import cancelled.');
      }
      if (publishImport) {
        const stage = cache.importStages.find((item) => item.id === publishImport.dataset.importPublish);
        if (!stage?.valid) throw new Error('Review a valid staged import before publishing.');
        const confirmed = await openConfirmDialog({ title: 'Publish the reviewed catalog import?', description: `Publish ${stage.count} ${stage.type} row(s) from the preview you reviewed? Catalog changes and their audit record are written together. If the preview is stale, publication will stop and you will be asked to review the updated changes.`, submitLabel: 'Publish reviewed import', danger: false });
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
  });
}
