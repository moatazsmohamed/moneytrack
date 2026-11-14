import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addFrequency,
  canonicalJson,
  coreState,
  deterministicUuid,
  emptyCore,
  isUuid,
  optionalText,
  sha256,
  validDate,
} from '../server/domain-helpers.js';

test('empty core is cloud-safe and uses UUID category IDs', () => {
  const state = emptyCore({ name: 'Unit test', language: 'en', theme: 'dark', currency: 'USD' });
  assert.equal(state.version, 1);
  assert.equal(state.prefs.name, 'Unit test');
  assert.equal(state.prefs.language, 'en');
  assert.equal(state.prefs.theme, 'dark');
  assert.ok(state.categories.every((category) => isUuid(category.id)));
  assert.deepEqual(coreState(state), state);
});

test('cloud core validation rejects legacy non-UUID IDs and broken references', () => {
  const state = emptyCore();
  state.transactions.push({ id: 'legacy-1', title: 'Lunch', amount: 10, type: 'expense', categoryId: state.categories[5].id, date: '2026-11-14', description: '' });
  assert.throws(() => coreState(state), /UUID/);
  state.transactions[0].id = deterministicUuid('test-user', 'transaction', 'legacy-1');
  assert.doesNotThrow(() => coreState(state));
  state.transactions[0].categoryId = deterministicUuid('other-user', 'category', 'food');
  assert.throws(() => coreState(state), /category reference/);
});

test('canonical JSON and scoped IDs are deterministic and collision-resistant by namespace', () => {
  assert.equal(canonicalJson({ b: 2, a: { d: 4, c: 3 } }), '{"a":{"c":3,"d":4},"b":2}');
  assert.equal(sha256({ a: 1, b: 2 }), sha256({ b: 2, a: 1 }));
  const first = deterministicUuid('user-a', 'transaction', 'old-1');
  assert.equal(first, deterministicUuid('user-a', 'transaction', 'old-1'));
  assert.notEqual(first, deterministicUuid('user-b', 'transaction', 'old-1'));
  assert.ok(isUuid(first));
});

test('recurring date advancement clamps month ends and preserves calendar dates', () => {
  assert.equal(validDate('2024-02-29'), '2024-02-29');
  assert.equal(addFrequency('2024-01-31', 'monthly'), '2024-02-29');
  assert.equal(addFrequency('2024-02-29', 'yearly'), '2025-02-28');
  assert.equal(addFrequency('2026-11-14', 'weekly'), '2026-11-21');
  assert.throws(() => validDate('2026-02-30'), /calendar date/);
});

test('optional text accepts omitted and empty values while enforcing limits', () => {
  assert.equal(optionalText(undefined, 'note', 10), '');
  assert.equal(optionalText(null, 'description', 10, null), null);
  assert.equal(optionalText('   ', 'note', 10), '');
  assert.equal(optionalText('  hello  ', 'note', 10), 'hello');
  assert.throws(() => optionalText('too long', 'note', 3), /invalid/);
  assert.throws(() => optionalText(42, 'note', 10), /invalid/);
});

test('core validator keeps extension metadata outside the legacy validation contract', () => {
  const state = emptyCore();
  state.goals = [];
  state.recurring = [];
  state.notifications = [];
  state.notificationPrefs = { budget: true, recurring: true, goals: true, security: true };
  assert.doesNotThrow(() => coreState(state));
});
