export async function runDataSmoke() {
  const store = await import('/js/storage.js');
  const ui = await import('/js/ui.js');
  const original = store.getState(), oldRecovery = localStorage.getItem(store.RECOVERY_KEY);
  const results = [], errors = [], pause = () => new Promise(resolve => setTimeout(resolve, 90));
  const q = selector => { const node = document.querySelector(selector); if (!node) throw new Error('Missing ' + selector); return node; };
  const check = (name, pass) => { results.push({ name, pass: !!pass }); if (!pass) throw new Error(name); };
  const click = async selector => { q(selector).click(); await pause(); };
  const submit = async selector => { q(selector).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await pause(); };
  const file = async content => {
    const transfer = new DataTransfer(); transfer.items.add(new File([content], 'backup.json', { type: 'application/json' }));
    q('#backup-file').files = transfer.files; q('#backup-file').dispatchEvent(new Event('change', { bubbles: true })); await pause();
  };
  try {
    location.hash = 'settings'; await pause();
    const prefs = store.getState().prefs;
    q('#workspace-name').value = 'UI test workspace'; await submit('#name-form'); check('Workspace name saved through UI', store.getState().prefs.name === 'UI test workspace');
    let before = store.backup();
    await file('{not json'); check('Malformed JSON refused without changing data', store.backup() === before && !document.querySelector('#modal-root form'));
    await file(JSON.stringify({ version: 5 })); check('Invalid schema refused without changing data', store.backup() === before);
    const valid = structuredClone(original); valid.transactions = []; valid.budgets = {}; valid.prefs.name = 'Restored workspace';
    await file(JSON.stringify(valid)); check('Valid import opens replacement confirmation', !!document.querySelector('#modal-root form'));
    await click('#modal-root .btn-secondary'); check('Cancel import keeps existing data', store.backup() === before);
    await file(JSON.stringify(valid)); await submit('#modal-root form');
    check('Confirmed JSON import replaces full workspace', store.getState().transactions.length === 0 && store.getState().prefs.name === 'Restored workspace');
    check('Recovery backup contains pre-import workspace', localStorage.getItem(store.RECOVERY_KEY) === before);
    check('Recovery download action is available', !!document.querySelector('#recovery-export'));
    await file('x'.repeat(2 * 1024 * 1024 + 1)); check('Oversized import refused before processing', store.getState().prefs.name === 'Restored workspace');
    q('#settings-currency').value = 'USD'; q('#settings-currency').dispatchEvent(new Event('change', { bubbles: true })); await pause();
    check('Currency preference saved without conversion', store.getState().prefs.currency === 'USD');
    await click('#load-demo'); await submit('#modal-root form'); check('Confirmed load demo populates transactions', store.getState().transactions.every(x => x.demo));
    store.update(s => { s.transactions.push({ id: 'preserve-me', title: 'My own entry', description: '', date: store.localDate(), type: 'expense', categoryId: 'food', amount: 22 }); }); await pause();
    await click('#clear-demo'); await submit('#modal-root form'); check('Confirmed clear demo preserves user entry', store.getState().transactions.length === 1 && store.getState().transactions[0].id === 'preserve-me');
    localStorage.setItem('other-app-test', 'untouched');
    await click('#clear-all'); await click('#modal-root .btn-secondary'); check('Cancel clear all keeps user data', store.getState().transactions.length === 1);
    await click('#clear-all'); await submit('#modal-root form'); check('Confirmed clear all resets finances not preferences/other apps', store.getState().transactions.length === 0 && store.getState().prefs.currency === 'USD' && localStorage.getItem('other-app-test') === 'untouched');
    check('Clear all also removes recovery copy', localStorage.getItem(store.RECOVERY_KEY) === null);
  } catch (error) { errors.push(error.message); }
  finally { ui.closeModal(); store.restore(original); if (oldRecovery === null) localStorage.removeItem(store.RECOVERY_KEY); else localStorage.setItem(store.RECOVERY_KEY, oldRecovery); localStorage.removeItem('other-app-test'); location.hash = 'dashboard'; await pause(); }
  return { passed: results.filter(x => x.pass).length, failed: results.filter(x => !x.pass).length, errors, results };
}
