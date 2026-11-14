import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authRouter from './auth.js';
import workspaceRouter from './workspace.js';
import adminRouter from './admin.js';
import { query } from './db.js';
import { isEmailConfigured } from './email.js';
import { isAllowedOrigin, requireAuth, requireReady, sendError } from './security.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const distRoot = path.resolve(here, '../dist');
const PUBLIC_PAGES = ['login', 'register', 'forgot-password', 'reset-password', 'verify-email', 'resend-verification', 'privacy', 'terms', 'contact'];

function parseCookies(req, res, next) {
  req.cookies = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    try { req.cookies[key] = decodeURIComponent(rest.join('=')); } catch { req.cookies[key] = rest.join('='); }
  }
  next();
}

function cors(req, res, next) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(origin && !isAllowedOrigin(origin) ? 403 : 204);
  next();
}

function sendDistPage(res, fileName, status = 200) {
  res.status(status).sendFile(fileName, { root: distRoot }, (error) => {
    if (error && !res.headersSent) res.status(error.statusCode || 404).type('text').send(status === 403 ? 'Forbidden' : 'Not found');
  });
}

async function authenticateHtml(req, res) {
  let failure;
  await new Promise((resolve) => requireAuth(req, res, (error) => { failure = error; resolve(); }));
  if (failure) {
    if (failure.code === 'AUTH_REQUIRED') { res.redirect(302, '/login'); return null; }
    res.status(503).type('text').send('Service temporarily unavailable');
    return null;
  }
  return req.auth;
}

async function protectAppHtml(req, res) {
  if (!await authenticateHtml(req, res)) return;
  res.set('Cache-Control', 'private, no-store');
  sendDistPage(res, 'app.html');
}

async function protectAdminHtml(req, res) {
  const auth = await authenticateHtml(req, res);
  if (!auth) return;
  let failure;
  await new Promise((resolve) => requireReady(req, res, (error) => { failure = error; resolve(); }));
  if (failure) { res.status(403).type('text').send('Access requires a verified account and a changed password.'); return; }
  if (!['ADMIN', 'SUPER_ADMIN'].includes(auth.user.role)) { res.status(403).type('text').send('Administrator access is required.'); return; }
  res.set('Cache-Control', 'private, no-store');
  sendDistPage(res, 'admin.html');
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(cors);
  app.use(parseCookies);
  app.use((req, res, next) => {
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'");
    next();
  });
  app.use((req, res, next) => { if (req.path.startsWith('/api/')) { res.set('Cache-Control', 'private, no-store'); res.set('Pragma', 'no-cache'); } next(); });
  app.use(express.json({ limit: '2mb', strict: true }));

  app.get('/api/health', async (req, res) => {
    try { await query('SELECT 1 AS ready'); res.json({ ok: true }); }
    catch { res.status(503).json({ ok: false }); }
  });
  app.get('/api/public/config', (req, res) => res.json({ emailConfigured: isEmailConfigured(), version: '2.0.0' }));
  app.use('/api/auth', authRouter);
  app.use('/api', workspaceRouter);
  app.use('/api/admin', adminRouter);

  app.get(['/app', '/app.html'], protectAppHtml);
  app.get(['/admin', '/admin.html'], protectAdminHtml);
  app.get(['/app/', '/admin/'], (req, res) => res.redirect(302, req.path.slice(0, -1)));
  for (const name of PUBLIC_PAGES) {
    app.get([`/${name}`, `/${name}/`], (req, res) => { res.set('Cache-Control', 'no-cache'); sendDistPage(res, `${name}.html`); });
  }
  app.get(['/en', '/en/'], (req, res) => { res.set('Cache-Control', 'no-cache'); sendDistPage(res, 'en/index.html'); });

  app.use(express.static(distRoot, { dotfiles: 'deny', fallthrough: true, index: 'index.html', redirect: false }));
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found.' } });
    return res.status(404).type('text').send('Not found');
  });
  app.use((error, req, res, next) => { if (res.headersSent) return next(error); sendError(res, error); });
  return app;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  const port = Number(process.env.PORT || 3000);
  const app = createApp();
  app.listen(port, '0.0.0.0', () => process.stdout.write(`MoneyTrack API listening on 0.0.0.0:${port}\n`));
}
