// dom-utils.js — pure DOM / array / text helpers shared across the app.
// Extracted verbatim from app.js (modularisation step 2). These functions hold
// no module state and run no top-level side effects, so this file is safe to
// import in Node for unit tests.
'use strict';

// Iterate an array-like (e.g. a NodeList) with a forEach-style callback.
export function forEachNode(list, callback) {
  Array.prototype.forEach.call(list, callback);
}

// Walk up from `element` to the nearest ancestor (inclusive) carrying
// `className`, or null. Browser-only: touches `document` when called.
export function closestByClass(element, className) {
  while (element && element !== document) {
    if (element.classList && element.classList.contains(className)) {
      return element;
    }
    element = element.parentNode;
  }
  return null;
}

// Fisher–Yates shuffle. Returns a new array; does not mutate the input.
export function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}

// Pick up to `count` distractor words from `pool`, excluding the correct word,
// preferring the same part of speech, then filling from the remainder.
export function pickDistractors(correctWord, pool, count) {
  var candidates = pool.filter(function (w) { return w.word !== correctWord.word; });
  var sameType = correctWord.word_type
    ? candidates.filter(function (w) { return w.word_type === correctWord.word_type; })
    : [];

  var picks = [];
  shuffle(sameType).forEach(function (w) {
    if (picks.length < count) picks.push(w);
  });
  if (picks.length < count) {
    var others = candidates.filter(function (w) { return picks.indexOf(w) === -1; });
    shuffle(others).forEach(function (w) {
      if (picks.length < count) picks.push(w);
    });
  }
  return picks;
}

// Blank the target word in its example sentence (case-insensitive, whole word).
// Returns the sentence with the first match replaced by '_____', or null if the
// word does not appear.
export function getSentenceBlank(wordObj) {
  var sentence = wordObj.sentence_usage || '';
  var escapedWord = wordObj.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var wordPattern = new RegExp('\\b' + escapedWord + '\\b', 'i');

  if (!wordPattern.test(sentence)) {
    return null;
  }

  return sentence.replace(wordPattern, '_____');
}

// Generate naive lowercase inflections of a word, used to highlight a word and
// its common variants in reading passages.
export function wordVariants(word) {
  var w = word.toLowerCase();
  var set = {};
  set[w] = true;
  set[w + 's'] = true;
  set[w + 'es'] = true;
  if (/[^aeiou]y$/.test(w)) set[w.slice(0, -1) + 'ies'] = true;
  if (w.charAt(w.length - 1) === 'e') {
    set[w + 'd'] = true;
    set[w.slice(0, -1) + 'ing'] = true;
  } else {
    set[w + 'ed'] = true;
    set[w + 'ing'] = true;
  }
  return Object.keys(set);
}
