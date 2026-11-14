import express from 'express';
import crypto from 'node:crypto';
import { pool, query, transaction, deleteAccount } from './db.js';
import { requireAuth, requireReady, csrfGuard, requirePermission, recordAudit } from './security.js';
import { verifyPassword } from './auth.js';
import { assert, isPlainObject, jsonValue, PERMISSION_WHITELIST, requireUuid } from './domain-helpers.js';

const router = express.Router();
const PAGE_SIZE = 20;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function fail(code, message, status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
function wrap(handler) { return async (req, res, next) => { try { await handler(req, res, next); } catch (error) { error.status = error.status || 400; next(error); } }; }
async function sql(conn, statement, params = []) {
  // mysql2 resolves [rows | ResultSetHeader, fields]; always return the first element so affectedRows works.
  if (conn) { const [result] = await conn.execute(statement, params); return result; }
  if (/^\s*(SELECT|SHOW|DESCRIBE|EXPLAIN)\b/i.test(statement)) return query(statement, params);
  const [result] = await pool.execute(statement, params);
  return result;
}
function bodyObject(req) { assert(isPlainObject(req.body), 'Request body must be an object'); return req.body; }
function stamp(value) { return value instanceof Date ? value.toISOString() : value ?? null; }
function authUser(req) { return req.auth.user; }
function permissions(value) { const parsed = jsonValue(value, []); return Array.isArray(parsed) ? parsed.filter((item) => PERMISSION_WHITELIST.includes(item)) : []; }
function serializeUser(row) { return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, permissions: permissions(row.permissions_json), status: row.status, emailVerified: Boolean(row.email_verified), mustChangePassword: Boolean(row.must_change_password), createdAt: stamp(row.created_at) }; }
function pageOf(value) { const page = Number.parseInt(value, 10); return Number.isInteger(page) && page > 0 ? Math.min(page, 1000000) : 1; }
function contentData(type, data) {
  assert(type === 'faq' || type === 'announcement', 'content type is invalid'); assert(isPlainObject(data), 'content data must be an object');
  const bilingual = (value, field, max) => { assert(isPlainObject(value) && typeof value.en === 'string' && typeof value.ar === 'string' && value.en.length <= max && value.ar.length <= max, `${field} must contain bilingual text`); return { en: value.en, ar: value.ar }; };
  if (type === 'faq') { const result = { question: bilingual(data.question, 'question', 500), answer: bilingual(data.answer, 'answer', 4000), order: Number.isInteger(data.order) ? data.order : 0 }; assert(result.order >= 0 && result.order <= 100000, 'order is invalid'); return result; }
  return { title: bilingual(data.title, 'title', 500), body: bilingual(data.body, 'body', 10000) };
}
function settingsData(data) {
  assert(isPlainObject(data), 'settings data must be an object'); const safe = {};
  if (data.supportEmail !== undefined) { assert(typeof data.supportEmail === 'string' && data.supportEmail.length <= 254 && (!data.supportEmail || emailPattern.test(data.supportEmail)), 'supportEmail is invalid'); safe.supportEmail = data.supportEmail; }
  if (data.platformName !== undefined) { assert(typeof data.platformName === 'string' && data.platformName.trim() && data.platformName.length <= 120, 'platformName is invalid'); safe.platformName = data.platformName.trim(); }
  if (data.tagline !== undefined) { assert(isPlainObject(data.tagline) && typeof data.tagline.en === 'string' && typeof data.tagline.ar === 'string' && data.tagline.en.length <= 500 && data.tagline.ar.length <= 500, 'tagline is invalid'); safe.tagline = { en: data.tagline.en, ar: data.tagline.ar }; }
  for (const key of ['theme', 'defaultLanguage']) if (data[key] !== undefined) { assert(typeof data[key] === 'string' && data[key].length <= 30, `${key} is invalid`); safe[key] = data[key]; }
  return safe;
}
async function roleRow(conn, id) { const rows = await sql(conn, 'SELECT p.id,p.email,p.status,r.role,r.permissions_json FROM mt_profiles p JOIN mt_user_roles r ON r.user_id=p.id WHERE p.id=?', [id]); return rows[0]; }
async function activeSuperadminCount(conn) { const rows = await sql(conn, "SELECT COUNT(*) AS count FROM mt_profiles p JOIN mt_user_roles r ON r.user_id=p.id WHERE r.role='SUPER_ADMIN' AND p.status='active'", []); return Number(rows[0]?.count || 0); }
function ensureTargetRule(caller, target) { if (!target) fail('NOT_FOUND', 'User not found', 404); if (caller.role === 'ADMIN' && target.role === 'SUPER_ADMIN') fail('FORBIDDEN', 'Administrators cannot manage super administrators', 403); }

