// data.js — word-corpus lookup index.
//
// Replaces the previous O(n) linear scan (findWordByName looped over the whole
// array on every call) with an O(1) Map keyed by word name. app.js still owns
// the allWords array and calls setWords() once after loading data.json.
'use strict';

var wordIndex = new Map();

// (Re)build the lookup index from the loaded word list. First occurrence of a
// given name wins, matching the original linear scan's behaviour.
export function setWords(words) {
  wordIndex = new Map();
  for (var i = 0; i < words.length; i++) {
    if (!wordIndex.has(words[i].word)) {
      wordIndex.set(words[i].word, words[i]);
    }
  }
}

// Look up a word object by its exact name, or null if it is not present.
export function findWordByName(name) {
  var w = wordIndex.get(name);
  return w === undefined ? null : w;
}
