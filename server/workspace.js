import express from 'express';
import crypto from 'node:crypto';
import { pool, query, seedWorkspace, transaction } from './db.js';
import { requireAuth, requireReady, csrfGuard, recordAudit, checkRateLimit, clientIp } from './security.js';
import { defaultCategories, validateState } from '../js/legacy-storage.js';
import {
  assert, clone, coreState, decimal, deterministicUuid, diffById, persistedCategory, persistedTransaction, persistedBudget, emptyCore, finiteMoney, isPlainObject, isUuid,
  jsonValue, MAX_CATCH_UP, MAX_IMPORT_BYTES, NOTIFICATION_PREF_KEYS, requireUuid, sha256, todayIso,
  validDate, addFrequency, canonicalJson, optionalText,
} from './domain-helpers.js';

const router = express.Router();
const UUID = '[0-9a-fA-F-]{36}';
const DEFAULT_NOTIFICATION_PREFS = { budget: true, recurring: true, goals: true, security: true };
const frequencies = new Set(['weekly', 'monthly', 'yearly']);
const transactionTypes = new Set(['income', 'expense']);

function fail(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function wrap(handler) { return async (req, res, next) => { try { await handler(req, res, next); } catch (error) { error.status = error.status || (error.code === 'REVISION_CONFLICT' ? 409 : 400); next(error); } }; }
function send(res, body, status = 200) { res.status(status).json(body); }
async function sql(conn, statement, params = []) {
  // mysql2 resolves [rows | ResultSetHeader, fields]; always return the first element so affectedRows works.
  if (conn) { const [result] = await conn.execute(statement, params); return result; }
  if (/^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(statement)) return query(statement, params);
  if (!pool) throw new Error('DATABASE_UNAVAILABLE');
  const [result] = await pool.execute(statement, params);
  return result;
}
function userId(req) { return req.auth?.user?.id; }
function owner(req) { const id = userId(req); if (!id) fail('UNAUTHENTICATED', 'Authentication is required', 401); return id; }
function stamp(value) { return value instanceof Date ? value.toISOString() : value ?? null; }
function dbDate(value) { return value instanceof Date ? value.toISOString().slice(0, 10) : value; }
function bodyObject(req) { assert(isPlainObject(req.body), 'Request body must be an object'); return req.body; }
function assertBodyAccount(body, accountId) { if (body.accountId !== undefined && body.accountId !== accountId) fail('SESSION_CHANGED', 'Authenticated account changed', 409); }
function safeName(value, field, max) { assert(typeof value === 'string' && value.trim() && value.length <= max, `${field} is invalid`); return value.trim(); }
function nullableDate(value, field) { return value === null || value === undefined || value === '' ? null : validDate(value, field, true); }
function parseDecimal(value, field, positive = true) { return finiteMoney(value, field, { positive }); }
function notificationPrefs(value) { const prefs = { ...DEFAULT_NOTIFICATION_PREFS }; if (isPlainObject(value)) for (const key of NOTIFICATION_PREF_KEYS) if (typeof value[key] === 'boolean') prefs[key] = value[key]; return prefs; }
function notificationBody(value) { return jsonValue(value, {}); }
function preservedTimestamp(value, field) { if (value === undefined || value === null) return null; assert(typeof value === 'string' && Number.isFinite(Date.parse(value)), `${field} is invalid`); return new Date(value); }

function categorySnapshot(row) { return { id: row.id, names: { en: row.name_en, ar: row.name_ar }, type: row.category_type, icon: row.icon, color: row.color, createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }
function transactionSnapshot(row) { return { id: row.id, title: row.title, amount: decimal(row.amount), type: row.transaction_type, categoryId: row.category_id, date: dbDate(row.transaction_date), description: row.description || '', demo: Boolean(row.is_demo), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }
function goalSnapshot(row, contributions) { return { id: row.id, title: row.title, targetAmount: decimal(row.target_amount), targetDate: dbDate(row.target_date), currentAmount: contributions.filter((item) => item.goal_id === row.id).reduce((sum, item) => sum + decimal(item.amount), 0), contributions: contributions.filter((item) => item.goal_id === row.id).map(contributionSnapshot), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }
function contributionSnapshot(row) { return { id: row.id, amount: decimal(row.amount), date: dbDate(row.contribution_date), note: row.note || '', createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }
function recurringSnapshot(row, occurrences) { return { id: row.id, title: row.title, amount: decimal(row.amount), type: row.transaction_type, categoryId: row.category_id, frequency: row.frequency, startDate: dbDate(row.start_date), nextDueDate: dbDate(row.next_due_date), endDate: dbDate(row.end_date), description: row.description || '', active: Boolean(row.is_active), occurrences: occurrences.filter((item) => item.recurring_id === row.id).map((item) => ({ id: item.id, date: dbDate(item.due_date), transactionId: item.transaction_id, createdAt: stamp(item.created_at), updatedAt: stamp(item.updated_at) })) , createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }
function notificationSnapshot(row) { return { id: row.id, type: row.notification_type, titleKey: row.title_key, body: notificationBody(row.body_json), read: Boolean(row.is_read), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) }; }

async function readSnapshot(conn, accountId) {
  const [settingsRows, categoryRows, transactionRows, budgetRows, goalRows, contributionRows, recurringRows, occurrenceRows, notificationRows] = await Promise.all([
    sql(conn, 'SELECT prefs_json, notification_prefs_json, revision FROM mt_user_settings WHERE user_id = ?', [accountId]),
    sql(conn, 'SELECT id,name_en,name_ar,category_type,icon,color,created_at,updated_at FROM mt_categories WHERE user_id = ? ORDER BY created_at,id', [accountId]),
    sql(conn, 'SELECT id,title,amount,transaction_type,category_id,transaction_date,description,is_demo,created_at,updated_at FROM mt_transactions WHERE user_id = ? ORDER BY transaction_date DESC,created_at DESC,id', [accountId]),
    sql(conn, 'SELECT month_key,scope_key,category_id,amount FROM mt_budgets WHERE user_id = ? ORDER BY month_key,scope_key', [accountId]),
    sql(conn, 'SELECT id,title,target_amount,target_date,created_at,updated_at FROM mt_savings_goals WHERE user_id = ? ORDER BY created_at,id', [accountId]),
    sql(conn, 'SELECT id,goal_id,amount,contribution_date,note,created_at,updated_at FROM mt_goal_contributions WHERE user_id = ? ORDER BY contribution_date DESC,created_at DESC,id', [accountId]),
    sql(conn, 'SELECT id,title,amount,transaction_type,category_id,frequency,start_date,next_due_date,end_date,is_active,description,created_at,updated_at FROM mt_recurring_transactions WHERE user_id = ? ORDER BY created_at,id', [accountId]),
    sql(conn, 'SELECT id,recurring_id,due_date,transaction_id,created_at,updated_at FROM mt_recurring_occurrences WHERE user_id = ? ORDER BY due_date DESC,id', [accountId]),
    sql(conn, 'SELECT id,notification_type,title_key,body_json,is_read,created_at,updated_at FROM mt_notifications WHERE user_id = ? AND dismissed_at IS NULL ORDER BY created_at DESC,id', [accountId]),
  ]);
  const settings = settingsRows[0] || { prefs_json: '{}', notification_prefs_json: JSON.stringify(DEFAULT_NOTIFICATION_PREFS), revision: 0 };
  const prefs = { theme: 'light', language: 'ar', currency: 'EGP', name: '', ...jsonValue(settings.prefs_json, {}) };
  const budgets = {};
  for (const row of budgetRows) {
    budgets[row.month_key] ||= { total: 0, categories: {} };
    if (row.scope_key === 'total') budgets[row.month_key].total = decimal(row.amount);
    else if (row.category_id) budgets[row.month_key].categories[row.category_id] = decimal(row.amount);
  }
  const recurringCategoryUse = new Map(); for (const row of recurringRows) recurringCategoryUse.set(row.category_id, (recurringCategoryUse.get(row.category_id) || 0) + 1);
  return {
    ownerId: accountId,
    state: { version: 1, transactions: transactionRows.map(transactionSnapshot), categories: categoryRows.map((row) => ({ ...categorySnapshot(row), usedByRecurring: recurringCategoryUse.get(row.id) || 0 })), budgets, prefs, goals: goalRows.map((row) => goalSnapshot(row, contributionRows)), recurring: recurringRows.map((row) => recurringSnapshot(row, occurrenceRows)), notifications: notificationRows.map(notificationSnapshot), notificationPrefs: notificationPrefs(jsonValue(settings.notification_prefs_json, DEFAULT_NOTIFICATION_PREFS)) },
    revision: Number(settings.revision || 0),
  };
}

async function accountExists(conn, accountId) { const rows = await sql(conn, 'SELECT id,status FROM mt_profiles WHERE id = ?', [accountId]); return rows[0] || null; }
async function ensureSettings(conn, accountId) { await sql(conn, 'INSERT IGNORE INTO mt_user_settings (user_id,prefs_json,notification_prefs_json,revision,created_at,updated_at) VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP(6), CURRENT_TIMESTAMP(6))', [accountId, JSON.stringify({ theme: 'light', language: 'ar', currency: 'EGP', name: '' }), JSON.stringify(DEFAULT_NOTIFICATION_PREFS)]); }
async function assertNoForeignIds(conn, accountId, table, ids) {
  const allowed = new Set(['mt_categories', 'mt_transactions', 'mt_savings_goals', 'mt_goal_contributions', 'mt_recurring_transactions', 'mt_recurring_occurrences']);
  assert(allowed.has(table), 'Invalid restore table');
  const uniqueIds = [...new Set(ids.filter(Boolean))]; if (!uniqueIds.length) return;
  const rows = await sql(conn, `SELECT id FROM ${table} WHERE id IN (${uniqueIds.map(() => '?').join(',')}) AND user_id<>?`, [...uniqueIds, accountId]);
  if (rows[0]) fail('ID_COLLISION', `Restore ID belongs to another account: ${rows[0].id}`, 409);
}
async function bumpRevision(conn, accountId) { await sql(conn, 'UPDATE mt_user_settings SET revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [accountId]); }

function assertCoreIds(state) { coreState(state); }
function changed(a, b) { return canonicalJson(a) !== canonicalJson(b); }

const BATCH = 200;
function chunks(items, size = BATCH) { const out = []; for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size)); return out; }
async function insertRows(conn, head, tuple, rows, values) {
  for (const part of chunks(rows)) await sql(conn, `${head} VALUES ${part.map(() => tuple).join(',')}`, part.flatMap(values));
}
async function applyCore(conn, accountId, incoming, categoryReplacements = undefined, snapshot = null, { prefsWritten = false } = {}) {
  const current = snapshot || await readSnapshot(conn, accountId);
  const previous = { version: 1, transactions: current.state.transactions, categories: current.state.categories, budgets: current.state.budgets, prefs: current.state.prefs };
  const next = { version: 1, transactions: incoming.transactions, categories: incoming.categories, budgets: incoming.budgets, prefs: incoming.prefs };
  const categoryDiff = diffById(previous.categories, next.categories, persistedCategory);
  const transactionDiff = diffById(previous.transactions, next.transactions, persistedTransaction);
  const previousCategoryIds = new Set(previous.categories.map((row) => row.id));
  const nextCategoryIds = new Set(next.categories.map((row) => row.id));
  const currentCategories = new Map(previous.categories.map((row) => [row.id, row]));
  const nextCategories = new Map(next.categories.map((row) => [row.id, row]));
  const replacements = new Map();
  if (categoryReplacements !== undefined) {
    assert(isPlainObject(categoryReplacements), 'categoryReplacements must be an object');
    for (const [rawOldId, rawNewId] of Object.entries(categoryReplacements)) {
      const oldId = requireUuid(rawOldId, 'category replacement source');
      const newId = requireUuid(rawNewId, 'category replacement target');
      const oldCategory = currentCategories.get(oldId);
      const newCategory = nextCategories.get(newId);
      assert(oldCategory && !nextCategories.has(oldId), 'category replacement source must be deleted', 'INVALID_CATEGORY_REPLACEMENT');
      assert(newCategory, 'category replacement target must exist', 'INVALID_CATEGORY_REPLACEMENT');
      assert(oldCategory.type === newCategory.type, 'category replacement type must match', 'CATEGORY_TYPE_MISMATCH');
      replacements.set(oldId, newId);
    }
  }
  await insertRows(conn, 'INSERT INTO mt_categories (id,user_id,name_en,name_ar,category_type,icon,color,created_at,updated_at)', '(?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),CURRENT_TIMESTAMP(6))', categoryDiff.created, (category) => [category.id, accountId, category.names.en, category.names.ar, category.type, category.icon, category.color, category.createdAt ? new Date(category.createdAt) : null]);
  for (const category of categoryDiff.updated) {
    await sql(conn, 'UPDATE mt_categories SET name_en=?,name_ar=?,category_type=?,icon=?,color=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=?', [category.names.en, category.names.ar, category.type, category.icon, category.color, accountId, category.id]);
  }
  for (const part of chunks(transactionDiff.deleted)) await sql(conn, `DELETE FROM mt_transactions WHERE user_id = ? AND id IN (${part.map(() => '?').join(',')})`, [accountId, ...part.map((tx) => tx.id)]);
  await insertRows(conn, 'INSERT INTO mt_transactions (id,user_id,category_id,title,amount,transaction_type,transaction_date,description,is_demo,created_at,updated_at)', '(?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),CURRENT_TIMESTAMP(6))', transactionDiff.created, (tx) => [tx.id, accountId, tx.categoryId, tx.title, tx.amount, tx.type, tx.date, tx.description || '', tx.demo === true ? 1 : 0, tx.createdAt ? new Date(tx.createdAt) : null]);
  for (const tx of transactionDiff.updated) await sql(conn, 'UPDATE mt_transactions SET category_id=?,title=?,amount=?,transaction_type=?,transaction_date=?,description=?,is_demo=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=?', [tx.categoryId, tx.title, tx.amount, tx.type, tx.date, tx.description || '', tx.demo === true ? 1 : 0, accountId, tx.id]);
  const previousBudgets = []; const nextBudgets = [];
  for (const [month, budget] of Object.entries(previous.budgets)) { previousBudgets.push({ id: `${month}:total`, month, scope: 'total', categoryId: null, amount: budget.total }); for (const [categoryId, amount] of Object.entries(budget.categories)) previousBudgets.push({ id: `${month}:${categoryId}`, month, scope: categoryId, categoryId, amount }); }
  for (const [month, budget] of Object.entries(next.budgets)) { nextBudgets.push({ id: `${month}:total`, month, scope: 'total', categoryId: null, amount: budget.total }); for (const [categoryId, amount] of Object.entries(budget.categories)) nextBudgets.push({ id: `${month}:${categoryId}`, month, scope: categoryId, categoryId, amount }); }
  const budgetDiff = diffById(previousBudgets, nextBudgets, persistedBudget);
  for (const budget of budgetDiff.deleted) await sql(conn, 'DELETE FROM mt_budgets WHERE user_id=? AND month_key=? AND scope_key=?', [accountId, budget.month, budget.scope]);
  await insertRows(conn, 'INSERT INTO mt_budgets (id,user_id,month_key,scope_key,category_id,amount,created_at,updated_at)', '(?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', budgetDiff.created, (budget) => [deterministicUuid(accountId, 'budget', budget.id), accountId, budget.month, budget.scope, budget.categoryId, budget.amount]);
  for (const budget of budgetDiff.updated) await sql(conn, 'UPDATE mt_budgets SET amount=?,category_id=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND month_key=? AND scope_key=?', [budget.amount, budget.categoryId, accountId, budget.month, budget.scope]);
  if (!prefsWritten && changed(previous.prefs, next.prefs)) await sql(conn, 'UPDATE mt_user_settings SET prefs_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [JSON.stringify(next.prefs), accountId]);
  for (const [oldId, newId] of replacements) await sql(conn, 'UPDATE mt_recurring_transactions SET category_id=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND category_id=?', [newId, accountId, oldId]);
  // Recurring rules can only become inconsistent when a category changes type or rules are re-pointed.
  if (replacements.size || categoryDiff.updated.some((category) => currentCategories.get(category.id)?.type !== category.type)) {
    const inconsistentRules = await sql(conn, 'SELECT r.id FROM mt_recurring_transactions r JOIN mt_categories c ON c.user_id=r.user_id AND c.id=r.category_id WHERE r.user_id=? AND r.transaction_type<>c.category_type LIMIT 1', [accountId]);
    if (inconsistentRules[0]) fail('CATEGORY_TYPE_MISMATCH', 'A recurring rule category type does not match its rule type', 409);
  }
  for (const category of categoryDiff.deleted) {
    const refs = await sql(conn, 'SELECT (SELECT COUNT(*) FROM mt_transactions WHERE user_id = ? AND category_id = ?) AS transactions, (SELECT COUNT(*) FROM mt_budgets WHERE user_id = ? AND category_id = ?) AS budgets, (SELECT COUNT(*) FROM mt_recurring_transactions WHERE user_id = ? AND category_id = ?) AS recurring', [accountId, category.id, accountId, category.id, accountId, category.id]);
    if (Number(refs[0]?.transactions || 0) || Number(refs[0]?.budgets || 0) || Number(refs[0]?.recurring || 0)) fail('CATEGORY_IN_USE', 'Category cannot be deleted while records refer to it', 409);
    await sql(conn, 'DELETE FROM mt_categories WHERE user_id = ? AND id = ?', [accountId, category.id]);
  }
  return { categoryDiff, transactionDiff, budgetDiff, previousCategoryIds, nextCategoryIds };
}

/*
 * Budget (80% / 100%) and goal-reached alerts are derived from the snapshot that is loaded anyway,
 * so a page load costs no extra round trips unless a genuinely new alert must be stored.
 * Amounts are compared in integer cents to avoid floating-point threshold errors.
 */
const cents = (value) => Math.round(Number(value || 0) * 100);
function dynamicNotificationCandidates(state) {
  const prefs = state.notificationPrefs || {}; const items = [];
  if (prefs.budget) {
    const spent = new Map(); const add = (key, value) => spent.set(key, (spent.get(key) || 0) + value);
    for (const tx of state.transactions) {
      if (tx.type !== 'expense' || typeof tx.date !== 'string') continue;
      const month = tx.date.slice(0, 7); const value = cents(tx.amount);
      add(`${month}|total`, value); add(`${month}|${tx.categoryId}`, value);
    }
    for (const [month, budget] of Object.entries(state.budgets || {})) {
      for (const [scope, amount] of [['total', budget.total], ...Object.entries(budget.categories || {})]) {
        const limit = cents(amount); if (limit <= 0) continue;
        const used = spent.get(`${month}|${scope}`) || 0;
        const severity = used >= limit ? '100' : used * 10 >= limit * 8 ? '80' : null;
        if (severity) items.push({ type: 'budget', titleKey: 'budgetAlert', body: { month, scope, severity }, dedupeKey: `budget:${month}:${scope}:${severity}` });
      }
    }
  }
  if (prefs.goals) {
    for (const goal of state.goals || []) {
      const target = cents(goal.targetAmount); const saved = (goal.contributions || []).reduce((sum, item) => sum + cents(item.amount), 0);
      if (target > 0 && saved >= target) items.push({ type: 'goal', titleKey: 'goalReached', body: { goalId: goal.id }, dedupeKey: `goal:${goal.id}:reached` });
    }
  }
  return items;
}
async function storeDynamicNotifications(accountId, state, knownKeys) {
  const fresh = dynamicNotificationCandidates(state).filter((item) => !knownKeys.has(item.dedupeKey));
  if (!fresh.length) return 0;
  const result = await sql(null, `INSERT IGNORE INTO mt_notifications (id,user_id,notification_type,title_key,body_json,is_read,dedupe_key,created_at,updated_at) VALUES ${fresh.map(() => '(?,?,?,?,?,0,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))').join(',')}`,
    fresh.flatMap((item) => [crypto.randomUUID(), accountId, item.type, item.titleKey, JSON.stringify(item.body), item.dedupeKey]));
  return Number(result.affectedRows || 0);
}
/** Parallel snapshot read (one round trip) plus any newly due alerts; dismissed alerts keep their dedupe key. */
async function readWorkspace(accountId) {
  const [snapshot, keyRows] = await Promise.all([
    readSnapshot(null, accountId),
    sql(null, 'SELECT dedupe_key FROM mt_notifications WHERE user_id=? AND dedupe_key IS NOT NULL', [accountId]),
  ]);
  const inserted = await storeDynamicNotifications(accountId, snapshot.state, new Set(keyRows.map((row) => row.dedupe_key)));
  return inserted ? readSnapshot(null, accountId) : snapshot;
}
async function workspaceGet(req, res) { send(res, await readWorkspace(owner(req))); }
async function workspacePut(req, res) {
  const accountId = owner(req); const body = bodyObject(req); assertBodyAccount(body, accountId); assert(Number.isSafeInteger(body.revision) && body.revision >= 0, 'revision is invalid'); assertCoreIds(body.state); const incomingCore = coreState(body.state);
  // Read once, in parallel, outside the transaction. Every writer bumps the revision, so the
  // compare-and-swap below proves this snapshot is still the latest state before anything is written.
  const current = await readSnapshot(null, accountId);
  if (current.revision !== body.revision) fail('REVISION_CONFLICT', 'Workspace changed on another device', 409);
  for (const key of ['goals', 'recurring', 'notificationPrefs']) if (body.state[key] !== undefined && changed(body.state[key], current.state[key])) fail('EXTENSION_IMMUTABLE', `${key} must be changed through its dedicated endpoint`, 400);
  const diff = await transaction(async (conn) => {
    // The revision claim also stores preferences, saving a round trip for theme/language changes.
    const claimed = await sql(conn, 'UPDATE mt_user_settings SET revision=revision+1,prefs_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND revision=?', [JSON.stringify(incomingCore.prefs), accountId, body.revision]);
    if (!claimed.affectedRows) fail('REVISION_CONFLICT', 'Workspace changed on another device', 409);
    return applyCore(conn, accountId, incomingCore, body.categoryReplacements, current, { prefsWritten: true });
  });
  // The usage log is written after commit, in parallel with the response read; losing it never loses data.
  const [snapshot] = await Promise.all([
    readWorkspace(accountId),
    recordAudit(accountId, 'workspace.updated', accountId, { entity: 'workspace', categories: diff.categoryDiff.created.length + diff.categoryDiff.updated.length + diff.categoryDiff.deleted.length, transactions: diff.transactionDiff.created.length + diff.transactionDiff.updated.length + diff.transactionDiff.deleted.length }).catch((error) => console.error('audit log failed', error.code || error.message)),
  ]);
  send(res, snapshot);
}
async function workspaceReset(req, res) {
  const accountId = owner(req); const body = bodyObject(req); assertBodyAccount(body, accountId); assert(body.confirm === 'RESET', 'Reset confirmation is required');
  const result = await transaction(async (conn) => {
    await sql(conn, 'SELECT revision FROM mt_user_settings WHERE user_id=? FOR UPDATE', [accountId]);
    for (const table of ['mt_recurring_occurrences', 'mt_recurring_transactions', 'mt_goal_contributions', 'mt_savings_goals', 'mt_transactions', 'mt_budgets', 'mt_notifications', 'mt_categories']) await sql(conn, `DELETE FROM ${table} WHERE user_id=?`, [accountId]);
    await seedWorkspace(accountId, conn);
    await sql(conn, 'UPDATE mt_user_settings SET revision=revision+1,recovery_json=NULL,recovery_updated_at=NULL,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [accountId]);
    await recordAudit(accountId, 'workspace.reset', accountId, { entity: 'workspace' }, conn);
    return readSnapshot(conn, accountId);
  });
  send(res, result);
}

function sourceId(value, field) { assert(typeof value === 'string' && value.trim() && value.length <= 80, `${field} is invalid`); return value; }
function destinationId(accountId, kind, value, preserveUuids) { return preserveUuids && isUuid(value) ? value.toLowerCase() : deterministicUuid(accountId, kind, value); }

function normalizeImport(input, accountId, includeDemo, { preserveUuids = false } = {}) {
  assert(isPlainObject(input), 'state must be an object');
  const core = { version: input.version, transactions: input.transactions, categories: input.categories, budgets: input.budgets, prefs: input.prefs };
  try { validateState(core); } catch (error) { error.code ||= 'INVALID_IMPORT'; throw error; }
  assert(Buffer.byteLength(JSON.stringify(input), 'utf8') <= MAX_IMPORT_BYTES, 'Import exceeds 2 MB');
  const categories = input.categories.map((category) => ({ ...category, id: destinationId(accountId, 'category', category.id, preserveUuids) }));
  const categoryMap = new Map(input.categories.map((category, index) => [category.id, categories[index].id]));
  const transactionMap = new Map();
  const transactions = input.transactions.filter((row) => includeDemo || row.demo !== true).map((row) => {
    const id = destinationId(accountId, 'transaction', row.id, preserveUuids);
    assert(!transactionMap.has(row.id), 'transaction IDs must be unique');
    transactionMap.set(row.id, id);
    return { ...row, id, categoryId: categoryMap.get(row.categoryId), demo: includeDemo && row.demo === true };
  });
  const budgets = {};
  for (const [month, budget] of Object.entries(input.budgets)) budgets[month] = { total: budget.total, categories: Object.fromEntries(Object.entries(budget.categories).map(([categoryId, amount]) => [categoryMap.get(categoryId), amount])) };
  const goals = []; const goalIds = new Set(); const goalMap = new Map(); const contributions = []; const contributionIds = new Set();
  for (const row of input.goals || []) {
    assert(isPlainObject(row), 'goal must be an object');
    const sourceGoalId = sourceId(row.id, 'goal.id');
    assert(!goalIds.has(sourceGoalId), 'goal IDs must be unique'); goalIds.add(sourceGoalId);
    const id = destinationId(accountId, 'goal', sourceGoalId, preserveUuids); goalMap.set(sourceGoalId, id);
    goals.push({ id, title: safeName(row.title, 'goal.title', 120), targetAmount: parseDecimal(row.targetAmount, 'goal.targetAmount'), targetDate: nullableDate(row.targetDate, 'goal.targetDate'), createdAt: preservedTimestamp(row.createdAt, 'goal.createdAt'), updatedAt: preservedTimestamp(row.updatedAt, 'goal.updatedAt') });
    for (const item of row.contributions || []) {
      assert(isPlainObject(item), 'goal contribution must be an object');
      const sourceContributionId = sourceId(item.id, 'contribution.id');
      assert(!contributionIds.has(sourceContributionId), 'contribution IDs must be unique'); contributionIds.add(sourceContributionId);
      contributions.push({ id: destinationId(accountId, 'contribution', sourceContributionId, preserveUuids), goalId: id, amount: parseDecimal(item.amount, 'contribution.amount'), date: validDate(item.date, 'contribution.date'), note: optionalText(item.note, 'contribution.note', 240), createdAt: preservedTimestamp(item.createdAt, 'contribution.createdAt'), updatedAt: preservedTimestamp(item.updatedAt, 'contribution.updatedAt') });
    }
  }
  const recurring = []; const recurringIds = new Set(); const recurringMap = new Map(); const occurrenceIds = new Set(); const occurrenceKeys = new Set(); const occurrences = [];
  for (const row of input.recurring || []) {
    assert(isPlainObject(row), 'recurring rule must be an object');
    const sourceRuleId = sourceId(row.id, 'recurring.id');
    assert(!recurringIds.has(sourceRuleId), 'recurring IDs must be unique'); recurringIds.add(sourceRuleId);
    const id = destinationId(accountId, 'recurring', sourceRuleId, preserveUuids); recurringMap.set(sourceRuleId, id);
    assert(transactionTypes.has(row.type) && frequencies.has(row.frequency), 'recurring type or frequency is invalid'); assert(categoryMap.has(row.categoryId), 'recurring category reference is invalid');
    const startDate = validDate(row.startDate, 'recurring.startDate'); const endDate = nullableDate(row.endDate, 'recurring.endDate'); if (endDate) assert(endDate >= startDate, 'recurring endDate must not precede startDate');
    recurring.push({ id, title: safeName(row.title, 'recurring.title', 240), amount: parseDecimal(row.amount, 'recurring.amount'), type: row.type, categoryId: categoryMap.get(row.categoryId), frequency: row.frequency, startDate, nextDueDate: validDate(row.nextDueDate, 'recurring.nextDueDate'), endDate, description: optionalText(row.description, 'recurring.description', 1000), active: row.active !== false, createdAt: preservedTimestamp(row.createdAt, 'recurring.createdAt'), updatedAt: preservedTimestamp(row.updatedAt, 'recurring.updatedAt') });
    for (const item of row.occurrences || []) {
      assert(isPlainObject(item), 'recurring occurrence must be an object');
      const sourceTransactionId = sourceId(item.transactionId, 'occurrence.transactionId');
      assert(transactionMap.has(sourceTransactionId), 'occurrence transaction reference is invalid');
      const sourceOccurrenceId = item.id === undefined || item.id === null || item.id === '' ? `${sourceRuleId}:${item.date}` : sourceId(item.id, 'occurrence.id');
      const occurrenceId = destinationId(accountId, 'occurrence', sourceOccurrenceId, preserveUuids);
      assert(!occurrenceIds.has(occurrenceId), 'occurrence IDs must be unique'); occurrenceIds.add(occurrenceId);
      const occurrenceKey = `${id}:${item.date}`; assert(!occurrenceKeys.has(occurrenceKey), 'recurring occurrence dates must be unique'); occurrenceKeys.add(occurrenceKey);
      occurrences.push({ id: occurrenceId, recurringId: id, date: validDate(item.date, 'occurrence.date'), transactionId: transactionMap.get(sourceTransactionId), createdAt: preservedTimestamp(item.createdAt, 'occurrence.createdAt'), updatedAt: preservedTimestamp(item.updatedAt, 'occurrence.updatedAt') });
    }
  }
  return { core: { version: 1, categories, transactions, budgets, prefs: input.prefs }, goals, contributions, recurring, occurrences, fingerprint: sha256(input), count: transactions.length + categories.length + Object.keys(budgets).length + goals.length + contributions.length + recurring.length + occurrences.length };
}

async function workspaceImport(req, res) {
  const accountId = owner(req); const body = bodyObject(req); assertBodyAccount(body, accountId); const includeDemo = body.includeDemo === true; assert(body.state !== undefined, 'state is required'); const imported = normalizeImport(body.state, accountId, includeDemo);
  const result = await transaction(async (conn) => {
    const duplicate = await sql(conn, 'SELECT fingerprint FROM mt_imports WHERE user_id=? AND fingerprint=?', [accountId, imported.fingerprint]);
    if (duplicate[0]) return { ...(await readSnapshot(conn, accountId)), imported: 0, duplicate: true };
    const current = await readSnapshot(conn, accountId);
    const existingCategories = new Map(current.state.categories.map((category) => [`${category.type}:${category.names.en.toLowerCase()}:${category.names.ar}`, category.id]));
    const categoryIdMap = new Map();
    for (const category of imported.core.categories) {
      const match = existingCategories.get(`${category.type}:${category.names.en.toLowerCase()}:${category.names.ar}`);
      if (match) categoryIdMap.set(category.id, match);
      else { await sql(conn, 'INSERT IGNORE INTO mt_categories (id,user_id,name_en,name_ar,category_type,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [category.id, accountId, category.names.en, category.names.ar, category.type, category.icon, category.color]); categoryIdMap.set(category.id, category.id); }
    }
    for (const row of imported.core.transactions) await sql(conn, 'INSERT IGNORE INTO mt_transactions (id,user_id,category_id,title,amount,transaction_type,transaction_date,description,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [row.id, accountId, categoryIdMap.get(row.categoryId), row.title, row.amount, row.type, row.date, row.description || '', row.demo ? 1 : 0]);
    for (const [month, budget] of Object.entries(imported.core.budgets)) {
      await sql(conn, 'INSERT INTO mt_budgets (id,user_id,month_key,scope_key,category_id,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE amount=VALUES(amount),category_id=VALUES(category_id),updated_at=CURRENT_TIMESTAMP(6)', [deterministicUuid(accountId, 'budget', `${month}:total`), accountId, month, 'total', null, budget.total]);
      for (const [importedCategoryId, amount] of Object.entries(budget.categories)) { const categoryId = categoryIdMap.get(importedCategoryId) || importedCategoryId; if (categoryId) await sql(conn, 'INSERT INTO mt_budgets (id,user_id,month_key,scope_key,category_id,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE amount=VALUES(amount),updated_at=CURRENT_TIMESTAMP(6)', [deterministicUuid(accountId, 'budget', `${month}:${categoryId}`), accountId, month, categoryId, categoryId, amount]); }
    }
    for (const goal of imported.goals) await sql(conn, 'INSERT IGNORE INTO mt_savings_goals (id,user_id,title,target_amount,target_date,created_at,updated_at) VALUES (?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [goal.id, accountId, goal.title, goal.targetAmount, goal.targetDate, goal.createdAt, goal.updatedAt]);
    for (const contribution of imported.contributions) await sql(conn, 'INSERT IGNORE INTO mt_goal_contributions (id,user_id,goal_id,amount,contribution_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [contribution.id, accountId, contribution.goalId, contribution.amount, contribution.date, contribution.note, contribution.createdAt, contribution.updatedAt]);
    for (const rule of imported.recurring) await sql(conn, 'INSERT IGNORE INTO mt_recurring_transactions (id,user_id,title,amount,transaction_type,category_id,frequency,start_date,next_due_date,end_date,is_active,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [rule.id, accountId, rule.title, rule.amount, rule.type, categoryIdMap.get(rule.categoryId) || rule.categoryId, rule.frequency, rule.startDate, rule.nextDueDate, rule.endDate, rule.active ? 1 : 0, rule.description, rule.createdAt, rule.updatedAt]);
    for (const occurrence of imported.occurrences) await sql(conn, 'INSERT IGNORE INTO mt_recurring_occurrences (id,user_id,recurring_id,due_date,transaction_id,created_at,updated_at) VALUES (?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [occurrence.id, accountId, occurrence.recurringId, occurrence.date, occurrence.transactionId, occurrence.createdAt, occurrence.updatedAt]);
    await sql(conn, 'INSERT INTO mt_imports (id,user_id,fingerprint,record_count,created_at,updated_at) VALUES (?,?,?, ?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [crypto.randomUUID(), accountId, imported.fingerprint, imported.count]);
    await sql(conn, 'UPDATE mt_user_settings SET revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [accountId]);
    await recordAudit(accountId, 'workspace.imported', accountId, { entity: 'workspace', count: imported.count }, conn);
    return { ...(await readSnapshot(conn, accountId)), imported: imported.count, duplicate: false };
  });
  send(res, result);
}

async function workspaceRestore(req, res) {
  const accountId = owner(req); const body = bodyObject(req); assertBodyAccount(body, accountId); assert(body.confirm === 'RESTORE', 'Restore confirmation is required'); assert(Number.isSafeInteger(body.revision) && body.revision >= 0, 'revision is invalid'); assert(body.state !== undefined, 'state is required');
  const state = body.state; const checked = normalizeImport(state, accountId, true, { preserveUuids: true }); assert(isPlainObject(state.notificationPrefs) ? NOTIFICATION_PREF_KEYS.every((key) => typeof state.notificationPrefs[key] === 'boolean') : state.notificationPrefs === undefined, 'notificationPrefs is invalid');
  const result = await transaction(async (conn) => {
    const locked = await sql(conn, 'SELECT revision FROM mt_user_settings WHERE user_id=? FOR UPDATE', [accountId]); if (!locked[0] || Number(locked[0].revision) !== body.revision) fail('REVISION_CONFLICT', 'Workspace changed on another device', 409);
    const previous = await readSnapshot(conn, accountId); const previousJson = JSON.stringify(previous.state); assert(Buffer.byteLength(previousJson, 'utf8') <= MAX_IMPORT_BYTES, 'Current workspace is too large to preserve as a recovery backup', 'RECOVERY_TOO_LARGE');
    await assertNoForeignIds(conn, accountId, 'mt_categories', checked.core.categories.map((row) => row.id));
    await assertNoForeignIds(conn, accountId, 'mt_transactions', checked.core.transactions.map((row) => row.id));
    await assertNoForeignIds(conn, accountId, 'mt_savings_goals', checked.goals.map((row) => row.id));
    await assertNoForeignIds(conn, accountId, 'mt_goal_contributions', checked.contributions.map((row) => row.id));
    await assertNoForeignIds(conn, accountId, 'mt_recurring_transactions', checked.recurring.map((row) => row.id));
    await assertNoForeignIds(conn, accountId, 'mt_recurring_occurrences', checked.occurrences.map((row) => row.id));
    await sql(conn, 'UPDATE mt_user_settings SET recovery_json=?,recovery_updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [previousJson, accountId]);
    for (const table of ['mt_recurring_occurrences', 'mt_recurring_transactions', 'mt_goal_contributions', 'mt_savings_goals', 'mt_transactions', 'mt_budgets', 'mt_categories']) await sql(conn, `DELETE FROM ${table} WHERE user_id=?`, [accountId]);
    for (const category of checked.core.categories) await sql(conn, 'INSERT INTO mt_categories (id,user_id,name_en,name_ar,category_type,icon,color,created_at,updated_at) VALUES (?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [category.id, accountId, category.names.en, category.names.ar, category.type, category.icon, category.color, preservedTimestamp(category.createdAt, 'category.createdAt'), preservedTimestamp(category.updatedAt, 'category.updatedAt')]);
    for (const row of checked.core.transactions) await sql(conn, 'INSERT INTO mt_transactions (id,user_id,category_id,title,amount,transaction_type,transaction_date,description,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [row.id, accountId, row.categoryId, row.title, row.amount, row.type, row.date, row.description || '', row.demo === true ? 1 : 0, preservedTimestamp(row.createdAt, 'transaction.createdAt'), preservedTimestamp(row.updatedAt, 'transaction.updatedAt')]);
    for (const [month, budget] of Object.entries(checked.core.budgets)) { await sql(conn, 'INSERT INTO mt_budgets (id,user_id,month_key,scope_key,category_id,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [deterministicUuid(accountId, 'budget', `${month}:total`), accountId, month, 'total', null, budget.total]); for (const [categoryId, amount] of Object.entries(budget.categories)) await sql(conn, 'INSERT INTO mt_budgets (id,user_id,month_key,scope_key,category_id,amount,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [deterministicUuid(accountId, 'budget', `${month}:${categoryId}`), accountId, month, categoryId, categoryId, amount]); }
    for (const goal of checked.goals) await sql(conn, 'INSERT INTO mt_savings_goals (id,user_id,title,target_amount,target_date,created_at,updated_at) VALUES (?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [goal.id, accountId, goal.title, goal.targetAmount, goal.targetDate, goal.createdAt, goal.updatedAt]);
    for (const contribution of checked.contributions) await sql(conn, 'INSERT INTO mt_goal_contributions (id,user_id,goal_id,amount,contribution_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [contribution.id, accountId, contribution.goalId, contribution.amount, contribution.date, contribution.note, contribution.createdAt, contribution.updatedAt]);
    for (const rule of checked.recurring) await sql(conn, 'INSERT INTO mt_recurring_transactions (id,user_id,title,amount,transaction_type,category_id,frequency,start_date,next_due_date,end_date,is_active,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [rule.id, accountId, rule.title, rule.amount, rule.type, rule.categoryId, rule.frequency, rule.startDate, rule.nextDueDate, rule.endDate, rule.active ? 1 : 0, rule.description, rule.createdAt, rule.updatedAt]);
    for (const occurrence of checked.occurrences) await sql(conn, 'INSERT INTO mt_recurring_occurrences (id,user_id,recurring_id,due_date,transaction_id,created_at,updated_at) VALUES (?,?,?,?,?,COALESCE(?,CURRENT_TIMESTAMP(6)),COALESCE(?,CURRENT_TIMESTAMP(6)))', [occurrence.id, accountId, occurrence.recurringId, occurrence.date, occurrence.transactionId, occurrence.createdAt, occurrence.updatedAt]);
    await sql(conn, 'UPDATE mt_user_settings SET prefs_json=?,notification_prefs_json=?,revision=revision+1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [JSON.stringify(checked.core.prefs), JSON.stringify(notificationPrefs(state.notificationPrefs)), accountId]);
    await recordAudit(accountId, 'workspace.restored', accountId, { entity: 'workspace', notificationsPreserved: true }, conn);
    return readSnapshot(conn, accountId);
  });
  send(res, { ...result, restored: true, restoredNotifications: false });
}

async function workspaceRecovery(req, res) {
  const accountId = owner(req); const rows = await sql(null, 'SELECT recovery_json,recovery_updated_at FROM mt_user_settings WHERE user_id=?', [accountId]); const row = rows[0];
  send(res, { backup: jsonValue(row?.recovery_json, null), createdAt: stamp(row?.recovery_updated_at) });
}

function goalInput(body, partial = false) { if (!partial || body.title !== undefined) body.title = safeName(body.title, 'title', 120); if (!partial || body.targetAmount !== undefined) body.targetAmount = parseDecimal(body.targetAmount, 'targetAmount'); if (!partial || body.targetDate !== undefined) body.targetDate = nullableDate(body.targetDate, 'targetDate'); return body; }
async function goalCreate(req, res) { const accountId = owner(req); const body = goalInput(bodyObject(req)); const id = crypto.randomUUID(); await transaction(async (conn) => { await sql(conn, 'INSERT INTO mt_savings_goals (id,user_id,title,target_amount,target_date,created_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [id, accountId, body.title, body.targetAmount, body.targetDate]); await bumpRevision(conn, accountId); await recordAudit(accountId, 'goal.created', id, { entity: 'goal' }, conn); }); send(res, { ok: true, id }); }
async function goalPatch(req, res) { const accountId = owner(req); const id = requireUuid(req.params.id, 'goal id'); const body = goalInput(bodyObject(req), true); const sets = []; const values = []; for (const [key, column] of [['title', 'title'], ['targetAmount', 'target_amount'], ['targetDate', 'target_date']]) if (body[key] !== undefined) { sets.push(`${column}=?`); values.push(body[key]); } assert(sets.length, 'No changes supplied'); await transaction(async (conn) => { values.push(accountId, id); const result = await sql(conn, `UPDATE mt_savings_goals SET ${sets.join(',')},updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=?`, values); if (!result.affectedRows) fail('NOT_FOUND', 'Goal not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }
async function goalDelete(req, res) { const accountId = owner(req); assert(bodyObject(req).confirm === 'DELETE', 'Delete confirmation is required'); const id = requireUuid(req.params.id, 'goal id'); await transaction(async (conn) => { const result = await sql(conn, 'DELETE FROM mt_savings_goals WHERE user_id=? AND id=?', [accountId, id]); if (!result.affectedRows) fail('NOT_FOUND', 'Goal not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }
async function contributionCreate(req, res) { const accountId = owner(req); const goalId = requireUuid(req.params.id, 'goal id'); const body = bodyObject(req); const amount = parseDecimal(body.amount, 'amount'); const date = validDate(body.date, 'date'); const note = optionalText(body.note, 'note', 240); const id = crypto.randomUUID(); await transaction(async (conn) => { const goal = await sql(conn, 'SELECT id FROM mt_savings_goals WHERE user_id=? AND id=?', [accountId, goalId]); if (!goal[0]) fail('NOT_FOUND', 'Goal not found', 404); await sql(conn, 'INSERT INTO mt_goal_contributions (id,user_id,goal_id,amount,contribution_date,note,created_at,updated_at) VALUES (?,?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [id, accountId, goalId, amount, date, note]); await bumpRevision(conn, accountId); await recordAudit(accountId, 'goal.contribution.created', id, { entity: 'goal_contribution' }, conn); }); send(res, { ok: true, id }); }
async function contributionDelete(req, res) { const accountId = owner(req); const goalId = requireUuid(req.params.id, 'goal id'); const contributionId = requireUuid(req.params.contributionId, 'contribution id'); await transaction(async (conn) => { const result = await sql(conn, 'DELETE FROM mt_goal_contributions WHERE user_id=? AND goal_id=? AND id=?', [accountId, goalId, contributionId]); if (!result.affectedRows) fail('NOT_FOUND', 'Contribution not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }

function recurringInput(body, partial = false) { if (!partial || body.title !== undefined) body.title = safeName(body.title, 'title', 240); if (!partial || body.amount !== undefined) body.amount = parseDecimal(body.amount, 'amount'); if (!partial || body.type !== undefined) assert(transactionTypes.has(body.type), 'type is invalid'); if (!partial || body.categoryId !== undefined) body.categoryId = requireUuid(body.categoryId, 'categoryId'); if (!partial || body.frequency !== undefined) assert(frequencies.has(body.frequency), 'frequency is invalid'); if (!partial || body.startDate !== undefined) body.startDate = validDate(body.startDate, 'startDate'); if (body.endDate !== undefined) body.endDate = nullableDate(body.endDate, 'endDate'); if (body.description !== undefined) body.description = optionalText(body.description, 'description', 1000); if (body.active !== undefined) assert(typeof body.active === 'boolean', 'active is invalid'); return body; }
async function assertCategory(conn, accountId, categoryId, type) { const rows = await sql(conn, 'SELECT id,category_type FROM mt_categories WHERE user_id=? AND id=?', [accountId, categoryId]); if (!rows[0]) fail('CATEGORY_NOT_FOUND', 'Category not found', 404); if (type && rows[0].category_type !== type) fail('CATEGORY_TYPE_MISMATCH', 'Category type does not match rule type'); }
async function recurringCreate(req, res) { const accountId = owner(req); const body = recurringInput(bodyObject(req)); const id = crypto.randomUUID(); const next = body.startDate; if (body.endDate && body.endDate < next) fail('INVALID_DATE_RANGE', 'endDate must not precede startDate'); await transaction(async (conn) => { await assertCategory(conn, accountId, body.categoryId, body.type); await sql(conn, 'INSERT INTO mt_recurring_transactions (id,user_id,title,amount,transaction_type,category_id,frequency,start_date,next_due_date,end_date,is_active,description,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, ?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [id, accountId, body.title, body.amount, body.type, body.categoryId, body.frequency, body.startDate, next, body.endDate ?? null, body.active === undefined ? 1 : body.active ? 1 : 0, body.description || '']); await bumpRevision(conn, accountId); await recordAudit(accountId, 'recurring.created', id, { entity: 'recurring_rule' }, conn); }); send(res, { ok: true, id }); }
async function recurringPatch(req, res) { const accountId = owner(req); const id = requireUuid(req.params.id, 'recurring id'); const body = recurringInput(bodyObject(req), true); if (body.endDate && body.startDate && body.endDate < body.startDate) fail('INVALID_DATE_RANGE', 'endDate must not precede startDate'); const current = await sql(null, 'SELECT * FROM mt_recurring_transactions WHERE user_id=? AND id=?', [accountId, id]); if (!current[0]) fail('NOT_FOUND', 'Recurring rule not found', 404); const merged = { title: current[0].title, amount: decimal(current[0].amount), type: current[0].transaction_type, categoryId: current[0].category_id, frequency: current[0].frequency, startDate: dbDate(current[0].start_date), endDate: dbDate(current[0].end_date), description: current[0].description || '', active: Boolean(current[0].is_active), ...body }; recurringInput(merged); await transaction(async (conn) => { await assertCategory(conn, accountId, merged.categoryId, merged.type); await sql(conn, 'UPDATE mt_recurring_transactions SET title=?,amount=?,transaction_type=?,category_id=?,frequency=?,start_date=?,end_date=?,is_active=?,description=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=?', [merged.title, merged.amount, merged.type, merged.categoryId, merged.frequency, merged.startDate, merged.endDate, merged.active ? 1 : 0, merged.description || '', accountId, id]); await bumpRevision(conn, accountId); await recordAudit(accountId, 'recurring.updated', id, { entity: 'recurring_rule' }, conn); }); send(res, { ok: true }); }
async function recurringDelete(req, res) { const accountId = owner(req); assert(bodyObject(req).confirm === 'DELETE', 'Delete confirmation is required'); const id = requireUuid(req.params.id, 'recurring id'); await transaction(async (conn) => { const result = await sql(conn, 'DELETE FROM mt_recurring_transactions WHERE user_id=? AND id=?', [accountId, id]); if (!result.affectedRows) fail('NOT_FOUND', 'Recurring rule not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }

export async function processDue(accountId, conn = null) {
  const profile = await sql(conn, 'SELECT status FROM mt_profiles WHERE id=?', [accountId]); if (!profile[0]) fail('NOT_FOUND', 'Account not found', 404); if (profile[0].status !== 'active') return { processed: 0, remaining: 0, suspended: true };
  const rules = await sql(conn, 'SELECT * FROM mt_recurring_transactions WHERE user_id=? AND is_active=1 ORDER BY next_due_date,id FOR UPDATE', [accountId]); let processed = 0; let remaining = 0; const today = todayIso();
  for (const rule of rules) {
    let due = dbDate(rule.next_due_date); let count = 0;
    while (due && due <= today && (!rule.end_date || due <= dbDate(rule.end_date)) && count < MAX_CATCH_UP) {
      const transactionId = crypto.randomUUID(); const occurrenceId = crypto.randomUUID();
      const inserted = await sql(conn, 'INSERT IGNORE INTO mt_recurring_occurrences (id,user_id,recurring_id,due_date,transaction_id,created_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [occurrenceId, accountId, rule.id, due, transactionId]);
      if (inserted.affectedRows) { await sql(conn, 'INSERT INTO mt_transactions (id,user_id,category_id,title,amount,transaction_type,transaction_date,description,is_demo,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,0,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [transactionId, accountId, rule.category_id, rule.title, decimal(rule.amount), rule.transaction_type, due, rule.description || '']); processed += 1; }
      due = addFrequency(due, rule.frequency); count += 1;
    }
    if (due && due <= today && (!rule.end_date || due <= dbDate(rule.end_date))) remaining += 1;
    await sql(conn, 'UPDATE mt_recurring_transactions SET next_due_date=?,is_active=CASE WHEN end_date IS NOT NULL AND ? > end_date THEN 0 ELSE is_active END,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=?', [due, due, accountId, rule.id]);
    if (processed && count) await sql(conn, 'INSERT IGNORE INTO mt_notifications (id,user_id,notification_type,title_key,body_json,is_read,dedupe_key,created_at,updated_at) VALUES (?,?,?,?,?,0,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [crypto.randomUUID(), accountId, 'recurring', 'recurringProcessed', JSON.stringify({ recurringId: rule.id, count }), `recurring:${rule.id}:${today}`]);
  }
  if (rules.length) await bumpRevision(conn, accountId);
  return { processed, remaining, suspended: false };
}
async function recurringProcess(req, res) { const accountId = owner(req); const result = await transaction((conn) => processDue(accountId, conn)); send(res, result); }

async function notificationPatch(req, res) { const accountId = owner(req); const body = bodyObject(req); assert(typeof body.read === 'boolean', 'read must be boolean'); const id = requireUuid(req.params.id, 'notification id'); await transaction(async (conn) => { const result = await sql(conn, 'UPDATE mt_notifications SET is_read=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND id=? AND dismissed_at IS NULL', [body.read ? 1 : 0, accountId, id]); if (!result.affectedRows) fail('NOT_FOUND', 'Notification not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }
async function notificationDelete(req, res) { const accountId = owner(req); const id = requireUuid(req.params.id, 'notification id'); await transaction(async (conn) => { const dismissed = await sql(conn, 'UPDATE mt_notifications SET dismissed_at=CURRENT_TIMESTAMP(6),is_read=1 WHERE user_id=? AND id=? AND dedupe_key IS NOT NULL AND dismissed_at IS NULL', [accountId, id]); const removed = dismissed.affectedRows ? dismissed : await sql(conn, 'DELETE FROM mt_notifications WHERE user_id=? AND id=? AND dedupe_key IS NULL', [accountId, id]); if (!removed.affectedRows) fail('NOT_FOUND', 'Notification not found', 404); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }
async function notificationReadAll(req, res) { const accountId = owner(req); await transaction(async (conn) => { await sql(conn, 'UPDATE mt_notifications SET is_read=1,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=? AND dismissed_at IS NULL', [accountId]); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }
async function notificationPrefsPatch(req, res) { const accountId = owner(req); const body = bodyObject(req); for (const key of NOTIFICATION_PREF_KEYS) assert(typeof body[key] === 'boolean', `${key} must be boolean`); await transaction(async (conn) => { await sql(conn, 'UPDATE mt_user_settings SET notification_prefs_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [JSON.stringify(Object.fromEntries(NOTIFICATION_PREF_KEYS.map((key) => [key, body[key]]))), accountId]); await bumpRevision(conn, accountId); }); send(res, { ok: true }); }

async function publicContent(req, res) { const items = await query('SELECT id,content_type,content_key,data_json FROM mt_platform_content WHERE is_published=1 AND content_type IN ("faq","announcement","settings") ORDER BY content_type,created_at,id'); const faqs = []; const announcements = []; let settings = {}; for (const row of items) { const data = jsonValue(row.data_json, {}); if (row.content_type === 'faq') faqs.push({ id: row.id, ...data }); else if (row.content_type === 'announcement') announcements.push({ id: row.id, ...data }); else if (row.content_key === 'platform-settings') settings = { supportEmail: typeof data.supportEmail === 'string' ? data.supportEmail : '', platformName: typeof data.platformName === 'string' ? data.platformName : 'MoneyTrack', tagline: isPlainObject(data.tagline) ? { en: data.tagline.en || '', ar: data.tagline.ar || '' } : { en: '', ar: '' } }; } send(res, { faqs, announcements, settings }); }
async function publicContact(req, res) { const body = bodyObject(req); const name = safeName(body.name, 'name', 100); const email = safeName(body.email, 'email', 254); const message = safeName(body.message, 'message', 4000); assert(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email), 'email is invalid'); const key = `contact:${clientIp(req)}`; const allowed = await checkRateLimit(key, 5, 3600); if (!allowed) fail('RATE_LIMITED', 'Too many contact messages', 429); await query("INSERT INTO mt_contact_messages (id,name,email,message,status,created_at,updated_at) VALUES (?,?,?,?,'new',CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))", [crypto.randomUUID(), name, email, message]); send(res, { ok: true }); }
async function cronRecurring(req, res) { const secret = process.env.CRON_SECRET; if (!secret) fail('CRON_NOT_CONFIGURED', 'Cron is not configured', 503); const supplied = Buffer.from(req.get('authorization') || ''); const expected = Buffer.from(`Bearer ${secret}`); if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) fail('FORBIDDEN', 'Invalid cron credentials', 403); const profiles = await query('SELECT id FROM mt_profiles WHERE status="active" AND email_verified=1'); let processed = 0; let remaining = 0; for (const profile of profiles) { const result = await transaction((conn) => processDue(profile.id, conn)); processed += result.processed; remaining += result.remaining; } send(res, { processed, remaining }); }

const privateWrite = [requireAuth, requireReady, csrfGuard];
router.get('/workspace', requireAuth, requireReady, wrap(workspaceGet));
router.get('/workspace/recovery', requireAuth, requireReady, wrap(workspaceRecovery));
router.put('/workspace', ...privateWrite, wrap(workspacePut));
router.post('/workspace/reset', ...privateWrite, wrap(workspaceReset));
router.post('/workspace/import', ...privateWrite, wrap(workspaceImport));
router.post('/workspace/restore', ...privateWrite, wrap(workspaceRestore));
router.post('/goals', ...privateWrite, wrap(goalCreate));
router.patch('/goals/:id', ...privateWrite, wrap(goalPatch));
router.delete('/goals/:id', ...privateWrite, wrap(goalDelete));
router.post('/goals/:id/contributions', ...privateWrite, wrap(contributionCreate));
router.delete('/goals/:id/contributions/:contributionId', ...privateWrite, wrap(contributionDelete));
router.post('/recurring', ...privateWrite, wrap(recurringCreate));
router.patch('/recurring/:id', ...privateWrite, wrap(recurringPatch));
router.delete('/recurring/:id', ...privateWrite, wrap(recurringDelete));
router.post('/recurring/process', ...privateWrite, wrap(recurringProcess));
router.patch('/notifications/:id', ...privateWrite, wrap(notificationPatch));
router.delete('/notifications/:id', ...privateWrite, wrap(notificationDelete));
router.post('/notifications/read-all', ...privateWrite, wrap(notificationReadAll));
router.patch('/notification-preferences', ...privateWrite, wrap(notificationPrefsPatch));
router.get('/public/content', wrap(publicContent));
router.post('/public/contact', csrfGuard, wrap(publicContact));
router.post('/cron/recurring', wrap(cronRecurring));
// Vercel Cron Jobs only issue GET requests; the bearer secret check is identical.
router.get('/cron/recurring', wrap(cronRecurring));

export { router as default, readSnapshot, ensureSettings, normalizeImport };