async function overview(req, res) {
  const counts = await query("SELECT COUNT(*) AS total, SUM(status='active') AS active, SUM(status='suspended') AS suspended, SUM(created_at >= DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01')) AS newThisMonth FROM mt_profiles");
  const growth = await query("SELECT DATE_FORMAT(created_at,'%Y-%m') AS month, COUNT(*) AS count FROM mt_profiles WHERE created_at >= DATE_SUB(DATE_FORMAT(CURRENT_DATE(),'%Y-%m-01'), INTERVAL 11 MONTH) GROUP BY month ORDER BY month");
  let database = 'ok'; try { await query('SELECT 1 AS ready'); } catch { database = 'error'; }
  res.json({ counts: { total: Number(counts[0]?.total || 0), active: Number(counts[0]?.active || 0), suspended: Number(counts[0]?.suspended || 0), newThisMonth: Number(counts[0]?.newThisMonth || 0) }, growth: growth.map((row) => ({ month: row.month, count: Number(row.count) })), health: { database, emailConfigured: Boolean(process.env.SMTP_HOST && process.env.SMTP_USER), cronConfigured: Boolean(process.env.CRON_SECRET) } });
}

async function users(req, res) {
  const page = pageOf(req.query.page); const status = ['all', 'active', 'suspended'].includes(req.query.status) ? req.query.status : 'all'; const search = typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 254) : '';
  const where = []; const params = []; if (status !== 'all') { where.push('p.status=?'); params.push(status); } if (search) { where.push('(p.email LIKE ? OR p.full_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); } const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const count = await query(`SELECT COUNT(*) AS total FROM mt_profiles p ${clause}`, params); const rows = await query(`SELECT p.id,p.email,p.full_name,p.status,p.email_verified,p.must_change_password,p.created_at,r.role,r.permissions_json FROM mt_profiles p JOIN mt_user_roles r ON r.user_id=p.id ${clause} ORDER BY p.created_at DESC,p.id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, params);
  res.json({ users: rows.map(serializeUser), page, pageSize: PAGE_SIZE, total: Number(count[0]?.total || 0) });
}

async function statusPatch(req, res) {
  const caller = authUser(req); const targetId = requireUuid(req.params.id, 'user id'); const body = bodyObject(req); assert(body.status === 'active' || body.status === 'suspended', 'status is invalid');
  const result = await transaction(async (conn) => { const target = await roleRow(conn, targetId); ensureTargetRule(caller, target); if (caller.id === targetId && body.status === 'suspended') fail('SELF_SUSPENSION_FORBIDDEN', 'You cannot suspend yourself', 403); if (target.role === 'SUPER_ADMIN' && body.status === 'suspended' && target.status === 'active' && await activeSuperadminCount(conn) <= 1) fail('LAST_SUPERADMIN', 'Cannot suspend the last active super administrator', 409); await sql(conn, 'UPDATE mt_profiles SET status=?,session_version=session_version+1,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?', [body.status, targetId]); await recordAudit(caller.id, `admin.user.${body.status}`, targetId, { entity: 'user', status: body.status }, conn); return roleRow(conn, targetId); });
  res.json({ user: serializeUser(result) });
}

async function rolePatch(req, res) {
  const caller = authUser(req); const targetId = requireUuid(req.params.id, 'user id'); const body = bodyObject(req); if (caller.role !== 'SUPER_ADMIN') fail('FORBIDDEN', 'Super administrator permission is required', 403); assert(['USER', 'ADMIN', 'SUPER_ADMIN'].includes(body.role), 'role is invalid'); assert(Array.isArray(body.permissions), 'permissions must be an array'); const unique = [...new Set(body.permissions)]; assert(unique.every((item) => PERMISSION_WHITELIST.includes(item)), 'permission is not allowed');
  const result = await transaction(async (conn) => { const target = await roleRow(conn, targetId); if (!target) fail('NOT_FOUND', 'User not found', 404); if (caller.id === targetId && body.role !== 'SUPER_ADMIN') fail('SELF_DEMOTION_FORBIDDEN', 'You cannot demote yourself', 403); if (target.role === 'SUPER_ADMIN' && body.role !== 'SUPER_ADMIN' && await activeSuperadminCount(conn) <= 1) fail('LAST_SUPERADMIN', 'Cannot remove the last super administrator', 409); await sql(conn, 'UPDATE mt_user_roles SET role=?,permissions_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE user_id=?', [body.role, JSON.stringify(unique), targetId]); await recordAudit(caller.id, 'admin.user.role_changed', targetId, { entity: 'user', role: body.role }, conn); return roleRow(conn, targetId); });
  res.json({ user: serializeUser(result) });
}

async function deleteUser(req, res) {
  const caller = authUser(req); if (caller.role !== 'SUPER_ADMIN') fail('FORBIDDEN', 'Super administrator permission is required', 403); const targetId = requireUuid(req.params.id, 'user id'); const body = bodyObject(req); assert(body.confirm === 'DELETE', 'Delete confirmation is required'); assert(typeof body.currentPassword === 'string' && body.currentPassword.length > 0, 'currentPassword is required'); const passwordRows = await query('SELECT password_hash FROM mt_profiles WHERE id=? LIMIT 1', [caller.id]); const verified = await verifyPassword(body.currentPassword, passwordRows[0]?.password_hash); if (!verified) fail('INVALID_PASSWORD', 'Current password is incorrect', 403);
  await transaction(async (conn) => { const target = await roleRow(conn, targetId); if (!target) fail('NOT_FOUND', 'User not found', 404); if (caller.id === targetId) fail('SELF_DELETE_FORBIDDEN', 'You cannot delete yourself here', 403); if (target.role === 'SUPER_ADMIN' && target.status === 'active' && await activeSuperadminCount(conn) <= 1) fail('LAST_SUPERADMIN', 'Cannot delete the last active super administrator', 409); await deleteAccount(conn, targetId); await recordAudit(caller.id, 'admin.user.deleted', targetId, { entity: 'user' }, conn); });
  res.json({ ok: true });
}

async function contentList(req, res) { const rows = await query("SELECT id,content_type AS type,content_key,data_json AS data,is_published AS published,created_at,updated_at FROM mt_platform_content WHERE content_type IN ('faq','announcement') ORDER BY content_type,created_at,id"); res.json({ items: rows.map((row) => ({ id: row.id, type: row.type, data: jsonValue(row.data, {}), published: Boolean(row.published), createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) })) }); }
async function contentCreate(req, res) { const actor = authUser(req); const body = bodyObject(req); const data = contentData(body.type, body.data); const id = crypto.randomUUID(); await query('INSERT INTO mt_platform_content (id,content_type,content_key,data_json,is_published,created_at,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))', [id, body.type, `${body.type}:${id}`, JSON.stringify(data), body.published === true ? 1 : 0]); await recordAudit(actor.id, 'admin.content.created', id, { entity: 'content' }); res.status(201).json({ id, type: body.type, data, published: body.published === true }); }
async function contentPatch(req, res) { const actor = authUser(req); const id = requireUuid(req.params.id, 'content id'); const body = bodyObject(req); const current = await query('SELECT content_type,data_json,is_published FROM mt_platform_content WHERE id=? AND content_type IN ("faq","announcement")', [id]); if (!current[0]) fail('NOT_FOUND', 'Content item not found', 404); const type = body.type || current[0].content_type; const data = body.data === undefined ? jsonValue(current[0].data_json, {}) : contentData(type, body.data); assert(type === 'faq' || type === 'announcement', 'content type is invalid'); await query('UPDATE mt_platform_content SET content_type=?,data_json=?,is_published=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?', [type, JSON.stringify(data), body.published === undefined ? Boolean(current[0].is_published) : body.published === true, id]); await recordAudit(actor.id, 'admin.content.updated', id, { entity: 'content' }); res.json({ ok: true }); }
async function contentDelete(req, res) { const actor = authUser(req); const id = requireUuid(req.params.id, 'content id'); assert(bodyObject(req).confirm === 'DELETE', 'Delete confirmation is required'); await query('DELETE FROM mt_platform_content WHERE id=? AND content_type IN ("faq","announcement")', [id]); await recordAudit(actor.id, 'admin.content.deleted', id, { entity: 'content' }); res.json({ ok: true }); }

