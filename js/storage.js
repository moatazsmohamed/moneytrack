/* MoneyTrack local data store. This module intentionally has no UI or translation imports. */

export const STORAGE_KEY = 'moneytrack-state';
export const RECOVERY_KEY = 'moneytrack-recovery-backup';
const STAGING_KEY = `${STORAGE_KEY}:staging`;
const MAX_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 240;
const MAX_ID = 80;
const byteSize = value => new TextEncoder().encode(value).byteLength;

let memoryState = null;
let initialized = false;
export let storageWarning = null;

const CATEGORY_SEED = [
  { id: 'salary', names: { en: 'Salary', ar: 'الراتب' }, type: 'income', icon: 'briefcase-business', color: '#10b981' },
  { id: 'freelance', names: { en: 'Freelance', ar: 'العمل الحر' }, type: 'income', icon: 'laptop', color: '#14b8a6' },
  { id: 'business', names: { en: 'Business', ar: 'الأعمال' }, type: 'income', icon: 'store', color: '#0ea5e9' },
  { id: 'investments', names: { en: 'Investments', ar: 'الاستثمارات' }, type: 'income', icon: 'trending-up', color: '#6366f1' },
  { id: 'other-income', names: { en: 'Other Income', ar: 'دخل آخر' }, type: 'income', icon: 'circle-dollar-sign', color: '#8b5cf6' },
  { id: 'food', names: { en: 'Food', ar: 'الطعام' }, type: 'expense', icon: 'utensils', color: '#f97316' },
  { id: 'transportation', names: { en: 'Transportation', ar: 'المواصلات' }, type: 'expense', icon: 'car-front', color: '#eab308' },
  { id: 'shopping', names: { en: 'Shopping', ar: 'التسوق' }, type: 'expense', icon: 'shopping-bag', color: '#ec4899' },
  { id: 'bills', names: { en: 'Bills', ar: 'الفواتير' }, type: 'expense', icon: 'receipt-text', color: '#ef4444' },
  { id: 'education', names: { en: 'Education', ar: 'التعليم' }, type: 'expense', icon: 'graduation-cap', color: '#3b82f6' },
  { id: 'healthcare', names: { en: 'Healthcare', ar: 'الرعاية الصحية' }, type: 'expense', icon: 'heart-pulse', color: '#f43f5e' },
  { id: 'entertainment', names: { en: 'Entertainment', ar: 'الترفيه' }, type: 'expense', icon: 'popcorn', color: '#a855f7' },
  { id: 'housing', names: { en: 'Housing', ar: 'السكن' }, type: 'expense', icon: 'house', color: '#64748b' },
  { id: 'other-expense', names: { en: 'Other Expenses', ar: 'مصروفات أخرى' }, type: 'expense', icon: 'ellipsis', color: '#94a3b8' },
];

const CATEGORY_BY_ID = Object.fromEntries(CATEGORY_SEED.map((category) => [category.id, category]));

function clone(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function fail(message) {
  throw new TypeError(`Invalid MoneyTrack state: ${message}`);
}

function validText(value, field, max = MAX_TEXT, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && value.trim() === '')) fail(`${field} must be a non-empty string`);
  return value;
}

function validId(value, field) {
  validText(value, field, MAX_ID);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) fail(`${field} contains invalid characters`);
}

function validMoney(value, field, { positive = true } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) fail(`${field} must be a finite number`);
  if (positive ? value <= 0 : value < 0) fail(`${field} must be ${positive ? 'greater than zero' : 'non-negative'}`);
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  if (Math.abs(value - rounded) > 1e-8) fail(`${field} may have at most two decimal places`);
}

function validDate(value, field = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail(`${field} must be YYYY-MM-DD`);
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1) fail(`${field} is not a calendar date`);
  const check = new Date(0);
  check.setFullYear(year, month - 1, day);
  if (check.getFullYear() !== year || check.getMonth() !== month - 1 || check.getDate() !== day) fail(`${field} is not a calendar date`);
}

