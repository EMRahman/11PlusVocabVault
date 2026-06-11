// progress-stats.js — pure progress/streak/CTA computations for the home
// dashboard. No DOM, no storage: state is passed in as plain objects
// (mirroring js/selection.js) so everything is unit-testable.
'use strict';

// Mastery counts across the whole word list. `getStatus(wordName)` is the
// storage.js getMasteryStatus (injected to keep this pure).
export function computeMasteryCounts(words, getStatus) {
  var mastered = 0;
  var learning = 0;
  var fresh = 0;
  words.forEach(function (w) {
    var s = getStatus(w.word);
    if (s === 'mastered') mastered++;
    else if (s === 'learning') learning++;
    else fresh++;
  });
  var total = words.length;
  return {
    mastered: mastered,
    learning: learning,
    fresh: fresh,
    total: total,
    pct: total > 0 ? Math.round((mastered / total) * 100) : 0,
  };
}

// Words that one more correct answer would flip to mastered (storage.js
// thresholds: mastered = correct >= 3 AND correct - incorrect >= 2, so a word
// is "ready" when correct >= 2 AND correct - incorrect >= 1 and it is not
// already mastered).
export function wordsReadyToMaster(words, mastery) {
  return words.filter(function (w) {
    var m = mastery[w.word];
    if (!m) return false;
    var correct = m.correct || 0;
    var incorrect = m.incorrect || 0;
    var isMastered = correct >= 3 && (correct - incorrect) >= 2;
    if (isMastered) return false;
    return (correct + 1) >= 3 && ((correct + 1) - incorrect) >= 2;
  });
}

// Reading-collection summary from a factory progress map ({ id: { read, … } }).
// `next` is the first unread item in collection order (null when finished).
export function summarizeCollection(items, progressMap) {
  var read = 0;
  var next = null;
  items.forEach(function (item) {
    var p = progressMap[item.id];
    if (p && p.read) {
      read++;
    } else if (!next) {
      next = item;
    }
  });
  return { read: read, total: items.length, next: next };
}

// Daily-streak twins of the Daily News logic in app.js (kept separate from the
// news streak; the activity streak means "finished any game today").
// `data` is { streak, lastDate }; day keys are YYYY-MM-DD strings.

// A stored streak is only live while the last active day was today or
// yesterday; a missed day reads as zero.
export function effectiveStreak(data, todayKey, yesterdayKey) {
  if (data && data.streak > 0 &&
      (data.lastDate === todayKey || data.lastDate === yesterdayKey)) {
    return data.streak;
  }
  return 0;
}

// Returns the new streak state after activity today. `bumped` is false when
// today was already counted (callers can skip persisting).
export function bumpDailyStreak(data, todayKey, yesterdayKey) {
  data = data || {};
  if (data.lastDate === todayKey) {
    return { streak: data.streak || 1, lastDate: todayKey, bumped: false };
  }
  var streak = data.lastDate === yesterdayKey ? (data.streak || 0) + 1 : 1;
  return { streak: streak, lastDate: todayKey, bumped: true };
}

// Up to two "what should I do next?" chips for the home dashboard.
// `collections` entries are { id, label, read, total, nextTitle } (nextTitle
// null when the collection is finished). Ranked: ① a mastery quiz when at
// least `readyCount` 3 words are one answer away, ② continue the most-read
// unfinished collection, ③ start an untouched one.
export function buildCtaSuggestions(opts) {
  var out = [];
  var readyCount = opts.readyCount || 0;
  var collections = opts.collections || [];

  if (readyCount >= 3) {
    out.push({
      kind: 'quiz',
      label: '⚡ ' + readyCount + ' words are one answer from mastered — Quiz me!',
    });
  }

  var unfinished = collections.filter(function (c) {
    return c.read > 0 && c.read < c.total && c.nextTitle;
  });
  unfinished.sort(function (a, b) { return b.read - a.read; });

  if (unfinished.length > 0) {
    var cont = unfinished[0];
    out.push({
      kind: 'continue',
      id: cont.id,
      label: '📖 Continue ' + cont.label + ': ' + cont.nextTitle,
    });
  } else {
    var untouched = collections.filter(function (c) {
      return c.read === 0 && c.total > 0 && c.nextTitle;
    });
    if (untouched.length > 0) {
      out.push({
        kind: 'start',
        id: untouched[0].id,
        label: '✨ Start ' + untouched[0].label + ': ' + untouched[0].nextTitle,
      });
    }
  }

  return out.slice(0, 2);
}

// Estimated reading time for an article from its paragraphs, at a child-
// friendly ~130 words per minute, never below one minute. (Used by Phase 4
// reading surfaces; lives here with the other collection maths.)
export function estimateReadMinutes(paragraphs) {
  var wordCount = 0;
  (paragraphs || []).forEach(function (p) {
    wordCount += String(p).split(/\s+/).filter(Boolean).length;
  });
  return Math.max(1, Math.round(wordCount / 130));
}
