import { ftInToM, mToFtIn, parseMaxHeight, classifyPlace, placesQuery, restrictionsQuery,
  tomtomRouteUrl, VALHALLA, valhallaBody, valhallaToRoutes, pickNearest, rankPlaces, withoutHouseNumber, nominatimPlaces, splitTrip, joinRoutes, fmtMiles, fmtTime, fmtDist, haversine, nextStepIndex } from './lib.js';

const $ = (id) => document.getElementById(id);
// Public map-data servers are often busy, so try each in turn.
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
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
  let last;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: new URLSearchParams({ data: query }), signal: ctl.signal });
      if (r.ok) return (await r.json()).elements;
      last = new Error(`server busy (${r.status})`);
    } catch (e) {
      if (ctl.signal.aborted) throw e; // map moved again; a newer request replaces this one
      last = e;
    }
  }
  throw last;
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
  } catch (e) { if (!inflight.places.signal.aborted) status(`Couldn't load truck stops right now (${e.message}). Move the map to try again.`, true); }
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
  } catch (e) { if (!inflight.restrictions.signal.aborted) status(`Couldn't load low bridges right now (${e.message}). Move the map to try again.`, true); }
}

let timer;
map.on('moveend', () => { clearTimeout(timer); timer = setTimeout(() => { loadPlaces(); loadRestrictions(); }, 400); });

// ---- routing ----
function status(msg, err = false) { $('status').textContent = msg; $('status').className = err ? 'error' : ''; }

// Free address search (Photon, from OpenStreetMap data), biased toward what's on the map.
const photon = async (text, near, signal) => {
  const r = await fetch(`https://photon.komoot.io/api/?limit=10&lang=en&lat=${near.lat}&lon=${near.lon}&q=${encodeURIComponent(text)}`, { signal });
  if (!r.ok) throw new Error(`address search is busy (${r.status}), try again`);
  return (await r.json()).features;
};

