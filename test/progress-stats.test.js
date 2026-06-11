// Characterisation tests for js/progress-stats.js — the pure home-dashboard
// stats: mastery counts, ready-to-master detection, collection summaries, the
// cross-game daily streak, CTA ranking and read-time estimation.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMasteryCounts,
  wordsReadyToMaster,
  summarizeCollection,
  effectiveStreak,
  bumpDailyStreak,
  buildCtaSuggestions,
  formatCollectionProgress,
  estimateReadMinutes,
} from '../js/progress-stats.js';

// ── computeMasteryCounts ──────────────────────────────────────────────────────
const WORDS = [{ word: 'A' }, { word: 'B' }, { word: 'C' }, { word: 'D' }];
const STATUS = { A: 'mastered', B: 'learning', C: 'learning', D: 'new' };

test('computeMasteryCounts tallies statuses and a rounded mastered pct', () => {
  assert.deepEqual(
    computeMasteryCounts(WORDS, (w) => STATUS[w]),
    { mastered: 1, learning: 2, fresh: 1, total: 4, pct: 25 },
  );
  assert.deepEqual(
    computeMasteryCounts([], () => 'new'),
    { mastered: 0, learning: 0, fresh: 0, total: 0, pct: 0 },
  );
});

// ── wordsReadyToMaster ────────────────────────────────────────────────────────
test('wordsReadyToMaster finds words one correct answer from mastered', () => {
  const mastery = {
    Ready1:  { correct: 2, incorrect: 0 }, // +1 → 3 correct, margin 3 ✓
    Ready2:  { correct: 2, incorrect: 1 }, // +1 → 3 correct, margin 2 ✓
    Ready3:  { correct: 4, incorrect: 4 }, // +1 → 5 correct, margin 1... ✗
    Ready4:  { correct: 3, incorrect: 2 }, // +1 → 4 correct, margin 2 ✓ (currently margin 1)
    TooNew:  { correct: 1, incorrect: 0 }, // +1 → only 2 correct ✗
    Behind:  { correct: 2, incorrect: 2 }, // +1 → margin 1 ✗
    Done:    { correct: 3, incorrect: 0 }, // already mastered ✗
  };
  const words = Object.keys(mastery).map((w) => ({ word: w }));
  words.push({ word: 'Unseen' }); // no mastery entry ✗
  assert.deepEqual(
    wordsReadyToMaster(words, mastery).map((w) => w.word),
    ['Ready1', 'Ready2', 'Ready4'],
  );
});

// ── summarizeCollection ───────────────────────────────────────────────────────
const ITEMS = [
  { id: 'a1', title: 'First' },
  { id: 'a2', title: 'Second' },
  { id: 'a3', title: 'Third' },
];

test('summarizeCollection counts read items and points at the first unread', () => {
  const summary = summarizeCollection(ITEMS, { a1: { read: true, bestScore: 8 } });
  assert.equal(summary.read, 1);
  assert.equal(summary.total, 3);
  assert.equal(summary.next.id, 'a2');
});

test('summarizeCollection: untouched, gap-filling, and finished collections', () => {
  assert.deepEqual(summarizeCollection(ITEMS, {}), { read: 0, total: 3, next: ITEMS[0] });
  // Read out of order: next is the first gap, not the item after the last read.
  const gappy = summarizeCollection(ITEMS, { a2: { read: true } });
  assert.equal(gappy.next.id, 'a1');
  const done = summarizeCollection(ITEMS, {
    a1: { read: true }, a2: { read: true }, a3: { read: true },
  });
  assert.deepEqual(done, { read: 3, total: 3, next: null });
});

// ── streaks ───────────────────────────────────────────────────────────────────
const TODAY = '2026-06-11';
const YESTERDAY = '2026-06-10';

