// Read-only deployment checks: no fixtures or financial writes in the shared database.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../../server/index.js';
import { closePool } from '../../server/db.js';
import { VERSION } from '../../js/version.js';

let server;
let base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await closePool();
});

test('Health exposes the real application version without sensitive diagnostics', async () => {
  const response = await fetch(`${base}/api/health`);
  assert.ok([200, 503].includes(response.status));
  const body = await response.json();
  assert.equal(body.version, VERSION);
  assert.equal(body.ok, response.status === 200);
  assert.deepEqual(Object.keys(body).sort(), ['ok', 'version']);
  assert.match(response.headers.get('cache-control'), /no-store/);
});

test('Public config uses the same version and only browser-safe fields', async () => {
  const response = await fetch(`${base}/api/public/config`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.version, VERSION);
  assert.equal(typeof body.emailConfigured, 'boolean');
  assert.deepEqual(Object.keys(body).sort(), ['emailConfigured', 'version']);
});

test('Anonymous application access still redirects to login', async () => {
  const response = await fetch(`${base}/app`, { redirect: 'manual' });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});
