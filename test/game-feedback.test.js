// Characterisation tests for js/game-feedback.js — the pure praise/feedback/
// tier logic extracted from app.js. Tier golden values are taken from the
// original inline implementation, so a threshold change will fail these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PRAISE_PHRASES,
  STREAK_PHRASES,
  pickPraise,
  buildWrongFeedback,
  getScoreTier,
  getBlitzTier,
  getBlitzScore,
} from '../js/game-feedback.js';

// A deterministic rng that returns the given values in order.
const rngOf = (...values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

// ── pickPraise ────────────────────────────────────────────────────────────────
test('pickPraise draws from the praise pool below a 3-streak', () => {
  assert.ok(PRAISE_PHRASES.length >= 8, 'pool should be meaningfully varied');
  assert.equal(pickPraise(0, rngOf(0)), PRAISE_PHRASES[0]);
  assert.equal(pickPraise(1, rngOf(0)), PRAISE_PHRASES[0]);
  assert.equal(pickPraise(2, rngOf(0.999)), PRAISE_PHRASES[PRAISE_PHRASES.length - 1]);
  // Every phrase reachable; none undefined.
  for (let i = 0; i < PRAISE_PHRASES.length; i++) {
    const phrase = pickPraise(1, rngOf(i / PRAISE_PHRASES.length));
    assert.equal(typeof phrase, 'string');
    assert.ok(phrase.length > 0);
  }
});

test('pickPraise celebrates the streak itself from 3 in a row', () => {
  assert.equal(pickPraise(3, rngOf(0)), STREAK_PHRASES[0].replace('{n}', '3'));
  assert.equal(pickPraise(7, rngOf(0)), STREAK_PHRASES[0].replace('{n}', '7'));
  // The substituted count appears in every streak phrase.
  for (let i = 0; i < STREAK_PHRASES.length; i++) {
    const phrase = pickPraise(5, rngOf(i / STREAK_PHRASES.length));
    assert.ok(phrase.indexOf('5') !== -1, `"${phrase}" should contain the streak count`);
    assert.ok(phrase.indexOf('{n}') === -1, 'placeholder must be substituted');
  }
});

// ── buildWrongFeedback ────────────────────────────────────────────────────────
const WORD = { word: 'Abhorrent', definition: 'Causing complete disgust or horror.' };

test('buildWrongFeedback names the correct choice and restates the definition', () => {
  for (const type of ['definition', 'sentence', 'synonym', 'antonym']) {
    const fb = buildWrongFeedback(type, WORD, 'Repulsive');
    assert.equal(fb.headline, '✗ The answer was: Repulsive');
    assert.equal(fb.detail, 'Abhorrent means: Causing complete disgust or horror.');
  }
});

test('buildWrongFeedback suppresses the detail for Word → meaning questions', () => {
  // In 'word' mode the correct choice IS the definition; repeating it teaches
  // nothing.
  const fb = buildWrongFeedback('word', WORD, WORD.definition);
  assert.equal(fb.headline, '✗ The answer was: ' + WORD.definition);
  assert.equal(fb.detail, '');
});

// ── getScoreTier ──────────────────────────────────────────────────────────────
test('getScoreTier keeps the original quiz thresholds (golden values)', () => {
  // Perfect: only on score === total.
  assert.deepEqual(getScoreTier(10, 10), { emoji: '🏆', title: 'Perfect score!', tierId: 'perfect' });
  assert.deepEqual(getScoreTier(5, 5),   { emoji: '🏆', title: 'Perfect score!', tierId: 'perfect' });
  // Star: ≥70%.
  assert.deepEqual(getScoreTier(7, 10), { emoji: '⭐', title: 'Star performance!', tierId: 'star' });
  assert.equal(getScoreTier(9, 10).tierId, 'star');
  // Good: ≥40%.
  assert.equal(getScoreTier(4, 10).tierId, 'good');
  assert.equal(getScoreTier(6, 10).tierId, 'good');
  // Practise: below 40%.
  assert.deepEqual(getScoreTier(3, 10), { emoji: '💪', title: 'Keep practising!', tierId: 'practise' });
  assert.equal(getScoreTier(0, 10).tierId, 'practise');
});

test('getScoreTier boundary behaviour matches the original >= comparisons', () => {
  // 7/10 is exactly 0.7 → star; 2/5 is exactly 0.4 → good.
  assert.equal(getScoreTier(7, 10).tierId, 'star');
  assert.equal(getScoreTier(2, 5).tierId, 'good');
  // 3.5 questions can't exist, but 3/5 (0.6) stays good, 4/5 (0.8) is star.
  assert.equal(getScoreTier(3, 5).tierId, 'good');
  assert.equal(getScoreTier(4, 5).tierId, 'star');
});

// ── getBlitzTier / getBlitzScore ──────────────────────────────────────────────
test('getBlitzTier keeps the original Flash Blitz thresholds (golden values)', () => {
  // Tier is driven by "Got" share alone — Nearly does not count, as before.
  assert.deepEqual(getBlitzTier(8, 0, 2),  { emoji: '⚡', title: 'Lightning Round!', tierId: 'lightning' });
  assert.deepEqual(getBlitzTier(5, 3, 2),  { emoji: '🃏', title: 'Solid Session!',   tierId: 'solid' });
  assert.deepEqual(getBlitzTier(2, 4, 4),  { emoji: '📚', title: 'Keep Flipping!',   tierId: 'practise' });
  // Boundaries: exactly 80% and exactly 50% round up a tier (>= comparisons).
  assert.equal(getBlitzTier(4, 1, 0).tierId, 'lightning'); // 4/5 = 0.8
  assert.equal(getBlitzTier(5, 0, 5).tierId, 'solid');     // 5/10 = 0.5
  // Nearly-heavy sessions stay honest: 0 got of 10 is practise.
  assert.equal(getBlitzTier(0, 10, 0).tierId, 'practise');
  // Empty session does not divide by zero.
  assert.equal(getBlitzTier(0, 0, 0).tierId, 'practise');
});

test('getBlitzScore: 10 pts per Got, 5 per Nearly, none for Missed', () => {
  assert.equal(getBlitzScore(0, 0), 0);
  assert.equal(getBlitzScore(10, 0), 100);
  assert.equal(getBlitzScore(7, 2), 80);
  assert.equal(getBlitzScore(0, 4), 20);
});
