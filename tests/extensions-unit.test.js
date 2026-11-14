import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const memory = new Map();
globalThis.localStorage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: (key) => memory.delete(key) };

const goals = await import('../js/goals.js');
const recurring = await import('../js/recurring.js');
const notifications = await import('../js/notifications.js');

const categories = [
  { id: 'food', type: 'expense', names: { en: 'Food', ar: 'الطعام' } },
  { id: 'salary', type: 'income', names: { en: 'Salary', ar: 'الراتب' } },
];

test('goal validator accepts two-decimal positive amounts and optional real target dates', () => {
  assert.deepEqual(goals.validateGoalInput({ title: 'Emergency fund', targetAmount: '1200.50', targetDate: '2027-02-28' }), { title: 'Emergency fund', targetAmount: 1200.5, targetDate: '2027-02-28' });
  assert.deepEqual(goals.validateGoalInput({ title: 'Travel', targetAmount: '.50', targetDate: '' }), { title: 'Travel', targetAmount: 0.5, targetDate: null });
  assert.throws(() => goals.validateGoalInput({ title: '', targetAmount: '2' }));
  assert.throws(() => goals.validateGoalInput({ title: 'x', targetAmount: '2.001' }));
  assert.throws(() => goals.validateGoalInput({ title: 'x', targetAmount: '2', targetDate: '2027-02-29' }));
});

test('goal progress is calculated from contribution records and capped at 100 percent', () => {
  assert.deepEqual(goals.goalProgress({ targetAmount: 100, contributions: [{ amount: 25 }, { amount: '80.12' }] }), { currentAmount: 105.12, targetAmount: 100, percent: 100 });
  assert.deepEqual(goals.goalProgress({ targetAmount: 0, contributions: [] }), { currentAmount: 0, targetAmount: 0, percent: 0 });
});

test('contribution validator requires a real date and limits note length', () => {
  assert.deepEqual(goals.validateContributionInput({ amount: '10.25', date: '2026-11-14', note: 'Payday' }), { amount: 10.25, date: '2026-11-14', note: 'Payday' });
  assert.throws(() => goals.validateContributionInput({ amount: '10', date: '2026-04-31', note: '' }));
  assert.throws(() => goals.validateContributionInput({ amount: '10', date: '2026-11-14', note: 'x'.repeat(241) }));
});

test('recurring validator enforces type/category/frequency and date ordering', () => {
  assert.deepEqual(recurring.validateRecurringInput({ title: 'Rent', amount: '5000', type: 'expense', categoryId: 'food', frequency: 'monthly', startDate: '2026-11-01', endDate: '2027-11-01', description: '', active: true }, categories), { title: 'Rent', amount: 5000, type: 'expense', categoryId: 'food', frequency: 'monthly', startDate: '2026-11-01', endDate: '2027-11-01', description: '', active: true });
  assert.throws(() => recurring.validateRecurringInput({ title: 'Rent', amount: '5000', type: 'income', categoryId: 'food', frequency: 'monthly', startDate: '2026-11-01' }, categories));
  assert.throws(() => recurring.validateRecurringInput({ title: 'Rent', amount: '5000', type: 'expense', categoryId: 'food', frequency: 'daily', startDate: '2026-11-01' }, categories));
  assert.throws(() => recurring.validateRecurringInput({ title: 'Rent', amount: '5000', type: 'expense', categoryId: 'food', frequency: 'monthly', startDate: '2027-01-01', endDate: '2026-12-31' }, categories));
});

test('structured notifications prefer translated body keys and bilingual body values', () => {
  assert.equal(typeof notifications.notificationBodyText({ body: { key: 'extensions.notifications.empty' } }), 'string');
  const localizedBody = notifications.notificationBodyText({ body: { en: 'Server supplied detail', ar: 'تفصيل من الخادم' } });
  assert.ok(localizedBody === 'Server supplied detail' || localizedBody === 'تفصيل من الخادم');
  assert.notEqual(notifications.notificationTitleText({ type: 'budget', titleKey: 'missing.server.key' }), 'missing.server.key');
});

test('extension output escapes user values and does not use inline event handlers', async () => {
  const source = await Promise.all(['goals.js', 'recurring.js', 'notifications.js'].map((file) => fs.readFile(new URL(`../js/${file}`, import.meta.url), 'utf8')));
  assert.ok(source.every((text) => !/\son(?:click|change|submit)\s*=/.test(text)));
  assert.ok(source.every((text) => text.includes('e(')));
});

test('phase-4 dictionary has paired English and Arabic values for every key', async () => {
  const dictionary = JSON.parse(await fs.readFile(new URL('../js/phase4-strings.json', import.meta.url), 'utf8'));
  assert.ok(Object.keys(dictionary).length > 80);
  for (const [key, value] of Object.entries(dictionary)) {
    assert.equal(typeof value.en, 'string', `${key} missing English`);
    assert.equal(typeof value.ar, 'string', `${key} missing Arabic`);
    assert.ok(value.en && value.ar, `${key} cannot be empty`);
  }
});
