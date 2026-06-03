// Characterisation tests for js/data.js. The Map-based findWordByName must
// behave identically to the original linear scan: same object for a hit, null
// for a miss, and first-occurrence-wins for duplicate names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setWords, findWordByName } from '../js/data.js';

test('findWordByName returns the matching object, or null when absent', () => {
  const alpha = { word: 'Alpha', definition: 'a' };
  const beta = { word: 'Beta', definition: 'b' };
  setWords([alpha, beta]);
  assert.strictEqual(findWordByName('Alpha'), alpha);
  assert.strictEqual(findWordByName('Beta'), beta);
  assert.strictEqual(findWordByName('Zeta'), null, 'misses return null, not undefined');
});

test('findWordByName preserves first-occurrence-wins (matches the original scan)', () => {
  const first = { word: 'Dup', n: 1 };
  const second = { word: 'Dup', n: 2 };
  setWords([first, second]);
  assert.strictEqual(findWordByName('Dup'), first);
});

test('setWords rebuilds the index without leaving stale entries', () => {
  setWords([{ word: 'OnlyOld' }]);
  setWords([{ word: 'OnlyNew' }]);
  assert.strictEqual(findWordByName('OnlyOld'), null);
  assert.ok(findWordByName('OnlyNew'));
});
