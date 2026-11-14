export async function runAdvancedSmoke() {
  const store = await import('/js/storage.js'), ui = await import('/js/ui.js');
  const original = store.getState(), results = [], errors = [], wait = () => new Promise(r => setTimeout(r, 85));
  const q = selector => { const node = document.querySelector(selector); if (!node) throw new Error('Missing ' + selector); return node; };
  const check = (name, pass) => { results.push({ name, pass: !!pass }); if (!pass) throw new Error(name); };
  const change = async (selector, value, event = 'change') => { const node = q(selector); node.focus(); node.value = value; node.dispatchEvent(new Event(event, { bubbles: true })); await wait(); };
  const click = async selector => { q(selector).click(); await wait(); };
  const rows = () => [...document.querySelectorAll('[data-transaction-id]')].map(x => x.dataset.transactionId);
  try {
    store.clearAll();
    store.update(s => { for (let i = 1; i <= 11; i++) s.transactions.push({ id: `advanced-${i}`, title: `Purchase ${i}`, description: i === 7 ? 'marker invoice' : 'ordinary note', amount: i, date: i === 11 ? '2026-01-11' : '2026-01-10', type: 'expense', categoryId: i % 2 ? 'food' : 'shopping' }); s.transactions.push({ id: 'advanced-income', title: 'Salary sample', description: '', amount: 500, type: 'income', categoryId: 'salary', date: '2026-01-09' }); });
    location.hash = 'transactions'; await wait(); await click('[data-reset-transaction-filters]');
    check('All four sort modes are offered', q('[data-filter="sort"]').options.length === 4);
    await change('[data-filter="sort"]', 'highest'); check('Highest amount sorting visible', rows()[0] === 'advanced-income');
    await change('[data-filter="sort"]', 'lowest'); check('Lowest amount sorting visible', rows()[0] === 'advanced-1');
    await change('[data-filter="sort"]', 'newest'); check('Newest date sorting visible', rows()[0] === 'advanced-11');
    await change('[data-filter="sort"]', 'oldest'); check('Oldest date sorting visible', rows()[0] === 'advanced-income');
    await change('[data-filter="type"]', 'expense'); await change('[data-filter="category"]', 'food'); await change('[data-filter="start"]', '2026-01-10'); await change('[data-filter="end"]', '2026-01-10'); await change('[data-filter="sort"]', 'highest');
    check('Type/category/date/sort combine correctly', rows().join(',') === 'advanced-9,advanced-7,advanced-5,advanced-3,advanced-1');
    await change('#transaction-search', 'marker', 'input'); check('Description search combines with other filters', rows().join(',') === 'advanced-7');
    await change('[data-filter="type"]', 'income'); check('Changing type resets incompatible category', q('[data-filter="category"]').value === 'all');
    await click('[data-reset-transaction-filters]'); await change('[data-filter="type"]', 'expense'); await change('[data-filter="sort"]', 'lowest');
    await click('[data-page="2"]'); check('Last page contains remaining single transaction', rows().length === 1 && rows()[0] === 'advanced-11');
    await click('[data-delete-tx="advanced-11"]'); q('#modal-root form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await wait();
    check('Deleting final row returns to valid previous page', rows().length === 10 && !document.querySelector('.pagination'));
    await change('[data-filter="start"]', '2026-01-10'); await change('[data-filter="end"]', '2026-01-09'); check('Invalid date range is not applied', q('[data-filter="end"]').value === '');
    location.hash = 'dashboard'; await wait(); await change('#global-search', 'marker', 'input'); q('#global-search').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await wait();
    check('Global search routes to matching transactions', location.hash === '#transactions' && rows().length === 1 && rows()[0] === 'advanced-7');
    await click('#language-toggle'); check('Arabic translates highest/lowest sort labels', q('[data-filter="sort"]').textContent.includes('أعلى مبلغ') && q('[data-filter="sort"]').textContent.includes('أقل مبلغ'));
    await click('#theme-toggle'); check('Dark mode retains active transaction filters', q('#transaction-search').value === 'marker' && document.documentElement.dataset.theme === 'dark');
  } catch (error) { errors.push(error.message); }
  finally { ui.closeModal(); store.restore(original); location.hash = 'dashboard'; await wait(); }
  return { passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, errors, results };
}
