import { escapeHtml } from '../../shared/dom.js';
import { elements } from './adminDom.js';

let activeResolver = null;
let previousFocus = null;

function closeDialog(result) {
  elements.dialog.backdrop.hidden = true;
  elements.dialog.cancel.hidden = false;
  elements.dialog.form.onsubmit = null;
  activeResolver?.(result);
  activeResolver = null;
  previousFocus?.focus?.();
}

function fieldMarkup(field) {
  const value = escapeHtml(field.value ?? '');
  const common = `id="${field.name}" name="${field.name}" ${field.required ? 'required' : ''}`;
  if (field.type === 'select') {
    return `<label for="${field.name}">${escapeHtml(field.label)}</label><select ${common}>${field.options
      .map((option) => `<option value="${escapeHtml(option.value)}" ${String(option.value) === String(field.value) ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
      .join('')}</select>`;
  }
  if (field.type === 'textarea') {
    return `<label for="${field.name}">${escapeHtml(field.label)}</label><textarea ${common}>${value}</textarea>`;
  }
  return `<label for="${field.name}">${escapeHtml(field.label)}</label><input ${common} type="${field.type || 'text'}" value="${value}" ${field.min ? `min="${escapeHtml(field.min)}"` : ''} />`;
}

export function setupDialogs() {
  elements.dialog.cancel.addEventListener('click', () => closeDialog(null));
  elements.dialog.close.addEventListener('click', () => closeDialog(null));
  elements.dialog.backdrop.addEventListener('click', (event) => {
    if (event.target === elements.dialog.backdrop) closeDialog(null);
  });
  document.addEventListener('keydown', (event) => {
    if (elements.dialog.backdrop.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeDialog(null);
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...elements.dialog.form.querySelectorAll('button:not([disabled]):not([hidden]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')]
      .filter((item) => item.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !elements.dialog.form.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

export function openFormDialog({ title, description, fields, submitLabel = 'Save', danger = false, onOpen }) {
  previousFocus = document.activeElement;
  elements.dialog.title.textContent = title;
  elements.dialog.description.textContent = description || '';
  elements.dialog.fields.innerHTML = fields.map(fieldMarkup).join('');
  elements.dialog.submit.textContent = submitLabel;
  elements.dialog.submit.classList.toggle('danger', danger);
  elements.dialog.backdrop.hidden = false;

  const firstField = elements.dialog.fields.querySelector('input, select, textarea');
  setTimeout(() => (firstField || elements.dialog.submit).focus(), 0);

  return new Promise((resolve) => {
    activeResolver = resolve;
    onOpen?.(elements.dialog.fields);
    elements.dialog.form.onsubmit = (event) => {
      event.preventDefault();
      const formData = new FormData(elements.dialog.form);
      closeDialog(Object.fromEntries(formData.entries()));
    };
  });
}

export function openConfirmDialog({ title, description, submitLabel = 'Delete', danger = true }) {
  return openFormDialog({
    title,
    description,
    fields: [],
    submitLabel,
    danger
  });
}

export function openContentDialog({ title, description = '', content, submitLabel = 'Close', onOpen }) {
  previousFocus = document.activeElement;
  elements.dialog.title.textContent = title;
  elements.dialog.description.textContent = description;
  elements.dialog.fields.innerHTML = content;
  elements.dialog.submit.textContent = submitLabel;
  elements.dialog.submit.classList.remove('danger');
  elements.dialog.cancel.hidden = true;
  elements.dialog.backdrop.hidden = false;
  setTimeout(() => (elements.dialog.fields.querySelector('input, select, button') || elements.dialog.submit).focus(), 0);

  activeResolver = null;
  elements.dialog.form.onsubmit = (event) => {
    event.preventDefault();
    closeDialog(true);
  };
  onOpen?.(elements.dialog.fields);
}