test('effectiveStreak is live only when last activity was today or yesterday', () => {
  assert.equal(effectiveStreak({ streak: 4, lastDate: TODAY }, TODAY, YESTERDAY), 4);
  assert.equal(effectiveStreak({ streak: 4, lastDate: YESTERDAY }, TODAY, YESTERDAY), 4);
  assert.equal(effectiveStreak({ streak: 4, lastDate: '2026-06-08' }, TODAY, YESTERDAY), 0);
  assert.equal(effectiveStreak({ streak: 0, lastDate: TODAY }, TODAY, YESTERDAY), 0);
  assert.equal(effectiveStreak(null, TODAY, YESTERDAY), 0);
});

test('bumpDailyStreak: starts, continues, restarts, and is idempotent per day', () => {
  // First ever activity.
  assert.deepEqual(bumpDailyStreak({}, TODAY, YESTERDAY),
    { streak: 1, lastDate: TODAY, bumped: true });
  // Continues yesterday's run.
  assert.deepEqual(bumpDailyStreak({ streak: 3, lastDate: YESTERDAY }, TODAY, YESTERDAY),
    { streak: 4, lastDate: TODAY, bumped: true });
  // A lapsed run restarts at 1.
  assert.deepEqual(bumpDailyStreak({ streak: 9, lastDate: '2026-06-01' }, TODAY, YESTERDAY),
    { streak: 1, lastDate: TODAY, bumped: true });
  // Second game today does not double-count.
  assert.deepEqual(bumpDailyStreak({ streak: 4, lastDate: TODAY }, TODAY, YESTERDAY),
    { streak: 4, lastDate: TODAY, bumped: false });
});

// ── buildCtaSuggestions ───────────────────────────────────────────────────────
const COLLECTIONS = [
  { id: 'history', label: 'History', read: 5, total: 20, nextTitle: 'The Romans' },
  { id: 'space',   label: 'Space',   read: 12, total: 15, nextTitle: 'Black Holes' },
  { id: 'fable',   label: 'Fables',  read: 0, total: 10, nextTitle: 'Tortoise and Hare' },
  { id: 'money',   label: 'Money',   read: 16, total: 16, nextTitle: null },
];

test('buildCtaSuggestions ranks mastery quiz first, then the most-read unfinished collection', () => {
  const ctas = buildCtaSuggestions({ collections: COLLECTIONS, readyCount: 5 });
  assert.equal(ctas.length, 2);
  assert.equal(ctas[0].kind, 'quiz');
  assert.ok(ctas[0].label.includes('5 words'));
  assert.equal(ctas[1].kind, 'continue');
  assert.equal(ctas[1].id, 'space'); // 12 read beats 5 read; finished money skipped
  assert.ok(ctas[1].label.includes('Black Holes'));
});

test('buildCtaSuggestions: no quiz below 3 ready; start chip when nothing begun', () => {
  const ctas = buildCtaSuggestions({ collections: COLLECTIONS, readyCount: 2 });
  assert.equal(ctas.length, 1);
  assert.equal(ctas[0].kind, 'continue');

  const fresh = buildCtaSuggestions({
    collections: [COLLECTIONS[2], COLLECTIONS[3]], // untouched fables + finished money
    readyCount: 0,
  });
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0].kind, 'start');
  assert.equal(fresh[0].id, 'fable');

  assert.deepEqual(buildCtaSuggestions({ collections: [], readyCount: 0 }), []);
});

// ── formatCollectionProgress ──────────────────────────────────────────────────
test('formatCollectionProgress renders the library header string', () => {
  assert.equal(formatCollectionProgress(12, 28), "You've read 12 of 28");
  assert.equal(formatCollectionProgress(0, 10), "You've read 0 of 10");
});

// ── estimateReadMinutes ───────────────────────────────────────────────────────
test('estimateReadMinutes uses ~130 wpm with a one-minute floor', () => {
  assert.equal(estimateReadMinutes([]), 1);
  assert.equal(estimateReadMinutes(['Just a few words.']), 1);
  const para65 = Array(65).fill('word').join(' ');
  assert.equal(estimateReadMinutes([para65, para65]), 1);          // 130 → 1
  assert.equal(estimateReadMinutes([para65, para65, para65]), 2);  // 195 → 1.5 → 2
  const para130 = Array(130).fill('word').join(' ');
  assert.equal(estimateReadMinutes([para130, para130, para130]), 3);
});
