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

export const valhallaBody = (from, to, truck) => ({
  locations: [{ lat: from.lat, lon: from.lon }, { lat: to.lat, lon: to.lon }],
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

// Convert a Valhalla answer into the same route shape the TomTom code path produces.
export function valhallaToRoutes(json) {
  const MI = 1609.344;
  return [json, ...(json.alternates || [])].map(({ trip }) => {
    const leg = trip.legs[0], points = decodePolyline6(leg.shape);
    let off = 0;
    const instructions = leg.maneuvers.map((m) => {
      const s = { message: m.instruction, routeOffsetInMeters: Math.round(off), point: points[m.begin_shape_index] };
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
