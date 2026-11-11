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

import { haversine, nextStepIndex } from './lib.js';
test('haversine: Memphis to Nashville is about 315 km straight-line', () => {
  const d = haversine({ lat: 35.1495, lon: -90.049 }, { lat: 36.1627, lon: -86.7816 });
  assert.ok(d > 310000 && d < 320000, d);
});
test('nextStepIndex advances past reached steps only', () => {
  const steps = [{ at: { lat: 0, lon: 0 } }, { at: { lat: 0, lon: 0.0001 } }, { at: { lat: 0, lon: 1 } }];
  assert.equal(nextStepIndex(steps, { lat: 0, lon: 0 }), 2);
  assert.equal(nextStepIndex(steps, { lat: 0, lon: 0.5 }), 0);
  assert.equal(nextStepIndex(steps, { lat: 0, lon: 1 }, 2), 2);
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
