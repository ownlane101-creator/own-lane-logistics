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
