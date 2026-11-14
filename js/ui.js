import { t } from './translations.js';

let modalState = null;
let toastTimer = 0;

export function e(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function icon(name, cls = '') {
  const aliases = { 'chart-no-axes-combined': 'bar-chart-3', 'chart-no-axes-column': 'bar-chart', 'chart-column': 'bar-chart-3', 'chart-line': 'line-chart', 'chart-pie': 'pie-chart' };
  const safeName = String(aliases[name] || name || 'circle').replace(/[^A-Za-z0-9:_-]/g, '');
  const safeClass = String(cls || '').replace(/[^A-Za-z0-9_ -]/g, '').trim();
  return `<i data-lucide="${e(safeName)}"${safeClass ? ` class="${e(safeClass)}"` : ''} aria-hidden="true"></i>`;
}

export function icons(root = typeof document !== 'undefined' ? document : null) {
  if (!root) return;
  const lucide = globalThis.lucide || globalThis.Lucide;
  if (lucide && typeof lucide.createIcons === 'function') {
    try { lucide.createIcons({ root }); } catch { try { lucide.createIcons(); } catch { /* optional vendor script */ } }
  }
}

function ensureRoot(id, className) {
  if (typeof document === 'undefined') return null;
  let root = document.getElementById(id);
  if (!root) {
    root = document.createElement('div');
    root.id = id;
    root.className = className;
    document.body?.append(root);
  }
  return root;
}

export function toast(message, type = 'success') {
  const root = ensureRoot('toast-root', 'toast-container');
  if (!root) return null;
  const item = document.createElement('div');
  const safeType = ['success', 'error', 'warning', 'info'].includes(type) ? type : 'info';
  item.className = `toast toast-${safeType}`;
  item.setAttribute('role', safeType === 'error' ? 'alert' : 'status');
  item.setAttribute('aria-live', safeType === 'error' ? 'assertive' : 'polite');
  item.textContent = String(message ?? '');
  root.append(item);
  globalThis.requestAnimationFrame?.(() => item.classList.add('is-visible'));
  globalThis.setTimeout?.(() => {
    item.classList.remove('is-visible');
    globalThis.setTimeout?.(() => item.remove(), 250);
  }, 4200);
  return item;
}

function focusable(dialog) {
  return [...dialog.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((node) => node.offsetParent !== null || node === document.activeElement);
}

function renderBody(target, body) {
  if (typeof Node !== 'undefined' && body instanceof Node) target.append(body);
  else target.innerHTML = String(body ?? '');
}

export function closeModal() {
  if (!modalState) return;
  const current = modalState;
  modalState = null;
  current.root.hidden = true;
  current.root.replaceChildren();
  document.removeEventListener('keydown', current.onKeyDown, true);
  document.body.style.overflow = current.previousOverflow;
  document.querySelectorAll('.workspace, .sidebar').forEach(node => { node.inert = false; });
  current.root.removeEventListener('click', current.onRootClick);
  current.onCancel?.();
  try { current.restoreFocus?.focus?.(); } catch { /* element may have been removed */ }
}

export function openModal({ title, body = '', onSubmit, submitLabel, onCancel } = {}) {
  if (typeof document === 'undefined') return null;
  if (modalState) closeModal();
  const root = ensureRoot('modal-root', 'modal-root');
  if (!root) return null;
  const restoreFocus = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement ? document.activeElement : null;
  root.hidden = false;
  root.setAttribute('aria-live', 'polite');
  root.innerHTML = '';

  const dialog = document.createElement('section');
  dialog.className = 'modal-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'modal-title');
  dialog.tabIndex = -1;
  const header = document.createElement('header');
  header.className = 'modal-head';
  const heading = document.createElement('h2');
  heading.id = 'modal-title';
  heading.textContent = String(title ?? '');
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn modal-close';
  close.setAttribute('aria-label', t('closeDialog'));
  close.innerHTML = icon('x');
  close.addEventListener('click', () => closeModal());
  header.append(heading, close);

  const form = document.createElement('form');
  form.className = 'modal-form';
  form.noValidate = true;
  const content = document.createElement('div');
  content.className = 'modal-body';
  renderBody(content, body);
  const error = document.createElement('div');
  error.className = 'modal-error danger-text';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  error.id = 'modal-error';
  const footer = document.createElement('footer');
  footer.className = 'modal-foot';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-secondary';
  cancel.textContent = t('cancel');
  cancel.addEventListener('click', () => closeModal());
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  submit.textContent = submitLabel || t('save');
  footer.append(cancel, submit);
  form.append(content, error, footer);
  dialog.append(header, form);
  root.append(dialog);

  const onSubmitEvent = async (event) => {
    event.preventDefault();
    error.hidden = true;
    error.textContent = '';
    if (typeof onSubmit !== 'function') {
      closeModal();
      return;
    }
    submit.disabled = true;
    cancel.disabled = true;
    try {
      const result = await onSubmit(new FormData(form), form);
      if (result === false) throw new Error(t('invalidForm'));
      closeModal();
    } catch (reason) {
      error.textContent = reason?.message || String(reason) || t('invalidForm');
      error.hidden = false;
      submit.disabled = false;
      cancel.disabled = false;
      const firstInvalid = form.querySelector(':invalid');
      (firstInvalid || submit).focus();
    }
  };
  form.addEventListener('submit', onSubmitEvent);

  const onKeyDown = (event) => {
    if (!modalState) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const nodes = focusable(dialog);
    if (!nodes.length) { event.preventDefault(); dialog.focus(); return; }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  const onRootClick = (event) => {
    if (event.target === root) closeModal();
  };
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.querySelectorAll('.workspace, .sidebar').forEach(node => { node.inert = true; });
  modalState = { root, dialog, restoreFocus, onKeyDown, onRootClick, onCancel, previousOverflow };
  root.addEventListener('click', onRootClick);
  document.addEventListener('keydown', onKeyDown, true);
  icons(dialog);
  const autofocus = dialog.querySelector('[autofocus]');
  (autofocus || focusable(dialog)[0] || dialog).focus();
  return { root, dialog, form, close: closeModal };
}

export function confirmDialog(title, message) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') { resolve(false); return; }
    let settled = false;
    const settle = (value) => {
      if (!settled) { settled = true; resolve(value); }
    };
    openModal({
      title,
      body: `<p class="modal-message">${e(message)}</p>`,
      submitLabel: t('confirm'),
      onSubmit: () => { settle(true); },
      onCancel: () => settle(false),
    });
  });
}

export function download(content, name = 'download.txt', mime = 'text/plain;charset=utf-8') {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return false;
  const blob = content instanceof Blob ? content : new Blob([String(content ?? '')], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = String(name || 'download.txt');
  anchor.style.display = 'none';
  document.body?.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout?.(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function empty(message, iconName = 'inbox') {
  return `<div class="empty-state" role="status">${icon(iconName, 'empty-state-icon')}<p>${e(message)}</p></div>`;
}
