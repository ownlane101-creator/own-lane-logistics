import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMaxHeight, ftInToM, mToFtIn, classifyPlace, tomtomRouteUrl, fmtTime } from './lib.js';

test('parseMaxHeight', () => {
  assert.equal(parseMaxHeight('4.1'), 4.1);
  assert.equal(parseMaxHeight('3.8 m'), 3.8);
  assert.ok(Math.abs(parseMaxHeight(`13'6"`) - 4.1148) < 1e-3);
  assert.ok(Math.abs(parseMaxHeight('12 ft 2 in') - ftInToM(12, 2)) < 1e-9);
  assert.ok(Math.abs(parseMaxHeight("14'") - ftInToM(14)) < 1e-9);
  assert.equal(parseMaxHeight('default'), null);
  assert.equal(parseMaxHeight(''), null);
});

test('mToFtIn round-trips', () => assert.equal(mToFtIn(ftInToM(13, 6)), `13'6"`));

test('classifyPlace', () => {
  assert.equal(classifyPlace({ amenity: 'fuel', hgv: 'yes' }), 'fuel');
  assert.equal(classifyPlace({ amenity: 'weighbridge' }), 'weigh');
  assert.equal(classifyPlace({ highway: 'rest_area' }), 'rest');
  assert.equal(classifyPlace({ amenity: 'parking' }), 'parking');
  assert.equal(classifyPlace({ shop: 'bakery' }), null);
});

test('tomtomRouteUrl sets truck params', () => {
  const u = new URL(tomtomRouteUrl('K', { lat: 1, lon: 2 }, { lat: 3, lon: 4 },
    { heightM: 4.1148, weightKg: 36287.4, lengthM: 0, hazmat: 'USHazmatClass3' }));
  assert.match(u.pathname, /1,2:3,4\/json$/);
  assert.equal(u.searchParams.get('travelMode'), 'truck');
  assert.equal(u.searchParams.get('vehicleHeight'), '4.11');
  assert.equal(u.searchParams.get('vehicleWeight'), '36287');
  assert.equal(u.searchParams.get('vehicleLoadType'), 'USHazmatClass3');
  assert.equal(u.searchParams.get('traffic'), 'true');
  assert.equal(u.searchParams.has('vehicleLength'), false);
});

test('fmtTime', () => { assert.equal(fmtTime(3900), '1 h 5 min'); assert.equal(fmtTime(600), '10 min'); });

import { haversine, nextTurn } from './lib.js';
test('haversine: Memphis to Nashville is about 315 km straight-line', () => {
  const d = haversine({ lat: 35.1495, lon: -90.049 }, { lat: 36.1627, lon: -86.7816 });
  assert.ok(d > 310000 && d < 320000, d);
});
test('nextTurn goes by distance along the route, so a skipped turn point never sticks', () => {
  const steps = [{ off: 0 }, { off: 4300 }, { off: 9000 }];
  assert.equal(nextTurn(steps, 0), 1);       // just started: the first real turn is next
  assert.equal(nextTurn(steps, 4400), 2);    // drove past turn 1 without touching its point
  assert.equal(nextTurn(steps, 9500), 2);    // at the end: stay on the last step
});
import { cumulative } from './lib.js';
test('cumulative', () => {
  const c = cumulative([{ lat: 0, lon: 0 }, { lat: 0, lon: 0.01 }, { lat: 0, lon: 0.02 }]);
  assert.equal(c[0], 0); assert.ok(Math.abs(c[2] - 2 * c[1]) < 1e-6 && c[1] > 1100 && c[1] < 1120);
});
import { fmtDist } from './lib.js';
test('fmtDist', () => { assert.equal(fmtDist(100), '350 ft'); assert.equal(fmtDist(1609.344), '1.0 mi'); });

