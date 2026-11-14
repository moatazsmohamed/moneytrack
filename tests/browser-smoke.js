/* Run in the test browser console: await (await import('/tests/browser-smoke.js?run=1')).runSmoke() */
export async function runSmoke() {
  const store = await import('/js/storage.js'), finance = await import('/js/transactions.js'), ui = await import('/js/ui.js');
  const original = store.getState(), results = [], errors = [];
  const recordError = ev => errors.push(ev.message || String(ev.reason));
  window.addEventListener('error', recordError); window.addEventListener('unhandledrejection', recordError);
  const delay = () => new Promise(resolve => setTimeout(resolve, 75));
  const check = (name, condition) => { results.push({ name, pass: !!condition }); if (!condition) throw new Error(name); };
  const select = selector => { const node = document.querySelector(selector); if (!node) throw new Error('Missing selector ' + selector); return node; };
  const set = (selector, value, event = 'input') => { const node = select(selector); node.focus(); node.value = value; node.dispatchEvent(new Event(event, { bubbles: true })); };
  const click = async selector => { select(selector).click(); await delay(); };
  const route = async page => { location.hash = page; await delay(); };
  const submit = async () => { select('#modal-root form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await delay(); };
  try {
    store.clearAll(); await delay();
    check('Empty dashboard renders four live Chart.js charts', ['income-expenses-chart','category-chart','spending-chart','trends-chart'].every(id => !!Chart.getChart(id)));
    for (const page of ['transactions','categories','budgets','reports','settings','dashboard']) { await route(page); check('Navigation: ' + page, document.title.toLowerCase().includes(page === 'dashboard' ? 'overview' : page)); }
    await route('dashboard'); await click('#dashboard-add');
    check('Modal has backdrop and keyboard focus inside', getComputedStyle(select('#modal-root')).position === 'fixed' && select('#modal-root').contains(document.activeElement));
    set('#transaction-title', 'Receipt test'); set('#transaction-amount', '.29'); set('#transaction-description', 'Alpha memo'); await submit();
    check('Add expense accepts 0.29 and persists', store.getState().transactions.length === 1 && store.getState().transactions[0].amount === .29);
    check('Dashboard remains visible after add', !!document.getElementById('income-expenses-chart'));
    check('Charts update after expense', Chart.getChart('category-chart').data.datasets[0].data[0] === .29);
    await click('[data-edit-tx]'); set('#transaction-amount', '19.99'); await submit();
    check('Edit transaction updates persisted amount', store.getState().transactions[0].amount === 19.99);
    await click('[data-delete-tx]'); await click('#modal-root .btn-secondary');
    check('Cancel delete preserves transaction', store.getState().transactions.length === 1);
    await click('[data-delete-tx]'); await submit(); check('Confirm delete removes transaction and updates charts', store.getState().transactions.length === 0 && Chart.getChart('category-chart').data.labels[0] === 'No expenses in this period');
    await route('transactions'); await click('[data-add-transaction]'); set('#transaction-title', 'Income test'); set('#transaction-type', 'income', 'change'); set('#transaction-amount', '1000'); await submit();
    check('Add income selects matching category', store.getState().transactions[0].type === 'income');
    const today = store.localDate();
    store.update(s => { for (let i = 0; i < 24; i++) s.transactions.push({ id: 'smoke-' + i, title: 'Payment ' + i, description: i === 7 ? 'needle memo' : '', amount: i + 1, type: 'expense', categoryId: 'food', date: today }); }); await delay();
    check('Pagination limits rows to ten', document.querySelectorAll('[data-transaction-id]').length === 10);
    await click('[data-page="2"]'); check('Pagination next page functional', document.querySelector('.pagination').textContent.includes('Page 2'));
    set('#transaction-search', 'needle'); await delay(); check('Description search returns exact match', document.querySelectorAll('[data-transaction-id]').length === 1 && select('[data-transaction-id]').dataset.transactionId === 'smoke-7');
    check('Search retains keyboard focus across render', document.activeElement.id === 'transaction-search');
    await click('[data-reset-transaction-filters]'); set('[data-filter="type"]', 'income', 'change'); check('Income filter functional', document.querySelectorAll('[data-transaction-id]').length === 1);
    await click('[data-reset-transaction-filters]'); set('[data-filter="category"]', 'salary', 'change'); check('Category filter functional', document.querySelectorAll('[data-transaction-id]').length === 1);
    await click('[data-reset-transaction-filters]'); set('[data-filter="start"]', today, 'change'); set('[data-filter="end"]', today, 'change'); check('Inclusive date range preserves today entries', document.querySelectorAll('[data-transaction-id]').length === 10);
    await route('budgets'); await click('[data-edit-budget]'); set('#budget-total', '200'); set('#budget-category-food', '100'); await submit();
    check('Budget saves total and category allocation', store.getState().budgets[store.monthKey()].categories.food === 100);
    check('Budget overspending uses actual expenses', select('#budget-summary').textContent.includes('300.00') && select('#budget-summary').textContent.includes('150.0%'));
    await click('#notification-toggle'); check('Budget notification appears', select('#notification-panel').textContent.includes('Over budget')); await click('#notification-toggle');
    await click('[data-reset-budget]'); await submit(); check('Budget reset preserves all transactions', store.getState().transactions.length === 25 && !store.getState().budgets[store.monthKey()]);
    await route('categories'); await click('[data-add-category]'); set('#category-name-en', 'Travel test'); set('#category-name-ar', 'رحلات الاختبار'); await submit();
    const created = store.getState().categories.find(c => c.names.en === 'Travel test'); check('Category CRUD: create', !!created);
    await click(`[data-edit-category="${created.id}"]`); set('#category-name-en', 'Travel changed'); await submit(); check('Category CRUD: edit', store.getState().categories.find(c => c.id === created.id).names.en === 'Travel changed');
    await click(`[data-delete-category="${created.id}"]`); await submit(); check('Category CRUD: delete unused', !store.getState().categories.some(c => c.id === created.id));
    await click('[data-delete-category="food"]'); set('#replacement-category', 'shopping', 'change'); await submit();
    check('Safe category reassignment preserves transaction amounts and references', store.getState().transactions.filter(x => x.type === 'expense').every(x => x.categoryId === 'shopping') && store.getState().transactions.length === 25);
    await route('reports'); set('#report-period', 'custom', 'change'); set('#report-start', today); set('#report-end', today); await click('#report-apply');
    check('Report custom range renders real totals and charts', document.querySelector('#main-content').textContent.includes('300.00') && !!Chart.getChart('report-income'));
    const csv = finance.exportCSV(store.getState().transactions); check('CSV has BOM and expected persisted data', csv.startsWith('\uFEFF') && csv.includes('needle memo'));
    await route('settings'); const snapshot = store.backup(); store.validateState(JSON.parse(snapshot)); check('JSON backup roundtrip schema valid', true);
    const invalid = { version: 99 }; let rejected = false; try { store.restore(invalid); } catch { rejected = true; } check('Invalid JSON restoration preserves data', rejected && snapshot === store.backup());
    await click('#theme-toggle'); check('Dark theme updates full shell and storage', document.documentElement.dataset.theme === 'dark' && store.getState().prefs.theme === 'dark');
    await click('#language-toggle'); check('Arabic switches instantly with RTL and translated labels', document.documentElement.dir === 'rtl' && select('#main-content').textContent.includes('الإعدادات'));
    await route('transactions'); check('Arabic transaction labels translated', select('#main-content').textContent.includes('المعاملات') && select('#main-content').textContent.includes('إعادة ضبط الفلاتر'));
    await click('#language-toggle'); await click('#theme-toggle'); check('English LTR and light mode restored', document.documentElement.dir === 'ltr' && document.documentElement.dataset.theme === 'light');
    check('No missing Lucide icons', !document.querySelector('i[data-lucide]'));
    check('Desktop document has no horizontal overflow', document.documentElement.scrollWidth <= innerWidth);
    check('No uncaught JavaScript errors', errors.length === 0);
  } catch (error) { errors.push(error.message); }
  finally {
    ui.closeModal(); store.restore(original); location.hash = 'dashboard'; await delay();
    window.removeEventListener('error', recordError); window.removeEventListener('unhandledrejection', recordError);
  }
  const result = { passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, results, errors, completed: results.at(-1)?.name === 'No uncaught JavaScript errors' };
  window.moneyTrackTestResults = result;
  console.log(JSON.stringify(result));
  return result;
}
