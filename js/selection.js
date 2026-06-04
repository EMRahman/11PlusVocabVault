// selection.js — pure word-selection algorithms extracted from app.js so they
// can be unit-tested under `node --test` without a DOM. app.js keeps ownership
// of the state (allWords, mastery, the daily seed) and passes it in here.
'use strict';

// Stable 32-bit string hash; seeds the daily word picker so the chosen set is
// deterministic for a given calendar day.
export function hashString(str) {
  var h = 0;
  for (var i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Deterministic 0..1 generator (LCG) so the daily word set is stable within a
// calendar day but rotates from one day to the next.
export function seededRandom(seed) {
  var s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Pick the top-`n` words for a given day. Each word is scored by its mastery
// tier (new=3, learning=2, mastered=1) plus a seeded jitter, so new/weak words
// are favoured while the set still rotates daily and ties break deterministically.
// `getStatus(name)` returns 'new' | 'learning' | 'mastered'; `seedStr` is the
// day key (e.g. '2026-06-04'). Returns word objects (not names), highest first.
export function pickDailyWords(words, getStatus, seedStr, n) {
  var rng = seededRandom(hashString(seedStr));
  var tier = { 'new': 3, learning: 2, mastered: 1 };
  var scored = words.map(function (w) {
    return { word: w, score: (tier[getStatus(w.word)] || 1) + rng() };
  });
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, Math.min(n, scored.length)).map(function (x) { return x.word; });
}

// Build the "weakest words" quiz pool: words the learner has answered wrong
// (margin = incorrect - correct >= 0), worst margin first, then most recent
// miss. Pads with non-mastered words (shuffled) up to `minCount`; if nothing
// qualifies at all, returns a shuffled copy of `basePool` so the quiz can still
// run. `mastery` is the name -> { correct, incorrect, lastWrong } map;
// `getStatus(name)` returns the mastery tier; `shuffleFn(arr)` returns a
// shuffled copy (injected so callers/tests control the randomness).
export function buildWeakestPool(basePool, mastery, getStatus, minCount, shuffleFn) {
  var withMisses = basePool.filter(function (w) {
    var m = mastery[w.word];
    return m && m.incorrect > 0 && (m.incorrect - m.correct) >= 0;
  });
  withMisses.sort(function (a, b) {
    var ma = mastery[a.word];
    var mb = mastery[b.word];
    var diffA = ma.incorrect - ma.correct;
    var diffB = mb.incorrect - mb.correct;
    if (diffB !== diffA) return diffB - diffA;
    return (mb.lastWrong || 0) - (ma.lastWrong || 0);
  });

  if (withMisses.length >= minCount) return withMisses;

  // Pad with non-mastered words so the quiz can run.
  var seen = {};
  withMisses.forEach(function (w) { seen[w.word] = true; });
  var pad = shuffleFn(basePool.filter(function (w) {
    return !seen[w.word] && getStatus(w.word) !== 'mastered';
  }));
  var combined = withMisses.concat(pad);

  // If everything is mastered (or basePool empty), fall back to a shuffled copy
  // of basePool so the user can keep practising rather than the quiz rendering
  // with no questions.
  if (combined.length === 0) {
    return shuffleFn(basePool);
  }
  return combined;
}
