import crypto from 'node:crypto';
import { defaultCategories, validateState } from '../js/legacy-storage.js';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_CATCH_UP = 366;
export const PERMISSION_WHITELIST = ['users.view', 'users.manage', 'content.manage', 'logs.view'];
export const NOTIFICATION_PREF_KEYS = ['budget', 'recurring', 'goals', 'security'];

export function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function assert(condition, message, code = 'VALIDATION_ERROR') {
  if (!condition) {
    const error = new Error(message);
    error.code = code;
    error.status = code === 'REVISION_CONFLICT' ? 409 : 400;
    throw error;
  }
}

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function requireUuid(value, field) {
  assert(isUuid(value), `${field} must be a UUID`, 'INVALID_UUID');
  return value.toLowerCase();
}

export function optionalText(value, field, max, fallback = '') {
  if (value === undefined || value === null) return fallback;
  assert(typeof value === 'string' && value.length <= max, `${field} is invalid`);
  return value.trim();
}

export function finiteMoney(value, field, { positive = true } = {}) {
  const number = typeof value === 'number' ? value : Number(value);
  assert(Number.isFinite(number), `${field} must be a finite number`);
  assert(Math.abs(number) <= 1e12, `${field} is too large`);
  assert(positive ? number > 0 : number >= 0, `${field} must be ${positive ? 'greater than zero' : 'non-negative'}`);
  assert(Math.abs(Math.round(number * 100) - number * 100) < 1e-7, `${field} may have at most two decimals`);
  return Math.round(number * 100) / 100;
}

export function validDate(value, field = 'date', nullable = false) {
  if (nullable && value === null) return null;
  assert(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  assert(year >= 1 && year <= 9999 && check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === day, `${field} is not a calendar date`);
  return value;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function dateFromIso(value) {
  validDate(value, 'date');
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addFrequency(value, frequency) {
  const date = dateFromIso(value);
  if (frequency === 'weekly') date.setUTCDate(date.getUTCDate() + 7);
  else if (frequency === 'monthly') {
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else if (frequency === 'yearly') {
    const month = date.getUTCMonth();
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    date.setUTCMonth(month);
    const last = new Date(Date.UTC(date.getUTCFullYear(), month + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, last));
  } else assert(false, 'frequency is invalid');
  return isoFromDate(date);
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256(value) {
  return crypto.createHash('sha256').update(typeof value === 'string' ? value : canonicalJson(value)).digest('hex');
}

export function deterministicUuid(namespace, kind, legacyId) {
  const digest = crypto.createHash('sha256').update(`${namespace}:${kind}:${legacyId}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function coreState(state) {
  assert(isPlainObject(state), 'state must be an object');
  const core = { version: state.version, transactions: state.transactions, categories: state.categories, budgets: state.budgets, prefs: state.prefs };
  validateState(core);
  assert(state.goals === undefined || Array.isArray(state.goals), 'goals must be an array');
  assert(state.recurring === undefined || Array.isArray(state.recurring), 'recurring must be an array');
  assert(state.notifications === undefined || Array.isArray(state.notifications), 'notifications must be an array');
  assert(state.notificationPrefs === undefined || isPlainObject(state.notificationPrefs), 'notificationPrefs must be an object');
  for (const category of core.categories) requireUuid(category.id, 'category.id');
  for (const transaction of core.transactions) {
    requireUuid(transaction.id, 'transaction.id');
    requireUuid(transaction.categoryId, 'transaction.categoryId');
  }
  for (const [month, budget] of Object.entries(core.budgets)) for (const categoryId of Object.keys(budget.categories)) requireUuid(categoryId, 'budget category ID');
  return clone(core);
}

export function emptyCore(prefs = {}) {
  const categories = defaultCategories().map((category) => ({ ...category, id: deterministicUuid('seed', 'category', category.id) }));
  return { version: 1, transactions: [], categories, budgets: {}, prefs: { theme: prefs.theme === 'dark' ? 'dark' : 'light', language: prefs.language === 'en' ? 'en' : 'ar', currency: ['EGP', 'USD', 'EUR', 'SAR'].includes(prefs.currency) ? prefs.currency : 'EGP', name: typeof prefs.name === 'string' ? prefs.name.slice(0, 100) : '' } };
}

export function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

export function jsonValue(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

/**
 * Splits rows into created / updated / deleted by id. `project` selects the persisted columns, so a
 * row only counts as updated when stored data changed (display-only fields such as usedByRecurring
 * or timestamps never trigger a write).
 */
export function diffById(previous, next, project = (row) => row) {
  const oldMap = new Map(previous.map((row) => [row.id, row]));
  const newMap = new Map(next.map((row) => [row.id, row]));
  const same = (before, after) => canonicalJson(project(before)) === canonicalJson(project(after));
  return {
    created: next.filter((row) => !oldMap.has(row.id)),
    updated: next.filter((row) => oldMap.has(row.id) && !same(oldMap.get(row.id), row)),
    deleted: previous.filter((row) => !newMap.has(row.id)),
  };
}
export const persistedCategory = (row) => ({ en: row.names?.en ?? '', ar: row.names?.ar ?? '', type: row.type, icon: row.icon ?? null, color: row.color ?? null });
export const persistedTransaction = (row) => ({ categoryId: row.categoryId, title: row.title, amount: Number(row.amount), type: row.type, date: row.date, description: row.description || '', demo: row.demo === true });
export const persistedBudget = (row) => ({ month: row.month, scope: row.scope, categoryId: row.categoryId ?? null, amount: Number(row.amount) });
