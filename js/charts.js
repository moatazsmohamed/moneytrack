import { getState, localDate } from './storage.js';
import { t, money, catName } from './translations.js';

const instances = new Map();
export function destroyCharts() {
  for (const chart of instances.values()) chart.destroy();
  instances.clear();
}
export function sum(list, type) {
  return Math.round(list.filter(x => !type || x.type === type).reduce((n, x) => n + Math.round(x.amount * 100), 0)) / 100;
}
export function inRange(list, start, end) { return list.filter(x => x.date >= start && x.date <= end); }
export function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: localDate(new Date(y, m, 0)) };
}
export function previousMonth(month) {
  const [y, m] = month.split('-').map(Number);
  return localDate(new Date(y, m - 2, 1)).slice(0, 7);
}
export function monthLabel(month, short = true) {
  const { language } = getState().prefs;
  return new Intl.DateTimeFormat(language === 'ar' ? 'ar-EG' : 'en-GB', { month: short ? 'short' : 'long', year: short ? undefined : 'numeric' }).format(new Date(`${month}-01T12:00:00`));
}
export function monthlySeries(list, endMonth, count = 6) {
  const [year, month] = endMonth.split('-').map(Number);
  return Array.from({ length: count }, (_, i) => {
    const key = localDate(new Date(year, month - count + i, 1)).slice(0, 7);
    const range = monthRange(key), rows = inRange(list, range.start, range.end);
    const income = sum(rows, 'income'), expense = sum(rows, 'expense');
    return { key, label: monthLabel(key), income, expense, savings: Math.round((income - expense) * 100) / 100 };
  });
}
export function categorySpending(list) {
  const state = getState();
  return state.categories.filter(c => c.type === 'expense').map(category => ({ category, amount: sum(list.filter(x => x.categoryId === category.id), 'expense') })).filter(x => x.amount > 0).sort((a, b) => b.amount - a.amount);
}
export function chart(id, type, data, extra = {}) {
  const canvas = document.getElementById(id);
  if (!canvas || !window.Chart) return;
  if (instances.has(id)) instances.get(id).destroy();
  const dark = getState().prefs.theme === 'dark';
  const muted = dark ? '#99acba' : '#8b9ba8', grid = dark ? '#293a46' : '#edf1f4';
  const doughnut = type === 'doughnut';
  const options = {
    responsive: true, maintainAspectRatio: false,
    animation: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 380 },
    interaction: { intersect: false, mode: doughnut ? 'nearest' : 'index' },
    plugins: {
      legend: { display: false },
      tooltip: { rtl: getState().prefs.language === 'ar', backgroundColor: dark ? '#2c4150' : '#193c50', padding: 12, cornerRadius: 7, callbacks: { label: context => `${context.dataset.label || context.label}: ${money(typeof context.parsed === 'number' ? context.parsed : context.parsed.y)}` } }
    },
    ...(doughnut ? { cutout: '76%', borderWidth: 0, spacing: 4 } : {
      scales: {
        x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, font: { family: 'DM Sans, Noto Sans Arabic, sans-serif', size: 10 }, maxTicksLimit: 7, maxRotation: 0 } },
        y: { beginAtZero: true, border: { display: false }, grid: { color: grid, drawTicks: false }, ticks: { color: muted, font: { size: 9 }, padding: 10, maxTicksLimit: 5, callback: value => new Intl.NumberFormat(getState().prefs.language === 'ar' ? 'ar-EG' : 'en-GB', { notation: 'compact', maximumFractionDigits: 1 }).format(value) } }
      }
    }), ...extra
  };
  instances.set(id, new window.Chart(canvas, { type, data, options }));
}
export function incomeExpenseChart(id, series) {
  chart(id, 'bar', { labels: series.map(x => x.label), datasets: [
    { label: t('income'), data: series.map(x => x.income), backgroundColor: '#188d72', borderRadius: 4, maxBarThickness: 19, categoryPercentage: .62 },
    { label: t('expenses'), data: series.map(x => x.expense), backgroundColor: '#b6cbd6', borderRadius: 4, maxBarThickness: 19, categoryPercentage: .62 }
  ] });
}
export function doughnutChart(id, spending) {
  chart(id, 'doughnut', { labels: spending.length ? spending.map(x => catName(x.category)) : [t('noExpenses')], datasets: [{ label: t('expenses'), data: spending.length ? spending.map(x => x.amount) : [1], backgroundColor: spending.length ? spending.map(x => x.category.color) : [getState().prefs.theme === 'dark' ? '#263a47' : '#eef2f5'], hoverOffset: spending.length ? 4 : 0 }] }, { plugins: { legend: { display: false }, tooltip: { enabled: !!spending.length, callbacks: { label: ctx => `${ctx.label}: ${money(ctx.parsed)}` } } } });
}
export function trendChart(id, series) {
  chart(id, 'line', { labels: series.map(x => x.label), datasets: [{ label: t('netSavings'), data: series.map(x => x.savings), borderColor: '#188d72', backgroundColor: '#188d7211', fill: true, tension: .35, borderWidth: 2, pointRadius: 3, pointBackgroundColor: '#188d72' }] });
}
