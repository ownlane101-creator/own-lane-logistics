// Pure game logic for Grindset. Log shape: { 'YYYY-MM-DD': { habitId: xpEarned } }
export const TIERS = ['Iron', 'Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Legend'];
const DIVS = ['IV', 'III', 'II', 'I'];

export const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

export const totalXP = log => Object.values(log).reduce((s, day) => s + Object.values(day).reduce((a, b) => a + b, 0), 0);

// Level n -> n+1 costs 50*n XP, so early levels come fast and later ones take real work.
export function levelInfo(xp) {
  let level = 1, need = 50;
  while (xp >= need) { xp -= need; level++; need = 50 * level; }
  return { level, into: xp, need };
}

// 3 levels per division, 4 divisions per tier; Legend I is the top.
export function rankFor(level) {
  const i = Math.min(Math.floor((level - 1) / 3), TIERS.length * 4 - 1);
  return `${TIERS[Math.floor(i / 4)]} ${DIVS[i % 4]}`;
}

const done = (log, d) => Object.keys(log[dayKey(d)] || {}).length > 0;

// Days in a row with at least one habit done. Today not done yet doesn't break it.
export function streak(log, today) {
  let d = done(log, today) ? today : addDays(today, -1), n = 0;
  while (done(log, d)) { n++; d = addDays(d, -1); }
  return n;
}

export function bestStreak(log) {
  const days = Object.keys(log).filter(k => Object.keys(log[k]).length).sort();
  let best = 0, run = 0, prev = null;
  for (const k of days) {
    const d = new Date(k + 'T12:00');
    run = prev && dayKey(addDays(prev, 1)) === k ? run + 1 : 1;
    best = Math.max(best, run); prev = d;
  }
  return best;
}

export const STATS = { body: 'Body', mind: 'Mind', social: 'Social', grit: 'Grit' };

// XP per stat. catOf(id) maps a log entry id to a stat key.
export function statXP(log, catOf) {
  const out = { body: 0, mind: 0, social: 0, grit: 0 };
  for (const day of Object.values(log)) for (const [id, xp] of Object.entries(day)) out[catOf(id) in out ? catOf(id) : 'grit'] += xp;
  return out;
}

const dayNum = d => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
// Same pick for everyone on a given day/week; rotates through the list.
export const pickDaily = (list, d) => list[dayNum(d) % list.length];
export const weekId = d => Math.floor((dayNum(d) + 3) / 7); // weeks start Monday
export const pickWeekly = (list, d) => list[weekId(d) % list.length];

// Has a log entry with this id anywhere in the given days?
export const doneIn = (log, id, days) => days.some(d => log[dayKey(d)]?.[id] !== undefined);
export const weekDays = d => { const off = (d.getDay() + 6) % 7; return Array.from({ length: 7 }, (_, i) => addDays(d, i - off)); };