// Try the fast search, then OpenStreetMap's main search, then the street without its house number.
async function lookupPlaces(text, near, signal, full = true) {
  let places = [];
  if (settings.key) { // TomTom's commercial address data when the driver added a key
    try {
      const r = await fetch(`https://api.tomtom.com/search/2/geocode/${encodeURIComponent(text)}.json?limit=6&countrySet=US,CA&typeahead=${!full}&lat=${near.lat}&lon=${near.lon}&key=${encodeURIComponent(settings.key)}`, { signal });
      if (r.ok) places = ((await r.json()).results || []).map((x) => ({ lat: x.position.lat, lon: x.position.lon, label: x.address.freeformAddress }));
    } catch (e) { if (signal?.aborted) throw e; }
  }
  if (!places.length) places = rankPlaces(await photon(text, near, signal), near);
  if (!places.length && full) { // Nominatim's rules forbid search-as-you-type, so only on the final lookup
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&limit=5&countrycodes=us,ca&q=${encodeURIComponent(text)}`, { signal });
      if (r.ok) places = nominatimPlaces(await r.json()).sort((a, b) => haversine(a, near) - haversine(b, near));
    } catch (e) { if (signal?.aborted) throw e; }
  }
  const street = withoutHouseNumber(text);
  if (!places.length && street !== text) places = rankPlaces(await photon(street, near, signal), near);
  return places;
}

async function geocode(text, near) {
  const hit = (await lookupPlaces(text, near))[0];
  if (!hit) throw new Error(`couldn't find "${text}". Check the spelling, or pick from the list as you type`);
  return hit;
}

async function freeRoute(from, to) {
  const r = await fetch(`${VALHALLA}?json=${encodeURIComponent(JSON.stringify(valhallaBody(from, to, truck())))}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `routing server is busy (${r.status}), try again`);
  return valhallaToRoutes(data);
}

// TomTom (with live traffic) when a working key is saved; otherwise the free truck router.
async function findRoutes(from, to) {
  if (settings.key) {
    const r = await fetch(tomtomRouteUrl(settings.key, from, to, truck()));
    const data = await r.json().catch(() => ({}));
    if (r.ok && data.routes?.length) return { routes: data.routes, traffic: true };
    if (r.status !== 401 && r.status !== 403) throw new Error(data.detailedError?.message || `routing failed (${r.status})`);
  }
  const stops = splitTrip(from, to);
  let routes;
  if (stops.length === 2) routes = await freeRoute(from, to);
  else {
    const pieces = [];
    for (let i = 1; i < stops.length; i++) {
      status(`Long haul: planning part ${i} of ${stops.length - 1}…`);
      pieces.push((await freeRoute(stops[i - 1], stops[i]))[0]);
    }
    routes = [joinRoutes(pieces)];
  }
  return { routes, traffic: false, badKey: !!settings.key };
}

// Suggestions under the From / To boxes as the driver types; a tapped suggestion is used as-is.
let lastFix = null; // last known GPS position, used to rank suggestions nearest first
const nearPoint = () => lastFix || (({ lat, lng }) => ({ lat, lon: lng }))(map.getCenter());
for (const id of ['from', 'to']) {
  const input = $(id), list = $(`${id}List`);
  let t, ctl;
  input.addEventListener('input', () => {
    input.picked = null;
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 3) { list.hidden = true; return; }
    t = setTimeout(async () => {
      ctl?.abort(); ctl = new AbortController();
      try {
        const near = nearPoint();
        const places = (await lookupPlaces(q, near, ctl.signal, false)).slice(0, 6);
        list.innerHTML = places.map((p, i) => `<li><button type="button" data-i="${i}">${esc(p.label)}<small>${fmtMiles(haversine(p, near))} away</small></button></li>`).join('');
        list.hidden = !places.length;
        list.querySelectorAll('button').forEach((b) => (b.onclick = () => {
          input.picked = places[b.dataset.i]; input.value = input.picked.label; list.hidden = true;
        }));
      } catch {} // typing on; the next keystroke retries
    }, 300);
  });
  input.addEventListener('blur', () => setTimeout(() => (list.hidden = true), 200));
}

const here = () => new Promise((ok, fail) => navigator.geolocation
  ? navigator.geolocation.getCurrentPosition((p) => ok(lastFix = { lat: p.coords.latitude, lon: p.coords.longitude }),
      () => fail(new Error('location is off; type a starting point')), { timeout: 10000 })
  : fail(new Error('type a starting point')));

let routes = [], selected = 0;
function showRoute(i) {
  selected = i;
  $('startNav').hidden = false;
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
  status('Finding a truck-safe route…');
  $('routes').innerHTML = ''; $('steps').innerHTML = ''; $('startNav').hidden = true;
  try {
    const fromText = $('from').value.trim();
    const from = $('from').picked || (fromText ? await geocode(fromText, nearPoint()) : await here());
    const to = $('to').picked || await geocode($('to').value.trim(), from);
    const found = await findRoutes(from, to);
    routes = found.routes;
    if (!routes.length) throw new Error('no truck-legal route found');
    $('routes').innerHTML = routes.map((rt, i) => {
      const s = rt.summary, delay = s.trafficDelayInSeconds;
      return `<button class="route" type="button" data-i="${i}">
        <b>${i ? `Alternate ${i}` : 'Best route'} · ${fmtTime(s.travelTimeInSeconds)}</b>
        ${fmtMiles(s.lengthInMeters)}${delay == null ? '' : delay > 60 ? ` · <span class="delay">+${fmtTime(delay)} traffic</span>` : ' · light traffic'}
      </button>`;
    }).join('');
    document.querySelectorAll('.route').forEach((b) => (b.onclick = () => showRoute(Number(b.dataset.i))));
    status(`${to.label ? `To ${to.label}. ` : ''}Route for ${mToFtIn(truckHeightM())} tall, ${settings.weightLb.toLocaleString()} lb${settings.hazmat ? ', hazmat' : ''}. Avoids low bridges and roads closed to trucks.${found.traffic ? '' : found.badKey ? ' Your TomTom key was rejected, so live traffic is off.' : ''}`);
    showRoute(0);
    $('routes').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); // results sit below the map on phones
  } catch (e) { status(`Sorry, ${e.message}.`, true); }
});

// ---- driving mode: follow the truck and call out each turn ----
const routeLine = (r) => r.legs.flatMap((l) => l.points.map((p) => ({ lat: p.latitude, lon: p.longitude })));
const say = (text) => { try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(text)); } catch {} };
let stopWatch = null;

function geoWatch(onPos) {
  if (!navigator.geolocation) { status('This device has no GPS location.', true); return () => {}; }
  const id = navigator.geolocation.watchPosition((p) => onPos({ lat: p.coords.latitude, lon: p.coords.longitude }),
    () => status('Turn on location to use driving mode.', true), { enableHighAccuracy: true, maximumAge: 2000 });
  return () => navigator.geolocation.clearWatch(id);
}

function startDriving() {
  const r = routes[selected], total = r.summary.lengthInMeters;
  // shortcut: no automatic re-route when the driver leaves the route; add one when live GPS testing shows it's needed.
  const steps = (r.guidance?.instructions || []).filter((s) => s.point)
    .map((s) => ({ msg: s.message, off: s.routeOffsetInMeters, at: { lat: s.point.latitude, lon: s.point.longitude } }));
  if (!steps.length) { status('This route has no turn list.', true); return; }
  document.body.classList.add('navigating'); $('nav').hidden = false; map.invalidateSize();
  const truckPin = L.marker([steps[0].at.lat, steps[0].at.lon], { icon: pin('truck', '🚚'), zIndexOffset: 1000 }).addTo(routeLayer);
  let idx = 0, spoken = -1, warned = -1;
  const onPos = (pos) => {
    truckPin.setLatLng([pos.lat, pos.lon]);
    map.setView([pos.lat, pos.lon], globalThis.DEMO_ZOOM || 16, { animate: false });
    idx = nextStepIndex(steps, pos, idx);
    const d = haversine(pos, steps[idx].at), left = Math.max(0, total - steps[idx].off) + d;
    $('navDist').textContent = fmtDist(d);
    $('navMsg').textContent = steps[idx].msg;
    $('navEta').textContent = `${fmtMiles(left)} · ${fmtTime(r.summary.travelTimeInSeconds * left / total)} left`;
    if (spoken !== idx) { spoken = idx; say(`In ${fmtDist(d).replace('mi', 'miles').replace('ft', 'feet')}, ${steps[idx].msg}`); }
    else if (d < 300 && warned !== idx) { warned = idx; say(steps[idx].msg); }
  };
  stopWatch = (globalThis.simulateDrive || geoWatch)(onPos, routeLine(r));
}

function endDriving() {
  stopWatch?.(); stopWatch = null;
  try { speechSynthesis.cancel(); } catch {}
  document.body.classList.remove('navigating'); $('nav').hidden = true; map.invalidateSize();
  showRoute(selected);
}
$('startNav').onclick = startDriving;
$('endNav').onclick = endDriving;


// Learn where the driver is (quietly) so address suggestions start nearby.
navigator.geolocation?.getCurrentPosition((p) => { lastFix = { lat: p.coords.latitude, lon: p.coords.longitude }; }, () => {}, { timeout: 10000 });
