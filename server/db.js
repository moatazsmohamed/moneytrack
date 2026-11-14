import crypto from 'node:crypto';
import { createPool } from 'mysql2/promise';
import { defaultCategories } from '../js/legacy-storage.js';

const databaseUrl = process.env.DATABASE_URL;

function connectionOptions(rawUrl) {
  const parsed = new URL(rawUrl);
  const options = {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : 3306,
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 16),
    queueLimit: 0,
    // Opening a TLS connection to the managed database costs ~2 s; keep idle connections alive.
    maxIdle: Number(process.env.DB_CONNECTION_LIMIT || 16),
    idleTimeout: 5 * 60 * 1000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000,
    dateStrings: true,
    timezone: '+00:00',
  };
  const sslText = parsed.searchParams.get('ssl') || parsed.searchParams.get('ssl-mode');
  if (parsed.protocol === 'mysqls:' || sslText) {
    try {
      const parsedSsl = sslText && sslText.startsWith('{') ? JSON.parse(sslText) : null;
      options.ssl = parsedSsl || {};
    } catch {
      options.ssl = {};
    }
  }
  return options;
}

export const pool = databaseUrl ? createPool(connectionOptions(databaseUrl)) : null;

export function assertDatabaseConfigured() {
  if (!pool) throw new Error('DATABASE_UNAVAILABLE');
}

export async function query(sql, params = []) {
  assertDatabaseConfigured();
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function transaction(fn) {
  assertDatabaseConfigured();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch { /* preserve original error */ }
    throw error;
  } finally {
    conn.release();
  }
}

export function uuid() {
  return crypto.randomUUID();
}

/**
 * Permanently removes one account. Categories are protected by ON DELETE RESTRICT so that
 * deleting a single category never silently drops transactions; account deletion therefore
 * removes the dependent financial rows first, inside the caller's transaction.
 */
export async function deleteAccount(conn, userId) {
  for (const table of ['mt_recurring_occurrences', 'mt_transactions', 'mt_budgets', 'mt_recurring_transactions', 'mt_goal_contributions', 'mt_savings_goals', 'mt_categories']) {
    await conn.execute(`DELETE FROM ${table} WHERE user_id=?`, [userId]);
  }
  const [result] = await conn.execute('DELETE FROM mt_profiles WHERE id=?', [userId]);
  return result.affectedRows;
}

function deterministicCategoryId(userId, legacyId) {
  const digest = crypto.createHash('sha256').update(`moneytrack:category:${userId}:${legacyId}`).digest('hex');
  const chars = digest.slice(0, 32).split('');
  chars[12] = '5';
  chars[16] = ((parseInt(chars[16], 16) & 0x3) | 0x8).toString(16);
  return `${chars.slice(0, 8).join('')}-${chars.slice(8, 12).join('')}-${chars.slice(12, 16).join('')}-${chars.slice(16, 20).join('')}-${chars.slice(20).join('')}`;
}

export function emptyWorkspacePrefs(fullName = '', lang = 'ar') {
  const language = lang === 'en' ? 'en' : 'ar';
  return {
    prefs: { theme: 'light', language, currency: 'EGP', name: String(fullName || '').slice(0, 40) },
    notificationPrefs: { budget: true, recurring: true, goals: true, security: true },
  };
}

/** Seed only account-owned defaults; never creates demo financial rows. */
export async function seedWorkspace(userId, conn, lang = 'ar') {
  if (!conn || typeof conn.execute !== 'function') throw new TypeError('seedWorkspace requires a MySQL connection');
  const fullNameRows = await conn.execute('SELECT full_name FROM mt_profiles WHERE id = ? LIMIT 1', [userId]);
  const profile = fullNameRows[0][0];
  const { prefs, notificationPrefs } = emptyWorkspacePrefs(profile?.full_name || '', lang);
  await conn.execute(
    `INSERT INTO mt_user_settings (user_id, prefs_json, notification_prefs_json)
     VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE user_id = user_id`,
    [userId, JSON.stringify(prefs), JSON.stringify(notificationPrefs)],
  );
  for (const category of defaultCategories()) {
    await conn.execute(
      `INSERT INTO mt_categories
        (id, user_id, name_en, name_ar, category_type, icon, color)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = user_id`,
      [deterministicCategoryId(userId, category.id), userId, category.names.en, category.names.ar, category.type, category.icon, category.color],
    );
  }
}

export { deterministicCategoryId };

export async function closePool() {
  if (pool) await pool.end();
}
