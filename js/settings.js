import { getState, update, backup, restore, validateState, clearDemo, clearAll, recoveryBackup, isStorageReady } from './storage.js';
import { t, number } from './translations.js';
import { e, icon, icons, toast, confirmDialog, download, openModal } from './ui.js';
import { VERSION } from './version.js';
import { api } from './api-client.js';
import { getUser, getSession, loadSession, clearSession } from './auth.js';
import { clearStorage } from './storage.js';
import { errorMessage } from './errors.js';
import { migrationButtonHTML, reviewMigration, importDemo } from './migration.js';

function passwordSection(forced) {
  return `<section class="card settings-section"><h2>${e(t('cloud.passwordTitle'))}</h2><p>${e(t(forced ? 'cloud.forcePassword' : 'cloud.passwordHint'))}</p><form id="password-form" class="form-grid"><label class="field span-2"><span>${e(t('cloud.currentPassword'))}</span><input type="password" name="currentPassword" required autocomplete="current-password" maxlength="256"></label><label class="field"><span>${e(t('cloud.newPassword'))}</span><input type="password" name="newPassword" required minlength="12" maxlength="256" autocomplete="new-password"></label><label class="field"><span>${e(t('cloud.confirmPassword'))}</span><input type="password" name="confirmPassword" required minlength="12" maxlength="256" autocomplete="new-password"></label><button class="btn btn-primary" type="submit">${icon('key-round')}${e(t('saveChanges'))}</button></form></section>`;
}

function profileSection(user) {
  return `<section class="card settings-section"><h2>${e(t('cloud.profileTitle'))}</h2><div class="info-list"><div><span>${e(t('cloud.email'))}</span><strong class="account-email">${e(user.email)}</strong></div><div><span>${e(t('cloud.role'))}</span><strong>${e(t('cloud.role.' + user.role))}</strong></div></div><form id="profile-form" class="form-grid" style="margin-top:16px"><label class="field span-2"><span>${e(t('cloud.fullName'))}</span><input name="fullName" required maxlength="100" autocomplete="name" value="${e(user.fullName)}"></label><button class="btn btn-secondary" type="submit">${icon('user-round-check')}${e(t('saveChanges'))}</button></form></section>`;
}

async function submitForm(form, work, success) {
  const button = form.querySelector('[type="submit"]');
  if (button.disabled) return;
  button.disabled = true;
  try { await work(new FormData(form)); if (success) toast(t(success)); }
  catch (error) { toast(errorMessage(error), 'error'); }
  finally { button.disabled = false; }
}

function bindAccountForms(container) {
  container.querySelector('#profile-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, async data => {
      await api('/auth/profile', { method: 'PATCH', body: { fullName: String(data.get('fullName') || '').trim() } });
      await loadSession();
      window.dispatchEvent(new Event('moneytrack:render'));
    }, 'cloud.profileSaved');
  });
  container.querySelector('#password-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    submitForm(form, async data => {
      if (data.get('newPassword') !== data.get('confirmPassword')) throw { code: 'PASSWORD_MISMATCH' };
      await api('/auth/change-password', { method: 'POST', body: Object.fromEntries(data.entries()) });
      form.reset();
      await loadSession();
      toast(t('cloud.passwordChanged'));
      // Re-enter through the server and reload the cloud workspace after forced change.
      location.assign(getUser()?.role === 'USER' ? '/app#settings' : '/admin');
    });
  });
  container.querySelector('#change-email')?.addEventListener('click', () => {
    openModal({
      title: t('cloud.changeEmail'), submitLabel: t('saveChanges'),
      body: `<p class="notice">${e(t('cloud.emailChangeHint'))}</p><div class="form-grid"><label class="field span-2"><span>${e(t('cloud.email'))}</span><input type="email" name="email" required autocomplete="email" maxlength="254"></label><label class="field span-2"><span>${e(t('cloud.currentPassword'))}</span><input type="password" name="currentPassword" required autocomplete="current-password" maxlength="256"></label></div>`,
      onSubmit: async data => {
        try {
          await api('/auth/change-email', { method: 'POST', body: { email: data.get('email'), currentPassword: data.get('currentPassword'), language: getState().prefs.language } });
          toast(t('cloud.emailRequested'));
        } catch (error) { throw new Error(errorMessage(error)); }
      },
    });
  });
  container.querySelector('#delete-account')?.addEventListener('click', () => {
    openModal({
      title: t('cloud.deleteAccount'), submitLabel: t('delete'),
      body: `<p class="notice warning">${e(t('cloud.deleteConfirmation'))}</p><div class="form-grid"><label class="field span-2"><span>${e(t('cloud.currentPassword'))}</span><input type="password" name="currentPassword" required autocomplete="current-password" maxlength="256"></label><label class="field span-2"><span>${e(t('cloud.confirmationWord'))}</span><input name="confirm" required pattern="DELETE" autocomplete="off"></label></div>`,
      onSubmit: async data => {
        try {
          await api('/auth/account', { method: 'DELETE', body: { currentPassword: data.get('currentPassword'), confirm: data.get('confirm') } });
          clearSession(); clearStorage(); location.assign('/');
        } catch (error) { throw new Error(errorMessage(error)); }
      },
    });
  });
}