import { decodePolyline6, valhallaToRoutes, valhallaBody } from './lib.js';
// Encode for tests (inverse of decodePolyline6).
const enc = (pts) => { let s = '', pl = 0, pn = 0; const e = (v) => { v = v < 0 ? ~(v << 1) : v << 1; while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } s += String.fromCharCode(v + 63); };
  for (const [la, lo] of pts) { const a = Math.round(la * 1e6), b = Math.round(lo * 1e6); e(a - pl); e(b - pn); pl = a; pn = b; } return s; };
test('decodePolyline6 round-trips', () => {
  const pts = [[39.1, -94.6], [39.123456, -94.654321], [38.9, -95.1]];
  assert.deepEqual(decodePolyline6(enc(pts)).map((p) => [p.latitude, p.longitude]), pts);
});
test('valhallaToRoutes maps trip + alternates', () => {
  const trip = (n) => ({ trip: { summary: { length: 10, time: 600 * n }, legs: [{ shape: enc([[39, -94], [39.1, -94.1]]),
    maneuvers: [{ instruction: 'Drive east.', begin_shape_index: 0, length: 9.5 }, { instruction: 'You have arrived.', begin_shape_index: 1, length: 0 }] }] } });
  const r = valhallaToRoutes({ ...trip(1), alternates: [trip(2)] });
  assert.equal(r.length, 2);
  assert.ok(Math.abs(r[0].summary.lengthInMeters - 16093.44) < 0.01);
  assert.equal(r[1].summary.travelTimeInSeconds, 1200);
  assert.equal(r[0].guidance.instructions[1].routeOffsetInMeters, Math.round(9.5 * 1609.344));
  assert.deepEqual(r[0].guidance.instructions[1].point, { latitude: 39.1, longitude: -94.1 });
});
test('valhallaBody uses tonnes and truck costing', () => {
  const b = valhallaBody({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { heightM: 4.1148, weightKg: 36287, lengthM: 21.95, hazmat: '' });
  assert.equal(b.costing, 'truck'); assert.equal(b.costing_options.truck.weight, 36.3); assert.equal(b.costing_options.truck.hazmat, false);
  assert.deepEqual(b.locations[0], { lat: 1, lon: 2 });
  const w = valhallaBody({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }, { heightM: 4, weightKg: 1, lengthM: 1 }, true);
  assert.ok(w.locations.every((l) => l.search_cutoff > 35000 && l.minimum_reachability < 50));
});

import { pickNearest, splitTrip, joinRoutes, photonLabel } from './lib.js';
const feat = (lon, lat, cc, props = {}) => ({ geometry: { coordinates: [lon, lat] }, properties: { countrycode: cc, ...props } });
test('pickNearest prefers the US/Canada match nearest the driver', () => {
  const kc = { lat: 39.1, lon: -94.6 };
  const r = pickNearest([feat(-118.2, 34.0, 'US'), feat(13.4, 52.5, 'DE'), feat(-94.7, 39.0, 'US', { housenumber: '3300', street: 'Espresso Way', city: 'Kansas City', state: 'Kansas' })], kc);
  assert.equal(r.label, '3300 Espresso Way, Kansas City, Kansas');
  assert.equal(pickNearest([], kc), null);
  assert.equal(photonLabel({ name: 'Pilot Travel Center', city: 'Joplin', state: 'Missouri' }), 'Pilot Travel Center, Joplin, Missouri');
});
test('splitTrip keeps short trips whole and splits long hauls', () => {
  const kc = { lat: 39.1, lon: -94.6 }, la = { lat: 34.05, lon: -118.24 };
  assert.equal(splitTrip(kc, { lat: 38.6, lon: -90.2 }).length, 2);
  const pts = splitTrip(kc, la);
  assert.ok(pts.length >= 4, pts.length);
  assert.deepEqual(pts[0], kc); assert.deepEqual(pts.at(-1), la);
});
test('joinRoutes adds up distance, time and step offsets', () => {
  const piece = (a, b) => ({ summary: { lengthInMeters: 1000, travelTimeInSeconds: 60 }, legs: [{ points: [a, b] }],
    guidance: { instructions: [{ message: 'Go', routeOffsetInMeters: 0 }, { message: 'Arrive', routeOffsetInMeters: 1000 }] } });
  const r = joinRoutes([piece(1, 2), piece(2, 3)]);
  assert.equal(r.summary.lengthInMeters, 2000); assert.equal(r.summary.travelTimeInSeconds, 120);
  assert.deepEqual(r.guidance.instructions.map((s) => s.routeOffsetInMeters), [0, 1000, 2000]);
  assert.equal(r.legs[0].points.length, 4);
});

import { withoutHouseNumber, nominatimPlaces } from './lib.js';
test('withoutHouseNumber', () => {
  assert.equal(withoutHouseNumber('3300 espresso Way, York, Pennsylvania'), 'espresso Way, York, Pennsylvania');
  assert.equal(withoutHouseNumber('12B-14 Main St'), 'Main St');
  assert.equal(withoutHouseNumber('I-70 Exit 415'), 'I-70 Exit 415');
});
test('nominatimPlaces', () => {
  const [p] = nominatimPlaces([{ lat: '39.9', lon: '-76.7', display_name: '3300, Espresso Way, York, York County, Pennsylvania, 17406, United States', address: { country_code: 'us', state: 'Pennsylvania' } }]);
  assert.deepEqual(p, { lat: 39.9, lon: -76.7, cc: 'US', state: 'Pennsylvania', label: '3300, Espresso Way, York, York County' });
});

import { stateIn, rankPlaces as rank2 } from './lib.js';
test('stateIn reads the typed state', () => {
  assert.equal(stateIn('3300 espresso way York pa'), 'Pennsylvania');
  assert.equal(stateIn('3300 Espresso Way, York, PA 17406'), 'Pennsylvania');
  assert.equal(stateIn('1118 Cedarcroft rd Baltimore md'), 'Maryland');
  assert.equal(stateIn('Main St, New York'), 'New York');
  assert.equal(stateIn('Espresso Way'), null);
});
test('rankPlaces drops overseas hits and keeps the typed state', () => {
  const near = { lat: 39.36, lon: -76.61 };
  const r = rank2([feat(4.4, 51.2, 'BE', { name: 'Espresso', city: 'Antwerp' }),
    feat(-76.6, 39.3, 'US', { street: 'Espresso Way', city: 'Baltimore', state: 'Maryland' }),
    feat(-76.78, 39.93, 'US', { housenumber: '3300', street: 'Espresso Way', city: 'York', state: 'Pennsylvania' })], near, '3300 Espresso Way, York, PA');
  assert.deepEqual(r.map((x) => x.state), ['Pennsylvania']);
  assert.deepEqual(rank2([feat(4.4, 51.2, 'BE', { name: 'Espresso' })], near, 'espresso'), []);
});

import { tidyTurn, snapToLine, bearing } from './lib.js';
test('tidyTurn shortens road names', () => {
  assert.equal(tidyTurn('Drive north on I 83 North/Veterans of Foreign Wars of the United States Memorial Highway.'), 'Drive north on I-83 North.');
  assert.equal(tidyTurn('Turn right onto Main Street.'), 'Turn right onto Main Street.');
});
test('snapToLine puts a wobbly fix back on the road', () => {
  const line = [{ lat: 40, lon: -77 }, { lat: 40, lon: -76.99 }];
  const s = snapToLine({ lat: 40.0002, lon: -76.995 }, line);
  assert.ok(Math.abs(s.lat - 40) < 1e-9 && Math.abs(s.lon + 76.995) < 1e-9);
  assert.ok(s.dist > 20 && s.dist < 25);
  assert.ok(Math.abs(bearing(line[0], line[1]) - 90) < 0.1);
});

import { dueCallout } from './lib.js';
test('dueCallout speaks each reminder once, tightest first', () => {
  assert.equal(dueCallout(5000), null);
  assert.equal(dueCallout(3000), 3300);
  assert.equal(dueCallout(1500, 3300), 1700);
  assert.equal(dueCallout(1400, 1700), null);  // already said "1 mile"
  assert.equal(dueCallout(60, 1700), 80);      // jumped past the quarter mile: go straight to "now"
});
