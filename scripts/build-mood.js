#!/usr/bin/env node
'use strict';

// Builds heuristic mood scores (formality, valence) for every word, based on
// the synonyms/antonyms/definition text already in data/words.json. Output is
// merged into data/word-explorer.json under the "mood" key.
//
// Heuristic is intentionally simple — good enough for a kid-facing "mood map"
// at v1. Higher-quality LLM-generated overrides can be merged in later via
// scripts/merge-explorer.js without losing these defaults.
//
// Run: node scripts/build-mood.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const EXPLORER_PATH = path.join(ROOT, 'data', 'word-explorer.json');

// Tiny seed lexicons of clearly positive/negative concepts. Used to inspect
// each word's synonyms, antonyms and definition text for emotional cues.
const POSITIVE = new Set([
  'happy','joy','joyful','good','great','beautiful','kind','love','calm','peace',
  'peaceful','bright','strong','wise','brave','gentle','noble','radiant','warm',
  'sweet','tender','grace','hope','triumph','delight','pleasing','pleasant','agree',
  'agreeable','elegant','exquisite','grand','superb','wonderful','splendid','glory',
  'glorious','heroic','dignified','sincere','generous','clever','impressive','fine',
  'safe','protect','protective','careful','thoughtful','cheerful','smart','helpful',
  'eager','lively','energetic','playful','friendly','cosy','cozy','soft',
]);

const NEGATIVE = new Set([
  'sad','bad','ugly','cruel','evil','hate','hatred','dark','weak','foolish','vile',
  'cold','sour','harsh','grief','despair','horror','agony','wretched','dreadful',
  'grim','bleak','fear','fearful','terrible','awful','horrible','disgust','disgusting',
  'angry','anger','rage','furious','violent','dangerous','threat','threatening',
  'gloomy','miserable','painful','pain','suffer','suffering','ruin','ruined','broken',
  'lonely','tired','exhausted','dull','stupid','foolish','rude','mean','nasty',
  'sneaky','dishonest','greedy','jealous','bitter','sorrow','shame','disgrace',
]);

// Suffixes that strongly signal a Latin/Greek/formal register.
const FORMAL_SUFFIXES = [
  'tion','sion','ity','ence','ance','ous','ize','ate','able','ible',
  'esque','ial','escent','ify','ology','itude','escence','aceous','iform',
];

const CASUAL_HINTS = [
  // Short Germanic-feeling roots tend to be more casual
  'icky','grimy','tipsy','snug','spooky','creepy','grumpy','cosy','cozy','tricky',
];

function norm(s) { return String(s || '').toLowerCase(); }

function sentimentFromText(text, weight) {
  let s = 0;
  const lower = norm(text);
  POSITIVE.forEach(function (p) {
    if (lower.indexOf(p) !== -1) s += weight;
  });
  NEGATIVE.forEach(function (n) {
    if (lower.indexOf(n) !== -1) s -= weight;
  });
  return s;
}

function valenceScore(word) {
  let s = 0;
  // Synonyms speak loudest
  (word.synonyms || []).forEach(function (syn) {
    const w = norm(syn);
    if (POSITIVE.has(w)) s += 2;
    if (NEGATIVE.has(w)) s -= 2;
    s += sentimentFromText(syn, 0.5);
  });
  // Antonyms invert
  (word.antonyms || []).forEach(function (ant) {
    const w = norm(ant);
    if (POSITIVE.has(w)) s -= 1.2;
    if (NEGATIVE.has(w)) s += 1.2;
  });
  // Definition gives weaker context
  s += sentimentFromText(word.definition || '', 0.4);
  // Squash into [-1, 1]
  return Math.max(-1, Math.min(1, s / 5));
}

function formalityScore(word) {
  const w = norm(word.word);
  let s = 0;
  // Word length: longer ~ more formal (gentle slope, capped)
  s += Math.min(0.45, Math.max(-0.15, (w.length - 6) * 0.06));
  // Latin/Greek suffix bump
  for (let i = 0; i < FORMAL_SUFFIXES.length; i++) {
    if (w.endsWith(FORMAL_SUFFIXES[i])) { s += 0.25; break; }
  }
  // Casual roots
  for (let i = 0; i < CASUAL_HINTS.length; i++) {
    if (w.indexOf(CASUAL_HINTS[i]) !== -1) { s -= 0.3; break; }
  }
  // Type hint: adverbs/conjunctions cluster casual; nouns/adjectives slightly formal
  const t = norm(word.word_type);
  if (t === 'verb') s += 0.05;
  if (t === 'adjective') s += 0.05;
  if (t === 'preposition' || t === 'conjunction' || t === 'pronoun') s -= 0.1;
  // Centre around 0.5 (neutral), squash into [0, 1]
  return Math.max(0, Math.min(1, 0.5 + s));
}

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const words = data.words;
  const mood = {};
  words.forEach(function (w) {
    mood[w.word] = {
      formality: Math.round(formalityScore(w) * 1000) / 1000,
      valence: Math.round(valenceScore(w) * 1000) / 1000,
    };
  });
  let existing = {};
  if (fs.existsSync(EXPLORER_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(EXPLORER_PATH, 'utf8')); } catch (_) {}
  }
  const out = Object.assign({}, existing, {
    generated: new Date().toISOString(),
    mood: mood,
    etymology: existing.etymology || {},
    popularity: existing.popularity || {},
  });
  fs.writeFileSync(EXPLORER_PATH, JSON.stringify(out));
  const kb = (fs.statSync(EXPLORER_PATH).size / 1024).toFixed(1);
  console.log('Wrote mood for ' + words.length + ' words → ' + EXPLORER_PATH + ' (' + kb + ' KB total)');
}

main();
