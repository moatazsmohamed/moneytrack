import { STORAGE_KEY, validateState as validateLegacy, defaultCategories, monthKey, uid } from './legacy-storage.js';
import { importWorkspace } from './storage.js';
import { t, number, money } from './translations.js';
import { e, icon, icons, openModal, toast, download, confirmDialog } from './ui.js';

export function legacyData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const state = JSON.parse(raw);
    validateLegacy(state);
    return { state, raw };
  } catch { return { invalid: true }; }
}

export function migrationButtonHTML() {
  const data = legacyData();
  if (!data) return '';
  if (data.invalid) return `<div class="notice warning">${icon('triangle-alert')}<span>${e(t('cloud.legacyInvalid'))}</span></div>`;
  return `<div class="notice"><span>${icon('hard-drive-download')}</span><span>${e(t('cloud.legacyFound', { count: number(data.state.transactions.length) }))}</span><button class="btn btn-secondary" type="button" data-review-migration>${e(t('cloud.reviewMigration'))}</button></div>`;
}

export function reviewMigration() {
  const data = legacyData();
  if (!data || data.invalid) return toast(t('invalidBackup'), 'error');
  const transactions = data.state.transactions;
  const actual = transactions.filter(row => !row.demo), demo = transactions.length - actual.length;
  let copied = false;
  const modal = openModal({
    title: t('cloud.migrateTitle'), submitLabel: t('cloud.importIntoAccount'),
    body: `<p class="notice">${e(t('cloud.migrationPrivacy'))}</p><div class="info-list"><div><span>${e(t('transactions'))}</span><strong>${e(number(actual.length))}</strong></div><div><span>${e(t('demoData'))}</span><strong>${e(number(demo))}</strong></div><div><span>${e(t('categories'))}</span><strong>${e(number(data.state.categories.length))}</strong></div></div><p class="muted">${e(t('cloud.migrationKeepsLocal'))}</p><button type="button" class="btn btn-secondary" data-copy-legacy>${icon('download')}${e(t('cloud.downloadBeforeImport'))}</button><label class="field" style="margin-top:18px"><span><input type="checkbox" name="includeDemo"> ${e(t('cloud.includeDemo'))}</span></label><label class="field"><span><input type="checkbox" name="authorized" required> ${e(t('cloud.authorizeMigration'))}</span></label>`,
    onSubmit: async form => {
      if (!copied) throw new Error(t('cloud.downloadFirst'));
      if (!form.get('authorized')) throw new Error(t('cloud.authorizeMigration'));
      const result = await importWorkspace(data.state, { includeDemo: !!form.get('includeDemo') });
      toast(t(result.duplicate ? 'cloud.importDuplicate' : 'cloud.importSuccess', { count: number(result.imported) }));
    },
  });
  modal.form.querySelector('[data-copy-legacy]').addEventListener('click', () => {
    download(data.raw, `MoneyTrack-device-before-import-${Date.now()}.json`, 'application/json');
    copied = true;
    toast(t('backupExported'));
  });
  icons();
}

/* Explicit sample import only: never seeds a real account automatically or overwrites old local data. */
export async function importDemo() {
  if (!await confirmDialog(t('loadDemo'), t('cloud.sampleImportConfirm'))) return;
  const categories = defaultCategories(), currentMonth = monthKey();
  const state = {
    version: 1, categories, budgets: {},
    prefs: { language: 'ar', theme: 'light', currency: 'EGP', name: '' },
    transactions: [
      { id: 'sample-v4-income', title: t('cloud.sampleIncome'), amount: 12000, type: 'income', categoryId: 'salary', date: `${currentMonth}-01`, description: t('cloud.sampleDescription'), demo: true },
      { id: 'sample-v4-expense', title: t('cloud.sampleExpense'), amount: 800, type: 'expense', categoryId: 'food', date: `${currentMonth}-01`, description: t('cloud.sampleDescription'), demo: true },
    ],
  };
  const result = await importWorkspace(state, { includeDemo: true });
  toast(t(result.duplicate ? 'cloud.importDuplicate' : 'cloud.sampleImported'));
}
