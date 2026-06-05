// Characterization tests for js/meanings.js — the sense-normalisation helpers.
// Golden values pin the fallback behaviour so display code can rely on a single
// shape whether or not a word has a meanings[] array.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  primaryMeaning,
  getMeanings,
  hasMultipleMeanings,
  additionalMeanings,
} from '../js/meanings.js';

const ADJ = {
  word: 'Objective',
  word_type: 'Adjective',
  definition: 'Based on facts and evidence rather than personal feelings.',
  sentence_usage: 'A good scientist stays objective when reading the results.',
  synonyms: ['Impartial', 'Unbiased', 'Factual'],
  antonyms: ['Subjective', 'Biased', 'Emotional'],
};

const NOUN = {
  word_type: 'Noun',
  definition: 'A goal or aim that you are trying to achieve.',
  sentence_usage: 'Our main objective was to reach the summit before noon.',
  synonyms: ['Goal', 'Aim', 'Target'],
  antonyms: [],
};

test('primaryMeaning mirrors the flat fields', () => {
  assert.deepEqual(primaryMeaning(ADJ), {
    word_type: 'Adjective',
    definition: 'Based on facts and evidence rather than personal feelings.',
    sentence_usage: 'A good scientist stays objective when reading the results.',
    synonyms: ['Impartial', 'Unbiased', 'Factual'],
    antonyms: ['Subjective', 'Biased', 'Emotional'],
  });
});

test('primaryMeaning defaults missing fields to empty string / empty array', () => {
  const m = primaryMeaning({ word: 'Lonely' });
  assert.equal(m.word_type, '');
  assert.equal(m.definition, '');
  assert.equal(m.sentence_usage, '');
  assert.deepEqual(m.synonyms, []);
  assert.deepEqual(m.antonyms, []);
});

test('getMeanings falls back to a one-element array for single-sense words', () => {
  const senses = getMeanings(ADJ);
  assert.equal(senses.length, 1);
  assert.equal(senses[0].word_type, 'Adjective');
  assert.equal(senses[0].definition, ADJ.definition);
});

test('getMeanings returns the meanings[] array verbatim when present', () => {
  const word = Object.assign({}, ADJ, { meanings: [primaryMeaning(ADJ), NOUN] });
  const senses = getMeanings(word);
  assert.equal(senses.length, 2);
  assert.equal(senses[0].word_type, 'Adjective');
  assert.equal(senses[1].word_type, 'Noun');
  assert.deepEqual(senses[1].antonyms, []);
});

test('getMeanings ignores an empty meanings[] array and falls back to flat', () => {
  const word = Object.assign({}, ADJ, { meanings: [] });
  const senses = getMeanings(word);
  assert.equal(senses.length, 1);
  assert.equal(senses[0].word_type, 'Adjective');
});

test('hasMultipleMeanings reflects the sense count', () => {
  assert.equal(hasMultipleMeanings(ADJ), false);
  const word = Object.assign({}, ADJ, { meanings: [primaryMeaning(ADJ), NOUN] });
  assert.equal(hasMultipleMeanings(word), true);
});

test('additionalMeanings returns the non-primary senses only', () => {
  assert.deepEqual(additionalMeanings(ADJ), []);
  const word = Object.assign({}, ADJ, { meanings: [primaryMeaning(ADJ), NOUN] });
  const extra = additionalMeanings(word);
  assert.equal(extra.length, 1);
  assert.equal(extra[0].word_type, 'Noun');
});
