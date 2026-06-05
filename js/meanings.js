// meanings.js — normalise a word's list of senses.
//
// A word's *primary* sense is mirrored onto its flat fields
// (word_type/definition/sentence_usage/synonyms/antonyms) so every existing
// consumer keeps reading one sense unchanged. A polysemous word additionally
// carries a `meanings[]` array, primary first, where meanings[0] equals the flat
// fields (the "mirror invariant", enforced by test/data-integrity.test.js).
//
// These helpers give display code one shape to read regardless of whether a word
// has a meanings[] array yet — single-sense / legacy words fall back to the flat
// fields. Pure (no DOM, no module state), so they are unit-tested under node.
'use strict';

// Build a meaning object from a word's flat (primary) fields. synonyms/antonyms
// always come back as arrays so callers can iterate without guarding.
export function primaryMeaning(word) {
  return {
    word_type: word.word_type || '',
    definition: word.definition || '',
    sentence_usage: word.sentence_usage || '',
    synonyms: Array.isArray(word.synonyms) ? word.synonyms : [],
    antonyms: Array.isArray(word.antonyms) ? word.antonyms : [],
  };
}

// Return the word's senses, primary first, as a non-empty array. Words without a
// meanings[] array (single-sense or legacy) yield a one-element array built from
// the flat fields, so callers never special-case the absence of meanings[].
export function getMeanings(word) {
  if (word && Array.isArray(word.meanings) && word.meanings.length > 0) {
    return word.meanings;
  }
  return [primaryMeaning(word)];
}

// True when the word carries more than one distinct sense to display.
export function hasMultipleMeanings(word) {
  return getMeanings(word).length > 1;
}

// The non-primary senses (everything after meanings[0]); empty for single-sense
// words. Handy for "More meanings" sections that show the primary separately.
export function additionalMeanings(word) {
  return getMeanings(word).slice(1);
}