async function settingsGet(req, res) { const rows = await query("SELECT data_json FROM mt_platform_content WHERE content_type='settings' AND content_key='platform-settings' LIMIT 1"); res.json({ data: jsonValue(rows[0]?.data_json, {}) }); }
async function settingsPatch(req, res) { const actor = authUser(req); if (actor.role !== 'SUPER_ADMIN') fail('FORBIDDEN', 'Super administrator permission is required', 403); const data = settingsData(bodyObject(req).data || bodyObject(req)); const current = await query("SELECT id,data_json FROM mt_platform_content WHERE content_type='settings' AND content_key='platform-settings' LIMIT 1"); const merged = { ...jsonValue(current[0]?.data_json, {}), ...data }; if (current[0]) await query('UPDATE mt_platform_content SET data_json=?,updated_at=CURRENT_TIMESTAMP(6) WHERE id=?', [JSON.stringify(merged), current[0].id]); else await query("INSERT INTO mt_platform_content (id,content_type,content_key,data_json,is_published,created_at,updated_at) VALUES (?,?,?,?,1,CURRENT_TIMESTAMP(6),CURRENT_TIMESTAMP(6))", [crypto.randomUUID(), 'settings', 'platform-settings', JSON.stringify(merged)]); await recordAudit(actor.id, 'admin.settings.updated', null, { entity: 'platform_settings' }); res.json({ data: merged }); }

