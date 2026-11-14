import { getState } from './storage.js';
import { e, icon, icons, empty, toast } from './ui.js';
import { t, formatDate, translations } from './translations.js';

const NOTIFICATION_TYPES = ['budget', 'recurring', 'goals', 'security'];
const TITLE_KEYS = {
  budgetAlert: 'extensions.notifications.title.budgetAlert',
  goalReached: 'extensions.notifications.title.goalReached',
  recurringProcessed: 'extensions.notifications.title.recurringProcessed',
  registered: 'extensions.notifications.title.registered',
};
const BODY_KEYS = {
  budgetAlert: 'extensions.notifications.body.budgetAlert',
  goalReached: 'extensions.notifications.body.goalReached',
  recurringProcessed: 'extensions.notifications.body.recurringProcessed',
  registered: 'extensions.notifications.body.registered',
};

function normalizedType(type) {
  return type === 'goal' ? 'goals' : (NOTIFICATION_TYPES.includes(type) ? type : 'security');
}

function getApi() {
  if (typeof globalThis.api === 'function') return globalThis.api;
  return import('./api-client.js').then((module) => module.api);
}

async function request(path, options) {
  const api = await getApi();
  if (typeof api !== 'function') throw new Error(t('extensions.api.unavailable'));
  return api(path, options);
}

async function refresh() {
  const storage = await import('./storage.js');
  if (typeof storage.refreshState !== 'function') throw new Error(t('extensions.api.unavailable'));
  return storage.refreshState();
}

const SERVER_ERROR_KEYS = new Set(['VALIDATION_ERROR', 'NOT_FOUND', 'CONFLICT', 'REVISION_CONFLICT', 'FORBIDDEN', 'UNAUTHORIZED', 'NOTIFICATION_NOT_FOUND', 'RATE_LIMITED', 'SERVER_ERROR', 'NETWORK_ERROR', 'REQUEST_TIMEOUT', 'CSRF_UNAVAILABLE', 'INVALID_RESPONSE', 'REQUEST_FAILED', 'UNAUTHENTICATED', 'ACCOUNT_SUSPENDED']);
function errorMessage(error) {
  const code = String(error?.code || '').toUpperCase();
  return SERVER_ERROR_KEYS.has(code) ? t(`extensions.api.${code}`) : t('extensions.api.generic');
}

async function commit(path, options, successKey, container) {
  try {
    await request(path, options);
    await refresh();
    toast(t(successKey));
    if (container) draw(container);
    return true;
  } catch (error) {
    toast(errorMessage(error), 'error');
    return false;
  }
}

export function notificationBodyText(notification) {
  const body = notification?.body;
  if (body && typeof body === 'object') {
    if (typeof body.key === 'string') return t(body.key, body.params || {});
    const structuredKey = BODY_KEYS[notification?.titleKey];
    if (structuredKey) return t(structuredKey, { ...body, severity: body.severity || '', count: body.count || 0 });
    const language = (() => { try { return getState()?.prefs?.language === 'ar' ? 'ar' : 'en'; } catch { return 'en'; } })();
    if (typeof body[language] === 'string') return body[language];
    if (typeof body.en === 'string') return body.en;
    if (typeof body.ar === 'string') return body.ar;
  }
  if (typeof body === 'string') return body;
  return t('extensions.notifications.noBody');
}

export function notificationTitleText(notification) {
  const titleKey = String(notification?.titleKey || '').trim();
  if (titleKey) {
    const localKey = TITLE_KEYS[titleKey] || titleKey;
    const value = t(localKey);
    if (translations.en?.[localKey] || translations.ar?.[localKey]) return value;
  }
  const type = normalizedType(notification?.type);
  return t(`extensions.notifications.type.${type}`);
}

function preferenceForm(prefs = {}) {
  return NOTIFICATION_TYPES.map((type) => `<label class="extension-switch"><input type="checkbox" data-pref="${type}" ${prefs[type] !== false ? 'checked' : ''}><span>${e(t(`extensions.notifications.pref.${type}`))}</span></label>`).join('');
}

