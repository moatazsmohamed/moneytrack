import { getState, getStorageWarning, initializeStorage, clearStorage, refreshState, isStorageReady, setAppearance } from './storage.js';
import { t, number, applyLocale } from './translations.js';
import { e, icon, icons, toast } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderTransactions, setTransactionSearch } from './transactions.js';
import { renderCategories } from './categories.js';
import { renderBudgets } from './budgets.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { renderGoals } from './goals.js';
import { renderRecurring } from './recurring.js';
import { renderNotifications, notificationTitleText, notificationBodyText } from './notifications.js';
import { destroyCharts } from './charts.js';
import { loadSession, getUser, logout, clearSession } from './auth.js';
import { errorMessage } from './errors.js';

const pages = { dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, goals: renderGoals, recurring: renderRecurring, reports: renderReports, categories: renderCategories, notifications: renderNotifications, settings: renderSettings };
const navIcons = { dashboard: 'layout-dashboard', transactions: 'arrow-left-right', budgets: 'wallet-cards', goals: 'target', recurring: 'repeat-2', reports: 'chart-no-axes-combined', categories: 'layers', notifications: 'bell', settings: 'settings-2' };
const $ = id => document.getElementById(id);
let rendering = false, booting = false, booted = false, currentAccount = null;
const activeRoute = () => getUser()?.mustChangePassword ? 'settings' : Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';

function navClosed() {
  $('sidebar').classList.remove('open'); $('sidebar-overlay').hidden = true;
  $('mobile-menu').setAttribute('aria-expanded', 'false');
}

function notificationPanel() {
  const unread = (getState().notifications || []).filter(row => !row.read);
  $('notification-dot').hidden = !unread.length;
  $('notification-panel').innerHTML = `<h3>${e(t('notifications'))}</h3>${unread.length ? unread.slice(0, 4).map(row => `<a class="notification-item" href="#notifications">${icon(row.type === 'budget' ? 'wallet-cards' : row.type === 'recurring' ? 'repeat-2' : 'bell')}<span><strong>${e(notificationTitleText(row))}</strong><p class="muted">${e(notificationBodyText(row))}</p></span></a>`).join('') : `<p class="muted" style="padding-top:15px;font-size:12px">${e(t('noNotifications'))}</p>`}<a href="#notifications" class="btn btn-ghost">${e(t('viewAll'))} ${unread.length ? e(number(unread.length)) : ''}${icon('arrow-up-right')}</a>`;
}

function shell() {
  const state = getState(), user = getUser(), route = activeRoute();
  applyLocale();
  document.title = `${t(route === 'dashboard' ? 'overview' : route)} | MoneyTrack`;
  const allowedPages = user?.mustChangePassword ? ['settings'] : Object.keys(pages);
  $('main-nav').innerHTML = allowedPages.map(key => `<a href="#${key}" class="nav-link ${route === key ? 'active' : ''}" ${route === key ? 'aria-current="page"' : ''}>${icon(navIcons[key])}<span>${e(t(key === 'dashboard' ? 'overview' : key))}</span></a>`).join('') + `${user && !user.mustChangePassword && ['ADMIN','SUPER_ADMIN'].includes(user.role) ? `<a class="nav-link" href="/admin">${icon('shield-check')}<span>${e(t('adminPanel'))}</span></a>` : ''}<a class="nav-link" href="/">${icon('house')}<span>${e(t('home'))}</span></a>`;
  $('breadcrumb-current').textContent = t(route === 'dashboard' ? 'overview' : route);
  $('workspace-label').textContent = t('workspace'); $('brand-tagline').textContent = t('brandTagline');
  $('local-status-text').textContent = t('storedHere');
  $('profile-name').textContent = user?.fullName || state.prefs.name || t('myWorkspace');
  $('avatar-initial').textContent = (user?.fullName || 'M').slice(0, 1).toUpperCase();
  $('profile-caption').textContent = user?.email || t('personalAccount');
  $('footer-label').textContent = t('footerLabel'); $('footer-private').innerHTML = `${icon('lock-keyhole')}${e(t('footerPrivate'))}`;
  $('skip-link').textContent = t('skipContent'); $('sidebar').setAttribute('aria-label', t('navigation'));
  $('mobile-menu').setAttribute('aria-label', t('openMenu'));
  const lang = $('language-toggle'); lang.textContent = state.prefs.language === 'en' ? 'عربي' : 'EN'; lang.setAttribute('aria-label', t('toggleLanguage'));
  $('theme-toggle').innerHTML = icon(state.prefs.theme === 'light' ? 'moon' : 'sun'); $('theme-toggle').setAttribute('aria-label', t('toggleTheme'));
  $('global-search').placeholder = t('searchPlaceholder'); $('global-search').setAttribute('aria-label', t('search')); $('global-search').disabled = !!user?.mustChangePassword;
  $('notification-toggle').setAttribute('aria-label', t('notifications')); $('notification-toggle').disabled = !!user?.mustChangePassword;
  $('refresh-workspace').setAttribute('aria-label', t('cloud.refresh')); $('refresh-workspace').disabled = !!user?.mustChangePassword || booting;
  $('logout-button').setAttribute('aria-label', t('logout')); notificationPanel();
}

