import { test } from 'node:test';
import assert from 'node:assert/strict';
import { levelInfo, rankFor, streak, bestStreak, totalXP } from './lib.js';

test('levels', () => {
  assert.deepEqual(levelInfo(0), { level: 1, into: 0, need: 50 });
  assert.deepEqual(levelInfo(50), { level: 2, into: 0, need: 100 });
  assert.deepEqual(levelInfo(160), { level: 3, into: 10, need: 150 });
});
test('ranks', () => {
  assert.equal(rankFor(1), 'Iron IV');
  assert.equal(rankFor(4), 'Iron III');
  assert.equal(rankFor(13), 'Bronze IV');
  assert.equal(rankFor(999), 'Legend I');
});
test('streaks and xp', () => {
  const log = { '2026-11-08': { a: 10 }, '2026-11-09': { a: 10 }, '2026-11-10': { a: 10, b: 20 }, '2026-11-05': { a: 10 } };
  const today = new Date('2026-11-11T09:00');
  assert.equal(streak(log, today), 3);
  log['2026-11-11'] = { a: 10 };
  assert.equal(streak(log, today), 4);
  assert.equal(streak(log, new Date('2026-11-13T09:00')), 0);
  assert.equal(bestStreak(log), 4);
  assert.equal(totalXP(log), 70);
});
