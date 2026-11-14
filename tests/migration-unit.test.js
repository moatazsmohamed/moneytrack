import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSqlStatements } from '../server/sql-statements.js';
import { diffById, persistedCategory, persistedTransaction } from '../server/domain-helpers.js';

test('migration SQL splits statements but not quoted semicolons or comments', () => {
  assert.deepEqual(splitSqlStatements("-- ignored ;\nCREATE TABLE `x;y` (note VARCHAR(40)); INSERT INTO `x;y` VALUES ('a;b'); /* ; */ SELECT 1;"), ["CREATE TABLE `x;y` (note VARCHAR(40))", "INSERT INTO `x;y` VALUES ('a;b')", 'SELECT 1']);
});
test('migration SQL handles escaped and doubled quotes and rejects incomplete input', () => {
  assert.equal(splitSqlStatements("INSERT INTO t VALUES ('a'';b'); SELECT 1").length, 2);
  assert.throws(() => splitSqlStatements("SELECT 'broken"), SyntaxError);
  assert.throws(() => splitSqlStatements('/* broken'), SyntaxError);
});
test('the complete initial schema is split into individual CREATE statements', () => {
  const sql = fs.readFileSync(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8');
  const parts = splitSqlStatements(sql);
  assert.ok(parts.length > 15);
  assert.ok(parts.every(part => /^CREATE TABLE IF NOT EXISTS\b/.test(part)));
});
test('category display metadata and timestamps do not cause rewrites', () => {
  const before = { id: 'a', names: { en: 'Food', ar: 'طعام' }, type: 'expense', icon: 'utensils', color: '#10b981', usedByRecurring: 2, createdAt: '2026-01-01' };
  const after = { ...before, usedByRecurring: 0, createdAt: undefined };
  assert.equal(diffById([before], [after], persistedCategory).updated.length, 0);
  assert.equal(diffById([before], [{ ...after, color: '#000000' }], persistedCategory).updated.length, 1);
});
test('transaction diffs write only actual changes and preserve created/deleted rows', () => {
  const row = { id: 'a', categoryId: 'c', title: 'Coffee', amount: 45, type: 'expense', date: '2026-11-14' };
  assert.equal(diffById([row], [{ ...row, description: '', demo: false, updatedAt: 'today' }], persistedTransaction).updated.length, 0);
  const diff = diffById([row], [{ ...row, amount: 46 }, { ...row, id: 'b' }], persistedTransaction);
  assert.equal(diff.updated.length, 1); assert.equal(diff.created.length, 1);
  assert.equal(diffById([row], [], persistedTransaction).deleted.length, 1);
});
