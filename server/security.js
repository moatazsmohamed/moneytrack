import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { pool, query, transaction } from './db.js';

const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_N = 2 ** 17;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 256 * 1024 * 1024;
let hashActive = false;
const hashWaiters = [];

async function withHashCapacity(work) {
  if (hashActive) {
    if (hashWaiters.length >= 8) throw new HttpError(503, 'SERVER_BUSY', 'Authentication is busy. Try again shortly.');
    await new Promise(resolve => hashWaiters.push(resolve));
  }
  hashActive = true;
  try { return await work(); }
  finally {
    const next = hashWaiters.shift();
    if (next) next(); else hashActive = false;
  }
}
export const SESSION_COOKIE = 'moneytrack_session';
export const PREAUTH_COOKIE = 'moneytrack_preauth';
export const CSRF_COOKIE = 'moneytrack_csrf';

export class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

export function sendError(res, error) {
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const code = error?.code || 'INTERNAL_ERROR';
  const message = status >= 500 ? 'An unexpected server error occurred.' : (error.message || 'Request could not be completed.');
  if (!res.headersSent) res.status(status).json({ error: { code, message } });
}

export function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString('base64url'); }
export function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }

export function validatePassword(password, { bootstrap = false } = {}) {
  if (typeof password !== 'string') throw new HttpError(400, 'INVALID_PASSWORD', 'Password is invalid.');
  if (password.length > 256) throw new HttpError(400, 'INVALID_PASSWORD', 'Password is too long.');
  if (bootstrap && /^\d{6,}$/.test(password)) return true;
  if (password.length < 12 || password.length > 256) throw new HttpError(400, 'WEAK_PASSWORD', 'Password must be at least 12 characters.');
  if (/^\d+$/.test(password)) throw new HttpError(400, 'WEAK_PASSWORD', 'Password cannot contain only digits.');
  if (/^(.)\1+$/.test(password) || /^(password|qwerty|letmein|welcome|moneytrack)/i.test(password)) throw new HttpError(400, 'WEAK_PASSWORD', 'Choose a less obvious password.');
  if (!/[A-Za-z\u0600-\u06ff]/.test(password) || !/\d|[^A-Za-z\u0600-\u06ff]/.test(password)) throw new HttpError(400, 'WEAK_PASSWORD', 'Use letters and numbers or symbols.');
  return true;
}

