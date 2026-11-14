import { getState } from './storage.js';
import { e, icon, icons, empty, openModal, confirmDialog, toast } from './ui.js';
import { t, money, formatDate, catName } from './translations.js';

const MAX_AMOUNT = 1e12;
const MAX_TITLE = 240;
const MAX_DESCRIPTION = 1000;
const FREQUENCIES = ['weekly', 'monthly', 'yearly'];
const TYPES = ['income', 'expense'];

export { FREQUENCIES };

export function isRealDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return false;
  const [year, month, day] = String(value).split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

export function parsePositiveAmount(value, message = t('extensions.validation.amount')) {
  const raw = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) throw new Error(message);
  const amount = Number(raw);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_AMOUNT) throw new Error(message);
  return Number(amount.toFixed(2));
}

export function validateRecurringInput(input, categories = []) {
  const title = String(input?.title ?? '').trim();
  if (!title || title.length > MAX_TITLE) throw new Error(t('extensions.validation.ruleTitle'));
  const amount = parsePositiveAmount(input?.amount);
  const type = String(input?.type ?? '');
  if (!TYPES.includes(type)) throw new Error(t('extensions.validation.type'));
  const categoryId = String(input?.categoryId ?? '');
  if (!categories.some((category) => category.id === categoryId && category.type === type)) throw new Error(t('extensions.validation.category'));
  const frequency = String(input?.frequency ?? '');
  if (!FREQUENCIES.includes(frequency)) throw new Error(t('extensions.validation.frequency'));
  const startDate = String(input?.startDate ?? '');
  const endDate = String(input?.endDate ?? '').trim() || null;
  if (!isRealDate(startDate) || (endDate && !isRealDate(endDate))) throw new Error(t('extensions.validation.date'));
  if (endDate && endDate < startDate) throw new Error(t('extensions.validation.endDate'));
  const description = String(input?.description ?? '').trim();
  if (description.length > MAX_DESCRIPTION) throw new Error(t('extensions.validation.description'));
  return { title, amount, type, categoryId, frequency, startDate, endDate, description, active: input?.active !== false };
}

function getApi() {
  if (typeof globalThis.api === 'function') return globalThis.api;
  return import('./api-client.js').then((module) => module.api);
}

async function request(path, options) {
  const api = await getApi();
  if (typeof api !== 'function') throw new Error(t('extensions.api.unavailable'));
  return api(path, options);
}

async function refresh() {
  const storage = await import('./storage.js');
  if (typeof storage.refreshState !== 'function') throw new Error(t('extensions.api.unavailable'));
  return storage.refreshState();
}

