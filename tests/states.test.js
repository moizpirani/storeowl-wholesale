import test from 'node:test';
import assert from 'node:assert/strict';
import { STATES, NEIGHBORS, stateName, cleanStates, statesLine, neighborsOf } from '../src/states.js';

test('51 places (50 states + DC), each once', () => {
  assert.equal(STATES.length, 51);
  assert.equal(new Set(STATES.map((s) => s[0])).size, 51);
  assert.equal(stateName('tn'), 'Tennessee');
  assert.equal(stateName('XX'), '');
});

test('neighbours go both ways and are real states', () => {
  for (const [k, v] of Object.entries(NEIGHBORS)) {
    for (const n of v ? v.split(' ') : []) {
      assert.ok(stateName(n), k + ' has unknown neighbour ' + n);
      assert.ok(neighborsOf(n).includes(k), n + ' should list ' + k);
    }
  }
  assert.deepEqual(neighborsOf('TN'), ['AL', 'AR', 'GA', 'KY', 'MO', 'MS', 'NC', 'VA']);
});

test('cleanStates: home first, others sorted, no repeats or unknowns', () => {
  assert.deepEqual(cleanStates('tn', ['va', 'KY', 'TN', 'zz', 'KY']), { home: 'TN', others: ['KY', 'VA'] });
  assert.equal(cleanStates('', ['KY']), null);
  assert.equal(cleanStates('ZZ'), null);
});

test('statesLine in plain words', () => {
  assert.equal(statesLine('TN', []), 'Tennessee');
  assert.equal(statesLine('TN', ['KY']), 'Tennessee · also Kentucky');
  assert.equal(statesLine('TN', ['KY', 'VA', 'GA']), 'Tennessee · also Kentucky, Virginia and Georgia');
});
