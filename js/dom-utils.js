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

// Pick up to `count` distractor words from `pool`, excluding the correct word
// and any direct synonym/antonym of the correct word (either direction),
// preferring the same part of speech, then filling from the remainder.
export function pickDistractors(correctWord, pool, count) {
  var targetLower = (correctWord.word || '').toLowerCase();
  var blocked = {};
  blocked[targetLower] = true;
  (correctWord.synonyms || []).forEach(function (s) {
    if (s) blocked[s.toLowerCase()] = true;
  });
  (correctWord.antonyms || []).forEach(function (a) {
    if (a) blocked[a.toLowerCase()] = true;
  });

  function isRelated(w) {
    var wLower = (w.word || '').toLowerCase();
    if (blocked[wLower]) return true;
    var syns = w.synonyms || [];
    for (var i = 0; i < syns.length; i++) {
      if (syns[i] && syns[i].toLowerCase() === targetLower) return true;
    }
    var ants = w.antonyms || [];
    for (var j = 0; j < ants.length; j++) {
      if (ants[j] && ants[j].toLowerCase() === targetLower) return true;
    }
    return false;
  }

  var nonTarget = pool.filter(function (w) { return w.word !== correctWord.word; });
  var safeCandidates = nonTarget.filter(function (w) { return !isRelated(w); });
  var candidates = safeCandidates.length >= count ? safeCandidates : nonTarget;

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

// Blank the target word in its example sentence (case-insensitive, whole word,
// falling back to common inflections when the sentence uses a plural/past form).
// Returns the sentence with the first match replaced by '_____', or null if the
// word does not appear.
export function getSentenceBlank(wordObj) {
  var sentence = wordObj.sentence_usage || '';
  var escapedWord = wordObj.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var wordPattern = new RegExp('\\b' + escapedWord + '\\b', 'i');

  if (wordPattern.test(sentence)) {
    return sentence.replace(wordPattern, '_____');
  }

  var variants = highlightVariants(wordObj.word).slice().sort(function (a, b) {
    return b.length - a.length;
  });
  for (var i = 0; i < variants.length; i++) {
    var esc = variants[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b' + esc + '\\b', 'i');
    if (re.test(sentence)) {
      return sentence.replace(re, '_____');
    }
  }

  return null;
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

// Richer inflection set for prose highlighting and sentence-blank fallback:
// includes wordVariants(word) plus adverbs (-ly/-ily), doubled final consonants
// (compelled), past-tense verb stems (bellowed -> bellow/bellows/bellowing),
// and common nominal/adjectival derivations (-t -> -ce, -ous -> base).
export function highlightVariants(word) {
  var w = word.toLowerCase();
  var set = {};
  wordVariants(w).forEach(function (v) { set[v] = true; });
  set[w + 'ly'] = true;
  set[w + 'ment'] = true;
  set[w + 'ate'] = true;
  if (/[^aeiou]y$/.test(w)) {
    set[w.slice(0, -1) + 'ily'] = true;
    set[w.slice(0, -1) + 'ied'] = true;
  }
  if (/le$/.test(w)) {
    set[w.slice(0, -1) + 'y'] = true;
  }
  if (/ic$/.test(w)) {
    set[w + 'ally'] = true;
  }
  // Doubled final consonant (e.g. compel -> compelled, compelling)
  if (/[aeiou][bcdfghlmnprstvz]$/.test(w)) {
    var last = w.charAt(w.length - 1);
    set[w + last + 'ed'] = true;
    set[w + last + 'ing'] = true;
  }
  // Headwords stored in -ed form (e.g. bellowed, lurched, muttered, contented)
  if (/ed$/.test(w) && w.length > 4) {
    var stem = w.slice(0, -2);
    set[stem] = true;
    set[stem + 's'] = true;
    set[stem + 'es'] = true;
    set[stem + 'ing'] = true;
    var stemE = w.slice(0, -1);
    set[stemE] = true;
    set[stemE + 's'] = true;
  }
  // -ent / -ant adjectives -> -ence / -ance nouns (resilient, obedient, vigilant)
  if (/[ae]nt$/.test(w)) {
    set[w.slice(0, -1) + 'ce'] = true;
  }
  // -ous adjectives -> base noun (courageous -> courage)
  if (/ous$/.test(w) && w.length > 5) {
    set[w.slice(0, -3)] = true;
  }
  // Irregular forms in corpus fables
  if (w === 'forsake') {
    set['forsook'] = true;
    set['forsaken'] = true;
  }
  return Object.keys(set);
}
