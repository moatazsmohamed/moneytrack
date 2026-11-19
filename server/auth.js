import express from 'express';
import crypto from 'node:crypto';
import { query, transaction, uuid, seedWorkspace, deleteAccount } from './db.js';
import {
  HttpError, csrfGuard, checkRateLimit, hashPassword, verifyPassword, validatePassword,
  normalizeEmail, validateFullName, randomToken, sha256, userDto, getSessionToken,
  SESSION_COOKIE, PREAUTH_COOKIE, cookieOptions, clearCookieOptions, setCsrfCookie,
  requireAuth, sendError, clientIp,
} from './security.js';
import { isEmailConfigured, sendVerificationEmail, sendPasswordResetEmail } from './email.js';

const router = express.Router();
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const nowPlus = (minutes) => new Date(Date.now() + minutes * 60 * 1000);
const ipKey = (req, suffix) => `${suffix}:${clientIp(req)}`;

function body(req) { return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {}; }
function requireConfirmPassword(password, confirmPassword) { if (password !== confirmPassword) throw new HttpError(400, 'PASSWORD_MISMATCH', 'Passwords do not match.'); }
async function rate(req, key, limit, seconds) { if (!(await checkRateLimit(ipKey(req, key), limit, seconds))) throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.'); }
function setAuthCookie(res, token, remember) { res.cookie(SESSION_COOKIE, token, cookieOptions((remember ? 30 : 1) * 24 * 60 * 60 * 1000)); }
function setPreauthCookie(res) { res.cookie(PREAUTH_COOKIE, randomToken(24), cookieOptions(24 * 60 * 60 * 1000)); }
function payloadLanguage(value) { return value === 'en' ? 'en' : 'ar'; }
function jsonValue(value) { return value == null ? null : JSON.stringify(value); }

async function createEmailToken(conn, userId, purpose, payload, minutes) {
  const raw = randomToken(32);
  await conn.execute(
    `INSERT INTO mt_email_tokens (id,user_id,token_hash,purpose,payload_json,expires_at) VALUES (?,?,?,?,?,?)`,
    [uuid(), userId, sha256(raw), purpose, jsonValue(payload), nowPlus(minutes)],
  );
  return raw;
}

async function createSession(userId, sessionVersion, remember) {
  const raw = randomToken(32);
  await query('INSERT INTO mt_sessions (token_hash,user_id,session_version,expires_at) VALUES (?,?,?,?)', [sha256(raw), userId, sessionVersion, nowPlus((remember ? 30 : 1) * 24 * 60)]);
  return raw;
}

async function currentUser(userId) {
  const rows = await query(`SELECT p.id,p.email,p.full_name,p.status,p.email_verified,p.must_change_password,p.created_at,r.role,r.permissions_json
    FROM mt_profiles p JOIN mt_user_roles r ON r.user_id=p.id WHERE p.id=? LIMIT 1`, [userId]);
  return userDto(rows[0]);
}

router.get('/csrf', asyncRoute(async (req, res) => {
  if (!isEmailConfigured()) { /* CSRF is still useful for account forms without mail configured. */ }
  const token = setCsrfCookie(res);
  setPreauthCookie(res);
  res.set('Cache-Control', 'private, no-store');
  res.json({ csrfToken: token });
}));

router.get('/me', asyncRoute(async (req, res) => {
  let user = null;
  const token = getSessionToken(req);
  if (token) {
    try {
      await new Promise((resolve, reject) => requireAuth(req, res, (error) => error ? reject(error) : resolve()));
      user = req.auth?.user || null;
    } catch (error) {
      if (error.code !== 'AUTH_REQUIRED') throw error;
      res.clearCookie(SESSION_COOKIE, clearCookieOptions());
    }
  }
  const csrfToken = setCsrfCookie(res);
  setPreauthCookie(res);
  res.set('Cache-Control', 'private, no-store');
  res.json({ user, csrfToken, emailConfigured: isEmailConfigured() });
}));

router.post('/register', csrfGuard, asyncRoute(async (req, res) => {
  await rate(req, 'register', 8, 3600);
  // Signing up must never dead-end: without a mail server the account is created
  // already verified, and the client is told that email is disabled.
  const emailReady = isEmailConfigured();
  const input = body(req);
  const fullName = validateFullName(input.fullName);
  const email = normalizeEmail(input.email);
  const password = input.password;
  requireConfirmPassword(password, input.confirmPassword);
  validatePassword(password);
  if (input.acceptTerms !== true) throw new HttpError(400, 'TERMS_REQUIRED', 'Accept the terms and privacy policy.');
  const language = payloadLanguage(input.language);
  const passwordHash = await hashPassword(password);
  let token;
  let profile;
  try {
    profile = await transaction(async (conn) => {
      const id = uuid();
      await conn.execute(`INSERT INTO mt_profiles (id,email,password_hash,full_name,status,email_verified,must_change_password) VALUES (?,?,?,?, 'active', ?, FALSE)`, [id, email, passwordHash, fullName, emailReady ? false : true]);
      await conn.execute(`INSERT INTO mt_user_roles (user_id,role,permissions_json) VALUES (?, 'USER', ?)`, [id, JSON.stringify([])]);
      await seedWorkspace(id, conn, language);
      token = await createEmailToken(conn, id, 'verify_email', { language }, 1440);
      return { id, email, fullName };
    });
  } catch (error) {
    if (error?.code === 'ER_DUP_ENTRY') throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    throw error;
  }
  let emailSent = false;
  if (emailReady) {
    try {
      await sendVerificationEmail({ to: profile.email, fullName: profile.fullName, token, language });
      emailSent = true;
    } catch (error) {
      // the account already exists, so a mail outage must not lock the owner out
      await query('UPDATE mt_profiles SET email_verified=TRUE WHERE id=?', [profile.id]);
      console.error('[auth] verification email failed, account auto-verified:', error?.code || error?.message);
    }
  }
  res.status(201).json({ verificationRequired: emailSent, emailDisabled: !emailSent });
}));

router.post('/login', csrfGuard, asyncRoute(async (req, res) => {
  const input = body(req);
  const email = normalizeEmail(input.email);
  await rate(req, 'login', 12, 900);
  // Per-account ceiling so rotating the source address cannot buy unlimited guesses.
  if (!(await checkRateLimit(`login-account:${sha256(email)}`, 10, 900))) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  }
  const rows = await query(`SELECT p.id,p.email,p.password_hash,p.full_name,p.status,p.email_verified,p.must_change_password,p.session_version,p.created_at,r.role,r.permissions_json
    FROM mt_profiles p JOIN mt_user_roles r ON r.user_id=p.id WHERE p.email=? LIMIT 1`, [email]);
  const row = rows[0];
  if (!row || !(await verifyPassword(input.password, row?.password_hash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  if (row.status !== 'active') throw new HttpError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended.');
  const remember = input.remember === true;
  const session = await createSession(row.id, row.session_version, remember);
  await query('UPDATE mt_profiles SET last_login_at=UTC_TIMESTAMP(6) WHERE id=?', [row.id]);
  try { await query('INSERT INTO mt_activity_logs (id,actor_id,action,target_id,metadata_json) VALUES (?,?,?,?,?)', [uuid(), row.id, 'auth.login', row.id, JSON.stringify({ method: 'password' })]); } catch { /* audit failure does not leak or block login */ }
  setAuthCookie(res, session, remember);
  const csrfToken = setCsrfCookie(res);
  setPreauthCookie(res);
  res.set('Cache-Control', 'private, no-store');
  res.json({ user: userDto(row), csrfToken });
}));

router.post('/logout', csrfGuard, asyncRoute(async (req, res) => {
  const token = getSessionToken(req);
  if (token) await query('DELETE FROM mt_sessions WHERE token_hash=?', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  res.clearCookie(PREAUTH_COOKIE, clearCookieOptions());
  res.clearCookie('moneytrack_csrf', clearCookieOptions());
  res.json({ ok: true });
}));

router.post('/forgot-password', csrfGuard, asyncRoute(async (req, res) => {
  await rate(req, 'forgot-password', 8, 3600);
  if (!isEmailConfigured()) throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Email service is not configured. Please try again later.');
  const input = body(req);
  const email = normalizeEmail(input.email);
  const rows = await query('SELECT id,email,full_name FROM mt_profiles WHERE email=? LIMIT 1', [email]);
  if (rows[0]) {
    let token;
    await transaction(async (conn) => { token = await createEmailToken(conn, rows[0].id, 'reset_password', { language: payloadLanguage(input.language) }, 60); });
    try { await sendPasswordResetEmail({ to: rows[0].email, fullName: rows[0].full_name, token, language: payloadLanguage(input.language) }); }
    catch (error) { throw new HttpError(503, error.code === 'EMAIL_DELIVERY_FAILED' ? 'EMAIL_DELIVERY_FAILED' : 'EMAIL_UNAVAILABLE', 'We could not send the reset email. Please try again later.'); }
  }
  res.json({ ok: true });
}));

router.post('/reset-password', csrfGuard, asyncRoute(async (req, res) => {
  await rate(req, 'reset-password', 10, 3600);
  const input = body(req);
  if (typeof input.token !== 'string' || input.token.length < 20) throw new HttpError(400, 'INVALID_TOKEN', 'This reset link is invalid or expired.');
  requireConfirmPassword(input.password, input.confirmPassword);
  validatePassword(input.password);
  const passwordHash = await hashPassword(input.password);
  const tokenHash = sha256(input.token);
  const changed = await transaction(async (conn) => {
    const [rows] = await conn.execute(`SELECT t.id,t.user_id FROM mt_email_tokens t WHERE t.token_hash=? AND t.purpose='reset_password' AND t.consumed_at IS NULL AND t.expires_at>UTC_TIMESTAMP(6) FOR UPDATE`, [tokenHash]);
    if (!rows[0]) return false;
    await conn.execute('UPDATE mt_profiles SET password_hash=?,must_change_password=FALSE,session_version=session_version+1 WHERE id=?', [passwordHash, rows[0].user_id]);
    await conn.execute('UPDATE mt_email_tokens SET consumed_at=UTC_TIMESTAMP(6) WHERE id=?', [rows[0].id]);
    await conn.execute('DELETE FROM mt_sessions WHERE user_id=?', [rows[0].user_id]);
    return true;
  });
  if (!changed) throw new HttpError(400, 'INVALID_TOKEN', 'This reset link is invalid or expired.');
  res.json({ ok: true });
}));

router.post('/verify-email', csrfGuard, asyncRoute(async (req, res) => {
  await rate(req, 'verify-email', 15, 3600);
  const input = body(req);
  if (typeof input.token !== 'string' || input.token.length < 20) throw new HttpError(400, 'INVALID_TOKEN', 'This verification link is invalid or expired.');
  const result = await transaction(async (conn) => {
    const [rows] = await conn.execute(`SELECT t.id,t.user_id,t.payload_json,t.purpose FROM mt_email_tokens t WHERE t.token_hash=? AND t.consumed_at IS NULL AND t.expires_at>UTC_TIMESTAMP(6) AND t.purpose IN ('verify_email','change_email') FOR UPDATE`, [sha256(input.token)]);
    const row = rows[0];
    if (!row) return false;
    let payload = {}; try { payload = row.payload_json ? (typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json) : {}; } catch { payload = {}; }
    if (row.purpose === 'change_email') {
      const newEmail = normalizeEmail(payload.email);
      await conn.execute('UPDATE mt_profiles SET email=?,email_verified=TRUE,session_version=session_version+1 WHERE id=?', [newEmail, row.user_id]);
      await conn.execute('DELETE FROM mt_sessions WHERE user_id=?', [row.user_id]);
    } else await conn.execute('UPDATE mt_profiles SET email_verified=TRUE WHERE id=?', [row.user_id]);
    await conn.execute('UPDATE mt_email_tokens SET consumed_at=UTC_TIMESTAMP(6) WHERE id=?', [row.id]);
    return true;
  });
  if (!result) throw new HttpError(400, 'INVALID_TOKEN', 'This verification link is invalid or expired.');
  res.json({ ok: true });
}));

router.post('/resend-verification', csrfGuard, asyncRoute(async (req, res) => {
  await rate(req, 'resend-verification', 5, 3600);
  if (!isEmailConfigured()) throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Email service is not configured. Please try again later.');
  const email = normalizeEmail(body(req).email);
  const rows = await query('SELECT id,email,full_name,email_verified FROM mt_profiles WHERE email=? LIMIT 1', [email]);
  if (rows[0] && !rows[0].email_verified) {
    let token;
    await transaction(async (conn) => { token = await createEmailToken(conn, rows[0].id, 'verify_email', { language: payloadLanguage(body(req).language) }, 1440); });
    try { await sendVerificationEmail({ to: rows[0].email, fullName: rows[0].full_name, token, language: payloadLanguage(body(req).language) }); }
    catch (error) { throw new HttpError(503, error.code === 'EMAIL_DELIVERY_FAILED' ? 'EMAIL_DELIVERY_FAILED' : 'EMAIL_UNAVAILABLE', 'We could not send the verification email. Please try again later.'); }
  }
  res.json({ ok: true });
}));

router.patch('/profile', requireAuth, csrfGuard, asyncRoute(async (req, res) => {
  const fullName = validateFullName(body(req).fullName);
  await query('UPDATE mt_profiles SET full_name=? WHERE id=?', [fullName, req.auth.user.id]);
  res.json({ user: await currentUser(req.auth.user.id) });
}));

router.post('/change-password', requireAuth, csrfGuard, asyncRoute(async (req, res) => {
  const input = body(req);
  requireConfirmPassword(input.newPassword, input.confirmPassword);
  validatePassword(input.newPassword);
  const rows = await query('SELECT password_hash FROM mt_profiles WHERE id=? LIMIT 1', [req.auth.user.id]);
  if (!(await verifyPassword(input.currentPassword, rows[0]?.password_hash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  const passwordHash = await hashPassword(input.newPassword);
  await transaction(async (conn) => {
    await conn.execute('UPDATE mt_profiles SET password_hash=?,must_change_password=FALSE,session_version=session_version+1 WHERE id=?', [passwordHash, req.auth.user.id]);
    await conn.execute('DELETE FROM mt_sessions WHERE user_id=?', [req.auth.user.id]);
  });
  const freshRows = await query('SELECT session_version FROM mt_profiles WHERE id=?', [req.auth.user.id]);
  const session = await createSession(req.auth.user.id, freshRows[0].session_version, true);
  setAuthCookie(res, session, true);
  const csrfToken = setCsrfCookie(res);
  res.json({ user: await currentUser(req.auth.user.id), csrfToken });
}));

router.post('/change-email', requireAuth, csrfGuard, asyncRoute(async (req, res) => {
  if (!isEmailConfigured()) throw new HttpError(503, 'EMAIL_UNAVAILABLE', 'Email service is not configured. Please try again later.');
  const input = body(req);
  const email = normalizeEmail(input.email);
  const current = await query('SELECT password_hash,full_name FROM mt_profiles WHERE id=?', [req.auth.user.id]);
  if (!(await verifyPassword(input.currentPassword, current[0]?.password_hash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  const existing = await query('SELECT id FROM mt_profiles WHERE email=? AND id<>? LIMIT 1', [email, req.auth.user.id]);
  if (existing[0]) throw new HttpError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  let token;
  await transaction(async (conn) => { token = await createEmailToken(conn, req.auth.user.id, 'change_email', { email, language: payloadLanguage(input.language) }, 1440); });
  try { await sendVerificationEmail({ to: email, fullName: current[0].full_name, token, language: payloadLanguage(input.language) }); }
  catch (error) { throw new HttpError(503, error.code === 'EMAIL_DELIVERY_FAILED' ? 'EMAIL_DELIVERY_FAILED' : 'EMAIL_UNAVAILABLE', 'We could not send the verification email. Please try again later.'); }
  res.json({ verificationRequired: true });
}));

router.delete('/account', requireAuth, csrfGuard, asyncRoute(async (req, res) => {
  const input = body(req);
  if (input.confirm !== 'DELETE') throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Type DELETE to confirm.');
  const current = await query('SELECT password_hash FROM mt_profiles WHERE id=?', [req.auth.user.id]);
  if (!(await verifyPassword(input.currentPassword, current[0]?.password_hash))) throw new HttpError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
  const roleRows = await query('SELECT role FROM mt_user_roles WHERE user_id=?', [req.auth.user.id]);
  if (roleRows[0]?.role === 'SUPER_ADMIN') {
    const counts = await query("SELECT COUNT(*) AS count FROM mt_user_roles r JOIN mt_profiles p ON p.id=r.user_id WHERE r.role='SUPER_ADMIN' AND p.status='active'");
    if (Number(counts[0]?.count || 0) <= 1) throw new HttpError(409, 'LAST_SUPER_ADMIN', 'The last super administrator cannot be deleted.');
  }
  await transaction((conn) => deleteAccount(conn, req.auth.user.id));
  res.clearCookie(SESSION_COOKIE, clearCookieOptions());
  res.clearCookie(PREAUTH_COOKIE, clearCookieOptions());
  res.json({ ok: true });
}));

export default router;
export { createSession, verifyPassword };
