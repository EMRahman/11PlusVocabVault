// storage.js — localStorage persistence + mastery logic for progress state.
//
// Operates on the shared singletons in store.js. The load functions replace the
// object CONTENTS in place (rather than reassigning the binding) because those
// bindings are imported read-only elsewhere.
'use strict';

import { viewCounts, mastery } from './store.js';

var VIEW_COUNTS_KEY = 'vocabVault_viewCounts';
var MASTERY_KEY = 'vocabVault_mastery';

// Replace the contents of `target` in place with the entries of `source`.
function replaceContents(target, source) {
  Object.keys(target).forEach(function (k) { delete target[k]; });
  Object.assign(target, source);
}

export function loadViewCounts() {
  try {
    var stored = localStorage.getItem(VIEW_COUNTS_KEY);
    replaceContents(viewCounts, stored ? JSON.parse(stored) : {});
  } catch (e) {
    replaceContents(viewCounts, {});
  }
}

export function saveViewCounts() {
  try {
    localStorage.setItem(VIEW_COUNTS_KEY, JSON.stringify(viewCounts));
  } catch (e) {}
}

export function incrementViewCount(word) {
  viewCounts[word] = (viewCounts[word] || 0) + 1;
  saveViewCounts();
}

export function loadMastery() {
  try {
    var stored = localStorage.getItem(MASTERY_KEY);
    replaceContents(mastery, stored ? JSON.parse(stored) : {});
  } catch (e) {
    replaceContents(mastery, {});
  }
}

export function saveMastery() {
  try { localStorage.setItem(MASTERY_KEY, JSON.stringify(mastery)); } catch (e) {}
}

export function getMasteryStatus(wordName) {
  var m = mastery[wordName];
  if (!m || (m.correct === 0 && m.incorrect === 0)) return 'new';
  if (m.correct >= 3 && (m.correct - m.incorrect) >= 2) return 'mastered';
  return 'learning';
}

// Records one answer and reports the mastery transition it caused, so callers
// can celebrate the moment a word becomes mastered. Existing callers that
// ignore the return value are unaffected.
export function recordAnswer(wordName, isCorrect) {
  var previousStatus = getMasteryStatus(wordName);
  var m = mastery[wordName] || { correct: 0, incorrect: 0, lastWrong: 0 };
  if (isCorrect) {
    m.correct++;
  } else {
    m.incorrect++;
    m.lastWrong = Date.now();
  }
  mastery[wordName] = m;
  saveMastery();
  var status = getMasteryStatus(wordName);
  return {
    status: status,
    previousStatus: previousStatus,
    becameMastered: status === 'mastered' && previousStatus !== 'mastered'
  };
}
