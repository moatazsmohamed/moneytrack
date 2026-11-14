import { getState, monthKey } from './storage.js';
import { t, money, number, catName } from './translations.js';
import { e, icon, icons, empty } from './ui.js';
import { openTransaction, transactionTable, bindTransactionActions } from './transactions.js';
import { budgetSummary } from './budgets.js';
import { sum, inRange, monthRange, previousMonth, monthlySeries, categorySpending, incomeExpenseChart, doughnutChart, trendChart, chart } from './charts.js';

let selectedMonth = monthKey(), recentType = 'all';
function comparison(current, previous, lowerGood = false) {
  if (!previous) return `<span>${t('noPreviousActivity')}</span>`;
  const percent = (current - previous) / Math.abs(previous) * 100;
  const good = lowerGood ? percent <= 0 : percent >= 0;
  return `<span class="change ${good ? '' : 'bad'}">${icon(percent >= 0 ? 'trending-up' : 'trending-down')}${number(Math.abs(percent), 1)}%</span><span>${t('vsLastMonth')}</span>`;
}
export function statCard(label, value, iconName, previous, className = '', lowerGood = false) {
  return `<article class="stat-card ${className}"><div class="stat-top"><span class="stat-label">${e(label)}</span><span class="stat-icon ${iconName === 'arrow-up-right' ? 'expense' : iconName === 'piggy-bank' ? 'savings' : ''}">${icon(iconName)}</span></div><div class="stat-value">${e(money(value))}</div><div class="stat-foot">${comparison(value, previous, lowerGood)}</div></article>`;
}
export function legendHTML(spending) {
  const total = spending.reduce((n, x) => n + x.amount, 0);
  return spending.length ? `<div class="category-legend">${spending.slice(0, 5).map(({ category, amount }) => `<div class="category-legend-row"><span class="legend-dot" style="background:${category.color}"></span><span>${e(catName(category))}</span><strong>${e(money(amount))}</strong><small>${number(amount / total * 100)}%</small></div>`).join('')}</div>` : empty(t('noExpenses'), 'chart-pie');
}
export function renderDashboard(container) {
  const state = getState(), { start, end } = monthRange(selectedMonth);
  const rows = inRange(state.transactions, start, end), prior = monthRange(previousMonth(selectedMonth));
  const priorRows = inRange(state.transactions, prior.start, prior.end);
  const income = sum(rows, 'income'), expense = sum(rows, 'expense');
  const balance = sum(state.transactions, 'income') - sum(state.transactions, 'expense');
  const past = state.transactions.filter(x => x.date <= prior.end);
  const previousBalance = sum(past, 'income') - sum(past, 'expense');
  const series = monthlySeries(state.transactions, selectedMonth), spending = categorySpending(rows);
  const recent = rows.filter(x => recentType === 'all' || x.type === recentType).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);
  const budget = budgetSummary(selectedMonth);
  const percent = budget.total ? expense / budget.total * 100 : 0;
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${t('financialWorkspace')}</div><h1>${t('overview')}</h1><p class="page-subtitle">${t('overviewSubtitle')}</p></div><div class="page-actions"><input class="month-control" type="month" id="dashboard-month" value="${selectedMonth}" aria-label="${t('selectMonth')}"><button class="btn btn-primary" id="dashboard-add">${icon('plus')}${t('addTransaction')}</button></div></div>
    ${state.transactions.some(x => x.demo) ? `<div class="demo-banner notice"><span>${icon('sparkles')}</span><span>${t('demoNotice')}</span><a class="btn btn-ghost" href="#settings" style="margin-inline-start:auto">${t('manageData')}${icon('arrow-up-right')}</a></div>` : ''}
    <div class="summary-grid">${statCard(t('totalBalance'), balance, 'wallet', previousBalance, 'balance-card')}${statCard(t('totalIncome'), income, 'arrow-down-left', sum(priorRows, 'income'))}${statCard(t('totalExpenses'), expense, 'arrow-up-right', sum(priorRows, 'expense'), '', true)}${statCard(t('monthlySavings'), income - expense, 'piggy-bank', sum(priorRows, 'income') - sum(priorRows, 'expense'))}</div>
    <div class="chart-grid"><section class="card"><div class="card-head"><div><h2>${t('incomeVsExpenses')}</h2><p>${t('sixMonthView')}</p></div><div class="legend"><span><i class="legend-dot"></i>${t('income')}</span><span><i class="legend-dot navy"></i>${t('expenses')}</span></div></div><div class="chart-canvas"><canvas id="income-expenses-chart" aria-label="${t('incomeVsExpenses')}" role="img"></canvas></div></section>
    <section class="card"><div class="card-head"><div><h2>${t('spendingByCategory')}</h2><p>${t('whereMoneyGoes')}</p></div>${icon('chart-pie')}</div><div class="doughnut-wrap"><div class="chart-canvas doughnut"><canvas id="category-chart" aria-label="${t('spendingByCategory')}" role="img"></canvas></div><div class="doughnut-center"><small>${t('totalSpent')}</small><strong>${e(money(expense))}</strong></div></div>${legendHTML(spending)}</section></div>
    <div class="table-budget-grid"><section class="card recent-card"><div class="card-head"><div><h2>${t('recentTransactions')}</h2><p>${t('latestActivity')}</p></div><a href="#transactions" class="btn btn-ghost">${t('viewAll')}${icon('arrow-up-right')}</a></div><div class="toolbar"><div class="segmented" id="recent-filters">${['all','income','expense'].map(type => `<button class="${recentType === type ? 'active' : ''}" data-recent-type="${type}" aria-pressed="${recentType === type}">${t(type === 'expense' ? 'expenses' : type)}</button>`).join('')}</div></div>${recent.length ? transactionTable(recent, { compact: true }) : empty(t('noTransactions'), 'receipt-text')}</section>
    <section class="card"><div class="card-head"><div><h2>${t('monthlyBudget')}</h2><p>${t('stayOnTrack')}</p></div><a href="#budgets" class="icon-btn" aria-label="${t('manageBudgets')}">${icon('arrow-up-right')}</a></div><div class="budget-overview"><div class="stat-value">${e(money(Math.max(0, budget.total - expense)))}</div><p>${budget.total ? t('remainingOf', { amount: money(budget.total) }) : t('noBudgetSet')}</p></div>${budget.total ? `<div class="budget-line"><div class="budget-line-head"><span>${t('totalBudget')}</span><strong>${number(percent)}%</strong></div><div class="progress"><div class="progress-fill ${percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : ''}" style="width:${Math.min(100, Math.max(0, percent))}%"></div></div><small>${money(expense)} / ${money(budget.total)}</small></div>` : ''}${budget.categories.slice(0, 3).map(x => `<div class="budget-line"><div class="budget-line-head"><span><i class="legend-dot" style="background:${x.category.color}"></i>${e(catName(x.category))}</span><strong>${number(x.percent)}%</strong></div><div class="progress"><div class="progress-fill ${x.percent >= 100 ? 'danger' : x.percent >= 80 ? 'warning' : ''}" style="width:${Math.min(100, Math.max(0, x.percent))}%"></div></div><small>${e(money(x.spent))} / ${e(money(x.budget))}</small></div>`).join('')}<a class="budget-note" href="#budgets">${icon(percent >= 100 ? 'triangle-alert' : 'circle-check')}${budget.total ? t(percent >= 100 ? 'overBudget' : percent >= 80 ? 'nearBudget' : 'budgetHealthy') : t('setFirstBudget')}</a></section></div>
    <div class="chart-grid"><section class="card"><div class="card-head"><div><h2>${t('monthlySpending')}</h2><p>${t('dailyExpenses')}</p></div>${icon('chart-column')}</div><div class="chart-canvas short"><canvas id="spending-chart" aria-label="${t('monthlySpending')}" role="img"></canvas></div></section><section class="card"><div class="card-head"><div><h2>${t('financialTrends')}</h2><p>${t('savingsOverTime')}</p></div>${icon('chart-line')}</div><div class="chart-canvas short"><canvas id="trends-chart" aria-label="${t('financialTrends')}" role="img"></canvas></div></section></div><p class="muted" style="font-size:10px">${t('balanceExplanation')}</p>`;
  container.querySelector('#dashboard-add').addEventListener('click', () => openTransaction());
  container.querySelector('#dashboard-month').addEventListener('change', ev => { if (/^\d{4}-\d{2}$/.test(ev.target.value)) { selectedMonth = ev.target.value; window.dispatchEvent(new Event('moneytrack:render')); } });
  container.querySelectorAll('[data-recent-type]').forEach(button => button.addEventListener('click', () => { recentType = button.dataset.recentType; window.dispatchEvent(new Event('moneytrack:render')); }));
  bindTransactionActions(container);
  incomeExpenseChart('income-expenses-chart', series);
  doughnutChart('category-chart', spending);
  trendChart('trends-chart', series);
  const days = Number(end.slice(-2));
  const daily = Array.from({ length: days }, (_, i) => ({ label: number(i + 1), amount: sum(rows.filter(x => x.date === `${selectedMonth}-${String(i + 1).padStart(2, '0')}`), 'expense') }));
  chart('spending-chart', 'bar', { labels: daily.map(x => x.label), datasets: [{ label: t('expenses'), data: daily.map(x => x.amount), backgroundColor: '#188d7290', borderRadius: 3, maxBarThickness: 13 }] });
  icons();
}
