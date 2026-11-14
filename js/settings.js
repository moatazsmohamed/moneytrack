import { getState, update, backup, restore, validateState, clearDemo, clearAll, loadDemo, recoveryBackup } from './storage.js';
import { t, number } from './translations.js';
import { e, icon, icons, toast, confirmDialog, download } from './ui.js';
import { VERSION } from './version.js';

export function renderSettings(container) {
  const state = getState(), prefs = state.prefs;
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${t('yourWorkspace')}</div><h1>${t('settings')}</h1><p class="page-subtitle">${t('settingsSubtitle')}</p></div></div><div class="settings-layout"><div>
    <section class="card settings-section"><h2>${t('preferences')}</h2><p>${t('preferencesHint')}</p><div class="setting-row"><div><strong>${t('workspaceName')}</strong><p>${t('workspaceNameHint')}</p></div><form id="name-form" style="display:flex;gap:6px"><input id="workspace-name" maxlength="40" required value="${e(prefs.name)}" aria-label="${t('workspaceName')}"><button class="icon-btn" type="submit" aria-label="${t('save')}">${icon('check')}</button></form></div>
    <div class="setting-row"><div><strong>${t('appearance')}</strong><p>${t('appearanceHint')}</p></div><select class="select" id="settings-theme" aria-label="${t('appearance')}"><option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>${t('lightMode')}</option><option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>${t('darkMode')}</option></select></div><div class="setting-row"><div><strong>${t('language')}</strong><p>${t('languageHint')}</p></div><select class="select" id="settings-language" aria-label="${t('language')}"><option value="en" ${prefs.language === 'en' ? 'selected' : ''}>English</option><option value="ar" ${prefs.language === 'ar' ? 'selected' : ''}>العربية</option></select></div><div class="setting-row"><div><strong>${t('currency')}</strong><p>${t('currencyHint')}</p></div><select class="select" id="settings-currency" aria-label="${t('currency')}">${['EGP','USD','EUR','SAR'].map(code => `<option value="${code}" ${prefs.currency === code ? 'selected' : ''}>${code} — ${t('currency' + code)}</option>`).join('')}</select></div></section>
    <section class="card settings-section"><h2>${t('dataManagement')}</h2><p>${t('backupHint')}</p><div class="setting-row"><div><strong>${t('exportBackup')}</strong><p>${t('exportBackupHint')}</p></div><button id="backup-export" class="btn btn-secondary">${icon('download')}${t('exportJSON')}</button></div><div class="setting-row"><div><strong>${t('restoreBackup')}</strong><p>${t('restoreBackupHint')}</p></div><button id="backup-import" class="btn btn-secondary">${icon('upload')}${t('importJSON')}</button><input type="file" id="backup-file" accept="application/json,.json" hidden></div></section>
    <section class="card settings-section"><h2>${t('freshStart')}</h2><p>${t('freshStartHint')}</p><div class="setting-buttons">${state.transactions.some(x => x.demo) ? `<button class="btn btn-secondary" id="clear-demo">${icon('eraser')}${t('clearDemo')}</button>` : `<button class="btn btn-secondary" id="load-demo">${icon('sparkles')}${t('loadDemo')}</button>`}<button class="btn btn-danger" id="clear-all">${icon('trash-2')}${t('clearAllData')}</button></div></section>
    </div><div><section class="card privacy-card"><i data-lucide="shield-check"></i><h2>${t('localFirst')}</h2><p>${t('localStorageExplanation')}</p></section><section class="card" style="margin-top:20px"><h2>${t('aboutApp')}</h2><p class="muted" style="font-size:11px;margin-top:8px">${t('aboutDescription')}</p><div class="info-list"><div><span>${t('version')}</span><strong>${VERSION}</strong></div><div><span>${t('transactions')}</span><strong>${number(state.transactions.length)}</strong></div><div><span>${t('categories')}</span><strong>${number(state.categories.length)}</strong></div><div><span>${t('storage')}</span><strong>LocalStorage</strong></div></div><p class="muted" style="font-size:10px;margin-top:12px">${t('notBankConnected')}</p></section></div></div>`;
  ['theme','language','currency'].forEach(key => container.querySelector(`#settings-${key}`).addEventListener('change', ev => {
    try { const value = ev.target.value; update(s => { s.prefs[key] = value; }); toast(t('preferencesSaved')); } catch { toast(t('storageError'), 'error'); }
  }));
  container.querySelector('#name-form').addEventListener('submit', ev => {
    ev.preventDefault(); const name = container.querySelector('#workspace-name').value.trim();
    if (!name || name.length > 40) return toast(t('invalidName'), 'error');
    try { update(s => { s.prefs.name = name; }); toast(t('preferencesSaved')); } catch { toast(t('storageError'), 'error'); }
  });
  container.querySelector('#backup-export').addEventListener('click', () => { download(backup(), `MoneyTrack-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); toast(t('backupExported')); });
  container.querySelector('#backup-import').addEventListener('click', () => container.querySelector('#backup-file').click());
  const recovery = recoveryBackup();
  if (recovery) {
    const recoveryRow = document.createElement('div');
    recoveryRow.className = 'setting-row';
    recoveryRow.innerHTML = `<div><strong>${t('downloadRecovery')}</strong><p>${t('downloadRecoveryHint')}</p></div><button id="recovery-export" class="btn btn-secondary">${icon('history')}${t('exportJSON')}</button>`;
    container.querySelector('#backup-export').closest('.settings-section').append(recoveryRow);
    recoveryRow.querySelector('button').addEventListener('click', () => { download(recovery, 'MoneyTrack-recovery.json', 'application/json'); toast(t('backupExported')); });
  }
  container.querySelector('#backup-file').addEventListener('change', async ev => {
    const file = ev.target.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { ev.target.value = ''; return toast(t('backupTooLarge'), 'error'); }
    try {
      const data = JSON.parse(await file.text()); validateState(data);
      const approved = await confirmDialog(t('restoreBackup'), t('confirmRestore', { count: number(data.transactions.length) }));
      if (!approved) return;
      restore(data); toast(t('backupRestored'));
    } catch { toast(t('invalidBackup'), 'error'); } finally { ev.target.value = ''; }
  });
  const runConfirmed = async (title, message, action) => {
    if (await confirmDialog(title, message)) {
      try { action(); toast(t('dataUpdated')); } catch { toast(t('storageError'), 'error'); }
    }
  };
  container.querySelector('#clear-demo')?.addEventListener('click', () => runConfirmed(t('clearDemo'), t('confirmClearDemo'), clearDemo));
  container.querySelector('#load-demo')?.addEventListener('click', () => runConfirmed(t('loadDemo'), t('confirmLoadDemo'), loadDemo));
  container.querySelector('#clear-all').addEventListener('click', () => runConfirmed(t('clearAllData'), t('confirmClearAll'), clearAll));
  icons();
}
