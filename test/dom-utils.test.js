// Characterisation tests for the pure helpers extracted into js/dom-utils.js.
// Golden values are derived from the ORIGINAL app.js implementations, so a
// transcription error during extraction would fail these tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shuffle,
  pickDistractors,
  getSentenceBlank,
  wordVariants,
} from '../js/dom-utils.js';

// Run `fn` with Math.random stubbed to a constant, then restore it.
function withRandom(value, fn) {
  const orig = Math.random;
  Math.random = () => value;
  try { return fn(); } finally { Math.random = orig; }
}

test('shuffle returns a new array with the same elements, leaving input intact', () => {
  const input = [1, 2, 3, 4, 5];
  const out = shuffle(input);
  assert.deepEqual(input, [1, 2, 3, 4, 5], 'input must not be mutated');
  assert.notStrictEqual(out, input, 'must return a new array');
  assert.deepEqual([...out].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
});

test('shuffle is deterministic under a fixed RNG (characterisation)', () => {
  // Math.random() === 0 → every Fisher–Yates index j = 0.
  assert.deepEqual(withRandom(0, () => shuffle([1, 2, 3, 4, 5])), [2, 3, 4, 5, 1]);
  // Math.random() ≈ 1 → j === i each step → identity permutation.
  assert.deepEqual(withRandom(0.999999, () => shuffle([1, 2, 3, 4, 5])), [1, 2, 3, 4, 5]);
});

test('pickDistractors excludes the answer, prefers same word_type, caps at count', () => {
  const A = { word: 'A', word_type: 'Noun' };
  const pool = [
    A,
    { word: 'B', word_type: 'Noun' },
    { word: 'C', word_type: 'Noun' },
    { word: 'D', word_type: 'Verb' },
    { word: 'E', word_type: 'Verb' },
  ];
  const picks = withRandom(0, () => pickDistractors(A, pool, 3));
  assert.equal(picks.length, 3);
  assert.ok(!picks.some((w) => w.word === 'A'), 'never includes the answer');
  // Exact selection under RNG=0 (same-type B,C first, then fill with E):
  assert.deepEqual(picks.map((w) => w.word), ['C', 'B', 'E']);
});

test('pickDistractors cannot exceed the available pool', () => {
  const A = { word: 'A', word_type: 'Noun' };
  const pool = [A, { word: 'B', word_type: 'Noun' }, { word: 'C', word_type: 'Verb' }];
  const picks = withRandom(0, () => pickDistractors(A, pool, 10));
  assert.equal(picks.length, 2);
  assert.ok(!picks.some((w) => w.word === 'A'));
});

test('getSentenceBlank blanks the whole word, case-insensitively', () => {
  assert.equal(
    getSentenceBlank({ word: 'happy', sentence_usage: 'She was very happy today.' }),
    'She was very _____ today.',
  );
  assert.equal(
    getSentenceBlank({ word: 'Happy', sentence_usage: 'I am happy.' }),
    'I am _____.',
  );
});

test('getSentenceBlank respects word boundaries and returns null when absent', () => {
  assert.equal(
    getSentenceBlank({ word: 'cat', sentence_usage: 'The category cat sat.' }),
    'The category _____ sat.',
  );
  assert.equal(
    getSentenceBlank({ word: 'zebra', sentence_usage: 'No match here.' }),
    null,
  );
});

test('wordVariants produces the documented inflection set (characterisation)', () => {
  assert.deepEqual(wordVariants('cat'), ['cat', 'cats', 'cates', 'cated', 'cating']);
  assert.deepEqual(
    wordVariants('happy'),
    ['happy', 'happys', 'happyes', 'happies', 'happyed', 'happying'],
  );
  assert.deepEqual(wordVariants('make'), ['make', 'makes', 'makees', 'maked', 'making']);
});
