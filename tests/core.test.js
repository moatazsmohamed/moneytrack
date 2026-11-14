import test from 'node:test';
import assert from 'node:assert/strict';

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
const store = await import('../js/storage.js');
const tx = await import('../js/transactions.js');
const budget = await import('../js/budgets.js');
const charts = await import('../js/charts.js');
const i18n = await import('../js/translations.js');
const report = await import('../js/reports.js');
const row = (id, amount, type = 'expense', date = '2026-11-14', description = '') => ({ id, title: `Entry ${id}`, amount, type, date, description, categoryId: type === 'income' ? 'salary' : 'food' });
const baseline = () => ({ version: 1, transactions: [row('expense-a', 0.29), row('expense-b', 99.71, 'expense', '2026-11-13', 'SPECIAL receipt'), row('income-a', 1000, 'income')], categories: store.defaultCategories(), budgets: { '2026-11': { total: 200, categories: { food: 125 } } }, prefs: { theme: 'light', language: 'en', currency: 'EGP', name: 'Test workspace' } });

test('first-time demo spans six months, no future transactions and valid schema', () => {
  const s = store.getState(); assert.equal(s.categories.length, 14); assert.equal(new Set(s.transactions.map(x => x.date.slice(0, 7))).size, 6);
  assert.ok(s.transactions.every(x => x.date <= store.localDate())); assert.ok(store.validateState(s));
});
test('snapshots cannot mutate saved state; persistence survives fresh module instance', async () => {
  store.restore(baseline()); const copy = store.getState(); copy.transactions = [];
  assert.equal(store.getState().transactions.length, 3);
  const fresh = await import('../js/storage.js?persist-check'); assert.equal(fresh.getState().transactions.length, 3);
});
test('add/edit/delete update actual totals without floating-point drift', () => {
  store.restore(baseline()); assert.equal(charts.sum(store.getState().transactions, 'expense'), 100);
  store.update(s => { s.transactions.push(row('new', 5.25)); }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 105.25);
  store.update(s => { s.transactions.find(x => x.id === 'new').amount = 8.99; }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 108.99);
  store.update(s => { s.transactions = s.transactions.filter(x => x.id !== 'new'); }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 100);
});
test('schema rejects bad dates, references, decimal amounts and preferences', () => {
  for (const mutate of [s => s.transactions[0].amount = -.1, s => s.transactions[0].amount = .001, s => s.transactions[0].amount = Infinity, s => s.transactions[0].date = '2026-02-30', s => s.transactions[0].categoryId = 'missing', s => s.transactions[0].type = 'income', s => s.transactions.push(s.transactions[0]), s => s.prefs.language = 'fr', s => s.budgets['2026-99'] = { total: 1, categories: {} }]) {
    const s = baseline(); mutate(s); assert.throws(() => store.validateState(s));
  }
});
test('description up to 1000 chars accepted and escaped separately', () => { const s = baseline(); s.transactions[0].description = 'x'.repeat(1000); assert.ok(store.validateState(s)); });
test('search includes description; type/category/inclusive date filters combine', () => {
  store.restore(baseline()); const rows = store.getState().transactions;
  assert.equal(tx.filterTransactions(rows, { search: 'special' }).length, 1);
  assert.equal(tx.filterTransactions(rows, { type: 'income' }).length, 1);
  assert.equal(tx.filterTransactions(rows, { type: 'expense', category: 'food', start: '2026-11-13', end: '2026-11-14' }).length, 2);
  assert.equal(tx.filterTransactions(rows, { start: '2026-11-14', end: '2026-11-14' }).length, 2);
});
test('four sorts are stable and do not mutate input', () => {
  const rows = baseline().transactions, original = JSON.stringify(rows);
  assert.equal(tx.filterTransactions(rows, { sort: 'highest' })[0].amount, 1000);
  assert.equal(tx.filterTransactions(rows, { sort: 'lowest' })[0].amount, .29);
  assert.equal(tx.filterTransactions(rows, { sort: 'oldest' })[0].date, '2026-11-13');
  assert.equal(tx.filterTransactions(rows, { sort: 'newest' })[0].date, '2026-11-14');
  assert.equal(JSON.stringify(rows), original);
});
test('budgets use actual per-month expenses and detect progress accurately', () => {
  store.restore(baseline()); const s = budget.budgetSummary('2026-11');
  assert.equal(s.spent, 100); assert.equal(s.remaining, 100); assert.equal(s.percent, 50);
  assert.equal(s.categories.find(x => x.category.id === 'food').percent, 80);
  assert.equal(budget.budgetSummary('2026-10').spent, 0);
  assert.equal(budget.budgetSummary('2026-10').percent, 0);
});
test('category reassignment preserves amounts and safely removes references', () => {
  store.restore(baseline()); store.update(s => {
    s.transactions.forEach(x => { if (x.categoryId === 'food') x.categoryId = 'shopping'; });
    Object.values(s.budgets).forEach(b => { delete b.categories.food; });
    s.categories = s.categories.filter(c => c.id !== 'food');
  });
  assert.equal(charts.sum(store.getState().transactions, 'expense'), 100); assert.ok(store.validateState(store.getState()));
});
test('month budget reset never deletes historical transactions', () => {
  store.restore(baseline()); store.update(s => { delete s.budgets['2026-11']; }); assert.equal(store.getState().transactions.length, 3);
});
test('CSV handles quotes/newlines and guards formula injection; Arabic headers translated', () => {
  store.restore(baseline()); const s = [row('csv', 2)]; s[0].title = ' =HYPERLINK("bad")'; s[0].description = 'one, two\nthree';
  const csv = tx.exportCSV(s); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("' =HYPERLINK")); assert.ok(csv.includes('"one, two\nthree"')); assert.ok(csv.includes('"2.00"'));
  store.update(s => { s.prefs.language = 'ar'; }); assert.ok(tx.exportCSV(s).includes('العنوان'));
});
test('JSON restoration validated before mutation and maintains recovery backup', () => {
  store.restore(baseline()); const old = store.backup(); assert.throws(() => store.restore({ version: 9 })); assert.equal(store.backup(), old);
  const empty = baseline(); empty.transactions = []; store.restore(empty); assert.equal(localStorage.getItem(store.RECOVERY_KEY), old);
});
test('local storage write failure does not commit unsaved changes', () => {
  store.restore(baseline()); const old = store.backup(), setter = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.throws(() => store.update(s => { s.prefs.name = 'Lost'; }));
  localStorage.setItem = setter; assert.equal(store.backup(), old);
});
test('clear demo preserves user entries; clear all preserves preferences and unrelated keys', () => {
  store.loadDemo(); store.update(s => { s.transactions.push(row('user', 22)); s.prefs.language = 'ar'; });
  localStorage.setItem('unrelated-site-key', 'keep'); store.clearDemo(); assert.equal(store.getState().transactions.length, 1);
  store.clearAll(); assert.equal(store.getState().transactions.length, 0); assert.equal(store.getState().prefs.language, 'ar'); assert.equal(localStorage.getItem('unrelated-site-key'), 'keep');
});
test('date ranges and monthly grouping handle year transitions and calendar days', () => {
  assert.deepEqual(charts.monthRange('2024-02'), { start: '2024-02-01', end: '2024-02-29' });
  assert.equal(charts.previousMonth('2026-01'), '2025-12'); assert.equal(report.dayCount('2026-01-01', '2026-01-01'), 1);
  assert.deepEqual(report.reportRange('thisWeek', new Date(2026, 10, 14)), { start: '2026-11-09', end: '2026-11-14' });
});
test('every static UI translation key exists in English and Arabic', async () => {
  const fs = await import('node:fs/promises'); const files = (await fs.readdir(new URL('../js/', import.meta.url))).filter(x => x.endsWith('.js') && x !== 'translations.js');
  const missing = [];
  for (const file of files) {
    const text = await fs.readFile(new URL(`../js/${file}`, import.meta.url), 'utf8');
    for (const match of text.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) for (const lang of ['en','ar']) if (!match[1].endsWith('.') && !i18n.translations[lang][match[1]]) missing.push(`${file}:${lang}:${match[1]}`);
  }
  assert.deepEqual(missing, []);
});

