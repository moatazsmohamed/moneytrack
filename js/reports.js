import { getState, localDate, monthKey } from './storage.js';
import { t, money, number, catName, formatDate } from './translations.js';
import { e, icon, icons, empty, toast } from './ui.js';
import { exportCSV } from './transactions.js';
import { sum, inRange, monthRange, previousMonth, monthlySeries, rangeSeries, categorySpending, incomeExpenseChart, doughnutChart, trendChart, monthLabel } from './charts.js';
import { statCard, legendHTML } from './dashboard.js';

let period = 'thisMonth', customStart = monthRange(monthKey()).start, customEnd = localDate();
export function reportRange(key, today = new Date()) {
  const now = localDate(today), month = now.slice(0, 7);
  if (key === 'thisYear') return { start: `${today.getFullYear()}-01-01`, end: now };
  if (key === 'lastMonth') return monthRange(previousMonth(month));
  if (key === 'thisWeek') {
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    start.setDate(start.getDate() - (start.getDay() + 6) % 7);
    return { start: localDate(start), end: now };
  }
  if (key === 'custom') return { start: customStart, end: customEnd };
  return { start: `${month}-01`, end: now };
}
export function dayCount(start, end) { return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1; }
export function renderReports(container) {
  const state = getState(), { start, end } = reportRange(period);
  const rows = inRange(state.transactions, start, end), income = sum(rows, 'income'), expense = sum(rows, 'expense');
  const priorMonth = monthRange(previousMonth(end.slice(0, 7))), priorRows = inRange(state.transactions, priorMonth.start, priorMonth.end);
  const spending = categorySpending(rows), series = monthlySeries(state.transactions, end.slice(0, 7));
  const selectedSeries = rangeSeries(rows, start, end);
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${t('understandMoney')}</div><h1>${t('reports')}</h1><p class="page-subtitle">${t('reportsSubtitle')}</p></div><div class="page-actions"><button class="btn btn-secondary" id="report-export">${icon('download')}${t('exportCSV')}</button></div></div>
    <div class="card" style="margin-bottom:20px"><div class="filter-bar"><span class="muted" style="font-size:12px">${icon('calendar-days')} ${t('dateRange')}</span><select class="select" id="report-period" aria-label="${t('dateRange')}">${['thisWeek','thisMonth','lastMonth','thisYear','custom'].map(key => `<option value="${key}" ${period === key ? 'selected' : ''}>${t(key)}</option>`).join('')}</select>${period === 'custom' ? `<label class="field"><span>${t('startDate')}</span><input type="date" id="report-start" value="${start}"></label><label class="field"><span>${t('endDate')}</span><input type="date" id="report-end" value="${end}"></label><button class="btn btn-primary" id="report-apply">${t('applyFilters')}</button>` : `<span class="muted" style="font-size:11px">${formatDate(start)} — ${formatDate(end)}</span>`}</div></div>
    <div class="summary-grid">${statCard(t('totalIncome'), income, 'arrow-down-left', sum(priorRows, 'income'))}${statCard(t('totalExpenses'), expense, 'arrow-up-right', sum(priorRows, 'expense'), '', true)}${statCard(t('netSavings'), income - expense, 'piggy-bank', sum(priorRows, 'income') - sum(priorRows, 'expense'))}<article class="stat-card"><div class="stat-top"><span class="stat-label">${t('savingsRate')}</span><span class="stat-icon">${icon('percent')}</span></div><div class="stat-value">${number(income ? (income - expense) / income * 100 : 0, 1)}%</div><div class="stat-foot">${t('savingsRateHint')}</div></article></div>
    <div class="report-insights"><article class="card insight-card"><span class="stat-icon expense">${icon('shopping-bag')}</span><div><span class="stat-label">${t('highestCategory')}</span><div class="stat-value">${spending.length ? e(catName(spending[0].category)) : '—'}</div><small class="muted">${spending.length ? e(money(spending[0].amount)) : t('noExpenses')}</small></div></article><article class="card insight-card"><span class="stat-icon">${icon('calendar-range')}</span><div><span class="stat-label">${t('averageDailyExpenses')}</span><div class="stat-value">${e(money(expense / Math.max(1, dayCount(start, end))))}</div><small class="muted">${t('acrossDays', { count: number(dayCount(start, end)) })}</small></div></article></div>
    <div class="chart-grid"><section class="card"><div class="card-head"><div><h2>${t('incomeVsExpenses')}</h2><p>${t('selectedRange')}</p></div><div class="legend"><span><i class="legend-dot"></i>${t('income')}</span><span><i class="legend-dot navy"></i>${t('expenses')}</span></div></div><div class="chart-canvas"><canvas id="report-income" role="img" aria-label="${t('incomeVsExpenses')}"></canvas></div></section><section class="card"><div class="card-head"><div><h2>${t('spendingByCategory')}</h2><p>${t('selectedRange')}</p></div>${icon('chart-pie')}</div><div class="doughnut-wrap"><div class="chart-canvas doughnut"><canvas id="report-categories" role="img" aria-label="${t('spendingByCategory')}"></canvas></div><div class="doughnut-center"><small>${t('totalSpent')}</small><strong>${e(money(expense))}</strong></div></div>${legendHTML(spending)}</section></div>
    <div class="chart-grid"><section class="card"><div class="card-head"><div><h2>${t('monthlyComparisons')}</h2><p>${t('sixMonthView')}</p></div>${icon('table-2')}</div><div class="table-wrap"><table class="data-table"><thead><tr><th>${t('month')}</th><th>${t('income')}</th><th>${t('expenses')}</th><th>${t('netSavings')}</th></tr></thead><tbody>${series.map(x => `<tr><td>${e(monthLabel(x.key, false))}</td><td class="amount-positive">${e(money(x.income))}</td><td class="amount-negative">${e(money(x.expense))}</td><td>${e(money(x.savings))}</td></tr>`).join('')}</tbody></table></div></section><section class="card"><div class="card-head"><div><h2>${t('financialTrends')}</h2><p>${t('savingsOverTime')}</p></div>${icon('chart-line')}</div><div class="chart-canvas"><canvas id="report-trends" role="img" aria-label="${t('financialTrends')}"></canvas></div></section></div>
    <section class="card"><div class="card-head"><div><h2>${t('categoryBreakdown')}</h2><p>${t('selectedRange')}</p></div><span class="muted" style="font-size:11px">${t('transactionCount', { count: number(rows.length) })}</span></div>${spending.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>${t('category')}</th><th>${t('transactions')}</th><th>${t('amount')}</th><th>${t('share')}</th></tr></thead><tbody>${spending.map(x => `<tr><td><span class="transaction-name"><span class="category-icon" style="color:${x.category.color};background:${x.category.color}15">${icon(x.category.icon)}</span>${e(catName(x.category))}</span></td><td>${number(rows.filter(row => row.categoryId === x.category.id).length)}</td><td>${e(money(x.amount))}</td><td>${number(x.amount / expense * 100, 1)}%</td></tr>`).join('')}</tbody></table></div>` : empty(t('noExpenses'), 'chart-no-axes-column')}</section><p class="muted" style="font-size:10px;margin-top:16px">${t('comparisonExplanation')}</p>`;
  container.querySelector('#report-period').addEventListener('change', ev => { period = ev.target.value; window.dispatchEvent(new Event('moneytrack:render')); });
  container.querySelector('#report-apply')?.addEventListener('click', () => {
    const s = container.querySelector('#report-start').value, en = container.querySelector('#report-end').value;
    if (!s || !en || s > en) return toast(t('invalidDateRange'), 'error');
    customStart = s; customEnd = en; window.dispatchEvent(new Event('moneytrack:render'));
  });
  container.querySelector('#report-export').addEventListener('click', () => { exportCSV(rows); toast(t('csvExported')); });
  incomeExpenseChart('report-income', selectedSeries);
  doughnutChart('report-categories', spending);
  trendChart('report-trends', series);
  icons();
}
