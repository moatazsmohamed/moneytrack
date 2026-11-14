import { getState } from './storage.js';
import { e, icon, icons, empty, openModal, confirmDialog, toast } from './ui.js';
import { t, money, number, formatDate } from './translations.js';

const MAX_AMOUNT = 1e12;
const MAX_TITLE = 120;
const MAX_NOTE = 240;

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

export function validateGoalInput(input) {
  const title = String(input?.title ?? '').trim();
  if (!title || title.length > MAX_TITLE) throw new Error(t('extensions.validation.goalTitle'));
  const targetAmount = parsePositiveAmount(input?.targetAmount);
  const targetDate = String(input?.targetDate ?? '').trim() || null;
  if (targetDate && !isRealDate(targetDate)) throw new Error(t('extensions.validation.date'));
  return { title, targetAmount, targetDate };
}

export function validateContributionInput(input) {
  const amount = parsePositiveAmount(input?.amount);
  const date = String(input?.date ?? '').trim();
  const note = String(input?.note ?? '').trim();
  if (!isRealDate(date)) throw new Error(t('extensions.validation.date'));
  if (note.length > MAX_NOTE) throw new Error(t('extensions.validation.note'));
  return { amount, date, note };
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

const SERVER_ERROR_KEYS = new Set(['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'REVISION_CONFLICT', 'FORBIDDEN', 'UNAUTHORIZED', 'GOAL_NOT_FOUND', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'CSRF_UNAVAILABLE', 'INVALID_RESPONSE', 'REQUEST_FAILED', 'UNAUTHENTICATED', 'ACCOUNT_SUSPENDED', 'RATE_LIMITED', 'SERVER_ERROR']);
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

function goalProgress(goal) {
  const contributions = Array.isArray(goal?.contributions) ? goal.contributions : [];
  const listedAmount = contributions.reduce((total, item) => total + (Number(item.amount) || 0), 0);
  const currentAmount = contributions.length ? listedAmount : (Number(goal?.currentAmount) || 0);
  const targetAmount = Number(goal?.targetAmount) || 0;
  const percent = targetAmount > 0 ? Math.min(100, Math.max(0, (currentAmount / targetAmount) * 100)) : 0;
  return { currentAmount: Number(currentAmount.toFixed(2)), targetAmount, percent: Number(percent.toFixed(1)) };
}

function goalForm(goal = null) {
  const current = goal || { title: '', targetAmount: '', targetDate: '' };
  return `<div class="form-grid"><label class="field span-2"><span>${e(t('extensions.goal.title'))}</span><input name="title" maxlength="120" required value="${e(current.title)}" placeholder="${e(t('extensions.goal.titlePlaceholder'))}" autofocus></label><label class="field"><span>${e(t('extensions.goal.targetAmount'))}</span><input name="targetAmount" type="number" inputmode="decimal" step="0.01" min="0.01" max="1000000000000" required value="${e(current.targetAmount)}"></label><label class="field"><span>${e(t('extensions.goal.targetDate'))}</span><input name="targetDate" type="date" value="${e(current.targetDate || '')}"><small>${e(t('extensions.optional'))}</small></label></div>`;
}

function contributionForm() {
  return `<div class="form-grid"><label class="field"><span>${e(t('extensions.goal.contributionAmount'))}</span><input name="amount" type="number" inputmode="decimal" step="0.01" min="0.01" max="1000000000000" required></label><label class="field"><span>${e(t('extensions.goal.contributionDate'))}</span><input name="date" type="date" required value="${e(new Date().toISOString().slice(0, 10))}"></label><label class="field span-2"><span>${e(t('extensions.goal.note'))}</span><textarea name="note" maxlength="240" placeholder="${e(t('extensions.goal.notePlaceholder'))}"></textarea></label></div>`;
}

function openGoalEditor(container, goal = null) {
  openModal({
    title: t(goal ? 'extensions.goal.editTitle' : 'extensions.goal.addTitle'),
    submitLabel: t(goal ? 'extensions.actions.save' : 'extensions.actions.create'),
    body: goalForm(goal),
    onSubmit: async (form) => {
      const payload = validateGoalInput({ title: form.get('title'), targetAmount: form.get('targetAmount'), targetDate: form.get('targetDate') });
      const ok = await commit(goal ? `/goals/${encodeURIComponent(goal.id)}` : '/goals', { method: goal ? 'PATCH' : 'POST', body: payload }, goal ? 'extensions.goal.updated' : 'extensions.goal.created');
      if (!ok) throw new Error(t('extensions.api.generic'));
      draw(container);
    },
  });
}

function openContributionEditor(container, goal) {
  openModal({
    title: t('extensions.goal.addContributionTitle', { name: goal.title }),
    submitLabel: t('extensions.actions.add'),
    body: contributionForm(),
    onSubmit: async (form) => {
      const payload = validateContributionInput({ amount: form.get('amount'), date: form.get('date'), note: form.get('note') });
      const ok = await commit(`/goals/${encodeURIComponent(goal.id)}/contributions`, { method: 'POST', body: payload }, 'extensions.goal.contributionAdded');
      if (!ok) throw new Error(t('extensions.api.generic'));
      draw(container);
    },
  });
}

function goalCard(goal, container) {
  const progress = goalProgress(goal);
  const contributions = [...(goal.contributions || [])].sort((a, b) => String(b.date).localeCompare(String(a.date)));
  return `<article class="extension-card goal-card" data-goal-id="${e(goal.id)}"><div class="extension-card-head"><div><h2>${e(goal.title)}</h2><p class="muted">${goal.targetDate ? `${e(t('extensions.goal.targetDate'))}: ${e(formatDate(goal.targetDate))}` : e(t('extensions.goal.noTargetDate'))}</p></div><div class="row-actions"><button type="button" class="icon-btn" data-edit-goal="${e(goal.id)}" aria-label="${e(t('extensions.actions.edit') + ': ' + goal.title)}">${icon('pencil')}</button><button type="button" class="icon-btn delete" data-delete-goal="${e(goal.id)}" aria-label="${e(t('extensions.actions.delete') + ': ' + goal.title)}">${icon('trash-2')}</button></div></div><div class="extension-amount-row"><strong>${e(money(progress.currentAmount))}</strong><span>${e(t('extensions.goal.ofTarget', { target: money(progress.targetAmount) }))}</span></div><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress.percent}" aria-label="${e(t('extensions.goal.progress'))}"><div class="progress-fill" style="width:${progress.percent}%"></div></div><div class="extension-meta"><span>${e(number(progress.percent, 1))}%</span><span>${e(t('extensions.goal.contributionCount', { count: contributions.length }))}</span></div><div class="extension-card-actions"><button type="button" class="btn btn-primary" data-add-contribution="${e(goal.id)}">${icon('plus')}<span>${e(t('extensions.goal.addContribution'))}</span></button></div>${contributions.length ? `<div class="extension-history"><h3>${e(t('extensions.goal.recentContributions'))}</h3><ul>${contributions.slice(0, 5).map((item) => `<li><span><strong>${e(money(item.amount))}</strong><small>${e(formatDate(item.date))}${item.note ? ` · ${e(item.note)}` : ''}</small></span><button type="button" class="icon-btn delete" data-delete-contribution="${e(item.id)}" data-goal-id="${e(goal.id)}" aria-label="${e(t('extensions.actions.delete') + ': ' + money(item.amount))}">${icon('trash-2')}</button></li>`).join('')}</ul></div>` : `<div class="extension-inline-empty">${e(t('extensions.goal.noContributions'))}</div>`}</article>`;
}

function draw(container) {
  const state = getState() || {};
  const goals = Array.isArray(state.goals) ? state.goals : [];
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${e(t('extensions.goals.eyebrow'))}</div><h1>${e(t('extensions.goals.title'))}</h1><p class="page-subtitle">${e(t('extensions.goals.subtitle'))}</p></div><div class="page-actions"><button type="button" class="btn btn-primary" data-add-goal>${icon('plus')}<span>${e(t('extensions.goal.add'))}</span></button></div></div>${goals.length ? `<div class="extension-grid">${goals.map((goal) => goalCard(goal, container)).join('')}</div>` : `<section class="card">${empty(t('extensions.goals.empty'), 'target')}</section>`}`;
  icons(container);
}

export function renderGoals(container) {
  if (!container) return;
  draw(container);
  if (container.dataset.goalsBound === 'true') return;
  container.dataset.goalsBound = 'true';
  container.addEventListener('click', async (event) => {
    const state = getState() || {};
    const goalId = event.target.closest('[data-edit-goal], [data-delete-goal], [data-add-contribution]')?.dataset.editGoal || event.target.closest('[data-edit-goal], [data-delete-goal], [data-add-contribution]')?.dataset.deleteGoal || event.target.closest('[data-edit-goal], [data-delete-goal], [data-add-contribution]')?.dataset.addContribution;
    const goal = (state.goals || []).find((item) => item.id === goalId);
    if (event.target.closest('[data-add-goal]')) return openGoalEditor(container);
    if (event.target.closest('[data-edit-goal]') && goal) return openGoalEditor(container, goal);
    if (event.target.closest('[data-add-contribution]') && goal) return openContributionEditor(container, goal);
    const deleteGoal = event.target.closest('[data-delete-goal]');
    if (deleteGoal && goal && await confirmDialog(t('extensions.goal.deleteTitle'), t('extensions.goal.deleteMessage', { name: goal.title }))) {
      if (await commit(`/goals/${encodeURIComponent(goal.id)}`, { method: 'DELETE', body: { confirm: 'DELETE' } }, 'extensions.goal.deleted')) draw(container);
    }
    const deleteContribution = event.target.closest('[data-delete-contribution]');
    if (deleteContribution) {
      const targetGoal = (getState().goals || []).find((item) => item.id === deleteContribution.dataset.goalId);
      const contribution = targetGoal?.contributions?.find((item) => item.id === deleteContribution.dataset.deleteContribution);
      if (contribution && await confirmDialog(t('extensions.goal.deleteContributionTitle'), t('extensions.goal.deleteContributionMessage'))) {
        if (await commit(`/goals/${encodeURIComponent(targetGoal.id)}/contributions/${encodeURIComponent(contribution.id)}`, { method: 'DELETE' }, 'extensions.goal.contributionDeleted')) draw(container);
      }
    }
  });
}

export { goalProgress };
