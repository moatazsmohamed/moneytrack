import test from 'node:test';
import assert from 'node:assert/strict';

/* In-memory localStorage: legacy-store tests and appearance preferences only. */
const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };

/* Mock cloud API enforcing CSRF, optimistic revisions and the authenticated owner like server/workspace.js. */
const OWNER = '7b0c8f2e-3c41-4d6a-9a8e-5d2b1c0f9e11';
const server = { state: null, revision: 0, recovery: null, csrf: 'csrf-test-token', calls: [] };
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace(/^\/api/, ''), method = options.method || 'GET';
  const body = options.body ? JSON.parse(options.body) : {};
  server.calls.push(`${method} ${path}`);
  if (path === '/auth/csrf') return reply(200, { csrfToken: server.csrf });
  if (method !== 'GET' && new Headers(options.headers).get('X-CSRF-Token') !== server.csrf) return reply(403, { error: { code: 'CSRF_INVALID' } });
  if (body.accountId && body.accountId !== OWNER) return reply(409, { error: { code: 'SESSION_CHANGED' } });
  const snapshot = () => reply(200, { state: structuredClone(server.state), revision: server.revision, ownerId: OWNER });
  if (path === '/workspace' && method === 'GET') return snapshot();
  if (path === '/workspace' && method === 'PUT') {
    if (body.revision !== server.revision) return reply(409, { error: { code: 'REVISION_CONFLICT' } });
    server.state = body.state; server.revision += 1; return snapshot();
  }
  if (path === '/workspace/restore') { server.recovery = structuredClone(server.state); server.state = body.state; server.revision += 1; return snapshot(); }
  if (path === '/workspace/recovery') return reply(200, { backup: server.recovery });
  if (path === '/workspace/reset') { server.state = { ...emptyCloud(), prefs: server.state.prefs }; server.recovery = null; server.revision += 1; return snapshot(); }
  if (path === '/recurring/process') return reply(200, { processed: 0 });
  return reply(404, { error: { code: 'NOT_FOUND' } });
};

const legacy = await import('../js/legacy-storage.js');
const store = await import('../js/storage.js');
const tx = await import('../js/transactions.js');
const budget = await import('../js/budgets.js');
const charts = await import('../js/charts.js');
const i18n = await import('../js/translations.js');
const report = await import('../js/reports.js');

const row = (id, amount, type = 'expense', date = '2026-11-14', description = '') => ({ id, title: `Entry ${id}`, amount, type, date, description, categoryId: type === 'income' ? 'salary' : 'food' });
const baseline = () => ({ version: 1, transactions: [row('expense-a', 0.29), row('expense-b', 99.71, 'expense', '2026-11-13', 'SPECIAL receipt'), row('income-a', 1000, 'income')], categories: legacy.defaultCategories(), budgets: { '2026-11': { total: 200, categories: { food: 125 } } }, prefs: { theme: 'light', language: 'en', currency: 'EGP', name: 'Test workspace' } });
function emptyCloud() { return { version: 1, transactions: [], categories: legacy.defaultCategories(), budgets: {}, prefs: { theme: 'light', language: 'en', currency: 'EGP', name: '' }, goals: [], recurring: [], notifications: [], notificationPrefs: { budget: true, recurring: true, goals: true, security: true } }; }
async function signedInWith(state) {
  server.state = { ...emptyCloud(), ...structuredClone(state) }; server.revision = 1; server.recovery = null;
  store.initializeStorage({ id: OWNER, fullName: 'Test owner' });
  await store.refreshState();
}

