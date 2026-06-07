// Characterisation tests for js/quiz.js — the pure question-eligibility logic
// extracted from app.js. Golden values are taken from the original app.js
// behaviour, so a change to which question types a word qualifies for (the rules
// that drive both the normal quiz and Story Quest's themed clozes) will fail
// these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  caseInsensitiveSet,
  getThemedQuest,
  getQuestSentenceBlank,
  getThemedRelation,
  hasUsableThemedRelation,
  getQuestionTypesForWord,
} from '../js/quiz.js';

// A fully-featured word: example sentence contains the word, plus synonyms and
// antonyms, plus a themed_quest payload with both relation clozes.
const FULL = {
  word: 'Brave',
  synonyms: ['Bold', 'Fearless'],
  antonyms: ['Timid', 'Cowardly'],
  sentence_usage: 'The brave knight charged the gate.',
  themed_quest: {
    theme: 'army-battle',
    word: 'Brave',
    sentence: 'The _____ soldier held the line.',
    synonym: { cloze: 'A _____ captain led the charge.', answer: 'Bold' },
    antonym: { cloze: 'No _____ recruit would run.', answer: 'Timid' },
  },
};

// ── caseInsensitiveSet ──────────────────────────────────────────────────────
test('caseInsensitiveSet lowercases keys and skips falsy entries', () => {
  const set = caseInsensitiveSet(['Bold', 'FEARLESS', '', null, undefined]);
  assert.deepEqual(set, { bold: true, fearless: true });
  assert.ok(set['bold'] && set['fearless']);
  assert.equal(set['Bold'], undefined, 'lookup is lowercase-only');
});

// ── getThemedQuest ──────────────────────────────────────────────────────────
test('getThemedQuest returns the payload or null', () => {
  assert.strictEqual(getThemedQuest(FULL), FULL.themed_quest);
  assert.equal(getThemedQuest({ word: 'X' }), null);
  assert.equal(getThemedQuest(null), null);
  assert.equal(getThemedQuest(undefined), null);
});

// ── getQuestSentenceBlank ───────────────────────────────────────────────────
test('getQuestSentenceBlank prefers the themed cloze over the static blank', () => {
  assert.equal(getQuestSentenceBlank(FULL), 'The _____ soldier held the line.');
});

test('getQuestSentenceBlank falls back to blanking the example sentence', () => {
  const plain = { word: 'happy', sentence_usage: 'She was very happy today.' };
  assert.equal(getQuestSentenceBlank(plain), 'She was very _____ today.');
  // No themed sentence and no matchable word → null (matches getSentenceBlank).
  assert.equal(getQuestSentenceBlank({ word: 'zebra', sentence_usage: 'No match.' }), null);
});

// ── getThemedRelation / hasUsableThemedRelation ─────────────────────────────
test('getThemedRelation returns the cloze/answer pair only when well-formed', () => {
  assert.deepEqual(getThemedRelation(FULL, 'synonym'), { cloze: 'A _____ captain led the charge.', answer: 'Bold' });
  assert.equal(getThemedRelation({ word: 'X' }, 'synonym'), null, 'no themed_quest → null');
  // Missing answer or non-string cloze → null.
  const bad = { themed_quest: { synonym: { cloze: 'x', answer: '' }, antonym: { cloze: 5, answer: 'y' } } };
  assert.equal(getThemedRelation(bad, 'synonym'), null);
  assert.equal(getThemedRelation(bad, 'antonym'), null);
});

test('hasUsableThemedRelation requires the answer to be one of the word\'s own relations', () => {
  assert.equal(hasUsableThemedRelation(FULL, 'synonym'), true);
  assert.equal(hasUsableThemedRelation(FULL, 'antonym'), true);
  // Answer not present in the word's synonyms → unusable (distractor-safety gate).
  const mismatch = {
    synonyms: ['Bold'],
    antonyms: [],
    themed_quest: { synonym: { cloze: 'A _____ one.', answer: 'Stranger' } },
  };
  assert.equal(hasUsableThemedRelation(mismatch, 'synonym'), false);
  assert.equal(hasUsableThemedRelation(mismatch, 'antonym'), false, 'no antonym relation → false');
});

// ── getQuestionTypesForWord ─────────────────────────────────────────────────
test('normal mode: definition+word always available, plus sentence/synonym/antonym when supported', () => {
  assert.deepEqual(getQuestionTypesForWord(FULL, false), ['definition', 'word', 'sentence', 'synonym', 'antonym']);

  // Word with no example match and no relations → only definition + word.
  const bare = { word: 'zebra', sentence_usage: 'No match.', synonyms: [], antonyms: [] };
  assert.deepEqual(getQuestionTypesForWord(bare, false), ['definition', 'word']);

  // Sentence available but no relations.
  const sentOnly = { word: 'happy', sentence_usage: 'I am happy.', synonyms: [], antonyms: [] };
  assert.deepEqual(getQuestionTypesForWord(sentOnly, false), ['definition', 'word', 'sentence']);
});

test('quest mode: only themed clozes count, and always falls back to sentence', () => {
  assert.deepEqual(getQuestionTypesForWord(FULL, true), ['sentence', 'synonym', 'antonym']);

  // A themed sentence but relations whose answers are not the word's own → just sentence.
  const sentenceOnly = {
    synonyms: ['Bold'],
    antonyms: ['Timid'],
    themed_quest: {
      sentence: 'The _____ one.',
      synonym: { cloze: 'A _____ x.', answer: 'NotASynonym' },
    },
  };
  assert.deepEqual(getQuestionTypesForWord(sentenceOnly, true), ['sentence']);

  // No themed payload at all in quest mode still yields the safe ['sentence'].
  assert.deepEqual(getQuestionTypesForWord({ word: 'X' }, true), ['sentence']);
});
