import { dayKey, addDays, totalXP, levelInfo, rankFor, streak, bestStreak, TIERS, STATS, statXP, pickDaily, pickWeekly, weekId, weekDays, doneIn } from './lib.js';
import { DAILY, WEEKLY, LINES, PROMPTS, STARTER, TIER_COLORS, THEMES } from './content.js';

const KEY = 'grit-v1';
const STARTER_CAT = Object.fromEntries(STARTER.map(([n, , c]) => [n, c]));
let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch {}
if (!state?.habits) state = { habits: STARTER.map(([name, xp, cat], i) => ({ id: 'h' + i, name, xp, cat })), log: {}, next: STARTER.length };
// Fill in fields added after the first version.
state.habits.forEach(h => { h.cat ||= STARTER_CAT[h.name] || 'grit'; });
state.journal ||= {}; state.goals ||= []; state.theme ||= 'gold'; state.sound ??= true;
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

const $ = id => document.getElementById(id);
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const active = () => state.habits.filter(h => !h.gone);
let selected = new Date(), editing = false;
const isToday = d => dayKey(d) === dayKey(new Date());

// Log ids: habit id, 'd:<cat>' daily quest, 'w<week>:<cat>' weekly, 'f<n>' focus, 'b' breathing, 'j' journal, 'g<id>' goal.
const MIND = new Set(['b', 'j']);
function catOf(id) {
  if (id.includes(':')) return id.split(':')[1];
  if (MIND.has(id) || /^f\d/.test(id)) return 'mind';
  if (/^g\d/.test(id)) return 'grit';
  return state.habits.find(h => h.id === id)?.cat || 'grit';
}

let ctx;
function beep(up) {
  if (!state.sound) return;
  try {
    ctx ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.setValueAtTime(up ? 523 : 660, t);
    if (up) { o.frequency.setValueAtTime(659, t + .12); o.frequency.setValueAtTime(784, t + .24); }
    g.gain.setValueAtTime(.15, t); g.gain.exponentialRampToValueAtTime(.001, t + (up ? .5 : .15));
    o.connect(g).connect(ctx.destination); o.start(t); o.stop(t + .5);
  } catch {}
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1900);
}

// Add or remove XP for one log entry, with level-up feedback.
function award(id, xp, date = new Date(), msg) {
  const k = dayKey(date), before = levelInfo(totalXP(state.log)).level;
  const day = state.log[k] ||= {};
  if (xp) day[id] = xp; else delete day[id];
  if (!Object.keys(day).length) delete state.log[k];
  save();
  const after = levelInfo(totalXP(state.log)).level;
  if (after > before) { beep(true); toast(`Level up! Lv ${after} · ${rankFor(after)}`); }
  else if (xp) { beep(); toast(msg || `+${xp} XP`); }
  render();
}

function renderToday() {
  const today = new Date(), xp = totalXP(state.log), L = levelInfo(xp), tier = TIERS.indexOf(rankFor(L.level).split(' ')[0]);
  $('lvl').textContent = `Lv ${L.level}`;
  $('rank').textContent = rankFor(L.level);
  $('rank').style.color = $('badge').style.color = TIER_COLORS[tier];
  $('badgeTxt').textContent = rankFor(L.level).split(' ')[1];
  $('bar').style.width = (100 * L.into / L.need) + '%';
  $('xpTotal').textContent = `${xp} XP total`;
  $('xpNext').textContent = `${L.need - L.into} XP to Lv ${L.level + 1}`;
  $('streak').textContent = `${streak(state.log, today)} 🔥`;

  const habits = active(), n = habits.length;
  $('week').innerHTML = '';
  for (let i = -6; i <= 0; i++) {
    const d = addDays(today, i), day = state.log[dayKey(d)] || {}, done = habits.filter(h => day[h.id]).length;
    const b = document.createElement('button');
    b.className = (n && done === n ? 'full' : done ? 'part' : '') + (dayKey(d) === dayKey(selected) ? ' sel' : '');
    b.innerHTML = `${d.toLocaleDateString(undefined, { weekday: 'short' })}<div class="dot">${n && done === n ? '✓' : done || ''}</div>`;
    b.onclick = () => { selected = d; render(); };
    $('week').append(b);
  }

  const day = state.log[dayKey(selected)] || {};
  $('dayTitle').textContent = isToday(selected) ? 'Today' : selected.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('list').classList.toggle('editing', editing);
  $('editBtn').textContent = editing ? 'Done' : 'Edit';
  $('habits').innerHTML = n ? '' : '<div class="empty">Add your first habit below.</div>';
  for (const h of habits) {
    const row = document.createElement('div');
    row.className = 'habit' + (day[h.id] ? ' on' : '');
    row.innerHTML = `<button class="check" aria-label="Done">${day[h.id] ? '✓' : ''}</button><span class="name">${esc(h.name)}</span><span class="tag">${STATS[h.cat]}</span><span class="xp">+${h.xp}</span><button class="del" aria-label="Delete">✕</button>`;
    row.querySelector('.check').onclick = () => toggle(h);
    row.querySelector('.del').onclick = () => {
      if (confirm(`Delete "${h.name}"? XP you already earned stays.`)) { h.gone = true; save(); render(); }
    };
    $('habits').append(row);
  }
}