/* ---------- Legacy device store (kept for the reviewed migration path) ---------- */
test('legacy first-time demo spans six months, no future transactions and valid schema', () => {
  const s = legacy.getState(); assert.equal(s.categories.length, 14); assert.equal(new Set(s.transactions.map(x => x.date.slice(0, 7))).size, 6);
  assert.ok(s.transactions.every(x => x.date <= legacy.localDate())); assert.ok(legacy.validateState(s));
});
test('legacy snapshots cannot mutate saved state; persistence survives a fresh module instance', async () => {
  legacy.restore(baseline()); const copy = legacy.getState(); copy.transactions = [];
  assert.equal(legacy.getState().transactions.length, 3);
  const fresh = await import('../js/legacy-storage.js?persist-check'); assert.equal(fresh.getState().transactions.length, 3);
});
test('legacy JSON restoration is validated before mutation and maintains a recovery backup', () => {
  legacy.restore(baseline()); const old = legacy.backup(); assert.throws(() => legacy.restore({ version: 9 })); assert.equal(legacy.backup(), old);
  const empty = baseline(); empty.transactions = []; legacy.restore(empty); assert.equal(localStorage.getItem(legacy.RECOVERY_KEY), old);
});
test('legacy storage write failure does not commit unsaved changes', () => {
  legacy.restore(baseline()); const old = legacy.backup(), setter = localStorage.setItem;
  localStorage.setItem = () => { throw new Error('QuotaExceeded'); };
  assert.throws(() => legacy.update(s => { s.prefs.name = 'Lost'; }));
  localStorage.setItem = setter; assert.equal(legacy.backup(), old);
});
test('legacy clear demo preserves user entries; clear all preserves preferences and unrelated keys', () => {
  legacy.loadDemo(); legacy.update(s => { s.transactions.push(row('user', 22)); s.prefs.language = 'ar'; });
  localStorage.setItem('unrelated-site-key', 'keep'); legacy.clearDemo(); assert.equal(legacy.getState().transactions.length, 1);
  legacy.clearAll(); assert.equal(legacy.getState().transactions.length, 0); assert.equal(legacy.getState().prefs.language, 'ar'); assert.equal(localStorage.getItem('unrelated-site-key'), 'keep');
});
test('legacy corrupt local data stays untouched and updates are blocked until confirmed reset', async () => {
  const raw = localStorage.getItem(legacy.STORAGE_KEY); localStorage.setItem(legacy.STORAGE_KEY, '{broken');
  const isolated = await import('../js/legacy-storage.js?corruption-case');
  isolated.getState(); assert.ok(isolated.getStorageWarning());
  assert.throws(() => isolated.update(s => { s.prefs.name = 'Do not overwrite'; }));
  assert.equal(localStorage.getItem(legacy.STORAGE_KEY), '{broken');
  isolated.clearAll(); assert.equal(isolated.getState().transactions.length, 0); assert.equal(isolated.getStorageWarning(), null);
  localStorage.setItem(legacy.STORAGE_KEY, raw);
});
test('legacy early calendar years remain valid and clear-all removes the recovery copy', () => {
  const s = baseline(); s.transactions[0].date = '0001-01-01'; assert.ok(legacy.validateState(s));
  legacy.restore(baseline()); assert.ok(legacy.recoveryBackup()); legacy.clearAll(); assert.equal(legacy.recoveryBackup(), null);
});

/* ---------- Validation shared by both stores ---------- */
test('schema rejects bad dates, references, decimal amounts and preferences', () => {
  for (const mutate of [s => s.transactions[0].amount = -.1, s => s.transactions[0].amount = .001, s => s.transactions[0].amount = Infinity, s => s.transactions[0].date = '2026-02-30', s => s.transactions[0].categoryId = 'missing', s => s.transactions[0].type = 'income', s => s.transactions.push(s.transactions[0]), s => s.prefs.language = 'fr', s => s.budgets['2026-99'] = { total: 1, categories: {} }]) {
    const s = baseline(); mutate(s); assert.throws(() => store.validateState(s));
  }
});
test('description up to 1000 chars accepted', () => { const s = baseline(); s.transactions[0].description = 'x'.repeat(1000); assert.ok(store.validateState(s)); });
test('backup bound is measured in UTF-8 bytes for Arabic text', () => {
  const s = baseline(); s.padding = 'ع'.repeat(1100000); assert.throws(() => store.validateState(s));
});