async function logs(req, res) { const page = pageOf(req.query.page); const kind = req.query.kind === 'security' ? 'security' : 'all'; const where = kind === 'security' ? "WHERE action LIKE 'security.%'" : ''; const total = await query(`SELECT COUNT(*) AS total FROM mt_activity_logs ${where}`); const rows = await query(`SELECT id,actor_id,action,target_id,metadata_json,created_at FROM mt_activity_logs ${where} ORDER BY created_at DESC,id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`, []); res.json({ logs: rows.map((row) => ({ id: row.id, actorId: row.actor_id, action: row.action, targetId: row.target_id, metadata: jsonValue(row.metadata_json, {}), createdAt: stamp(row.created_at) })), page, pageSize: PAGE_SIZE, total: Number(total[0]?.total || 0) }); }
async function messages(req, res) { const rows = await query('SELECT id,name,email,message,status,created_at,updated_at FROM mt_contact_messages ORDER BY created_at DESC,id'); res.json({ messages: rows.map((row) => ({ id: row.id, name: row.name, email: row.email, message: row.message, status: row.status, createdAt: stamp(row.created_at), updatedAt: stamp(row.updated_at) })) }); }
async function messagePatch(req, res) { const actor = authUser(req); const id = requireUuid(req.params.id, 'message id'); assert(bodyObject(req).status === 'read', 'Only read status is supported'); await query("UPDATE mt_contact_messages SET status='read',updated_at=CURRENT_TIMESTAMP(6) WHERE id=?", [id]); await recordAudit(actor.id, 'admin.message.read', id, { entity: 'contact_message' }); res.json({ ok: true }); }
async function messageDelete(req, res) { const actor = authUser(req); assert(bodyObject(req).confirm === 'DELETE', 'Delete confirmation is required'); const id = requireUuid(req.params.id, 'message id'); await query('DELETE FROM mt_contact_messages WHERE id=?', [id]); await recordAudit(actor.id, 'admin.message.deleted', id, { entity: 'contact_message' }); res.json({ ok: true }); }

const auth = [requireAuth, requireReady];
router.get('/overview', ...auth, requirePermission('users.view'), wrap(overview));
router.get('/users', ...auth, requirePermission('users.view'), wrap(users));
router.patch('/users/:id/status', ...auth, csrfGuard, requirePermission('users.manage'), wrap(statusPatch));
router.patch('/users/:id/role', ...auth, csrfGuard, wrap(rolePatch));
router.delete('/users/:id', ...auth, csrfGuard, wrap(deleteUser));
router.get('/content', ...auth, requirePermission('content.manage'), wrap(contentList));
router.post('/content', ...auth, csrfGuard, requirePermission('content.manage'), wrap(contentCreate));
router.patch('/content/:id', ...auth, csrfGuard, requirePermission('content.manage'), wrap(contentPatch));
router.delete('/content/:id', ...auth, csrfGuard, requirePermission('content.manage'), wrap(contentDelete));
router.get('/settings', ...auth, requirePermission('content.manage'), wrap(settingsGet));
router.patch('/settings', ...auth, csrfGuard, wrap(settingsPatch));
router.get('/logs', ...auth, requirePermission('logs.view'), wrap(logs));
router.get('/messages', ...auth, requirePermission('content.manage'), wrap(messages));
router.patch('/messages/:id', ...auth, csrfGuard, requirePermission('content.manage'), wrap(messagePatch));
router.delete('/messages/:id', ...auth, csrfGuard, requirePermission('content.manage'), wrap(messageDelete));

export default router;
