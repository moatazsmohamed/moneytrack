import { getState, update, monthKey } from './storage.js';
import { e, icon, empty, openModal, confirmDialog, toast } from './ui.js';
import { t, money, number, catName } from './translations.js';

let selectedMonth = monthKey();
let activeContainer = null;

function text(value) {
  return e(value == null ? '' : String(value));
}

function validMonth(value) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ''))) return false;
  const [year, month] = String(value).split('-').map(Number);
  return year >= 1 && year <= 9999 && month >= 1 && month <= 12;
}

function parseBudget(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 0;
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new Error(t('finance.validation.budget'));
  const result = Number(raw);
  if (!Number.isFinite(result) || result < 0 || result > 1000000000000) throw new Error(t('finance.validation.budget'));
  return Number(result.toFixed(2));
}

function monthTransactions(state, month) {
  return state.transactions.filter((transaction) => transaction.date.slice(0, 7) === month && transaction.type === 'expense');
}

export function budgetSummary(month = monthKey()) {
  const state = getState();
  const stored = state.budgets?.[month] || { total: 0, categories: {} };
  const total = Number(stored.total || 0);
  const expenses = monthTransactions(state, month);
  const spent = Number(expenses.reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0).toFixed(2));
  const remaining = Number((total - spent).toFixed(2));
  const percent = total > 0 ? Number(((spent / total) * 100).toFixed(2)) : 0;
  const categories = state.categories.filter((category) => category.type === 'expense').map((category) => {
    const budget = Number(stored.categories?.[category.id] || 0);
    const categorySpent = Number(expenses.filter((transaction) => transaction.categoryId === category.id).reduce((sum, transaction) => sum + Number(transaction.amount || 0), 0).toFixed(2));
    const categoryRemaining = Number((budget - categorySpent).toFixed(2));
    const categoryPercent = budget > 0 ? Number(((categorySpent / budget) * 100).toFixed(2)) : 0;
    return { category, budget, spent: categorySpent, remaining: categoryRemaining, percent: categoryPercent };
  });
  return { total, spent, remaining, percent, categories };
}

function budgetForm(summary, month) {
  const state = getState();
  const stored = state.budgets?.[month] || { total: 0, categories: {} };
  const categories = state.categories.filter((category) => category.type === 'expense');
  return `<div class="form-grid" id="budget-form-fields"><label class="field span-2" for="budget-total"><span>${text(t('finance.budget.total'))}</span><input id="budget-total" name="total" type="number" min="0" max="1000000000000" step="0.01" value="${text(stored.total || '')}"></label><div class="span-2"><h3 class="section-title">${text(t('finance.budget.categoryAllocations'))}</h3></div>${categories.map((category) => `<label class="field" for="budget-category-${text(category.id)}"><span>${text(catName(category))}</span><input id="budget-category-${text(category.id)}" name="category_${text(category.id)}" type="number" min="0" max="1000000000000" step="0.01" value="${text(stored.categories?.[category.id] || '')}"></label>`).join('')}</div>`;
}

export function openBudgetEditor(month = selectedMonth) {
  if (!validMonth(month)) month = selectedMonth;
  const summary = budgetSummary(month);
  openModal({
    title: t('finance.budget.editTitle', { month }),
    body: budgetForm(summary, month),
    submitLabel: t('finance.actions.save'),
    onSubmit: async (form) => {
      const total = parseBudget(form.get('total'));
      const state = getState();
      const categories = {};
      state.categories.filter((category) => category.type === 'expense').forEach((category) => {
        const value = parseBudget(form.get(`category_${category.id}`));
        if (value > 0) categories[category.id] = value;
      });
      update((draft) => {
        draft.budgets[month] = { total, categories };
      });
      selectedMonth = month;
      toast(t('finance.budget.updated'));
      if (activeContainer) drawBudgets(activeContainer);
      return true;
    },
  });
}

async function resetMonth() {
  if (!await confirmDialog(t('finance.budget.resetTitle'), t('finance.budget.resetMessage', { month: selectedMonth }))) return;
  update((draft) => {
    delete draft.budgets[selectedMonth];
  });
  toast(t('finance.budget.resetDone'));
  if (activeContainer) drawBudgets(activeContainer);
}

