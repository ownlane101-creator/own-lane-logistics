import { ftInToM, mToFtIn, parseMaxHeight, classifyPlace, placesQuery, restrictionsQuery,
  tomtomRouteUrl, fmtMiles, fmtTime } from './lib.js';

const $ = (id) => document.getElementById(id);
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const ICONS = { fuel: '⛽', parking: 'P', rest: '🛏', weigh: '⚖' };
const NAMES = { fuel: 'Truck stop / fuel', parking: 'Truck parking', rest: 'Rest area', weigh: 'Weigh station' };

// ---- truck settings (per device) ----
const DEFAULTS = { hFt: 13, hIn: 6, weightLb: 80000, lengthFt: 72, hazmat: '', key: '' };
let settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('ownlane.truck') || '{}')); } catch {}
const truckHeightM = () => ftInToM(settings.hFt, settings.hIn);
const truck = () => ({
  heightM: truckHeightM(),
  weightKg: settings.weightLb * 0.45359237,
  lengthM: settings.lengthFt * 0.3048,
  hazmat: settings.hazmat,
});

const form = $('settingsForm');
function openSettings() {
  for (const [k, v] of Object.entries(settings)) if (form.elements[k]) form.elements[k].value = v;
  $('settings').showModal();
}
form.addEventListener('submit', () => {
  for (const k of Object.keys(DEFAULTS)) {
    const v = form.elements[k].value.trim();
    settings[k] = ['hazmat', 'key'].includes(k) ? v : Number(v) || 0;
  }
  try { localStorage.setItem('ownlane.truck', JSON.stringify(settings)); } catch {}
  setTrafficLayers();
  loadRestrictions();
});
$('settingsBtn').onclick = openSettings;

// ---- map ----
const map = L.map('map', { zoomControl: true }).setView([39.5, -98.35], 5);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '© OpenStreetMap contributors',
}).addTo(map);

const places = L.layerGroup().addTo(map);
const restrictions = L.layerGroup().addTo(map);
const routeLayer = L.layerGroup().addTo(map);
const traffic = L.layerGroup().addTo(map);
L.control.layers(null, {
  'Truck stops, parking, weigh stations': places,
  'Low bridges & no-truck roads': restrictions,
  'Live traffic': traffic,
}, { collapsed: true }).addTo(map);

function setTrafficLayers() {
  traffic.clearLayers();
  if (!settings.key) return;
  const k = encodeURIComponent(settings.key);
  traffic.addLayer(L.tileLayer(`https://api.tomtom.com/traffic/map/4/tile/flow/relative0/{z}/{x}/{y}.png?key=${k}`, { opacity: 0.7 }));
  traffic.addLayer(L.tileLayer(`https://api.tomtom.com/traffic/map/4/tile/incidents/s3/{z}/{x}/{y}.png?key=${k}`));
}
setTrafficLayers();

const pin = (cls, html) => L.divIcon({ className: '', html: `<div class="pin ${cls}">${html}</div>`, iconSize: null });
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const bounds = () => { const b = map.getBounds(); return { s: b.getSouth(), w: b.getWest(), n: b.getNorth(), e: b.getEast() }; };

const inflight = {};
async function overpass(name, query) {
  inflight[name]?.abort();
  const ctl = (inflight[name] = new AbortController());
  const r = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
  if (!r.ok) throw new Error(`map data ${r.status}`);
  return (await r.json()).elements;
}

async function loadPlaces() {
  if (map.getZoom() < 10) { places.clearLayers(); return; }
  try {
    const els = await overpass('places', placesQuery(bounds()));
    places.clearLayers();
    for (const el of els) {
      const type = classifyPlace(el.tags);
      const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
      if (!type || lat == null) continue;
      const t = el.tags;
      const extras = [t['capacity:hgv'] && `${esc(t['capacity:hgv'])} truck spots`, t.shower === 'yes' && 'Showers',
        t['fuel:diesel'] === 'yes' && 'Diesel', t.opening_hours && esc(t.opening_hours)].filter(Boolean);
      L.marker([lat, lon], { icon: pin(type, ICONS[type]), title: t.name || NAMES[type] })
        .bindPopup(`<b>${esc(t.name || t.brand || NAMES[type])}</b><br>${NAMES[type]}${extras.length ? '<br>' + extras.join(' · ') : ''}`)
        .addTo(places);
    }
  } catch (e) { if (e.name !== 'AbortError') status(`Couldn't load truck stops: ${e.message}`, true); }
}

