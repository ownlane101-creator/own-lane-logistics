// Pure helpers, no DOM, so they can be tested with `node --test`.

export const FT = 0.3048;
export const ftInToM = (ft, inch = 0) => (Number(ft) + Number(inch) / 12) * FT;
export const mToFtIn = (m) => {
  const totalIn = Math.round(m / FT * 12);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
};

// OSM maxheight values: "4.1", "4.1 m", "13'6\"", "13 ft 6 in", "default", "none"...
export function parseMaxHeight(v) {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:m)?$/);
  if (m) return Number(m[1]);
  m = s.match(/^(\d+)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|''|in)?)?$/);
  if (m) return ftInToM(m[1], m[2] || 0);
  return null; // "default", "none", "below_default", signs we can't read
}

export function classifyPlace(tags = {}) {
  if (tags.amenity === 'weighbridge') return 'weigh';
  if (tags.amenity === 'fuel' || tags.highway === 'services') return 'fuel';
  if (tags.highway === 'rest_area') return 'rest';
  if (tags.amenity === 'parking') return 'parking';
  return null;
}

const bbox = ({ s, w, n, e }) => `${s},${w},${n},${e}`;

export const placesQuery = (b) => `[out:json][timeout:25];(
nwr["amenity"="fuel"]["hgv"~"yes|designated"](${bbox(b)});
nwr["highway"="services"](${bbox(b)});
nwr["amenity"="parking"]["hgv"~"yes|designated"](${bbox(b)});
nwr["highway"="rest_area"](${bbox(b)});
nwr["amenity"="weighbridge"](${bbox(b)});
);out center tags;`;

export const restrictionsQuery = (b) => `[out:json][timeout:25];(
nwr["maxheight"](${bbox(b)});
way["hgv"="no"](${bbox(b)});
);out geom tags;`;

// TomTom Routing API, truck mode with live traffic and alternatives.
// truck: { heightM, weightKg, lengthM, hazmat } ; hazmat is a TomTom vehicleLoadType or ''.
export function tomtomRouteUrl(key, from, to, truck) {
  const p = new URLSearchParams({
    key,
    travelMode: 'truck',
    vehicleCommercial: 'true',
    vehicleHeight: truck.heightM.toFixed(2),
    vehicleWeight: String(Math.round(truck.weightKg)),
    traffic: 'true',
    maxAlternatives: '2',
    routeType: 'fastest',
    instructionsType: 'text',
    computeTravelTimeFor: 'all',
  });
  if (truck.lengthM) p.set('vehicleLength', truck.lengthM.toFixed(2));
  if (truck.hazmat) p.set('vehicleLoadType', truck.hazmat);
  const loc = `${from.lat},${from.lon}:${to.lat},${to.lon}`;
  return `https://api.tomtom.com/routing/1/calculateRoute/${loc}/json?${p}`;
}

export const fmtMiles = (m) => `${(m / 1609.344).toFixed(1)} mi`;
export const fmtTime = (s) => {
  const h = Math.floor(s / 3600), min = Math.round((s % 3600) / 60);
  return h ? `${h} h ${min} min` : `${min} min`;
};

// Meters between two {lat, lon} points.
export function haversine(a, b) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Index of the step to show next: skip steps the truck is within `reachedM` of, or already past.
export function nextStepIndex(steps, pos, from = 0, reachedM = 40) {
  let i = from;
  while (i < steps.length - 1 && haversine(pos, steps[i].at) < reachedM) i++;
  return i;
}

export const fmtDist = (m) => m < 320 ? `${Math.max(50, Math.round(m / 0.3048 / 50) * 50)} ft` : fmtMiles(m);

// ---- free, keyless truck routing (Valhalla on the OpenStreetMap community server) ----
export const VALHALLA = 'https://valhalla1.openstreetmap.de/route';

// wide: search farther for a truck-legal road when an address sits on a private lane or a small no-truck pocket.
const snap = (p, wide) => wide ? { lat: p.lat, lon: p.lon, radius: 300, search_cutoff: 80000, minimum_reachability: 5 } : { lat: p.lat, lon: p.lon };
export const valhallaBody = (from, to, truck, wide = false) => ({
  locations: [snap(from, wide), snap(to, wide)],
  costing: 'truck',
  costing_options: { truck: {
    height: +truck.heightM.toFixed(2), weight: +(truck.weightKg / 1000).toFixed(1),
    length: +(truck.lengthM || 0).toFixed(1), hazmat: !!truck.hazmat,
  } },
  alternates: 2,
  units: 'miles',
});

// Valhalla encodes route shapes as polyline with 6 digits of precision.
export function decodePolyline6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  while (i < str.length) {
    for (const k of [0, 1]) {
      let shift = 0, result = 0, b;
      do { b = str.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      const d = result & 1 ? ~(result >> 1) : result >> 1;
      if (k === 0) lat += d; else lon += d;
    }
    out.push({ latitude: lat / 1e6, longitude: lon / 1e6 });
  }
  return out;
}

// "Drive north on I 83 North/Veterans of Foreign Wars … Highway." -> "Drive north on I-83 North."
export const tidyTurn = (t = '') => t.replace(/\/[^,.;]+/g, '').replace(/\b(I|US|SR|PA|MD|VA|NJ|NY|OH) (\d+)/g, '$1-$2');