function progressClass(percent) {
  if (percent >= 100) return 'danger-text';
  if (percent >= 80) return 'warning-text';
  return '';
}

function progress(summary, label) {
  const width = Math.min(100, Math.max(0, summary.percent));
  const status = summary.percent >= 100 ? t('finance.budget.over') : (summary.percent >= 80 ? t('finance.budget.warning') : t('finance.budget.onTrack'));
  return `<div class="progress" aria-label="${text(label)}"><div class="progress-fill ${progressClass(summary.percent)}" style="width:${width}%"></div></div><div class="stat-foot ${progressClass(summary.percent)}"><span>${text(number(summary.percent, 1))}%</span><span>${text(status)}</span></div>`;
}

function categoryBudgetCard(item) {
  return `<article class="budget-card" data-budget-category="${text(item.category.id)}"><div class="card-head"><div><h3>${text(catName(item.category))}</h3><p class="muted">${text(t('finance.budget.spentOf', { spent: money(item.spent), budget: money(item.budget) }))}</p></div><span class="${progressClass(item.percent)}">${text(number(item.percent, 1))}%</span></div>${progress(item, catName(item.category))}<div class="budget-card-values"><span>${text(t('finance.budget.remaining'))}</span><strong class="${item.remaining < 0 ? 'danger-text' : ''}">${text(money(item.remaining))}</strong></div></article>`;
}

function drawBudgets(container) {
  if (!validMonth(selectedMonth)) selectedMonth = monthKey();
  const summary = budgetSummary(selectedMonth);
  const totalState = { percent: summary.percent };
  container.innerHTML = `<div class="toolbar" id="budgets-toolbar"><label class="field"><span>${text(t('finance.budget.month'))}</span><input id="budget-month" type="month" value="${text(selectedMonth)}" max="9999-12"></label><div class="toolbar-actions"><button type="button" class="btn btn-primary" data-edit-budget>${icon('pencil')}<span>${text(t('finance.actions.edit'))}</span></button><button type="button" class="btn btn-ghost" data-reset-budget>${icon('rotate-ccw')}<span>${text(t('finance.actions.reset'))}</span></button></div></div><div class="summary-grid" id="budget-summary"><article class="stat-card"><span class="stat-label">${text(t('finance.budget.total'))}</span><strong class="stat-value">${text(money(summary.total))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.spent'))}</span><strong class="stat-value ${summary.percent >= 100 ? 'danger-text' : ''}">${text(money(summary.spent))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.remaining'))}</span><strong class="stat-value ${summary.remaining < 0 ? 'danger-text' : ''}">${text(money(summary.remaining))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.progress'))}</span><strong class="stat-value ${progressClass(summary.percent)}">${text(number(summary.percent, 1))}%</strong>${progress(totalState, t('finance.budget.progress'))}</article></div><div class="card" id="budget-categories-card"><div class="card-head"><div><h2 class="section-title">${text(t('finance.budget.categoryAllocations'))}</h2><p class="muted">${text(t('finance.budget.actualDescription'))}</p></div></div>${summary.categories.length ? `<div class="budget-grid" id="budget-category-grid">${summary.categories.map(categoryBudgetCard).join('')}</div>` : empty(t('finance.budget.noExpenseCategories'), 'pie-chart')}</div>`;
}

export function renderBudgets(container) {
  activeContainer = container;
  drawBudgets(container);
  if (container.dataset.budgetViewBound === 'true') return;
  container.dataset.budgetViewBound = 'true';
  container.addEventListener('change', (event) => {
    if (!event.target.matches('#budget-month')) return;
    if (!validMonth(event.target.value)) {
      toast(t('finance.validation.month'), 'error');
      event.target.value = selectedMonth;
      return;
    }
    selectedMonth = event.target.value;
    drawBudgets(container);
  });
  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-edit-budget]')) openBudgetEditor(selectedMonth);
    if (event.target.closest('[data-reset-budget]')) resetMonth();
  });
}

export { selectedMonth };