async function loadRestrictions() {
  if (map.getZoom() < 13) { restrictions.clearLayers(); return; }
  try {
    const els = await overpass('restrictions', restrictionsQuery(bounds()));
    restrictions.clearLayers();
    const myH = truckHeightM();
    for (const el of els) {
      const t = el.tags || {};
      const geom = el.geometry?.map((p) => [p.lat, p.lon]) || (el.lat != null ? [[el.lat, el.lon]] : null);
      if (!geom) continue;
      const h = parseMaxHeight(t.maxheight);
      if (h != null && h < myH + 0.05) { // under your truck height (+5 cm margin)
        const mid = geom[Math.floor(geom.length / 2)];
        L.marker(mid, { icon: pin('low', mToFtIn(h)), title: `Low clearance ${mToFtIn(h)}` })
          .bindPopup(`<b>Low clearance: ${mToFtIn(h)}</b><br>Your truck: ${mToFtIn(myH)}<br>Sign: ${esc(t.maxheight)}`)
          .addTo(restrictions);
        if (geom.length > 1) L.polyline(geom, { color: '#d62828', weight: 6 }).addTo(restrictions);
      } else if (t.hgv === 'no' && geom.length > 1) {
        L.polyline(geom, { color: '#d62828', weight: 4, dashArray: '6 6' })
          .bindPopup(`<b>No trucks</b>${t.name ? '<br>' + esc(t.name) : ''}`).addTo(restrictions);
      }
    }
  } catch (e) { if (e.name !== 'AbortError') status(`Couldn't load road restrictions: ${e.message}`, true); }
}

let timer;
map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(() => { loadPlaces(); loadRestrictions(); }, 400); });

// ---- routing ----
function status(msg, err = false) { $('status').textContent = msg; $('status').className = err ? 'error' : ''; }

async function geocode(text) {
  const u = `https://api.tomtom.com/search/2/geocode/${encodeURIComponent(text)}.json?limit=1&key=${encodeURIComponent(settings.key)}`;
  const r = await fetch(u);
  if (!r.ok) throw new Error(`address lookup failed (${r.status})`);
  const hit = (await r.json()).results?.[0];
  if (!hit) throw new Error(`couldn't find "${text}"`);
  return hit.position; // { lat, lon }
}

const here = () => new Promise((ok, fail) => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition((p) => ok({ lat: p.coords.latitude, lon: p.coords.longitude }),
      () => fail(new Error('location is off; type a starting point')), { timeout: 10000 })
  : fail(new Error('type a starting point')));

let routes = [];
function showRoute(i) {
  routeLayer.clearLayers();
  routes.forEach((r, j) => {
    const pts = r.legs.flatMap((l) => l.points.map((p) => [p.latitude, p.longitude]));
    const line = L.polyline(pts, j === i ? { color: '#0f2238', weight: 7 } : { color: '#8a99a8', weight: 5, opacity: 0.8 })
      .on('click', () => showRoute(j)).addTo(routeLayer);
    if (j === i) { line.bringToFront(); map.fitBounds(line.getBounds(), { padding: [30, 30] }); }
  });
  document.querySelectorAll('.route').forEach((b, j) => b.setAttribute('aria-pressed', String(j === i)));
  $('steps').innerHTML = (routes[i].guidance?.instructions || [])
    .map((s) => `<li>${esc(s.message)} <small>${fmtMiles(s.routeOffsetInMeters)}</small></li>`).join('');
}

$('routeForm').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (!settings.key) { status('Add your TomTom API key in Truck settings first.', true); openSettings(); return; }
  status('Finding a truck-safe route…');
  $('routes').innerHTML = ''; $('steps').innerHTML = '';
  try {
    const fromText = $('from').value.trim();
    const [from, to] = await Promise.all([fromText ? geocode(fromText) : here(), geocode($('to').value.trim())]);
    const r = await fetch(tomtomRouteUrl(settings.key, from, to, truck()));
    const data = await r.json();
    if (!r.ok) throw new Error(data.detailedError?.message || data.error?.description || `routing failed (${r.status})`);
    routes = data.routes || [];
    if (!routes.length) throw new Error('no truck-legal route found');
    $('routes').innerHTML = routes.map((rt, i) => {
      const s = rt.summary, delay = s.trafficDelayInSeconds;
      return `<button class="route" type="button" data-i="${i}">
        <b>${i ? `Alternate ${i}` : 'Fastest now'} · ${fmtTime(s.travelTimeInSeconds)}</b>
        ${fmtMiles(s.lengthInMeters)}${delay > 60 ? ` · <span class="delay">+${fmtTime(delay)} traffic</span>` : ' · light traffic'}
      </button>`;
    }).join('');
    document.querySelectorAll('.route').forEach((b) => (b.onclick = () => showRoute(Number(b.dataset.i))));
    status(`Route for ${mToFtIn(truckHeightM())} tall, ${settings.weightLb.toLocaleString()} lb${settings.hazmat ? ', hazmat' : ''}. Avoids low bridges and roads closed to trucks.`);
    showRoute(0);
  } catch (e) { status(`Sorry, ${e.message}.`, true); }
});

if (!settings.key) openSettings();