function validMonth(value, field = 'month') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) fail(`${field} must be YYYY-MM`);
  const [year, month] = value.split('-').map(Number);
  if (year < 1 || year > 9999 || month < 1 || month > 12) fail(`${field} is not a calendar month`);
}

function dateForMonth(monthDate, day) {
  const last = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  return localDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(day, last)));
}

function monthShift(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

export function localDate(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) throw new TypeError('date must be a valid Date');
  const pad = (part) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function monthKey(date = new Date()) {
  return localDate(new Date(date.getFullYear(), date.getMonth(), 1)).slice(0, 7);
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `tx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultCategories() {
  return clone(CATEGORY_SEED);
}

function demoTransactions() {
  const today = new Date();
  const rows = [];
  const monthly = [
    [['salary', 28000, 'Salary payment'], ['food', 560, 'Groceries and meals'], ['housing', 7500, 'Monthly rent'], ['transportation', 820, 'Transport and fuel'], ['bills', 1450, 'Utilities and phone']],
    [['salary', 28000, 'Salary payment'], ['freelance', 4200, 'Website project'], ['food', 690, 'Groceries and meals'], ['shopping', 1250, 'Household shopping'], ['entertainment', 480, 'Cinema and streaming']],
    [['salary', 28000, 'Salary payment'], ['investments', 1350, 'Investment distribution'], ['food', 615, 'Groceries and meals'], ['healthcare', 950, 'Pharmacy and checkup'], ['housing', 7500, 'Monthly rent']],
    [['salary', 28000, 'Salary payment'], ['freelance', 3000, 'Design project'], ['food', 730, 'Groceries and meals'], ['education', 1200, 'Online course'], ['transportation', 760, 'Transport and fuel']],
    [['salary', 28000, 'Salary payment'], ['business', 5200, 'Small business income'], ['food', 640, 'Groceries and meals'], ['bills', 1620, 'Utilities and phone'], ['shopping', 980, 'Household shopping']],
    [['salary', 28000, 'Salary payment'], ['other-income', 900, 'Cashback and refunds'], ['food', 710, 'Groceries and meals'], ['housing', 7500, 'Monthly rent'], ['entertainment', 520, 'Weekend activities']],
  ];
  monthly.forEach((items, index) => {
    const month = monthShift(new Date(today.getFullYear(), today.getMonth(), 1), index - 5);
    items.forEach(([categoryId, amount, title], itemIndex) => {
      const type = CATEGORY_BY_ID[categoryId].type;
      rows.push({
        id: `demo-${index + 1}-${itemIndex + 1}`,
        title,
        amount,
        type,
        categoryId,
        date: dateForMonth(month, Math.min(type === 'income' ? 3 : 7 + itemIndex * 4, index === 5 ? today.getDate() : 31)),
        description: `MoneyTrack demo · ${title.toLowerCase()}`,
        demo: true,
      });
    });
  });
  return rows;
}

function freshState({ demo = true, prefs = null } = {}) {
  return {
    version: 1,
    transactions: demo ? demoTransactions() : [],
    categories: defaultCategories(),
    budgets: demo ? { [monthKey()]: { total: 14000, categories: { food: 1800, housing: 8000, transportation: 1600 } } } : {},
    prefs: prefs ? clone(prefs) : { theme: 'light', language: 'en', currency: 'EGP', name: '' },
  };
}

function getStorage() {
  try {
    const candidate = globalThis.localStorage;
    if (candidate && typeof candidate.getItem === 'function' && typeof candidate.setItem === 'function') return candidate;
  } catch {
    // Access to localStorage can be denied by browser privacy settings.
  }
  return null;
}

function persist(next) {
  const serialized = JSON.stringify(next);
  if (byteSize(serialized) > MAX_BACKUP_BYTES) throw new Error('MoneyTrack data exceeds the 2 MB storage limit');
  const storage = getStorage();
  if (!storage) {
    if (typeof window !== 'undefined') throw new Error('Browser local storage is unavailable');
    memoryState = clone(next);
    return;
  }
  let previous = null;
  try {
    previous = storage.getItem(STORAGE_KEY);
    storage.setItem(STAGING_KEY, serialized);
    storage.setItem(STORAGE_KEY, serialized);
    storage.removeItem?.(STAGING_KEY);
    memoryState = clone(next);
  } catch (error) {
    try {
      if (previous === null) storage.removeItem?.(STORAGE_KEY);
      else storage.setItem(STORAGE_KEY, previous);
      storage.removeItem?.(STAGING_KEY);
    } catch {
      // Preserve the original persistence failure for callers.
    }
    throw new Error(`Unable to save MoneyTrack data: ${error?.message || error}`);
  }
}

function dispatchUpdate(snapshot) {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  let event;
  try {
    const EventConstructor = globalThis.CustomEvent || window.CustomEvent;
    if (!EventConstructor) throw new Error('CustomEvent unavailable');
    event = new EventConstructor('moneytrack:update', { detail: snapshot });
  } catch {
    if (typeof document === 'undefined' || typeof document.createEvent !== 'function') return;
    event = document.createEvent('CustomEvent');
    event.initCustomEvent('moneytrack:update', false, false, snapshot);
  }
  window.dispatchEvent(event);
}

function readInitial() {
  if (initialized) return;
  initialized = true;
  const storage = getStorage();
  if (!storage) {
    if (typeof window !== 'undefined') storageWarning = 'Browser local storage is unavailable; changes cannot be saved.';
    memoryState = freshState();
    return;
  }
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch (error) {
    storageWarning = `Unable to read local data: ${error?.message || error}`;
    memoryState = freshState();
    return;
  }
  if (raw === null) {
    memoryState = freshState();
    try { persist(memoryState); } catch (error) { storageWarning = error.message; }
    return;
  }
  if (typeof raw !== 'string' || byteSize(raw) > MAX_BACKUP_BYTES) {
    storageWarning = 'Saved MoneyTrack data is too large or unreadable; it was left untouched.';
    memoryState = freshState();
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    validateState(parsed);
    memoryState = clone(parsed);
  } catch (error) {
    storageWarning = `Saved MoneyTrack data is corrupt and was left untouched: ${error?.message || error}`;
    memoryState = freshState();
  }
}

export function getStorageWarning() {
  readInitial();
  return storageWarning;
}

export function getState() {
  readInitial();
  return clone(memoryState);
}

export function validateState(data) {
  if (!plainObject(data)) fail('state must be an object');
  if (byteSize(JSON.stringify(data)) > MAX_BACKUP_BYTES) fail('backup exceeds 2 MB');
  if (data.version !== 1) fail('version must be 1');
  if (!Array.isArray(data.transactions) || !Array.isArray(data.categories) || !plainObject(data.budgets) || !plainObject(data.prefs)) fail('invalid top-level shape');
  const categoryIds = new Set();
  for (const category of data.categories) {
    if (!plainObject(category)) fail('category must be an object');
    validId(category.id, 'category.id');
    if (categoryIds.has(category.id)) fail('category IDs must be unique');
    categoryIds.add(category.id);
    if (!plainObject(category.names)) fail('category.names must be bilingual');
    validText(category.names.en, 'category.names.en', 120);
    validText(category.names.ar, 'category.names.ar', 120);
    if (category.type !== 'income' && category.type !== 'expense') fail('category.type is invalid');
    validText(category.icon, 'category.icon', 80);
    if (typeof category.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(category.color)) fail('category.color must be #RRGGBB');
  }
  const transactionIds = new Set();
  for (const transaction of data.transactions) {
    if (!plainObject(transaction)) fail('transaction must be an object');
    validId(transaction.id, 'transaction.id');
    if (transactionIds.has(transaction.id)) fail('transaction IDs must be unique');
    transactionIds.add(transaction.id);
    validText(transaction.title, 'transaction.title');
    validMoney(transaction.amount, 'transaction.amount');
    if (transaction.type !== 'income' && transaction.type !== 'expense') fail('transaction.type is invalid');
    validId(transaction.categoryId, 'transaction.categoryId');
    const category = data.categories.find((item) => item.id === transaction.categoryId);
    if (!category) fail('transaction category reference is invalid');
    if (category.type !== transaction.type) fail('transaction type does not match category type');
    validDate(transaction.date, 'transaction.date');
    validText(transaction.description, 'transaction.description', 1000, false);
    if (transaction.demo !== undefined && typeof transaction.demo !== 'boolean') fail('transaction.demo must be boolean');
  }
  const prefs = data.prefs;
  if (prefs.theme !== 'light' && prefs.theme !== 'dark') fail('prefs.theme is invalid');
  if (prefs.language !== 'en' && prefs.language !== 'ar') fail('prefs.language is invalid');
  if (!['EGP', 'USD', 'EUR', 'SAR'].includes(prefs.currency)) fail('prefs.currency is invalid');
  validText(prefs.name, 'prefs.name', 100, false);
  for (const [month, budget] of Object.entries(data.budgets)) {
    validMonth(month, 'budget month');
    if (!plainObject(budget)) fail('budget must be an object');
    validMoney(budget.total, 'budget.total', { positive: false });
    if (!plainObject(budget.categories)) fail('budget.categories must be an object');
    for (const [categoryId, amount] of Object.entries(budget.categories)) {
      validId(categoryId, 'budget category ID');
      const category = data.categories.find((item) => item.id === categoryId);
      if (!category || category.type !== 'expense') fail('budget category must be an expense category');
      validMoney(amount, 'category budget', { positive: false });
    }
  }
  return true;
}

export function update(mutator) {
  if (typeof mutator !== 'function') throw new TypeError('update requires a mutator function');
  const current = getState();
  if (storageWarning) throw new Error('Saved data is protected: use an explicitly confirmed restore or reset');
  const draft = clone(current);
  const result = mutator(draft);
  const next = result === undefined ? draft : result;
  validateState(next);
  persist(next);
  const snapshot = getState();
  dispatchUpdate(snapshot);
  return snapshot;
}

export function backup() {
  const serialized = JSON.stringify(getState());
  if (byteSize(serialized) > MAX_BACKUP_BYTES) throw new Error('MoneyTrack data exceeds the 2 MB backup limit');
  return serialized;
}

export function restore(data) {
  validateState(data);
  const previous = backup();
  const storage = getStorage();
  if (storage) {
    try { storage.setItem(RECOVERY_KEY, storageWarning ? storage.getItem(STORAGE_KEY) || previous : previous); }
    catch (error) { throw new Error(`Unable to save recovery backup: ${error?.message || error}`); }
  }
  return saveConfirmed(clone(data));
}

function saveConfirmed(next) {
  validateState(next);
  const storage = getStorage();
  if (storageWarning && storage) storage.setItem(RECOVERY_KEY, storage.getItem(STORAGE_KEY) || backup());
  persist(next);
  storageWarning = null;
  const snapshot = getState();
  dispatchUpdate(snapshot);
  return snapshot;
}

export function clearDemo() {
  return update((draft) => {
    draft.transactions = draft.transactions.filter((transaction) => transaction.demo !== true);
  });
}

export function clearAll() {
  const draft = getState();
  draft.transactions = [];
  draft.categories = defaultCategories();
  draft.budgets = {};
  return saveConfirmed(draft);
}

export function loadDemo() {
  const current = getState();
  return saveConfirmed(freshState({ demo: true, prefs: current.prefs }));
}

export function recoveryBackup() {
  const storage = getStorage();
  if (!storage) return null;
  try { return storage.getItem(RECOVERY_KEY); } catch { return null; }
}

export { CATEGORY_SEED };
