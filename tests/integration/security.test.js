/*
 * End-to-end security tests against the real Express app and the managed MySQL database.
 * A local SMTP sink captures verification e-mails, so no real mailbox is used.
 * Every account uses the reserved domain example.test and is removed in the final cleanup.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { SMTPServer } from 'smtp-server';

const mails = [];
const smtp = new SMTPServer({
  authOptional: true,
  disabledCommands: ['STARTTLS', 'AUTH'],
  onData(stream, session, callback) {
    let data = '';
    stream.on('data', (chunk) => { data += chunk; });
    stream.on('end', () => { mails.push({ to: session.envelope.rcptTo.map((item) => item.address), data }); callback(); });
  },
});
await new Promise((resolve) => smtp.listen(0, '127.0.0.1', resolve));
const smtpPort = smtp.server.address().port;

process.env.SMTP_URL = `smtp://127.0.0.1:${smtpPort}/?ignoreTLS=true`;
process.env.SMTP_FROM = 'MoneyTrack Tests <no-reply@example.test>';
process.env.MONEYTRACK_LOCAL_HTTP = 'true';

const { createApp } = await import('../../server/index.js');
const { query, transaction, deleteAccount } = await import('../../server/db.js');
const app = createApp();
const httpServer = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const BASE = `http://127.0.0.1:${httpServer.address().port}`;
process.env.PUBLIC_APP_URL = BASE;

const RUN = crypto.randomBytes(4).toString('hex');
const PASSWORD = `It-Test-Passw0rd-${RUN}`;
const emailFor = (name) => `mt-it-${RUN}-${name}@example.test`;
const testIp = () => `198.51.100.${1 + crypto.randomInt(250)}`;

function client() {
  const jar = new Map();
  const ip = testIp();
  let csrf = null;
  async function call(method, path, body) {
    const headers = { Accept: 'application/json', 'X-Forwarded-For': ip };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (method !== 'GET') {
      if (!csrf) await call('GET', '/api/auth/csrf');
      headers['X-CSRF-Token'] = csrf;
      headers.Origin = BASE;
    }
    if (jar.size) headers.Cookie = [...jar].map(([key, value]) => `${key}=${value}`).join('; ');
    const response = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    for (const cookie of response.headers.getSetCookie()) {
      const pair = cookie.split(';')[0];
      const index = pair.indexOf('=');
      const key = pair.slice(0, index), value = pair.slice(index + 1);
      if (!value || /expires=Thu, 01 Jan 1970/i.test(cookie)) jar.delete(key); else jar.set(key, value);
    }
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (data && typeof data === 'object' && typeof data.csrfToken === 'string') csrf = data.csrfToken;
    return { status: response.status, body: data, location: response.headers.get('location') };
  }
  return { call, jar, resetCsrf: () => { csrf = null; } };
}

function tokenFrom(address, kind = 'verify-email') {
  const mail = [...mails].reverse().find((item) => item.to.includes(address));
  assert.ok(mail, `an e-mail was delivered to ${address}`);
  const decoded = mail.data.replace(/=\r?\n/g, '').replace(/=3D/gi, '=');
  const match = decoded.match(new RegExp(`${kind}\\?token=([A-Za-z0-9_\\-%.~]+)`));
  assert.ok(match, `the e-mail contains a ${kind} link`);
  return decodeURIComponent(match[1]);
}

async function registeredUser(name) {
  const c = client();
  const email = emailFor(name);
  const reg = await c.call('POST', '/api/auth/register', { fullName: `Test ${name}`, email, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true, language: 'en' });
  assert.equal(reg.status, 201, JSON.stringify(reg.body)); assert.equal(reg.body.verificationRequired, true);
  const early = await c.call('POST', '/api/auth/login', { email, password: PASSWORD });
  if (early.status === 200) { const blocked = await c.call('GET', '/api/workspace'); assert.equal(blocked.status, 403, 'an unverified account cannot read financial data'); }
  const verify = await c.call('POST', '/api/auth/verify-email', { token: tokenFrom(email) });
  assert.equal(verify.status, 200, JSON.stringify(verify.body));
  const login = await c.call('POST', '/api/auth/login', { email, password: PASSWORD });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  return { c, email, id: login.body.user.id, user: login.body.user };
}

const users = {};
const tx = (categoryId, amount, title) => ({ id: crypto.randomUUID(), title, amount, type: 'expense', categoryId, date: '2026-11-10', description: '' });
const expenseCategory = (state) => state.categories.find((item) => item.type === 'expense').id;

test.after(async () => {
  try {
    const rows = await query('SELECT id FROM mt_profiles WHERE email LIKE ?', [`mt-it-${RUN}-%@example.test`]);
    for (const row of rows) await transaction((conn) => deleteAccount(conn, row.id));
    const left = await query('SELECT COUNT(*) AS n FROM mt_profiles WHERE email LIKE ?', [`mt-it-${RUN}-%@example.test`]);
    assert.equal(Number(left[0].n), 0, 'all integration accounts were removed');
    await query('DELETE FROM mt_contact_messages WHERE email LIKE ?', [`mt-it-${RUN}-%@example.test`]);
  } finally {
    await new Promise((resolve) => httpServer.close(resolve));
    await new Promise((resolve) => smtp.close(resolve));
    setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
  }
});

test('registration requires e-mail verification, then login returns a USER role', async () => {
  users.a = await registeredUser('a');
  users.b = await registeredUser('b');
  users.c = await registeredUser('c');
  assert.equal(users.a.user.role, 'USER'); assert.equal(users.b.user.role, 'USER');
  const duplicate = await client().call('POST', '/api/auth/register', { fullName: 'Duplicate', email: users.a.email, password: PASSWORD, confirmPassword: PASSWORD, acceptTerms: true });
  assert.equal(duplicate.status, 409);
  const wrong = await client().call('POST', '/api/auth/login', { email: users.a.email, password: `${PASSWORD}x` });
  assert.equal(wrong.status, 401); assert.equal(wrong.body.error.code, 'INVALID_CREDENTIALS');
});

test('user A financial data is invisible and immutable to user B', async () => {
  const a = users.a, b = users.b;
  const wsA = await a.c.call('GET', '/api/workspace'); assert.equal(wsA.status, 200); assert.equal(wsA.body.ownerId, a.id);
  const secret = tx(expenseCategory(wsA.body.state), 4321.5, 'A private rent');
  wsA.body.state.transactions.push(secret);
  const saved = await a.c.call('PUT', '/api/workspace', { state: wsA.body.state, revision: wsA.body.revision, accountId: a.id });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));

  const wsB = await b.c.call('GET', '/api/workspace'); assert.equal(wsB.status, 200); assert.equal(wsB.body.ownerId, b.id);
  assert.ok(!JSON.stringify(wsB.body).includes('A private rent'));
  assert.ok(!wsB.body.state.transactions.some((item) => item.id === secret.id));

  const crossAccount = await b.c.call('PUT', '/api/workspace', { state: wsB.body.state, revision: wsB.body.revision, accountId: a.id });
  assert.ok(crossAccount.status >= 400 && crossAccount.status < 500, 'B cannot write with A\'s account id');

  const collision = structuredClone(wsB.body.state);
  collision.transactions.push({ ...secret, title: 'Overwritten by B', amount: 1 });
  const collide = await b.c.call('PUT', '/api/workspace', { state: collision, revision: wsB.body.revision, accountId: b.id });
  assert.ok([200, 400, 409].includes(collide.status));
  const after = await a.c.call('GET', '/api/workspace');
  const original = after.body.state.transactions.find((item) => item.id === secret.id);
  assert.equal(original.title, 'A private rent'); assert.equal(original.amount, 4321.5);
});

test('goals, recurring rules and notifications cannot be changed through another account', async () => {
  const a = users.a, b = users.b;
  const goal = await a.c.call('POST', '/api/goals', { title: 'A emergency fund', targetAmount: 10000, targetDate: '2027-12-31' });
  assert.ok([200, 201].includes(goal.status), JSON.stringify(goal.body));
  const goalId = goal.body.goal?.id || goal.body.id; assert.ok(goalId);
  assert.equal((await b.c.call('PATCH', `/api/goals/${goalId}`, { title: 'Hijacked' })).status, 404);
  assert.equal((await b.c.call('POST', `/api/goals/${goalId}/contributions`, { amount: 5, date: '2026-11-10' })).status, 404);
  assert.equal((await b.c.call('DELETE', `/api/goals/${goalId}`, { confirm: 'DELETE' })).status, 404);
  const stillThere = await a.c.call('GET', '/api/workspace');
  assert.ok(stillThere.body.state.goals.some((item) => item.id === goalId && item.title === 'A emergency fund'));
  assert.equal((await b.c.call('PATCH', `/api/recurring/${crypto.randomUUID()}`, { active: false })).status, 404);
  const notes = stillThere.body.state.notifications || [];
  for (const note of notes.slice(0, 1)) {
    await b.c.call('DELETE', `/api/notifications/${note.id}`, {});
    await b.c.call('PATCH', `/api/notifications/${note.id}`, { read: true });
    const again = await a.c.call('GET', '/api/workspace');
    const kept = again.body.state.notifications.find((item) => item.id === note.id);
    assert.ok(kept, 'B cannot delete A\'s notification'); assert.equal(Boolean(kept.read), Boolean(note.read));
  }
});

test('owners can edit their own goals, recurring rules and alerts; a deleted alert stays deleted', async () => {
  const a = users.a;
  let ws = (await a.c.call('GET', '/api/workspace')).body;
  const goal = ws.state.goals.find((item) => item.title === 'A emergency fund');
  assert.equal((await a.c.call('PATCH', `/api/goals/${goal.id}`, { title: 'A emergency fund v2' })).status, 200);
  const contribution = await a.c.call('POST', `/api/goals/${goal.id}/contributions`, { amount: 10000, date: '2026-11-10' });
  assert.ok([200, 201].includes(contribution.status), JSON.stringify(contribution.body));

  // Budget alert is generated straight from the PUT response (4321.5 spent of a 1000 budget).
  ws = (await a.c.call('GET', '/api/workspace')).body;
  const state = structuredClone(ws.state); state.budgets = { '2026-11': { total: 1000, categories: {} } };
  const started = Date.now();
  const put = await a.c.call('PUT', '/api/workspace', { state, revision: ws.revision, accountId: a.id });
  const putMs = Date.now() - started;
  assert.equal(put.status, 200, JSON.stringify(put.body));
  console.log(`# workspace PUT took ${putMs} ms`);
  const stale = await a.c.call('PUT', '/api/workspace', { state, revision: ws.revision, accountId: a.id });
  assert.equal(stale.status, 409, 'a stale revision is rejected');
  const budgetAlert = put.body.state.notifications.find((item) => item.type === 'budget' && item.body.month === '2026-11' && item.body.severity === '100');
  const goalAlert = put.body.state.notifications.find((item) => item.type === 'goal' && item.body.goalId === goal.id);
  assert.ok(budgetAlert, 'an exceeded budget raises an alert'); assert.ok(goalAlert, 'a reached goal raises an alert');

  assert.equal((await a.c.call('PATCH', `/api/notifications/${budgetAlert.id}`, { read: true })).status, 200);
  assert.equal((await a.c.call('DELETE', `/api/notifications/${budgetAlert.id}`, {})).status, 200);
  assert.equal((await a.c.call('DELETE', `/api/notifications/${goalAlert.id}`, {})).status, 200);
  ws = (await a.c.call('GET', '/api/workspace')).body;
  assert.ok(!ws.state.notifications.some((item) => item.id === budgetAlert.id || item.id === goalAlert.id), 'deleted alerts do not come back');
  assert.ok(!ws.state.notifications.some((item) => item.type === 'budget' && item.body.month === '2026-11' && item.body.severity === '100'));

  const saved = ws.state.goals.find((item) => item.id === goal.id);
  assert.equal(saved.title, 'A emergency fund v2'); assert.equal(saved.currentAmount, 10000);
  assert.equal((await a.c.call('DELETE', `/api/goals/${goal.id}/contributions/${saved.contributions[0].id}`, {})).status, 200);

  const categoryId = ws.state.categories.find((item) => item.type === 'expense').id;
  const rule = await a.c.call('POST', '/api/recurring', { title: 'A gym', amount: 300, type: 'expense', categoryId, frequency: 'monthly', startDate: '2030-01-01' });
  assert.ok([200, 201].includes(rule.status), JSON.stringify(rule.body));
  const ruleId = rule.body.id || rule.body.rule?.id; assert.ok(ruleId);
  assert.equal((await a.c.call('PATCH', `/api/recurring/${ruleId}`, { active: false, amount: 350 })).status, 200);
  ws = (await a.c.call('GET', '/api/workspace')).body;
  const storedRule = ws.state.recurring.find((item) => item.id === ruleId);
  assert.equal(storedRule.amount, 350); assert.equal(storedRule.active, false);
  assert.equal((await a.c.call('DELETE', `/api/recurring/${ruleId}`, { confirm: 'DELETE' })).status, 200);
  assert.equal((await a.c.call('DELETE', `/api/goals/${goal.id}`, { confirm: 'DELETE' })).status, 200);
});

test('a USER cannot open the admin area, call admin APIs or promote themselves', async () => {
  const b = users.b;
  assert.equal((await b.c.call('GET', '/api/admin/overview')).status, 403);
  assert.equal((await b.c.call('GET', '/api/admin/users')).status, 403);
  const promote = await b.c.call('PATCH', `/api/admin/users/${b.id}/role`, { role: 'SUPER_ADMIN', permissions: [] });
  assert.equal(promote.status, 403);
  const html = await b.c.call('GET', '/admin'); assert.equal(html.status, 403);
  const me = await b.c.call('GET', '/api/auth/me'); assert.equal(me.body.user.role, 'USER');
  const anonymous = client();
  assert.equal((await anonymous.call('GET', '/api/admin/users')).status, 401);
  assert.equal((await anonymous.call('GET', '/api/workspace')).status, 401);
  const redirect = await anonymous.call('GET', '/app'); assert.equal(redirect.status, 302); assert.match(redirect.location, /\/login$/);
});

test('an ADMIN can view and suspend users without seeing their finances; a suspended session stops working', async () => {
  const b = users.b, c = users.c;
  await query("UPDATE mt_user_roles SET role='ADMIN', permissions_json=? WHERE user_id=?", [JSON.stringify(['users.view', 'users.manage', 'content.manage', 'logs.view']), c.id]);
  const list = await c.c.call('GET', `/api/admin/users?search=${encodeURIComponent(`mt-it-${RUN}`)}`);
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const text = JSON.stringify(list.body);
  assert.ok(text.includes(b.email)); assert.ok(!text.includes('A private rent')); assert.ok(!/password_hash|passwordHash|token_hash|scrypt\$/i.test(text), 'no password or token hashes are exposed');
  const roleChange = await c.c.call('PATCH', `/api/admin/users/${b.id}/role`, { role: 'ADMIN', permissions: [] });
  assert.equal(roleChange.status, 403, 'only SUPER_ADMIN changes roles');

  assert.equal((await b.c.call('GET', '/api/workspace')).status, 200);
  const suspend = await c.c.call('PATCH', `/api/admin/users/${b.id}/status`, { status: 'suspended' });
  assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
  assert.equal((await b.c.call('GET', '/api/workspace')).status, 401, 'the old session is rejected after suspension');
  const relogin = await client().call('POST', '/api/auth/login', { email: b.email, password: PASSWORD });
  assert.equal(relogin.status, 403); assert.equal(relogin.body.error.code, 'ACCOUNT_SUSPENDED');
  const logs = await c.c.call('GET', '/api/admin/logs');
  assert.equal(logs.status, 200); assert.ok(logs.body.logs.some((item) => item.action === 'admin.user.suspended' && item.targetId === b.id));
});

test('contact messages are stored for admins and can be marked read and deleted', async () => {
  const visitor = client();
  const sent = await visitor.call('POST', '/api/public/contact', { name: 'Integration visitor', email: emailFor('visitor'), message: `Integration message ${RUN}`, website: '' });
  assert.ok([200, 201].includes(sent.status), JSON.stringify(sent.body));
  const inbox = await users.c.c.call('GET', '/api/admin/messages');
  const message = inbox.body.messages.find((item) => item.message === `Integration message ${RUN}`);
  assert.ok(message);
  assert.equal((await users.c.c.call('PATCH', `/api/admin/messages/${message.id}`, { status: 'read' })).status, 200);
  assert.equal((await users.c.c.call('DELETE', `/api/admin/messages/${message.id}`, { confirm: 'DELETE' })).status, 200);
});

test('password reset uses a single-use e-mailed token and revokes existing sessions', async () => {
  const c = users.c;
  const request = await client().call('POST', '/api/auth/forgot-password', { email: c.email, language: 'en' });
  assert.equal(request.status, 200);
  const token = tokenFrom(c.email, 'reset-password');
  const next = `${PASSWORD}-new`;
  const reset = await client().call('POST', '/api/auth/reset-password', { token, password: next, confirmPassword: next });
  assert.equal(reset.status, 200, JSON.stringify(reset.body));
  assert.equal((await client().call('POST', '/api/auth/reset-password', { token, password: next, confirmPassword: next })).status, 400);
  assert.equal((await c.c.call('GET', '/api/auth/me')).body.user, null, 'old sessions end after a reset');
  assert.equal((await c.c.call('GET', '/api/admin/users')).status, 401);
  assert.equal((await client().call('POST', '/api/auth/login', { email: c.email, password: next })).status, 200);
});

test('a user with financial data can delete their own account', async () => {
  const a = users.a;
  const wrong = await a.c.call('DELETE', '/api/auth/account', { confirm: 'DELETE', currentPassword: 'not-the-password' });
  assert.equal(wrong.status, 401);
  const deleted = await a.c.call('DELETE', '/api/auth/account', { confirm: 'DELETE', currentPassword: PASSWORD });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  const rows = await query('SELECT COUNT(*) AS n FROM mt_transactions WHERE user_id=?', [a.id]);
  assert.equal(Number(rows[0].n), 0);
  assert.equal((await client().call('POST', '/api/auth/login', { email: a.email, password: PASSWORD })).status, 401);
});