// Nearest point on the route to a GPS fix, so the truck rides the road instead of wobbling beside it.
export function snapToLine(pos, line) {
  const k = Math.cos(pos.lat * Math.PI / 180), M = 111320;
  let best = { lat: pos.lat, lon: pos.lon, dist: Infinity, i: 0 };
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const ax = (a.lon - pos.lon) * k, ay = a.lat - pos.lat, bx = (b.lon - pos.lon) * k, by = b.lat - pos.lat;
    const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
    const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
    const x = ax + t * dx, y = ay + t * dy, dist = Math.hypot(x, y) * M;
    if (dist < best.dist) best = { lat: pos.lat + y, lon: pos.lon + x / k, dist, i };
  }
  return best;
}
export const bearing = (a, b) => {
  const r = Math.PI / 180, y = Math.sin((b.lon - a.lon) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lon - a.lon) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
};

// Convert a Valhalla answer into the same route shape the TomTom code path produces.
export function valhallaToRoutes(json) {
  const MI = 1609.344;
  return [json, ...(json.alternates || [])].map(({ trip }) => {
    const leg = trip.legs[0], points = decodePolyline6(leg.shape);
    let off = 0;
    const instructions = leg.maneuvers.map((m) => {
      const s = { message: tidyTurn(m.instruction), routeOffsetInMeters: Math.round(off), point: points[m.begin_shape_index] };
      off += m.length * MI;
      return s;
    });
    return {
      summary: { lengthInMeters: trip.summary.length * MI, travelTimeInSeconds: trip.summary.time },
      legs: [{ points }],
      guidance: { instructions },
    };
  });
}

// ---- address search helpers (Photon results) ----
export const photonLabel = (p = {}) =>
  [[p.housenumber, p.street].filter(Boolean).join(' ') || p.name, p.city || p.county, p.state].filter(Boolean).join(', ');

const STATES = { AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
  DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
  IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming' };

// The US state a driver typed: a full name anywhere, or a 2-letter code as the last word ("York pa", "York, PA 17406").
export function stateIn(text = '') {
  const t = text.replace(/\b\d{5}(-\d{4})?\b/g, '').trim();
  const full = Object.values(STATES).sort((a, b) => b.length - a.length).find((n) => new RegExp(`\\b${n}\\b`, 'i').test(t));
  return full || STATES[(t.match(/([a-z]{2})\W*$/i)?.[1] || '').toUpperCase()] || null;
}

// Drivers here run US/Canada only, so overseas matches are dropped; a typed state narrows it further.
// Many towns share street names, so what's left is sorted nearest first.
export function keepLikely(places, near, text) {
  const home = places.filter((h) => h.cc === 'US' || h.cc === 'CA');
  const st = stateIn(text), inState = st ? home.filter((h) => h.state === st) : [];
  const seen = new Set();
  return (inState.length ? inState : home).sort((a, b) => haversine(a, near) - haversine(b, near))
    .filter((h) => !seen.has(h.label) && seen.add(h.label));
}
export const rankPlaces = (features, near, text) => keepLikely((features || []).map((f) => ({
  lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0],
  label: photonLabel(f.properties), cc: f.properties?.countrycode, state: f.properties?.state,
})), near, text);
export const pickNearest = (features, near) => rankPlaces(features, near)[0] || null;

// The free router caps one request at 1500 km of driving, so long hauls are routed in pieces.
// shortcut: pieces meet at straight-line points snapped to the nearest road, which can add small detours; use TomTom (no cap) when a key is set.
export function splitTrip(from, to, maxStraightM = 900000) {
  const n = Math.max(1, Math.ceil(haversine(from, to) / maxStraightM));
  return Array.from({ length: n + 1 }, (_, i) => ({ lat: from.lat + (to.lat - from.lat) * i / n, lon: from.lon + (to.lon - from.lon) * i / n }));
}

// Join consecutive route pieces into one route.
export function joinRoutes(pieces) {
  let off = 0;
  const points = [], instructions = [];
  pieces.forEach((r, i) => {
    points.push(...r.legs[0].points);
    const steps = r.guidance.instructions.filter((s, k, all) => i === pieces.length - 1 || k < all.length - 1); // drop mid-trip "arrived"
    for (const s of steps) instructions.push({ ...s, routeOffsetInMeters: s.routeOffsetInMeters + off });
    off += r.summary.lengthInMeters;
  });
  return {
    summary: { lengthInMeters: off, travelTimeInSeconds: pieces.reduce((t, r) => t + r.summary.travelTimeInSeconds, 0) },
    legs: [{ points }], guidance: { instructions },
  };
}

// "3300 Espresso Way, York, PA" -> "Espresso Way, York, PA": free map data often lacks exact house numbers.
export const withoutHouseNumber = (q) => q.replace(/^\s*\d+[a-z]?(-\d+)?\s+/i, '');

// Nominatim results -> same shape as rankPlaces items.
export const nominatimPlaces = (rows) => (rows || []).map((r) => ({
  lat: +r.lat, lon: +r.lon, cc: (r.address?.country_code || '').toUpperCase(), state: r.address?.state,
  label: r.display_name.split(', ').slice(0, 4).join(', '),
}));
