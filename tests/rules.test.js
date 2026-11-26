// License rules: the wholesaler picks the licenses needed per state; nothing stops a sale.
import test from 'node:test';
import assert from 'node:assert/strict';
import { licNeeded, custNeeds, licProblems, saleWarnings, custIssues, licNeedCheck, suggestedLic } from '../src/rules.js';

const T = '2026-11-26';
test('Tennessee suggests resale, location number and hemp; other states resale and tobacco', () => {
  assert.deepEqual(suggestedLic('TN'), ['resale', 'location', 'hemp']);
  assert.deepEqual(suggestedLic('KY'), ['resale', 'tobacco']);
  assert.deepEqual(licNeeded({ lic_need: { TN: ['resale'] } }, 'TN'), ['resale']);
  assert.deepEqual(licNeeded({ lic_need: { TN: [] } }, 'TN'), [], 'the wholesaler can need none');
});
test('a Tennessee store with no tobacco license is fine; a missing hemp license only warns when selling hemp', () => {
  const c = { state: 'TN', tobacco: true, licenses: [{ kind: 'resale', number: '1' }, { kind: 'location', number: '1-001' }] };
  assert.deepEqual(licProblems(c, {}, T, 'TN'), []);
  assert.deepEqual(custIssues(c, {}, T, 'TN'), []);
  assert.deepEqual(saleWarnings(c, 'cigarettes', {}, T, 'TN'), []);
  assert.deepEqual(saleWarnings(c, 'hemp', {}, T, 'TN').map((p) => p.kind), ['hemp']);
});
test('a store with no state uses the home state; tobacco only for stores that buy it', () => {
  const c = { state: '', tobacco: false, licenses: [{ kind: 'resale', number: '1' }] };
  assert.deepEqual(custNeeds(c, {}, 'KY'), ['resale']);
  const t = Object.assign({}, c, { tobacco: true, licenses: c.licenses.concat([{ kind: 'tobacco', number: 'T1', expires: '2026-11-01' }]) });
  assert.deepEqual(licProblems(t, {}, T, 'KY').map((p) => [p.kind, p.st]), [['tobacco', 'ended']]);
  assert.equal(custIssues(t, {}, T, 'KY')[0].tone, 'or', 'a warning, not a stop');
});
test('the license list is checked before saving', () => {
  assert.equal(licNeedCheck({ TN: ['resale'] }, ['TN']), '');
  assert.match(licNeedCheck({ KY: ['resale'] }, ['TN']), /don’t sell in KY/);
  assert.match(licNeedCheck({ TN: ['x'] }, ['TN']), /from the list/);
});

import { photoMatch, upcSame } from '../src/rules.js';
test('a photo file finds its item by UPC (any way it is written) or item #', () => {
  const items = [{ id: 'a', item_no: 'SEN-FF-CTN', sizes: [{ upc: '014700319017' }, { upc: '10014700319014' }] }, { id: 'b', item_no: '', sizes: [{ upc: '028200003843' }] }];
  assert.deepEqual(photoMatch('014700319017.jpg', items), { id: 'a', how: 'upc' });
  assert.deepEqual(photoMatch('1470031901.JPG', items), { id: 'a', how: 'upc' }, '10 digits, no leading 0 or check digit');
  assert.deepEqual(photoMatch('10014700319014.png', items), { id: 'a', how: 'upc' }, 'the case UPC');
  assert.deepEqual(photoMatch('sen-ff-ctn.png', items), { id: 'a', how: 'item' });
  assert.equal(photoMatch('IMG_2291.jpg', items), null);
  assert.ok(upcSame('28200003843', '028200003843')); assert.ok(!upcSame('028200003843', '014700319017'));
});
