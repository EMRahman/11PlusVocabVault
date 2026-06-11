// game-feedback.js — pure feedback/tier helpers for the quiz and games.
//
// No DOM and no module state: everything (including the RNG) is passed in,
// mirroring js/selection.js, so the logic is unit-testable under node --test.
// app.js owns the rendering; this module owns the words and the thresholds.
'use strict';

// Praise pool for correct answers (was 4 phrases inline in app.js).
export const PRAISE_PHRASES = [
  '✓ Brilliant!',
  '✓ Spot on!',
  '✓ Nice work!',
  '✓ Excellent!',
  '✓ You got it!',
  '✓ Superb!',
  '✓ Exactly right!',
  '✓ Great thinking!',
  '✓ Word wizard!',
  "✓ That's the one!",
];

// Once a child is on a run, the phrase celebrates the run itself.
export const STREAK_PHRASES = [
  '🔥 {n} in a row!',
  '🔥 {n} straight — on fire!',
  '🔥 Unstoppable — {n} in a row!',
];

// Pick a praise phrase for a correct answer. `streak` is the running count of
// consecutive correct answers INCLUDING this one; from 3 the phrase switches to
// streak celebration. `rng` defaults to Math.random (inject for tests).
export function pickPraise(streak, rng) {
  rng = rng || Math.random;
  if (streak >= 3) {
    var s = STREAK_PHRASES[Math.floor(rng() * STREAK_PHRASES.length)];
    return s.replace('{n}', String(streak));
  }
  return PRAISE_PHRASES[Math.floor(rng() * PRAISE_PHRASES.length)];
}

// Build the two-line feedback for a wrong answer: the correct choice, plus a
// learning detail restating the word's definition. The detail is suppressed
// for 'word' questions (Word → meaning), where the correct choice already IS
// the definition and repeating it teaches nothing.
export function buildWrongFeedback(questionType, wordObj, correctChoice) {
  var headline = '✗ The answer was: ' + correctChoice;
  if (questionType === 'word') {
    return { headline: headline, detail: '' };
  }
  return {
    headline: headline,
    detail: wordObj.word + ' means: ' + wordObj.definition,
  };
}

// End-of-quiz tier. Thresholds are characterized from the original inline
// logic in app.js (perfect / ≥70% / ≥40% / below).
export function getScoreTier(score, total) {
  if (score === total)            return { emoji: '🏆', title: 'Perfect score!',     tierId: 'perfect' };
  if (score >= total * 0.7)       return { emoji: '⭐', title: 'Star performance!', tierId: 'star' };
  if (score >= total * 0.4)       return { emoji: '👍', title: 'Good effort!',      tierId: 'good' };
  return                                 { emoji: '💪', title: 'Keep practising!',  tierId: 'practise' };
}
