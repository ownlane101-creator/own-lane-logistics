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
