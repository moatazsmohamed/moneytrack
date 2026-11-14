import { getState, update, monthKey } from './storage.js';
import { e, icon, icons, empty, openModal, confirmDialog, toast } from './ui.js';
import { t, money, number, catName } from './translations.js';

const MAX_MONEY_CENTS = 100000000000000;
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

function parseMoneyCents(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return 0;
  if (!/^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/.test(raw)) throw new Error(t('finance.validation.budget'));
  const [wholePart, fractionPart = ''] = raw.split('.');
  const whole = BigInt(wholePart || '0');
  const cents = whole * 100n + BigInt((fractionPart + '00').slice(0, 2));
  if (cents < 0n || cents > BigInt(MAX_MONEY_CENTS)) throw new Error(t('finance.validation.budget'));
  return Number(cents);
}

function storedMoneyCents(value) {
  try {
    return parseMoneyCents(value);
  } catch {
    return 0;
  }
}

function centsValue(cents) {
  return Number((cents / 100).toFixed(2));
}

function inputMoney(value) {
  const cents = storedMoneyCents(value);
  if (!cents) return '';
  return (cents / 100).toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function monthTransactions(state, month) {
  return state.transactions.filter((transaction) => transaction.date.slice(0, 7) === month && transaction.type === 'expense');
}

export function budgetSummary(month = monthKey()) {
  const state = getState();
  const stored = state.budgets?.[month] || { total: 0, categories: {} };
  const totalCents = storedMoneyCents(stored.total);
  const expenses = monthTransactions(state, month);
  const spentCents = expenses.reduce((sum, transaction) => sum + storedMoneyCents(transaction.amount), 0);
  const remainingCents = totalCents - spentCents;
  const percent = totalCents > 0 ? Number(((spentCents / totalCents) * 100).toFixed(2)) : 0;
  const categories = state.categories.filter((category) => category.type === 'expense').map((category) => {
    const budgetCents = storedMoneyCents(stored.categories?.[category.id]);
    const categorySpentCents = expenses.filter((transaction) => transaction.categoryId === category.id).reduce((sum, transaction) => sum + storedMoneyCents(transaction.amount), 0);
    const categoryRemainingCents = budgetCents - categorySpentCents;
    const categoryPercent = budgetCents > 0 ? Number(((categorySpentCents / budgetCents) * 100).toFixed(2)) : 0;
    return {
      category,
      budget: centsValue(budgetCents),
      spent: centsValue(categorySpentCents),
      remaining: centsValue(categoryRemainingCents),
      percent: categoryPercent,
    };
  });
  return {
    total: centsValue(totalCents),
    spent: centsValue(spentCents),
    remaining: centsValue(remainingCents),
    percent,
    categories,
  };
}

function budgetForm(summary, month) {
  const state = getState();
  const stored = state.budgets?.[month] || { total: 0, categories: {} };
  const categories = state.categories.filter((category) => category.type === 'expense');
  return `<div class="form-grid" id="budget-form-fields"><label class="field span-2" for="budget-total"><span>${text(t('finance.budget.total'))}</span><input id="budget-total" name="total" type="number" min="0" max="1000000000000" step="0.01" value="${text(inputMoney(stored.total))}"></label><div class="span-2"><h3 class="section-title">${text(t('finance.budget.categoryAllocations'))}</h3></div>${categories.map((category) => `<label class="field" for="budget-category-${text(category.id)}"><span>${text(catName(category))}</span><input id="budget-category-${text(category.id)}" name="category_${text(category.id)}" type="number" min="0" max="1000000000000" step="0.01" value="${text(inputMoney(stored.categories?.[category.id]))}"></label>`).join('')}</div>`;
}

export function openBudgetEditor(month = selectedMonth) {
  if (!validMonth(month)) month = selectedMonth;
  const summary = budgetSummary(month);
  openModal({
    title: t('finance.budget.editTitle', { month }),
    body: budgetForm(summary, month),
    submitLabel: t('finance.actions.save'),
    onSubmit: async (form) => {
      const total = centsValue(parseMoneyCents(form.get('total')));
      const state = getState();
      const categories = {};
      state.categories.filter((category) => category.type === 'expense').forEach((category) => {
        const value = centsValue(parseMoneyCents(form.get(`category_${category.id}`)));
        if (value > 0) categories[category.id] = value;
      });
      try {
        update((draft) => {
          draft.budgets[month] = { total, categories };
        });
      } catch {
        throw new Error(t('storageError'));
      }
      selectedMonth = month;
      toast(t('finance.budget.updated'));
      if (activeContainer) drawBudgets(activeContainer);
      return true;
    },
  });
}

async function resetMonth() {
  if (!await confirmDialog(t('finance.budget.resetTitle'), t('finance.budget.resetMessage', { month: selectedMonth }))) return;
  try {
    update((draft) => {
      delete draft.budgets[selectedMonth];
    });
  } catch {
    toast(t('storageError'), 'error');
    return;
  }
  toast(t('finance.budget.resetDone'));
  if (activeContainer) drawBudgets(activeContainer);
}

function progressClass(percent) {
  if (percent >= 100) return 'danger-text';
  if (percent >= 80) return 'warning-text';
  return '';
}

function progress(summary, label) {
  if (summary.budget <= 0) return `<div class="stat-foot"><span>${text(t('unallocated'))}</span></div>`;
  const width = Math.min(100, Math.max(0, summary.percent));
  const status = summary.percent >= 100 ? t('finance.budget.over') : (summary.percent >= 80 ? t('finance.budget.warning') : t('finance.budget.onTrack'));
  return `<div class="progress" aria-label="${text(label)}"><div class="progress-fill ${progressClass(summary.percent)}" style="width:${width}%"></div></div><div class="stat-foot ${progressClass(summary.percent)}"><span>${text(number(summary.percent, 1))}%</span><span>${text(status)}</span></div>`;
}

function categoryBudgetCard(item) {
  if (item.budget <= 0) {
    return `<article class="budget-card" data-budget-category="${text(item.category.id)}"><div class="card-head"><div><h3>${text(catName(item.category))}</h3><p class="muted">${text(t('unallocated'))}</p></div></div><div class="budget-card-values"><span>${text(t('finance.budget.spent'))}</span><strong>${text(money(item.spent))}</strong></div><button type="button" class="btn btn-ghost" data-edit-budget>${icon('pencil')}<span>${text(t('setCategoryBudget'))}</span></button></article>`;
  }
  return `<article class="budget-card" data-budget-category="${text(item.category.id)}"><div class="card-head"><div><h3>${text(catName(item.category))}</h3><p class="muted">${text(t('finance.budget.spentOf', { spent: money(item.spent), budget: money(item.budget) }))}</p></div><span class="${progressClass(item.percent)}">${text(number(item.percent, 1))}%</span></div>${progress(item, catName(item.category))}<div class="budget-card-values"><span>${text(t('finance.budget.remaining'))}</span><strong class="${item.remaining < 0 ? 'danger-text' : ''}">${text(money(item.remaining))}</strong></div></article>`;
}

function drawBudgets(container) {
  if (!validMonth(selectedMonth)) selectedMonth = monthKey();
  const summary = budgetSummary(selectedMonth);
  const totalState = { budget: summary.total, percent: summary.percent };
  const hasTotalBudget = summary.total > 0;
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${text(t('budgetEyebrow'))}</div><h1>${text(t('budgets'))}</h1><p class="page-subtitle">${text(t('budgetSubtitle'))}</p></div></div><div class="toolbar" id="budgets-toolbar"><label class="field"><span>${text(t('finance.budget.month'))}</span><input id="budget-month" type="month" value="${text(selectedMonth)}" max="9999-12"></label><div class="toolbar-actions"><button type="button" class="btn btn-primary" data-edit-budget>${icon('pencil')}<span>${text(t('finance.actions.edit'))}</span></button><button type="button" class="btn btn-ghost" data-reset-budget>${icon('rotate-ccw')}<span>${text(t('finance.actions.reset'))}</span></button></div></div><div class="summary-grid" id="budget-summary"><article class="stat-card"><span class="stat-label">${text(t('finance.budget.total'))}</span><strong class="stat-value">${text(hasTotalBudget ? money(summary.total) : t('noBudgetSet'))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.spent'))}</span><strong class="stat-value ${hasTotalBudget && summary.percent >= 100 ? 'danger-text' : ''}">${text(money(summary.spent))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.remaining'))}</span><strong class="stat-value ${hasTotalBudget && summary.remaining < 0 ? 'danger-text' : ''}">${text(hasTotalBudget ? money(summary.remaining) : t('noBudgetSet'))}</strong></article><article class="stat-card"><span class="stat-label">${text(t('finance.budget.progress'))}</span><strong class="stat-value ${hasTotalBudget ? progressClass(summary.percent) : ''}">${text(hasTotalBudget ? `${number(summary.percent, 1)}%` : t('noBudgetSet'))}</strong>${progress(totalState, t('finance.budget.progress'))}</article></div><div class="card" id="budget-categories-card"><div class="card-head"><div><h2 class="section-title">${text(t('finance.budget.categoryAllocations'))}</h2><p class="muted">${text(t('finance.budget.actualDescription'))}</p></div></div>${summary.categories.length ? `<div class="budget-grid" id="budget-category-grid">${summary.categories.map(categoryBudgetCard).join('')}</div>` : empty(t('finance.budget.noExpenseCategories'), 'pie-chart')}</div>`;
  icons();
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
