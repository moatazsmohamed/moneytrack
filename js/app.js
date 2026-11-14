import { getState, update, getStorageWarning, monthKey } from './storage.js';
import { t, money, catName, applyLocale } from './translations.js';
import { e, icon, icons, toast } from './ui.js';
import { renderDashboard } from './dashboard.js';
import { renderTransactions, setTransactionSearch } from './transactions.js';
import { renderCategories } from './categories.js';
import { renderBudgets, budgetSummary } from './budgets.js';
import { renderReports } from './reports.js';
import { renderSettings } from './settings.js';
import { destroyCharts } from './charts.js';

const pages = { dashboard: renderDashboard, transactions: renderTransactions, budgets: renderBudgets, reports: renderReports, categories: renderCategories, settings: renderSettings };
const navIcons = { dashboard: 'layout-dashboard', transactions: 'arrow-left-right', budgets: 'wallet-cards', reports: 'chart-no-axes-combined', categories: 'layers', settings: 'settings-2' };
let rendering = false;
const activeRoute = () => Object.hasOwn(pages, location.hash.slice(1)) ? location.hash.slice(1) : 'dashboard';
function navClosed() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').hidden = true;
  document.getElementById('mobile-menu').setAttribute('aria-expanded', 'false');
}
function notifications() {
  const summary = budgetSummary(monthKey()), warnings = [];
  if (summary.total && summary.percent >= 80) warnings.push({ title: t('monthlyBudget'), percent: summary.percent, over: summary.percent >= 100 });
  for (const item of summary.categories) if (item.budget && item.percent >= 80) warnings.push({ title: catName(item.category), percent: item.percent, over: item.percent >= 100 });
  document.getElementById('notification-dot').hidden = !warnings.length;
  document.getElementById('notification-panel').innerHTML = `<h3>${t('notifications')}</h3>${warnings.length ? warnings.map(w => `<a class="notification-item" href="#budgets">${icon(w.over ? 'triangle-alert' : 'circle-alert')}<span><strong>${e(w.title)}</strong><p class="muted">${e(t(w.over ? 'overBudget' : 'nearBudget'))}</p></span>${icon('arrow-up-right')}</a>`).join('') : `<p class="muted" style="padding-top:15px;font-size:12px">${t('noNotifications')}</p>`}<p class="muted" style="font-size:10px;margin-top:8px">${t('notificationHint')}</p>`;
}
function shell() {
  const state = getState(), route = activeRoute();
  applyLocale();
  document.title = `${t(route === 'dashboard' ? 'overview' : route)} | MoneyTrack`;
  document.getElementById('main-nav').innerHTML = Object.keys(pages).map(key => `<a href="#${key}" class="nav-link ${route === key ? 'active' : ''}" ${route === key ? 'aria-current="page"' : ''}>${icon(navIcons[key])}<span>${t(key === 'dashboard' ? 'overview' : key)}</span></a>`).join('');
  document.getElementById('breadcrumb-current').textContent = t(route === 'dashboard' ? 'overview' : route);
  document.getElementById('workspace-label').textContent = t('workspace');
  document.getElementById('brand-tagline').textContent = t('brandTagline');
  document.getElementById('local-status-text').textContent = t('storedHere');
  document.getElementById('profile-name').textContent = state.prefs.name || t('myWorkspace');
  document.getElementById('avatar-initial').textContent = (state.prefs.name || 'M').slice(0, 1).toUpperCase();
  document.getElementById('profile-caption').textContent = t('personalAccount');
  document.getElementById('footer-label').textContent = t('footerLabel');
  document.getElementById('footer-private').innerHTML = `${icon('lock-keyhole')}${t('footerPrivate')}`;
  document.getElementById('skip-link').textContent = t('skipContent');
  document.getElementById('sidebar').setAttribute('aria-label', t('navigation'));
  document.getElementById('mobile-menu').setAttribute('aria-label', t('openMenu'));
  const langButton = document.getElementById('language-toggle');
  langButton.textContent = state.prefs.language === 'en' ? 'عربي' : 'EN';
  langButton.setAttribute('aria-label', t('toggleLanguage'));
  const themeButton = document.getElementById('theme-toggle');
  themeButton.innerHTML = icon(state.prefs.theme === 'light' ? 'moon' : 'sun');
  themeButton.setAttribute('aria-label', t('toggleTheme'));
  document.getElementById('global-search').placeholder = t('searchPlaceholder');
  document.getElementById('global-search').setAttribute('aria-label', t('search'));
  document.getElementById('notification-toggle').setAttribute('aria-label', t('notifications'));
  notifications();
}
function render() {
  if (rendering) return;
  rendering = true;
  try {
    destroyCharts(); shell();
    const main = document.getElementById('main-content');
    main.innerHTML = '<section id="page-view"></section>';
    pages[activeRoute()](document.getElementById('page-view'));
    if (getStorageWarning()) main.insertAdjacentHTML('afterbegin', `<div class="notice warning" role="alert">${icon('triangle-alert')}<span>${t('storageWarning')} ${t('storageWarningAction')}</span><a href="#settings" class="btn btn-ghost">${t('settings')}</a></div>`);
    icons();
    main.querySelectorAll('.stat-value').forEach(node => {
      if (node.scrollWidth > node.clientWidth && node.clientWidth > 0) {
        const size = parseFloat(getComputedStyle(node).fontSize);
        node.style.fontSize = `${Math.max(12, Math.floor(size * node.clientWidth / node.scrollWidth))}px`;
      }
    });
  } catch (error) {
    console.error('MoneyTrack render error:', error);
    document.getElementById('main-content').innerHTML = `<div class="empty-state">${icon('triangle-alert')}<h2>${t('appError')}</h2><p>${t('appErrorHint')}</p><button class="btn btn-primary" id="retry-render">${t('retry')}</button></div>`;
    document.getElementById('retry-render').addEventListener('click', render); icons();
  } finally { rendering = false; }
}
window.addEventListener('hashchange', () => { navClosed(); document.getElementById('notification-panel').hidden = true; document.getElementById('notification-toggle').setAttribute('aria-expanded', 'false'); render(); window.scrollTo({ top: 0, behavior: 'instant' }); });
window.addEventListener('moneytrack:update', render);
window.addEventListener('moneytrack:render', render);
document.getElementById('theme-toggle').addEventListener('click', () => { try { update(s => { s.prefs.theme = s.prefs.theme === 'light' ? 'dark' : 'light'; }); } catch { toast(t('storageError'), 'error'); } });
document.getElementById('language-toggle').addEventListener('click', () => { try { update(s => { s.prefs.language = s.prefs.language === 'en' ? 'ar' : 'en'; }); } catch { toast(t('storageError'), 'error'); } });
document.getElementById('mobile-menu').addEventListener('click', () => {
  const open = document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').hidden = !open;
  document.getElementById('mobile-menu').setAttribute('aria-expanded', String(open));
});
document.getElementById('sidebar-overlay').addEventListener('click', navClosed);
document.getElementById('main-nav').addEventListener('click', navClosed);
document.getElementById('skip-link').addEventListener('click', ev => { ev.preventDefault(); document.getElementById('main-content').focus(); });
document.getElementById('notification-toggle').addEventListener('click', ev => {
  ev.stopPropagation(); const panel = document.getElementById('notification-panel'); panel.hidden = !panel.hidden;
  ev.currentTarget.setAttribute('aria-expanded', String(!panel.hidden));
});
document.addEventListener('click', ev => { if (!ev.target.closest('.notification-wrapper')) { document.getElementById('notification-panel').hidden = true; document.getElementById('notification-toggle').setAttribute('aria-expanded', 'false'); } });
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') { navClosed(); document.getElementById('notification-panel').hidden = true; } });
document.getElementById('global-search').addEventListener('keydown', ev => {
  if (ev.key === 'Enter') { setTransactionSearch(ev.target.value); if (location.hash !== '#transactions') location.hash = 'transactions'; else render(); }
});
render();