test('corrupt local data stays untouched and updates are blocked until confirmed reset', async () => {
  const raw = localStorage.getItem(store.STORAGE_KEY); localStorage.setItem(store.STORAGE_KEY, '{broken');
  const isolated = await import('../js/storage.js?corruption-case');
  isolated.getState(); assert.ok(isolated.getStorageWarning());
  assert.throws(() => isolated.update(s => { s.prefs.name = 'Do not overwrite'; }));
  assert.equal(localStorage.getItem(store.STORAGE_KEY), '{broken');
  isolated.clearAll(); assert.equal(isolated.getState().transactions.length, 0); assert.equal(isolated.getStorageWarning(), null);
  localStorage.setItem(store.STORAGE_KEY, raw);
});
test('backup bound is measured in UTF-8 bytes for Arabic text', () => {
  const s = baseline(); s.padding = 'ع'.repeat(1100000); assert.throws(() => store.validateState(s));
});
test('early calendar years remain valid and clear-all removes recovery copy', () => {
  const s = baseline(); s.transactions[0].date = '0001-01-01'; assert.ok(store.validateState(s));
  store.restore(baseline()); assert.ok(store.recoveryBackup()); store.clearAll(); assert.equal(store.recoveryBackup(), null);
});

test('custom report charts aggregate all years without dropping old transactions', () => {
  const rows = [row('old', 9, 'expense', '2019-02-03'), row('newest', 11, 'expense', '2026-11-14')];
  const series = charts.rangeSeries(rows, '2019-01-01', '2026-12-31');
  assert.equal(series.length, 8); assert.equal(series[0].expense, 9); assert.equal(series.at(-1).expense, 11);
  assert.equal(series.reduce((n, x) => n + x.expense, 0), 20);
});