function toggle(h) {
  const k = dayKey(selected), on = !(state.log[k] || {})[h.id];
  // Remember perfect days so deleting a habit later doesn't erase them.
  const day = { ...(state.log[k] || {}) }; if (on) day[h.id] = h.xp; else delete day[h.id];
  const perfect = new Set(state.perfect || []);
  const isPerfect = active().every(x => day[x.id]);
  isPerfect ? perfect.add(k) : perfect.delete(k);
  state.perfect = [...perfect];
  award(h.id, on ? h.xp : 0, selected, isPerfect && on ? 'Perfect day 💯' : undefined);
}

function renderQuests() {
  const today = new Date(), [dq, dcat, dxp] = pickDaily(DAILY, today), [wq, wcat, wxp] = pickWeekly(WEEKLY, today);
  const did = id => doneIn(state.log, id, [today]);
  $('dq').textContent = dq; $('dqXp').textContent = `+${dxp} XP · ${STATS[dcat]}`;
  $('dqBtn').textContent = did('d:' + dcat) ? 'Completed ✓' : 'Done';
  $('dqBtn').onclick = () => award('d:' + dcat, did('d:' + dcat) ? 0 : dxp, today, `Challenge done! +${dxp} XP`);
  const wid = `w${weekId(today)}:${wcat}`, wdone = doneIn(state.log, wid, weekDays(today));
  $('wq').textContent = wq; $('wqXp').textContent = `+${wxp} XP · ${STATS[wcat]}`;
  $('wqBtn').textContent = wdone ? 'Completed ✓' : 'Done';
  $('wqBtn').disabled = wdone && !did(wid); // undo only on the day it was marked
  $('wqBtn').onclick = () => award(wid, wdone ? 0 : wxp, today, `Weekly challenge done! +${wxp} XP`);
  const left = 7 - ((today.getDay() + 6) % 7);
  $('wqLeft').textContent = `${left} day${left > 1 ? 's' : ''} left · new challenge every Monday`;

  $('goals').innerHTML = state.goals.length ? '' : '<div class="empty">No goals yet.</div>';
  for (const g of state.goals) {
    const row = document.createElement('div');
    row.className = 'habit' + (g.done ? ' on' : '');
    row.innerHTML = `<button class="check" aria-label="Done">${g.done ? '✓' : ''}</button><span class="name">${esc(g.text)}</span><button class="del" style="display:block" aria-label="Delete">✕</button>`;
    row.querySelector('.check').onclick = () => {
      const was = g.done;
      g.done = was ? null : dayKey(today);
      award('g' + g.id, was ? 0 : 100, was ? new Date(was + 'T12:00') : today, 'Goal crushed! +100 XP');
    };
    row.querySelector('.del').onclick = () => { if (confirm('Delete this goal?')) { state.goals = state.goals.filter(x => x !== g); save(); render(); } };
    $('goals').append(row);
  }
}

// Focus timer keeps its end time in storage so it survives the phone locking.
const MINS = [15, 25, 45, 60];
let focusMin = 25, tick;
function renderFocus() {
  $('mins').innerHTML = '';
  for (const m of MINS) {
    const b = document.createElement('button'); b.textContent = m + ' min';
    b.className = m === focusMin ? 'sel' : ''; b.disabled = !!state.focus;
    b.onclick = () => { focusMin = m; renderFocus(); };
    $('mins').append(b);
  }
  $('focusBtn').textContent = state.focus ? 'Give up' : 'Start';
  updateTimer();
}
function updateTimer() {
  const f = state.focus;
  const left = f ? Math.max(0, f.end - Date.now()) : focusMin * 60000;
  $('timer').textContent = `${Math.floor(left / 60000)}:${String(Math.floor(left / 1000) % 60).padStart(2, '0')}`;
  if (f && left === 0) {
    state.focus = null; clearInterval(tick);
    const day = state.log[dayKey(new Date())] || {}, n = Object.keys(day).filter(k => /^f\d/.test(k)).length;
    award('f' + n, f.min, new Date(), `Focus session done! +${f.min} XP`);
  }
}
$('focusBtn').onclick = () => {
  if (state.focus) { if (!confirm('Give up this session? No XP.')) return; state.focus = null; clearInterval(tick); }
  else { state.focus = { end: Date.now() + focusMin * 60000, min: focusMin }; tick = setInterval(updateTimer, 500); beep(); }
  save(); renderFocus();
};
if (state.focus) tick = setInterval(updateTimer, 500);