/* ---------- Cloud workspace facade + financial logic ---------- */
test('cloud store is empty and refuses writes until the authenticated workspace is loaded', async () => {
  store.clearStorage();
  assert.equal(store.isStorageReady(), false); assert.equal(store.getState().transactions.length, 0);
  await assert.rejects(store.update(s => { s.prefs.name = 'x'; }), error => error.status === 401);
  assert.throws(() => store.backup(), error => error.code === 'SYNC_REQUIRED');
});
test('add/edit/delete are saved through the API with CSRF and update totals without floating-point drift', async () => {
  await signedInWith(baseline()); assert.equal(charts.sum(store.getState().transactions, 'expense'), 100);
  await store.update(s => { s.transactions.push(row('new', 5.25)); }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 105.25);
  await store.update(s => { s.transactions.find(x => x.id === 'new').amount = 8.99; }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 108.99);
  await store.update(s => { s.transactions = s.transactions.filter(x => x.id !== 'new'); }); assert.equal(charts.sum(store.getState().transactions, 'expense'), 100);
  assert.equal(server.revision, 4); assert.equal(server.state.transactions.length, 3);
  assert.ok(server.calls.includes('GET /auth/csrf'));
});
test('cloud snapshots cannot mutate saved state', async () => {
  await signedInWith(baseline()); const copy = store.getState(); copy.transactions = [];
  assert.equal(store.getState().transactions.length, 3);
});
test('a stale revision is rejected and the workspace refreshes from the server', async () => {
  await signedInWith(baseline());
  server.revision += 1; server.state.transactions.push(row('other-device', 1));
  await assert.rejects(store.update(s => { s.prefs.name = 'Stale'; }), error => error.code === 'REVISION_CONFLICT');
  assert.equal(server.state.prefs.name, 'Test workspace');
  assert.equal(store.getState().transactions.length, 4);
});
test('a response for a different account clears the workspace instead of mixing data', async () => {
  await signedInWith(baseline());
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await original(url, options);
    if (String(url) === '/api/workspace' && options.method === 'PUT') return reply(200, { ...(await response.json()), ownerId: 'another-account' });
    return response;
  };
  try { await assert.rejects(store.update(s => { s.prefs.name = 'Mixed'; }), error => error.code === 'SESSION_CHANGED'); }
  finally { globalThis.fetch = original; }
  assert.equal(store.isStorageReady(), false); assert.equal(store.getState().transactions.length, 0);
});
test('search includes description; type/category/inclusive date filters combine', async () => {
  await signedInWith(baseline()); const rows = store.getState().transactions;
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
test('budgets use actual per-month expenses and detect progress accurately', async () => {
  await signedInWith(baseline()); const s = budget.budgetSummary('2026-11');
  assert.equal(s.spent, 100); assert.equal(s.remaining, 100); assert.equal(s.percent, 50);
  assert.equal(s.categories.find(x => x.category.id === 'food').percent, 80);
  assert.equal(budget.budgetSummary('2026-10').spent, 0);
  assert.equal(budget.budgetSummary('2026-10').percent, 0);
});
test('category reassignment preserves amounts, removes references and sends the replacement map', async () => {
  await signedInWith(baseline());
  let sentBody = null; const original = globalThis.fetch;
  globalThis.fetch = async (url, options) => { if (options?.method === 'PUT') sentBody = JSON.parse(options.body); return original(url, options); };
  try {
    await store.update(s => {
      s.transactions.forEach(x => { if (x.categoryId === 'food') x.categoryId = 'shopping'; });
      Object.values(s.budgets).forEach(b => { delete b.categories.food; });
      s.categories = s.categories.filter(c => c.id !== 'food');
    }, { categoryReplacements: { food: 'shopping' } });
  } finally { globalThis.fetch = original; }
  assert.deepEqual(sentBody.categoryReplacements, { food: 'shopping' }); assert.equal(sentBody.accountId, OWNER);
  assert.equal(charts.sum(store.getState().transactions, 'expense'), 100); assert.ok(store.validateState(store.getState()));
});
test('month budget reset never deletes historical transactions', async () => {
  await signedInWith(baseline()); await store.update(s => { delete s.budgets['2026-11']; }); assert.equal(store.getState().transactions.length, 3);
});
test('CSV handles quotes/newlines and guards formula injection; Arabic headers translated', async () => {
  await signedInWith(baseline()); const s = [row('csv', 2)]; s[0].title = ' =HYPERLINK("bad")'; s[0].description = 'one, two\nthree';
  const csv = tx.exportCSV(s); assert.ok(csv.startsWith('\uFEFF')); assert.ok(csv.includes("' =HYPERLINK")); assert.ok(csv.includes('"one, two\nthree"')); assert.ok(csv.includes('"2.00"'));
  await store.update(state => { state.prefs.language = 'ar'; }); assert.ok(tx.exportCSV(s).includes('العنوان'));
});
test('cloud restoration validates before sending, and the server keeps a recovery copy', async () => {
  await signedInWith(baseline()); const old = store.backup();
  await assert.rejects(store.restore({ version: 9 })); assert.equal(store.backup(), old);
  const empty = baseline(); empty.transactions = []; await store.restore(empty);
  assert.equal(store.getState().transactions.length, 0);
  assert.equal(JSON.parse(await store.recoveryBackup()).transactions.length, 3);
});
test('cloud clear demo keeps user entries; clear all keeps preferences and drops the recovery copy', async () => {
  const s = baseline(); s.transactions.push({ ...row('demo-row', 5), demo: true }); await signedInWith(s);
  await store.clearDemo(); assert.equal(store.getState().transactions.length, 3);
  await store.restore(baseline()); assert.ok(await store.recoveryBackup());
  await store.clearAll(); assert.equal(store.getState().transactions.length, 0); assert.equal(store.getState().prefs.currency, 'EGP');
  assert.equal(await store.recoveryBackup(), null);
});

/* ---------- Pure calculations and dictionary ---------- */
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
test('custom report charts aggregate all years without dropping old transactions', () => {
  const rows = [row('old', 9, 'expense', '2019-02-03'), row('newest', 11, 'expense', '2026-11-14')];
  const series = charts.rangeSeries(rows, '2019-01-01', '2026-12-31');
  assert.equal(series.length, 8); assert.equal(series[0].expense, 9); assert.equal(series.at(-1).expense, 11);
  assert.equal(series.reduce((n, x) => n + x.expense, 0), 20);
});
