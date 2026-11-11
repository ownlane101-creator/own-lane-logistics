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
import { statXP, pickDaily, weekId, weekDays, doneIn } from './lib.js';
test('stats, daily and weekly picks', () => {
  const log = { '2026-11-10': { a: 10, f1: 15 }, '2026-11-11': { b: 20, zzz: 5 } };
  const cat = { a: 'body', b: 'mind', f1: 'mind' };
  assert.deepEqual(statXP(log, id => cat[id]), { body: 10, mind: 35, social: 0, grit: 5 });
  const l = ['x', 'y', 'z'], d = new Date('2026-11-11T08:00');
  assert.equal(pickDaily(l, d), pickDaily(l, new Date('2026-11-11T23:00')));
  assert.notEqual(pickDaily(l, d), pickDaily(l, new Date('2026-11-12T08:00')));
  const wk = weekDays(d);
  assert.equal(wk[0].getDay(), 1); assert.equal(wk[6].getDay(), 0);
  assert.ok(wk.every(x => weekId(x) === weekId(d)));
  assert.notEqual(weekId(new Date('2026-11-16T08:00')), weekId(d));
  assert.ok(doneIn(log, 'a', wk)); assert.ok(!doneIn(log, 'q', wk));
});