const SERVER_ERROR_KEYS = new Set(['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'REVISION_CONFLICT', 'FORBIDDEN', 'UNAUTHORIZED', 'RECURRING_NOT_FOUND', 'PROCESSING_UNAVAILABLE', 'RATE_LIMITED', 'SERVER_ERROR', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'CSRF_UNAVAILABLE', 'INVALID_RESPONSE', 'REQUEST_FAILED', 'UNAUTHENTICATED', 'ACCOUNT_SUSPENDED', 'INVALID_DATE_RANGE']);
function errorMessage(error) {
  const code = String(error?.code || '').toUpperCase();
  return SERVER_ERROR_KEYS.has(code) ? t(`extensions.api.${code}`) : t('extensions.api.generic');
}

async function commit(path, options, successKey) {
  try {
    await request(path, options);
    await refresh();
    toast(t(successKey));
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  }
}

function categoryOptions(state, type, selected) {
  return (state.categories || []).filter((category) => category.type === type).map((category) => `<option value="${e(category.id)}" ${category.id === selected ? 'selected' : ''}>${e(catName(category))}</option>`).join('');
}

function ruleForm(rule = null) {
  const state = getState() || {};
  const current = rule || { title: '', amount: '', type: 'expense', categoryId: '', frequency: 'monthly', startDate: new Date().toISOString().slice(0, 10), endDate: '', description: '', active: true };
  return `<div class="form-grid"><label class="field span-2"><span>${e(t('extensions.recurring.title'))}</span><input name="title" maxlength="240" required value="${e(current.title)}" placeholder="${e(t('extensions.recurring.titlePlaceholder'))}" autofocus></label><label class="field"><span>${e(t('extensions.recurring.amount'))}</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="1000000000000" required value="${e(current.amount)}"></label><label class="field"><span>${e(t('extensions.recurring.type'))}</span><select name="type" required>${TYPES.map((type) => `<option value="${type}" ${current.type === type ? 'selected' : ''}>${e(t(`extensions.type.${type}`))}</option>`).join('')}</select></label><label class="field"><span>${e(t('extensions.recurring.category'))}</span><select name="categoryId" required>${categoryOptions(state, current.type, current.categoryId)}</select></label><label class="field"><span>${e(t('extensions.recurring.frequency'))}</span><select name="frequency" required>${FREQUENCIES.map((frequency) => `<option value="${frequency}" ${current.frequency === frequency ? 'selected' : ''}>${e(t(`extensions.frequency.${frequency}`))}</option>`).join('')}</select></label><label class="field"><span>${e(t('extensions.recurring.startDate'))}</span><input name="startDate" type="date" required value="${e(current.startDate)}"></label><label class="field"><span>${e(t('extensions.recurring.endDate'))}</span><input name="endDate" type="date" value="${e(current.endDate || '')}"><small>${e(t('extensions.optional'))}</small></label><label class="field span-2"><span>${e(t('extensions.recurring.description'))}</span><textarea name="description" maxlength="1000" placeholder="${e(t('extensions.recurring.descriptionPlaceholder'))}">${e(current.description || '')}</textarea></label></div>`;
}

function openRuleEditor(container, rule = null) {
  const modal = openModal({
    title: t(rule ? 'extensions.recurring.editTitle' : 'extensions.recurring.addTitle'),
    submitLabel: t(rule ? 'extensions.actions.save' : 'extensions.actions.create'),
    body: ruleForm(rule),
    onSubmit: async (form) => {
      const state = getState() || {};
      const payload = validateRecurringInput({ title: form.get('title'), amount: form.get('amount'), type: form.get('type'), categoryId: form.get('categoryId'), frequency: form.get('frequency'), startDate: form.get('startDate'), endDate: form.get('endDate'), description: form.get('description'), active: rule?.active ?? true }, state.categories || []);
      const ok = await commit(rule ? `/recurring/${encodeURIComponent(rule.id)}` : '/recurring', { method: rule ? 'PATCH' : 'POST', body: payload }, rule ? 'extensions.recurring.updated' : 'extensions.recurring.created');
      if (!ok) throw new Error(t('extensions.api.generic'));
      draw(container);
    },
  });
  if (!modal) return;
  modal.form.querySelector('[name="type"]')?.addEventListener('change', (event) => {
    const category = modal.form.querySelector('[name="categoryId"]');
    category.innerHTML = categoryOptions(getState() || {}, event.target.value, '');
  });
}

function ruleCard(rule, container) {
  const state = getState() || {};
  const category = (state.categories || []).find((item) => item.id === rule.categoryId);
  const occurrences = [...(rule.occurrences || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const status = rule.active ? 'active' : 'paused';
  return `<article class="extension-card recurring-card" data-rule-id="${e(rule.id)}"><div class="extension-card-head"><div><span class="badge badge-${rule.type}">${e(t(`extensions.type.${rule.type}`))}</span><h2>${e(rule.title)}</h2><p class="muted">${e(catName(category))} · ${e(t(`extensions.frequency.${rule.frequency}`))}</p></div><div class="row-actions"><button type="button" class="icon-btn" data-edit-rule="${e(rule.id)}" aria-label="${e(t('extensions.actions.edit') + ': ' + rule.title)}">${icon('pencil')}</button><button type="button" class="icon-btn delete" data-delete-rule="${e(rule.id)}" aria-label="${e(t('extensions.actions.delete') + ': ' + rule.title)}">${icon('trash-2')}</button></div></div><div class="extension-amount-row"><strong class="amount-${rule.type === 'income' ? 'positive' : 'negative'}">${rule.type === 'income' ? '+' : '−'}${e(money(rule.amount))}</strong><span class="extension-status ${status}">${e(t(`extensions.recurring.${status}`))}</span></div><dl class="extension-details"><div><dt>${e(t('extensions.recurring.nextDue'))}</dt><dd>${rule.nextDueDate ? e(formatDate(rule.nextDueDate)) : e(t('extensions.recurring.noNextDue'))}</dd></div><div><dt>${e(t('extensions.recurring.startDate'))}</dt><dd>${e(formatDate(rule.startDate))}</dd></div>${rule.endDate ? `<div><dt>${e(t('extensions.recurring.endDate'))}</dt><dd>${e(formatDate(rule.endDate))}</dd></div>` : ''}</dl><div class="extension-card-actions"><button type="button" class="btn btn-secondary" data-toggle-rule="${e(rule.id)}" data-next-active="${String(!rule.active)}">${icon(rule.active ? 'pause' : 'play')}<span>${e(t(rule.active ? 'extensions.recurring.pause' : 'extensions.recurring.resume'))}</span></button></div>${occurrences.length ? `<div class="extension-history"><h3>${e(t('extensions.recurring.history'))}</h3><ul>${occurrences.slice(0, 6).map((item) => `<li><span>${e(formatDate(item.date))}</span><small>${e(t('extensions.recurring.processed'))}</small></li>`).join('')}</ul></div>` : `<div class="extension-inline-empty">${e(t('extensions.recurring.noHistory'))}</div>`}</article>`;
}

function draw(container) {
  const state = getState() || {};
  const rules = Array.isArray(state.recurring) ? state.recurring : [];
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${e(t('extensions.recurring.eyebrow'))}</div><h1>${e(t('extensions.recurring.titlePage'))}</h1><p class="page-subtitle">${e(t('extensions.recurring.subtitle'))}</p></div><div class="page-actions"><button type="button" class="btn btn-secondary" data-process-due>${icon('refresh-cw')}<span>${e(t('extensions.recurring.processDue'))}</span></button><button type="button" class="btn btn-primary" data-add-rule>${icon('plus')}<span>${e(t('extensions.recurring.add'))}</span></button></div></div><div class="notice">${icon('info')}<span>${e(t('extensions.recurring.disclaimer'))}</span></div>${rules.length ? `<div class="extension-grid">${rules.map((rule) => ruleCard(rule, container)).join('')}</div>` : `<section class="card">${empty(t('extensions.recurring.empty'), 'repeat-2')}</section>`}`;
  icons(container);
}

export function renderRecurring(container) {
  if (!container) return;
  draw(container);
  if (container.dataset.recurringBound === 'true') return;
  container.dataset.recurringBound = 'true';
  container.addEventListener('click', async (event) => {
    const state = getState() || {};
    const ruleId = event.target.closest('[data-edit-rule], [data-delete-rule], [data-toggle-rule]')?.dataset.editRule || event.target.closest('[data-edit-rule], [data-delete-rule], [data-toggle-rule]')?.dataset.deleteRule || event.target.closest('[data-edit-rule], [data-delete-rule], [data-toggle-rule]')?.dataset.toggleRule;
    const rule = (state.recurring || []).find((item) => item.id === ruleId);
    if (event.target.closest('[data-add-rule]')) return openRuleEditor(container);
    if (event.target.closest('[data-process-due]')) {
      const button = event.target.closest('[data-process-due]');
      button.disabled = true;
      try {
        await request('/recurring/process', { method: 'POST', body: {} });
        await refresh();
        toast(t('extensions.recurring.processedSuccess'));
        draw(container);
      } catch (error) { toast(errorMessage(error), 'error'); button.disabled = false; }
      return;
    }
    if (event.target.closest('[data-edit-rule]') && rule) return openRuleEditor(container, rule);
    const toggle = event.target.closest('[data-toggle-rule]');
    if (toggle && rule) {
      if (await commit(`/recurring/${encodeURIComponent(rule.id)}`, { method: 'PATCH', body: { active: toggle.dataset.nextActive === 'true' } }, rule.active ? 'extensions.recurring.pausedSuccess' : 'extensions.recurring.resumedSuccess')) draw(container);
      return;
    }
    const remove = event.target.closest('[data-delete-rule]');
    if (remove && rule && await confirmDialog(t('extensions.recurring.deleteTitle'), t('extensions.recurring.deleteMessage', { name: rule.title }))) {
      if (await commit(`/recurring/${encodeURIComponent(rule.id)}`, { method: 'DELETE', body: { confirm: 'DELETE' } }, 'extensions.recurring.deleted')) draw(container);
    }
  });
}
