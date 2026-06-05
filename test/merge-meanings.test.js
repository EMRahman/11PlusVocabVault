// Tests for the scripts/merge-meanings.js validators. The merge pipeline is the
// only guard on the meanings[] data the app ships, so its accept/reject rules are
// pinned here. The script is CommonJS (the scripts/ dir is), loaded via
// createRequire; importing it does not run main() (guarded by require.main).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { validateSense, buildMeanings, primaryMeaning } = require('../scripts/merge-meanings.js');

const WORD = {
  word: 'Objective',
  word_type: 'Adjective',
  definition: 'Based on facts and evidence rather than personal feelings.',
  sentence_usage: 'A scientist stays objective when reading results.',
  synonyms: ['Impartial', 'Unbiased'],
  antonyms: ['Subjective', 'Biased'],
};

const GOOD_NOUN = {
  word_type: 'Noun',
  definition: 'A goal or aim that you are trying to achieve.',
  example: 'Our main objective was to reach the summit before noon.',
  synonyms: ['Goal', 'Aim', 'Target'],
  antonyms: [],
};

test('validateSense accepts a good sense and maps example -> sentence_usage', () => {
  const m = validateSense(GOOD_NOUN, 'Objective');
  assert.ok(m);
  assert.equal(m.word_type, 'Noun');
  assert.equal(m.sentence_usage, GOOD_NOUN.example);
  assert.deepEqual(m.synonyms, ['Goal', 'Aim', 'Target']);
  assert.deepEqual(m.antonyms, []);
});

test('validateSense rejects an unknown word_type', () => {
  assert.equal(validateSense(Object.assign({}, GOOD_NOUN, { word_type: 'Thing' }), 'Objective'), null);
});

test('validateSense rejects a definition that names the word or its stem', () => {
  const named = Object.assign({}, GOOD_NOUN, { definition: 'The objective fact you aim at.' });
  assert.equal(validateSense(named, 'Objective'), null);
});

test('validateSense rejects an example that omits the word', () => {
  const noWord = Object.assign({}, GOOD_NOUN, { example: 'Our main goal was to reach the summit by noon.' });
  assert.equal(validateSense(noWord, 'Objective'), null);
});

test('validateSense rejects a sense with no usable synonym', () => {
  assert.equal(validateSense(Object.assign({}, GOOD_NOUN, { synonyms: [] }), 'Objective'), null);
});

test('buildMeanings returns null when there is no valid extra sense', () => {
  assert.equal(buildMeanings(WORD, []), null);
  assert.equal(buildMeanings(WORD, [{ word_type: 'Bogus' }]), null);
});

test('buildMeanings yields [primary, extra] with the primary mirroring the flat fields', () => {
  const merged = buildMeanings(WORD, [GOOD_NOUN]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0], primaryMeaning(WORD));
  assert.equal(merged[1].word_type, 'Noun');
  assert.equal(merged[1].sentence_usage, GOOD_NOUN.example);
});

test('buildMeanings drops a generated sense identical to the primary', () => {
  const dupePrimary = {
    word_type: WORD.word_type,
    definition: WORD.definition,
    example: WORD.sentence_usage,
    synonyms: WORD.synonyms,
    antonyms: WORD.antonyms,
  };
  assert.equal(buildMeanings(WORD, [dupePrimary]), null);
});

test('buildMeanings preserves existing hand-seeded extras and de-dupes', () => {
  const withExtra = Object.assign({}, WORD, {
    meanings: [primaryMeaning(WORD), {
      word_type: 'Noun',
      definition: 'A goal or aim that you are trying to achieve.',
      sentence_usage: 'Our main objective was to reach the summit before noon.',
      synonyms: ['Goal', 'Aim', 'Target'],
      antonyms: [],
    }],
  });
  // Re-running with the same generated sense must not duplicate it.
  const merged = buildMeanings(withExtra, [GOOD_NOUN]);
  assert.equal(merged.length, 2);
  assert.equal(merged[1].word_type, 'Noun');
});