let breathing = false;
$('breathBtn').onclick = async () => {
  if (breathing) return;
  breathing = true; $('breathBtn').disabled = true;
  const steps = [['Breathe in', true], ['Hold', true], ['Breathe out', false], ['Hold', false]];
  for (let r = 1; r <= 4; r++) for (const [txt, big] of steps) {
    $('breathTxt').textContent = `${txt} · round ${r} of 4`;
    $('breath').classList.toggle('big', big);
    await new Promise(res => setTimeout(res, 4000));
  }
  breathing = false; $('breathBtn').disabled = false;
  $('breathTxt').textContent = 'Nice. Calm and locked in.';
  if (!doneIn(state.log, 'b', [new Date()])) award('b', 10, new Date(), 'Breathing done +10 XP');
};

function renderJournal() {
  const k = dayKey(new Date());
  $('jDate').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('prompt').textContent = pickDaily(PROMPTS, new Date());
  if (document.activeElement !== $('journal')) $('journal').value = state.journal[k] || '';
  const past = Object.keys(state.journal).filter(d => d !== k && state.journal[d].trim()).sort().reverse().slice(0, 30);
  $('past').innerHTML = past.length ? past.map(d => `<details class="habit" style="display:block"><summary>${new Date(d + 'T12:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</summary><p style="white-space:pre-wrap">${esc(state.journal[d])}</p></details>`).join('') : '<div class="empty">Your entries will show up here.</div>';
}
$('journal').oninput = () => {
  const k = dayKey(new Date()), text = $('journal').value;
  state.journal[k] = text; save(); $('jSaved').textContent = 'Saved';
  if (text.trim().split(/\s+/).length >= 20 && !doneIn(state.log, 'j', [new Date()])) award('j', 15, new Date(), 'Journal +15 XP');
};

function renderMe() {
  const s = statXP(state.log, catOf), max = Math.max(100, ...Object.values(s));
  $('stats').innerHTML = Object.entries(STATS).map(([k, label]) =>
    `<div class="statrow"><div class="row"><span>${label}</span><span class="sub">${s[k]} XP · Lv ${levelInfo(s[k]).level}</span></div><div class="bar"><i style="width:${100 * s[k] / max}%"></i></div></div>`).join('');
  $('best').textContent = bestStreak(state.log);
  $('checks').textContent = Object.values(state.log).reduce((n, d) => n + Object.keys(d).filter(id => state.habits.some(h => h.id === id)).length, 0);
  $('perfect').textContent = state.perfect?.length || 0;
  const cur = TIERS.indexOf(rankFor(levelInfo(totalXP(state.log)).level).split(' ')[0]);
  $('ladder').innerHTML = TIERS.map((t, i) => `<div class="${i === cur ? 'me' : ''}"><span style="color:${TIER_COLORS[i]}">⬢ ${t}</span><span>Lv ${i * 12 + 1}${i === cur ? ' · you' : ''}</span></div>`).join('');
  $('swatches').innerHTML = '';
  for (const [name, color] of Object.entries(THEMES)) {
    const b = document.createElement('button'); b.style.background = color; b.ariaLabel = name;
    b.className = state.theme === name ? 'sel' : '';
    b.onclick = () => { state.theme = name; save(); render(); };
    $('swatches').append(b);
  }
  $('soundBtn').textContent = state.sound ? 'On' : 'Off';
}
$('soundBtn').onclick = () => { state.sound = !state.sound; save(); render(); };
$('exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state)], { type: 'application/json' }));
  a.download = `grindset-backup-${dayKey(new Date())}.json`; a.click();
};
$('importBtn').onclick = () => $('importFile').click();
$('importFile').onchange = async e => {
  try {
    const data = JSON.parse(await e.target.files[0].text());
    if (!Array.isArray(data.habits) || typeof data.log !== 'object') throw 0;
    if (!confirm('Replace everything on this phone with this backup?')) return;
    localStorage.setItem(KEY, JSON.stringify(data)); location.reload();
  } catch { alert("That file isn't a Grindset backup."); }
};

function render() {
  document.documentElement.style.setProperty('--gold', THEMES[state.theme]);
  $('line').textContent = pickDaily(LINES, new Date());
  renderToday(); renderQuests(); renderFocus(); renderJournal(); renderMe();
}

$('add').onsubmit = e => {
  e.preventDefault();
  const name = $('newName').value.trim();
  if (!name) return;
  state.habits.push({ id: 'h' + state.next++, name, xp: +$('newXp').value, cat: $('newCat').value });
  $('newName').value = ''; save(); render();
};
$('addGoal').onsubmit = e => {
  e.preventDefault();
  const text = $('goalText').value.trim();
  if (!text) return;
  state.goals.push({ id: state.next++, text }); $('goalText').value = ''; save(); render();
};
$('editBtn').onclick = () => { editing = !editing; render(); };
$('nav').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of $('nav').children) x.classList.toggle('sel', x === b);
  document.querySelectorAll('.tab').forEach(t => t.hidden = t.id !== 'tab-' + b.dataset.tab);
  scrollTo(0, 0);
};
// Roll over to the new day if the app stays open past midnight; catch a finished focus timer.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) return;
  if (!isToday(selected) && dayKey(addDays(selected, 1)) === dayKey(new Date())) selected = new Date();
  render();
});
render();
