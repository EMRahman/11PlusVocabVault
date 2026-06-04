// Characterisation tests for js/selection.js — the pure word-selection logic
// (daily-news picker + weakest-words pool) extracted from app.js. Golden values
// are taken from the current implementation, so a change in the hash/LCG
// constants or the scoring/sorting rules will fail these.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hashString,
  seededRandom,
  pickDailyWords,
  buildWeakestPool,
} from '../js/selection.js';

// ── hashString ────────────────────────────────────────────────────────────────
test('hashString is a deterministic, non-negative 32-bit hash', () => {
  assert.equal(hashString(''), 0);
  assert.equal(hashString('a'), 97);
  assert.equal(hashString('ab'), 3105);
  assert.equal(hashString('2026-06-04'), 1161814688);
  assert.equal(hashString('hello'), hashString('hello'), 'same input → same hash');
  assert.notEqual(hashString('2026-06-04'), hashString('2026-06-05'), 'different days differ');
});

// ── seededRandom (LCG) ─────────────────────────────────────────────────────────
test('seededRandom yields a deterministic [0,1) sequence per seed', () => {
  const a = seededRandom(0);
  // Golden sequence locks the LCG constants (1664525 / 1013904223 / 2^32).
  assert.equal(a(), 0.23606797284446657);
  assert.equal(a(), 0.278566908556968);
  assert.equal(a(), 0.8195337599609047);

  // Same seed reproduces the same stream; a different seed diverges.
  assert.deepEqual(
    [seededRandom(7)(), seededRandom(7)()],
    [seededRandom(7)(), seededRandom(7)()],
  );
  assert.notEqual(seededRandom(0)(), seededRandom(123)());

  // Range check across many draws.
  const r = seededRandom(999);
  for (let i = 0; i < 1000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `value ${v} out of [0,1)`);
  }
});

// ── pickDailyWords ────────────────────────────────────────────────────────────
const DAILY_WORDS = [
  { word: 'N1' }, { word: 'N2' }, { word: 'L1' },
  { word: 'L2' }, { word: 'M1' }, { word: 'M2' },
];
const DAILY_STATUS = { N1: 'new', N2: 'new', L1: 'learning', L2: 'learning', M1: 'mastered', M2: 'mastered' };
const statusOf = (name) => DAILY_STATUS[name];

test('pickDailyWords favours weaker tiers: new > learning > mastered', () => {
  // tier (new=3, learning=2, mastered=1) + jitter in [0,1) means a higher tier
  // always outranks a lower one regardless of seed.
  const top2 = pickDailyWords(DAILY_WORDS, statusOf, '2026-06-04', 2).map((w) => w.word);
  assert.deepEqual(top2.slice().sort(), ['N1', 'N2'], 'top 2 are the two "new" words');

  const top4 = pickDailyWords(DAILY_WORDS, statusOf, '2026-06-04', 4).map((w) => w.word);
  assert.deepEqual(top4.slice().sort(), ['L1', 'L2', 'N1', 'N2'], 'top 4 are new + learning, never mastered');
});

test('pickDailyWords is deterministic for a day and returns the actual word objects', () => {
  const a = pickDailyWords(DAILY_WORDS, statusOf, '2026-06-04', 4);
  const b = pickDailyWords(DAILY_WORDS, statusOf, '2026-06-04', 4);
  assert.deepEqual(a, b, 'same day → same set and order');
  // Golden order (locks hash + LCG + sort together).
  assert.deepEqual(a.map((w) => w.word), ['N2', 'N1', 'L1', 'L2']);
  assert.equal(a[0], DAILY_WORDS[1], 'returns the original word object, not a copy');
});

test('pickDailyWords caps n at the corpus size', () => {
  const all = pickDailyWords(DAILY_WORDS, statusOf, 'seed', 99);
  assert.equal(all.length, DAILY_WORDS.length);
});

// ── buildWeakestPool ──────────────────────────────────────────────────────────
const keepOrder = (arr) => arr.slice(); // deterministic stand-in for shuffle

test('buildWeakestPool ranks missed words by margin desc, then most-recent miss', () => {
  const pool = [{ word: 'A' }, { word: 'B' }, { word: 'C' }, { word: 'D' }, { word: 'E' }];
  const mastery = {
    A: { correct: 0, incorrect: 3, lastWrong: 100 }, // margin 3
    B: { correct: 1, incorrect: 3, lastWrong: 200 }, // margin 2
    C: { correct: 1, incorrect: 1, lastWrong: 300 }, // margin 0
    D: { correct: 5, incorrect: 0 },                 // no misses → excluded
    E: { correct: 0, incorrect: 1, lastWrong: 50 },  // margin 1
  };
  const out = buildWeakestPool(pool, mastery, () => 'learning', 4, keepOrder).map((w) => w.word);
  assert.deepEqual(out, ['A', 'B', 'E', 'C'], 'worst margin first; D (no misses) excluded');
});

test('buildWeakestPool breaks margin ties by the more recent miss', () => {
  const pool = [{ word: 'X' }, { word: 'Y' }];
  const mastery = {
    X: { correct: 0, incorrect: 2, lastWrong: 500 },
    Y: { correct: 0, incorrect: 2, lastWrong: 900 },
  };
  const out = buildWeakestPool(pool, mastery, () => 'learning', 2, keepOrder).map((w) => w.word);
  assert.deepEqual(out, ['Y', 'X'], 'equal margin → most recent miss first');
});

test('buildWeakestPool pads with non-mastered words when short of minCount', () => {
  const pool = [{ word: 'A' }, { word: 'P' }, { word: 'Q' }, { word: 'M' }];
  const mastery = { A: { correct: 0, incorrect: 2, lastWrong: 100 } };
  const getStatus = (name) => ({ A: 'learning', P: 'new', Q: 'learning', M: 'mastered' }[name] || 'new');
  const out = buildWeakestPool(pool, mastery, getStatus, 3, keepOrder).map((w) => w.word);
  assert.deepEqual(out, ['A', 'P', 'Q'], 'miss first, then non-mastered pad; mastered M excluded');
});

test('buildWeakestPool falls back to the whole base pool when nothing qualifies', () => {
  const pool = [{ word: 'X' }, { word: 'Y' }, { word: 'Z' }];
  const out = buildWeakestPool(pool, {}, () => 'mastered', 5, keepOrder).map((w) => w.word);
  assert.deepEqual(out, ['X', 'Y', 'Z'], 'all mastered / no misses → shuffled copy of base pool');
});

test('buildWeakestPool returns the miss list as-is when it already meets minCount', () => {
  const pool = [{ word: 'A' }, { word: 'B' }, { word: 'PAD' }];
  const mastery = {
    A: { correct: 0, incorrect: 2, lastWrong: 10 },
    B: { correct: 0, incorrect: 1, lastWrong: 20 },
  };
  let shuffleCalls = 0;
  const spyShuffle = (arr) => { shuffleCalls++; return arr.slice(); };
  const out = buildWeakestPool(pool, mastery, () => 'new', 2, spyShuffle).map((w) => w.word);
  assert.deepEqual(out, ['A', 'B'], 'no padding when misses already satisfy minCount');
  assert.equal(shuffleCalls, 0, 'shuffle is not used on the early-return path');
});