export function renderSettings(container) {
  const user = getUser();
  if (!user) return;
  const state = getState(), prefs = state.prefs, forced = user.mustChangePassword;
  if (forced) {
    container.innerHTML = `<div class="page-head"><div><h1>${e(t('cloud.passwordTitle'))}</h1><p class="page-subtitle">${e(t('cloud.forcePassword'))}</p></div></div>${passwordSection(true)}`;
    bindAccountForms(container); icons(); return;
  }
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${e(t('yourWorkspace'))}</div><h1>${e(t('settings'))}</h1><p class="page-subtitle">${e(t('settingsSubtitle'))}</p></div></div>${migrationButtonHTML()}<div class="settings-layout"><div>
    ${profileSection(user)}${passwordSection(false)}
    <section class="card settings-section"><h2>${e(t('preferences'))}</h2><p>${e(t('preferencesHint'))}</p><div class="setting-row"><div><strong>${e(t('workspaceName'))}</strong><p>${e(t('workspaceNameHint'))}</p></div><form id="name-form" style="display:flex;gap:6px"><input id="workspace-name" maxlength="40" value="${e(prefs.name)}" aria-label="${e(t('workspaceName'))}"><button class="icon-btn" type="submit" aria-label="${e(t('save'))}">${icon('check')}</button></form></div>
    <div class="setting-row"><div><strong>${e(t('appearance'))}</strong><p>${e(t('appearanceHint'))}</p></div><select class="select" id="settings-theme" aria-label="${e(t('appearance'))}"><option value="light" ${prefs.theme === 'light' ? 'selected' : ''}>${e(t('lightMode'))}</option><option value="dark" ${prefs.theme === 'dark' ? 'selected' : ''}>${e(t('darkMode'))}</option></select></div><div class="setting-row"><div><strong>${e(t('language'))}</strong><p>${e(t('languageHint'))}</p></div><select class="select" id="settings-language" aria-label="${e(t('language'))}"><option value="en" ${prefs.language === 'en' ? 'selected' : ''}>English</option><option value="ar" ${prefs.language === 'ar' ? 'selected' : ''}>العربية</option></select></div><div class="setting-row"><div><strong>${e(t('currency'))}</strong><p>${e(t('currencyHint'))}</p></div><select class="select" id="settings-currency" aria-label="${e(t('currency'))}">${['EGP','USD','EUR','SAR'].map(code => `<option value="${code}" ${prefs.currency === code ? 'selected' : ''}>${code} — ${e(t('currency' + code))}</option>`).join('')}</select></div></section>
    <section class="card settings-section"><h2>${e(t('dataManagement'))}</h2><p>${e(t('backupHint'))}</p><div class="setting-row"><div><strong>${e(t('exportBackup'))}</strong><p>${e(t('exportBackupHint'))}</p></div><button id="backup-export" class="btn btn-secondary">${icon('download')}${e(t('exportJSON'))}</button></div><div class="setting-row"><div><strong>${e(t('restoreBackup'))}</strong><p>${e(t('restoreBackupHint'))}</p></div><button id="backup-import" class="btn btn-secondary">${icon('upload')}${e(t('importJSON'))}</button><input type="file" id="backup-file" accept="application/json,.json" hidden></div><div class="setting-row"><div><strong>${e(t('downloadRecovery'))}</strong><p>${e(t('downloadRecoveryHint'))}</p></div><button id="recovery-export" class="btn btn-secondary">${icon('history')}${e(t('exportJSON'))}</button></div></section>
    <section class="card settings-section"><h2>${e(t('freshStart'))}</h2><p>${e(t('freshStartHint'))}</p><div class="setting-buttons">${state.transactions.some(item => item.demo) ? `<button class="btn btn-secondary" id="clear-demo">${icon('eraser')}${e(t('clearDemo'))}</button>` : `<button class="btn btn-secondary" id="load-demo">${icon('sparkles')}${e(t('loadDemo'))}</button>`}<button class="btn btn-danger" id="clear-all">${icon('trash-2')}${e(t('clearAllData'))}</button></div></section>
    </div><div><section class="card privacy-card"><i data-lucide="shield-check"></i><h2>${e(t('localFirst'))}</h2><p>${e(t('localStorageExplanation'))}</p></section><section class="card settings-section" style="margin-top:20px"><h2>${e(t('cloud.changeEmail'))}</h2><p>${e(t('cloud.emailChangeHint'))}</p>${!getSession().emailConfigured ? `<p class="notice warning">${e(t('cloud.mailUnavailable'))}</p>` : ''}<button id="change-email" class="btn btn-secondary">${icon('mail')}${e(t('cloud.changeEmail'))}</button></section><section class="card settings-section"><h2>${e(t('cloud.deleteAccount'))}</h2><p>${e(t('cloud.deleteAccountHint'))}</p><button id="delete-account" class="btn btn-danger">${icon('user-round-x')}${e(t('cloud.deleteAccount'))}</button></section><section class="card"><h2>${e(t('aboutApp'))}</h2><p class="muted" style="font-size:11px;margin-top:8px">${e(t('aboutDescription'))}</p><div class="info-list"><div><span>${e(t('version'))}</span><strong>${VERSION}</strong></div><div><span>${e(t('transactions'))}</span><strong>${e(number(state.transactions.length))}</strong></div><div><span>${e(t('categories'))}</span><strong>${e(number(state.categories.length))}</strong></div><div><span>${e(t('storage'))}</span><strong>${e(t('cloud.storageLabel'))}</strong></div></div><p class="muted" style="font-size:10px;margin-top:12px">${e(t('notBankConnected'))}</p></section></div></div>`;
  bindAccountForms(container);
  container.querySelector('[data-review-migration]')?.addEventListener('click', reviewMigration);
  ['theme','language','currency'].forEach(key => container.querySelector(`#settings-${key}`).addEventListener('change', async event => {
    const input = event.target;
    input.disabled = true;
    try { const value = input.value; await update(draft => { draft.prefs[key] = value; }); toast(t('preferencesSaved')); }
    catch (error) { input.value = getState().prefs[key]; toast(errorMessage(error), 'error'); }
    finally { input.disabled = false; }
  }));
  container.querySelector('#name-form').addEventListener('submit', event => {
    event.preventDefault();
    submitForm(event.currentTarget, async () => {
      const name = container.querySelector('#workspace-name').value.trim();
      await update(draft => { draft.prefs.name = name; });
    }, 'preferencesSaved');
  });
  container.querySelector('#backup-export').addEventListener('click', () => {
    try { download(backup(), `MoneyTrack-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json'); toast(t('backupExported')); }
    catch (error) { toast(errorMessage(error), 'error'); }
  });
  container.querySelector('#recovery-export').addEventListener('click', async event => {
    event.currentTarget.disabled = true;
    try {
      const previous = await recoveryBackup();
      if (!previous) return toast(t('cloud.noRecovery'));
      download(previous, 'MoneyTrack-recovery.json', 'application/json'); toast(t('backupExported'));
    } catch (error) { toast(errorMessage(error), 'error'); }
    finally { event.currentTarget.disabled = false; }
  });
  container.querySelector('#backup-import').addEventListener('click', () => container.querySelector('#backup-file').click());
  container.querySelector('#backup-file').addEventListener('change', async event => {
    const input = event.target, file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { input.value = ''; return toast(t('backupTooLarge'), 'error'); }
    try {
      const data = JSON.parse(await file.text()); validateState(data);
      if (!await confirmDialog(t('restoreBackup'), t('confirmRestore', { count: number(data.transactions.length) }))) return;
      await restore(data); toast(t('backupRestored'));
    } catch (error) { toast(error?.code ? errorMessage(error) : t('invalidBackup'), 'error'); }
    finally { input.value = ''; }
  });
  const confirmed = async (title, message, action) => {
    if (!await confirmDialog(title, message)) return;
    try { await action(); toast(t('dataUpdated')); }
    catch (error) { toast(errorMessage(error), 'error'); }
  };
  container.querySelector('#clear-demo')?.addEventListener('click', () => confirmed(t('clearDemo'), t('confirmClearDemo'), clearDemo));
  container.querySelector('#load-demo')?.addEventListener('click', () => importDemo().catch(error => toast(errorMessage(error), 'error')));
  container.querySelector('#clear-all').addEventListener('click', () => confirmed(t('clearAllData'), t('confirmClearAll'), clearAll));
  icons();
}