export async function hashPassword(password, options) {
  validatePassword(password, options);
  const salt = crypto.randomBytes(16);
  const derived = await withHashCapacity(() => scryptAsync(password, salt, 64, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: SCRYPT_MAXMEM }));
  return `scrypt$${SCRYPT_N},${SCRYPT_R},${SCRYPT_P}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

export async function verifyPassword(password, encoded) {
  if (typeof password !== 'string' || password.length > 256 || typeof encoded !== 'string') return false;
  const match = /^scrypt\$(\d+),(\d+),(\d+)\$([^$]+)\$([^$]+)$/.exec(encoded);
  if (!match) return false;
  try {
    const [, n, r, p, saltText, hashText] = match;
    const expected = Buffer.from(hashText, 'base64url');
    const salt = Buffer.from(saltText, 'base64url');
    if (expected.length !== 64 || salt.length !== 16 || Number(n) > SCRYPT_N || Number(r) !== 8 || Number(p) < 1 || Number(p) > 10) return false;
    const actual = Buffer.from(await withHashCapacity(() => scryptAsync(password, salt, expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT_MAXMEM })));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (error) { if (error instanceof HttpError) throw error; return false; }
}

export function normalizeEmail(email) {
  if (typeof email !== 'string') throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new HttpError(400, 'INVALID_EMAIL', 'Enter a valid email address.');
  return normalized;
}

export function validateFullName(fullName) {
  if (typeof fullName !== 'string' || fullName.trim().length < 1 || fullName.trim().length > 100) throw new HttpError(400, 'INVALID_NAME', 'Enter your full name.');
  return fullName.trim();
}

export function publicOriginSet() {
  const values = [process.env.PUBLIC_APP_URL || 'https://moneycash-sigma-one.vercel.app', 'https://moneytrack-szwtxpxu.manus.space', process.env.PREVIEW_ORIGIN, ...(process.env.ALLOWED_ORIGINS || '').split(',')];
  if (isLocalHttp()) values.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return new Set(values.map((value) => value?.trim()).filter(Boolean).map((value) => value.replace(/\/$/, '')));
}

export function isLocalHttp() { return process.env.MONEYTRACK_LOCAL_HTTP === 'true'; }
export function cookieOptions(maxAge) {
  return { httpOnly: true, secure: !isLocalHttp(), sameSite: isLocalHttp() ? 'lax' : 'none', path: '/', ...(maxAge ? { maxAge } : {}) };
}
export function clearCookieOptions() { return { ...cookieOptions(), expires: new Date(0) }; }

function cookieValue(req, name) {
  if (req.cookies?.[name]) return req.cookies[name];
  const header = req.headers?.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}
export function getSessionToken(req) { return cookieValue(req, SESSION_COOKIE); }
export function getCsrfToken(req) { return cookieValue(req, CSRF_COOKIE); }

export function setCsrfCookie(res, token = randomToken()) {
  res.cookie(CSRF_COOKIE, token, cookieOptions(24 * 60 * 60 * 1000));
  return token;
}

export function isAllowedOrigin(origin) {
  if (!origin) return true;
  return publicOriginSet().has(String(origin).replace(/\/$/, ''));
}

/* The browser's Origin must equal the host the request was addressed to (proxy-forwarded host when present). */
export function isSameOrigin(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  const forwardedHost = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
  const host = forwardedHost || req.headers.host;
  if (!host) return false;
  try { return new URL(origin).host === host; } catch { return false; }
}

export function csrfGuard(req, res, next) {
  if (!isSameOrigin(req) && !isAllowedOrigin(req.headers.origin)) return next(new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed.'));
  const supplied = req.get('X-CSRF-Token');
  const stored = getCsrfToken(req);
  if (!supplied || !stored || supplied.length !== stored.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(stored))) return next(new HttpError(403, 'CSRF_INVALID', 'Security verification failed. Refresh and try again.'));
  next();
}

function dto(row) {
  if (!row) return null;
  let permissions = row.permissions_json;
  if (typeof permissions === 'string') { try { permissions = JSON.parse(permissions); } catch { permissions = []; } }
  if (!Array.isArray(permissions)) permissions = [];
  return { id: row.id, email: row.email, fullName: row.full_name, role: row.role, permissions, status: row.status, emailVerified: Boolean(row.email_verified), mustChangePassword: Boolean(row.must_change_password), createdAt: row.created_at };
}
export { dto as userDto };

export async function requireAuth(req, res, next) {
  try {
    const token = getSessionToken(req);
    if (!token) throw new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.');
    const tokenHash = sha256(token);
    const rows = await query(
      `SELECT p.id,p.email,p.full_name,p.status,p.email_verified,p.must_change_password,p.session_version,p.created_at,
              s.token_hash,s.session_version AS stored_session_version,s.expires_at,
              r.role,r.permissions_json
         FROM mt_sessions s JOIN mt_profiles p ON p.id=s.user_id
         JOIN mt_user_roles r ON r.user_id=p.id
        WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP(6) LIMIT 1`, [tokenHash],
    );
    const row = rows[0];
    if (!row || row.status !== 'active' || row.session_version !== row.stored_session_version) throw new HttpError(401, 'AUTH_REQUIRED', 'Your session is no longer valid.');
    req.auth = { user: dto(row), sessionHash: tokenHash, csrfToken: getCsrfToken(req) };
    next();
  } catch (error) { next(error); }
}

export function requireReady(req, res, next) {
  if (!req.auth?.user) return next(new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.'));
  if (req.auth.user.status !== 'active' || !req.auth.user.emailVerified) return next(new HttpError(403, 'EMAIL_NOT_VERIFIED', 'Verify your email before continuing.'));
  if (req.auth.user.mustChangePassword) return next(new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Change your temporary password before continuing.'));
  next();
}

export function requirePermission(permission) {
  return (req, res, next) => {
    const user = req.auth?.user;
    if (!user) return next(new HttpError(401, 'AUTH_REQUIRED', 'Please sign in.'));
    if (user.role === 'SUPER_ADMIN' || (user.role === 'ADMIN' && user.permissions.includes(permission))) return next();
    return next(new HttpError(403, 'FORBIDDEN', 'You do not have permission for this action.'));
  };
}

export async function recordAudit(actorId, action, targetId = null, metadata = {}, conn = pool) {
  const safe = metadata && typeof metadata === 'object' ? metadata : {};
  const sql = 'INSERT INTO mt_activity_logs (id,actor_id,action,target_id,metadata_json) VALUES (?,?,?,?,?)';
  if (conn?.execute) { await conn.execute(sql, [crypto.randomUUID(), actorId || null, action, targetId || null, JSON.stringify(safe)]); return; }
  await query(sql, [crypto.randomUUID(), actorId || null, action, targetId || null, JSON.stringify(safe)]);
}

export async function checkRateLimit(key, limit, windowSeconds, conn = pool) {
  const keyHash = sha256(String(key));
  const sql = `INSERT INTO mt_rate_limits (key_hash,hits,window_start,updated_at) VALUES (?,1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))
    ON DUPLICATE KEY UPDATE hits=IF(TIMESTAMPDIFF(SECOND,window_start,UTC_TIMESTAMP(6))>=?,1,hits+1),
      window_start=IF(TIMESTAMPDIFF(SECOND,window_start,UTC_TIMESTAMP(6))>=?,UTC_TIMESTAMP(6),window_start), updated_at=UTC_TIMESTAMP(6)`;
  const read = 'SELECT hits FROM mt_rate_limits WHERE key_hash=?';
  if (conn?.execute) {
    await conn.execute(sql, [keyHash, windowSeconds, windowSeconds]);
    const [rows] = await conn.execute(read, [keyHash]);
    return Number(rows[0]?.hits || 0) <= limit;
  }
  return transaction(async (tx) => {
    await tx.execute(sql, [keyHash, windowSeconds, windowSeconds]);
    const [rows] = await tx.execute(read, [keyHash]);
    return Number(rows[0]?.hits || 0) <= limit;
  });
}