function notificationCard(notification, container) {
  const title = notificationTitleText(notification);
  const body = notificationBodyText(notification);
  const type = normalizedType(notification.type);
  return `<article class="extension-card notification-card ${notification.read ? 'is-read' : 'is-unread'}" data-notification-id="${e(notification.id)}"><div class="notification-card-icon">${icon(type === 'budget' ? 'wallet-cards' : type === 'recurring' ? 'repeat-2' : type === 'goals' ? 'target' : 'shield-check')}</div><div class="notification-card-content"><div class="extension-card-head"><div><h2>${e(title)}</h2><p class="muted">${notification.createdAt ? e(formatDate(String(notification.createdAt).slice(0, 10))) : ''}</p></div><span class="notification-state">${e(t(notification.read ? 'extensions.notifications.read' : 'extensions.notifications.unread'))}</span></div><p>${e(body)}</p><div class="extension-card-actions"><button type="button" class="btn btn-ghost" data-toggle-notification="${e(notification.id)}" data-next-read="${String(!notification.read)}">${icon(notification.read ? 'mail' : 'mail-open')}<span>${e(t(notification.read ? 'extensions.notifications.markUnread' : 'extensions.notifications.markRead'))}</span></button><button type="button" class="btn btn-ghost danger-text" data-delete-notification="${e(notification.id)}">${icon('trash-2')}<span>${e(t('extensions.actions.delete'))}</span></button></div></div></article>`;
}

function draw(container) {
  const state = getState() || {};
  const notifications = Array.isArray(state.notifications) ? [...state.notifications].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))) : [];
  const prefs = state.notificationPrefs || { budget: true, recurring: true, goals: true, security: true };
  const unread = notifications.filter((notification) => !notification.read).length;
  container.innerHTML = `<div class="page-head"><div><div class="eyebrow">${e(t('extensions.notifications.eyebrow'))}</div><h1>${e(t('extensions.notifications.title'))}</h1><p class="page-subtitle">${e(t('extensions.notifications.subtitle'))}</p></div><div class="page-actions"><button type="button" class="btn btn-secondary" data-read-all ${unread ? '' : 'disabled'}>${icon('check-check')}<span>${e(t('extensions.notifications.readAll'))}</span></button></div></div><section class="card extension-preferences"><div class="card-head"><div><h2>${e(t('extensions.notifications.preferences'))}</h2><p>${e(t('extensions.notifications.preferencesHint'))}</p></div></div><div class="extension-switches">${preferenceForm(prefs)}</div></section>${notifications.length ? `<div class="extension-stack">${notifications.map((notification) => notificationCard(notification, container)).join('')}</div>` : `<section class="card">${empty(t('extensions.notifications.empty'), 'bell-off')}</section>`}`;
  icons(container);
}

export function notificationSummaryHTML() {
  const notifications = Array.isArray(getState()?.notifications) ? getState().notifications : [];
  const unread = notifications.filter((notification) => !notification.read);
  if (!unread.length) return '';
  return `<span class="notification-summary" aria-label="${e(t('extensions.notifications.unreadCount', { count: unread.length }))}">${e(String(unread.length))}</span>`;
}

export function renderNotifications(container) {
  if (!container) return;
  draw(container);
  if (container.dataset.notificationsBound === 'true') return;
  container.dataset.notificationsBound = 'true';
  container.addEventListener('change', async (event) => {
    const input = event.target.closest('[data-pref]');
    if (!input) return;
    const prefs = { ...(getState()?.notificationPrefs || {}), [input.dataset.pref]: input.checked };
    input.disabled = true;
    const ok = await commit('/notification-preferences', { method: 'PATCH', body: prefs }, 'extensions.notifications.preferencesSaved', container);
    if (!ok) input.checked = !input.checked;
    input.disabled = false;
  });
  container.addEventListener('click', async (event) => {
    const readAll = event.target.closest('[data-read-all]');
    if (readAll && !readAll.disabled) { await commit('/notifications/read-all', { method: 'POST', body: {} }, 'extensions.notifications.readAllSuccess', container); return; }
    const toggle = event.target.closest('[data-toggle-notification]');
    if (toggle) { await commit(`/notifications/${encodeURIComponent(toggle.dataset.toggleNotification)}`, { method: 'PATCH', body: { read: toggle.dataset.nextRead === 'true' } }, 'extensions.notifications.updated', container); return; }
    const remove = event.target.closest('[data-delete-notification]');
    if (remove) await commit(`/notifications/${encodeURIComponent(remove.dataset.deleteNotification)}`, { method: 'DELETE' }, 'extensions.notifications.deleted', container);
  });
}