function render() {
  if (rendering || !getUser()) return;
  if (!getUser().mustChangePassword && !isStorageReady()) return;
  rendering = true;
  try {
    destroyCharts(); shell();
    const main = $('main-content'); main.innerHTML = '<section id="page-view"></section>';
    pages[activeRoute()]($('page-view'));
    if (getStorageWarning()) main.insertAdjacentHTML('afterbegin', `<div class="notice warning" role="alert">${icon('triangle-alert')}<span>${e(t('cloud.syncWarning'))}</span><button class="btn btn-ghost" data-refresh-cloud>${e(t('cloud.refresh'))}</button></div>`);
    main.querySelector('[data-refresh-cloud]')?.addEventListener('click', () => synchronize());
    icons();
    main.querySelectorAll('.stat-value').forEach(node => {
      if (node.scrollWidth > node.clientWidth && node.clientWidth > 0) {
        const size = parseFloat(getComputedStyle(node).fontSize);
        node.style.fontSize = `${Math.max(12, Math.floor(size * node.clientWidth / node.scrollWidth))}px`;
      }
    });
  } catch (error) {
    console.error('MoneyTrack render failed:', error?.name || 'Error');
    showError();
  } finally { rendering = false; }
}

function showError(error) {
  destroyCharts();
  $('main-content').innerHTML = `<div class="empty-state">${icon('triangle-alert')}<h2>${e(t('appError'))}</h2><p>${e(error ? errorMessage(error) : t('appErrorHint'))}</p><button class="btn btn-primary" id="retry-render">${e(t('retry'))}</button></div>`;
  $('retry-render').addEventListener('click', () => synchronize()); icons();
}

async function synchronize({ initial = false, silent = false } = {}) {
  if (booting) return;
  booting = true;
  $('refresh-workspace').disabled = true;
  try {
    const session = await loadSession(), user = session.user;
    if (!user || user.status !== 'active') return expireSession();
    if (!user.emailVerified) { clearStorage(); location.replace('/resend-verification'); return; }
    if (currentAccount !== user.id) { initializeStorage(user); currentAccount = user.id; }
    if (user.mustChangePassword) {
      history.replaceState({}, '', '/app#settings'); render(); return;
    }
    if (initial || !booted) $('main-content').innerHTML = `<div class="loading-state"><span class="loader"></span><p>${e(t('cloud.refreshing'))}</p></div>`;
    await refreshState({ processDue: initial || !booted });
    booted = true; render();
    if (!initial && !silent) toast(t('cloud.synced'));
  } catch (error) { if (error.status === 401) expireSession(); else showError(error); }
  finally { booting = false; if ($('refresh-workspace')) $('refresh-workspace').disabled = !!getUser()?.mustChangePassword; }
}

function expireSession() {
  destroyCharts(); clearStorage(); clearSession(); currentAccount = null;
  $('main-content').replaceChildren(); $('notification-panel').replaceChildren();
  location.replace('/login');
}

window.addEventListener('hashchange', async () => {
  navClosed(); $('notification-panel').hidden = true; $('notification-toggle').setAttribute('aria-expanded', 'false');
  try {
    const { user } = await loadSession();
    if (!user) return expireSession();
    if (user.id !== currentAccount) return synchronize({ silent: true });
    render(); window.scrollTo({ top: 0, behavior: 'instant' });
  } catch (error) { if (error.status === 401) expireSession(); else toast(errorMessage(error), 'error'); }
});
window.addEventListener('moneytrack:update', render);
window.addEventListener('moneytrack:render', render);
window.addEventListener('moneytrack:auth-expired', expireSession);
window.addEventListener('focus', () => { if (booted) synchronize({ silent: true }); });
for (const [id, key] of [['theme-toggle','theme'], ['language-toggle','language']]) {
  $(id).addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    try { const prefs = getState().prefs; await setAppearance({ [key]: key === 'theme' ? (prefs.theme === 'light' ? 'dark' : 'light') : (prefs.language === 'en' ? 'ar' : 'en') }); }
    catch (error) { toast(errorMessage(error), 'error'); }
    finally { button.disabled = false; }
  });
}
$('refresh-workspace').addEventListener('click', () => synchronize());
$('logout-button').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { await logout(); expireSession(); } catch (error) { toast(errorMessage(error), 'error'); button.disabled = false; }
});
$('mobile-menu').addEventListener('click', () => { const open = $('sidebar').classList.toggle('open'); $('sidebar-overlay').hidden = !open; $('mobile-menu').setAttribute('aria-expanded', String(open)); });
$('sidebar-overlay').addEventListener('click', navClosed); $('main-nav').addEventListener('click', navClosed);
$('skip-link').addEventListener('click', event => { event.preventDefault(); $('main-content').focus(); });
$('notification-toggle').addEventListener('click', event => { event.stopPropagation(); const panel = $('notification-panel'); panel.hidden = !panel.hidden; event.currentTarget.setAttribute('aria-expanded', String(!panel.hidden)); });
$('notification-panel').addEventListener('click', () => { $('notification-panel').hidden = true; $('notification-toggle').setAttribute('aria-expanded', 'false'); });
document.addEventListener('click', event => { if (!event.target.closest('.notification-wrapper')) { $('notification-panel').hidden = true; $('notification-toggle').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', event => { if (event.key === 'Escape') { navClosed(); $('notification-panel').hidden = true; } });
$('global-search').addEventListener('keydown', event => { if (event.key === 'Enter') { setTransactionSearch(event.target.value); if (location.hash !== '#transactions') location.hash = 'transactions'; else render(); } });
synchronize({ initial: true });
