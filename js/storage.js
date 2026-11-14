/* Cloud workspace facade. The original offline store remains in legacy-storage.js. */
import { api, ApiError } from './api-client.js';
import { getPublicPrefs, setPublicPrefs } from './platform-i18n.js';
import { validateState as validateLegacy, localDate, monthKey, defaultCategories } from './legacy-storage.js';

const clone = value => structuredClone(value);
let ownerId = null;
let loaded = false;
let revision = 0;
let warning = null;
let writes = Promise.resolve();
let refreshing = null;
let memory = emptyState();

function emptyState(name = '') {
  const prefs = getPublicPrefs();
  return {
    version: 1, transactions: [], categories: [], budgets: {},
    prefs: { theme: prefs.theme || 'light', language: prefs.language || 'ar', currency: 'EGP', name },
    goals: [], recurring: [], notifications: [],
    notificationPrefs: { budget: true, recurring: true, goals: true, security: true },
  };
}

function notify() {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('moneytrack:update', { detail: { revision, source: 'cloud' } }));
}

function accept(result, expectedOwner) {
  if (!expectedOwner || ownerId !== expectedOwner) throw new ApiError('SESSION_CHANGED', 401);
  if (result.ownerId && result.ownerId !== expectedOwner) {
    clearStorage();
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('moneytrack:auth-expired'));
    throw new ApiError('SESSION_CHANGED', 401);
  }
  validateState(result.state);
  if (!Number.isSafeInteger(Number(result.revision)) || Number(result.revision) < 0) throw new ApiError('INVALID_RESPONSE');
  memory = clone(result.state);
  memory.goals ||= [];
  memory.recurring ||= [];
  memory.notifications ||= [];
  memory.notificationPrefs ||= { budget: true, recurring: true, goals: true, security: true };
  revision = Number(result.revision);
  loaded = true;
  warning = null;
  setPublicPrefs({ language: memory.prefs.language, theme: memory.prefs.theme });
  notify();
  return getState();
}

export function initializeStorage(user) {
  clearStorage();
  ownerId = user?.id || null;
  memory = emptyState(user?.fullName || '');
}

export function clearStorage() {
  ownerId = null;
  loaded = false;
  revision = 0;
  warning = null;
  memory = emptyState();
  refreshing = null;
}

export function getState() {
  if (!loaded) {
    const prefs = getPublicPrefs();
    memory.prefs.theme = prefs.theme || 'light';
    memory.prefs.language = prefs.language || 'ar';
  }
  return clone(memory);
}

export function isStorageReady() { return loaded; }
export function getStorageWarning() { return warning; }
export function getRevision() { return revision; }

export function validateState(data) {
  validateLegacy(data);
  if (data.goals !== undefined && !Array.isArray(data.goals)) throw new TypeError('Invalid savings goals');
  if (data.recurring !== undefined && !Array.isArray(data.recurring)) throw new TypeError('Invalid recurring transactions');
  if (data.notifications !== undefined && !Array.isArray(data.notifications)) throw new TypeError('Invalid notifications');
  // The server independently validates every financial field and ownership relationship.
  return true;
}

export async function refreshState({ processDue = false } = {}) {
  if (!ownerId) throw new ApiError('UNAUTHENTICATED', 401);
  if (refreshing) return refreshing;
  const expectedOwner = ownerId;
  refreshing = (async () => {
    const result = await api('/workspace');
    if (processDue) {
      const due = await api('/recurring/process', { method: 'POST', body: {} });
      if (due.processed > 0) return accept(await api('/workspace'), expectedOwner);
    }
    return accept(result, expectedOwner);
  })().catch(error => {
    if (ownerId === expectedOwner) warning = error.code || 'SYNC_FAILED';
    throw error;
  }).finally(() => { refreshing = null; });
  return refreshing;
}

export function update(mutator, { categoryReplacements } = {}) {
  if (typeof mutator !== 'function') throw new TypeError('A workspace mutation is required');
  const expectedOwner = ownerId;
  const operation = writes.then(async () => {
    if (!loaded || !expectedOwner || ownerId !== expectedOwner) throw new ApiError('UNAUTHENTICATED', 401);
    if (warning) throw new ApiError('SYNC_REQUIRED');
    const draft = getState();
    const replacement = mutator(draft);
    const next = replacement === undefined ? draft : replacement;
    validateState(next);
    try {
      return accept(await api('/workspace', { method: 'PUT', body: { state: next, revision, accountId: expectedOwner, ...(categoryReplacements ? { categoryReplacements } : {}) } }), expectedOwner);
    } catch (error) {
      if (ownerId === expectedOwner) {
        warning = error.code || 'SAVE_FAILED';
        if (error.code === 'REVISION_CONFLICT') {
          try { await refreshState(); } catch { /* Keep the actual sync failure visible. */ }
        }
        notify();
      }
      throw error;
    }
  });
  writes = operation.catch(() => {});
  return operation;
}

export async function setAppearance(partial) {
  setPublicPrefs(partial);
  if (!loaded) {
    Object.assign(memory.prefs, partial);
    notify();
    return getState();
  }
  // Apply instantly so the interface responds without waiting for the database round trip,
  // then persist; if saving fails, restore the previous values unless they were changed again.
  const previous = Object.fromEntries(Object.keys(partial).map(key => [key, memory.prefs[key]]));
  Object.assign(memory.prefs, partial);
  notify();
  try {
    return await update(state => { Object.assign(state.prefs, partial); });
  } catch (error) {
    if (Object.keys(partial).every(key => memory.prefs[key] === partial[key])) {
      Object.assign(memory.prefs, previous);
      setPublicPrefs(previous);
      notify();
    }
    throw error;
  }
}

export function backup() {
  if (!loaded) throw new ApiError('SYNC_REQUIRED');
  return JSON.stringify(getState(), null, 2);
}

export async function restore(data) {
  validateState(data);
  if (!loaded) throw new ApiError('SYNC_REQUIRED');
  const expectedOwner = ownerId;
  return accept(await api('/workspace/restore', {
    method: 'POST', body: { state: data, revision, accountId: expectedOwner, confirm: 'RESTORE' },
  }), expectedOwner);
}

export async function recoveryBackup() {
  const result = await api('/workspace/recovery');
  return result.backup ? JSON.stringify(result.backup, null, 2) : null;
}

export function clearDemo() {
  return update(state => { state.transactions = state.transactions.filter(item => item.demo !== true); });
}

export async function clearAll() {
  if (!loaded) throw new ApiError('SYNC_REQUIRED');
  const expectedOwner = ownerId;
  return accept(await api('/workspace/reset', { method: 'POST', body: { confirm: 'RESET', accountId: expectedOwner } }), expectedOwner);
}

export async function importWorkspace(data, { includeDemo = false } = {}) {
  validateState(data);
  const expectedOwner = ownerId;
  const result = await api('/workspace/import', { method: 'POST', body: { state: data, includeDemo, accountId: expectedOwner } });
  accept(result, expectedOwner);
  return { imported: result.imported || 0, duplicate: !!result.duplicate };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  if (!globalThis.crypto?.getRandomValues) throw new Error('Secure random identifiers are unavailable');
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export { localDate, monthKey, defaultCategories };
