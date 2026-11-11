import { dayKey, addDays, totalXP, levelInfo, rankFor, streak, bestStreak } from './lib.js';

const KEY = 'grit-v1';
const STARTER = [
  ['Wake up before 7am', 20], ['Workout', 35], ['Drink 3L of water', 10], ['Read 10 pages', 20],
  ['Under 4 hours of screen time', 35], ['No junk food', 20], ['Cold shower', 20], ['Journal / plan tomorrow', 10],
];
let state;
try { state = JSON.parse(localStorage.getItem(KEY)); } catch {}
if (!state?.habits) state = { habits: STARTER.map(([name, xp], i) => ({ id: 'h' + i, name, xp })), log: {}, next: STARTER.length };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} };

const $ = id => document.getElementById(id);
let selected = new Date(), editing = false;
const isToday = d => dayKey(d) === dayKey(new Date());

function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}

function render() {
  const today = new Date(), xp = totalXP(state.log), L = levelInfo(xp);
  $('lvl').textContent = `Lv ${L.level}`;
  $('rank').textContent = rankFor(L.level);
  $('bar').style.width = (100 * L.into / L.need) + '%';
  $('xpTotal').textContent = `${xp} XP total`;
  $('xpNext').textContent = `${L.need - L.into} XP to Lv ${L.level + 1}`;
  $('streak').textContent = `${streak(state.log, today)} 🔥`;

  const n = state.habits.length;
  $('week').innerHTML = '';
  for (let i = -6; i <= 0; i++) {
    const d = addDays(today, i), done = Object.keys(state.log[dayKey(d)] || {}).length;
    const b = document.createElement('button');
    b.className = (done && done >= n ? 'full' : done ? 'part' : '') + (dayKey(d) === dayKey(selected) ? ' sel' : '');
    b.innerHTML = `${d.toLocaleDateString(undefined, { weekday: 'short' })}<div class="dot">${done >= n && n ? '✓' : done || ''}</div>`;
    b.onclick = () => { selected = d; render(); };
    $('week').append(b);
  }

  const k = dayKey(selected), day = state.log[k] || {};
  $('dayTitle').textContent = isToday(selected) ? 'Today' : selected.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  $('list').classList.toggle('editing', editing);
  $('editBtn').textContent = editing ? 'Done' : 'Edit';
  $('habits').innerHTML = n ? '' : '<div class="empty">Add your first habit below.</div>';
  for (const h of state.habits) {
    const row = document.createElement('div');
    row.className = 'habit' + (day[h.id] ? ' on' : '');
    row.innerHTML = `<button class="check" aria-label="Done">${day[h.id] ? '✓' : ''}</button><span class="name"></span><span class="xp">+${h.xp}</span><button class="del" aria-label="Delete">✕</button>`;
    row.querySelector('.name').textContent = h.name;
    row.querySelector('.check').onclick = () => toggle(h);
    row.querySelector('.del').onclick = () => {
      if (confirm(`Delete "${h.name}"? XP you already earned stays.`)) { state.habits = state.habits.filter(x => x !== h); save(); render(); }
    };
    $('habits').append(row);
  }

  const days = Object.values(state.log);
  $('best').textContent = bestStreak(state.log);
  $('checks').textContent = days.reduce((s, d) => s + Object.keys(d).length, 0);
  $('perfect').textContent = state.perfect?.length || 0;
}

function toggle(h) {
  const k = dayKey(selected), before = levelInfo(totalXP(state.log)).level;
  const day = state.log[k] ||= {};
  if (day[h.id]) delete day[h.id]; else day[h.id] = h.xp;
  if (!Object.keys(day).length) delete state.log[k];
  // Remember perfect days so deleting a habit later doesn't erase them.
  const perfect = new Set(state.perfect || []);
  state.habits.every(x => day[x.id]) ? perfect.add(k) : perfect.delete(k);
  state.perfect = [...perfect];
  save();
  const after = levelInfo(totalXP(state.log)).level;
  if (after > before) toast(`Level up! Lv ${after} · ${rankFor(after)}`);
  else if (day[h.id] && perfect.has(k)) toast('Perfect day 💯');
  else if (day[h.id]) toast(`+${h.xp} XP`);
  render();
}

$('add').onsubmit = e => {
  e.preventDefault();
  const name = $('newName').value.trim();
  if (!name) return;
  state.habits.push({ id: 'h' + state.next++, name, xp: +$('newXp').value });
  $('newName').value = ''; save(); render();
};
$('editBtn').onclick = () => { editing = !editing; render(); };
// Roll over to the new day if the app stays open past midnight.
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (!isToday(selected) && dayKey(addDays(selected, 1)) === dayKey(new Date())) selected = new Date(); render(); } });
render();
