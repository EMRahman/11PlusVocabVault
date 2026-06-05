#!/usr/bin/env node
'use strict';

// Validates the model responses pasted into scripts/meanings-prompts/*.json
// (`outputs` field) and merges the ADDITIONAL senses into data/words.json as a
// meanings[] array. The curated primary always stays meanings[0] (a mirror of the
// flat word_type/definition/sentence_usage/synonyms/antonyms); only distinct,
// validated extra senses are appended, capped at MAX_MEANINGS total.
//
// Idempotent and update-in-place: existing hand-seeded extras are preserved, the
// primary is re-mirrored from the flat fields, and a word with no valid extra is
// left WITHOUT a meanings[] array (it is optional — js/meanings.js falls back to
// the flat fields). Validators mirror scripts/merge-themed.js. See
// MULTIPLE_MEANINGS_PLAN.md §6/§7.
//
// Run: node scripts/merge-meanings.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const PROMPT_DIR = path.join(__dirname, 'meanings-prompts');
const MAX_MEANINGS = 3;
const KNOWN_TYPES = new Set([
  'Noun', 'Verb', 'Adjective', 'Adverb', 'Pronoun',
  'Preposition', 'Conjunction', 'Interjection', 'Determiner',
]);

function wordRegex(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + '\\b', 'i');
}
function containsWord(text, word) { return wordRegex(word).test(text || ''); }

// A definition must demonstrate the meaning without naming the word; reject an
// obvious shared stem too (same guard as merge-themed.js).
function namesWord(text, word) {
  if (containsWord(text, word)) return true;
  const stem = word.toLowerCase().slice(0, Math.max(4, word.length - 3));
  return stem.length >= 4 && (text || '').toLowerCase().indexOf(stem) !== -1;
}
function wordCount(text) { return text ? text.trim().split(/\s+/).length : 0; }
function norm(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }

// Mirror of js/meanings.js primaryMeaning (CommonJS side cannot import the ESM).
function primaryMeaning(word) {
  return {
    word_type: word.word_type || '',
    definition: word.definition || '',
    sentence_usage: word.sentence_usage || '',
    synonyms: Array.isArray(word.synonyms) ? word.synonyms : [],
    antonyms: Array.isArray(word.antonyms) ? word.antonyms : [],
  };
}

// Trim, drop empties / the word itself, de-duplicate, cap length.
function cleanList(arr, word, max) {
  if (!Array.isArray(arr)) return [];
  const seen = {};
  const out = [];
  arr.forEach(function (s) {
    const t = String(s || '').trim();
    if (!t || containsWord(t, word)) return;
    const k = t.toLowerCase();
    if (seen[k]) return;
    seen[k] = true;
    out.push(t);
  });
  return out.slice(0, max);
}

// Validate one generated additional sense for `word`. Returns a normalised
// { word_type, definition, sentence_usage, synonyms, antonyms } or null. The
// model emits `example`; it is mapped to the schema's sentence_usage.
function validateSense(gen, word) {
  if (!gen || typeof gen !== 'object') return null;

  const word_type = String(gen.word_type || '').trim();
  if (!KNOWN_TYPES.has(word_type)) return null;

  const definition = String(gen.definition || '').trim();
  const dc = wordCount(definition);
  if (!definition || dc < 3 || dc > 30 || namesWord(definition, word)) return null;

  const sentence_usage = String(gen.example || gen.sentence_usage || '').trim();
  const sc = wordCount(sentence_usage);
  if (!sentence_usage || sc < 4 || sc > 32 || !containsWord(sentence_usage, word)) return null;

  const synonyms = cleanList(gen.synonyms, word, 4);
  if (synonyms.length === 0) return null;            // schema requires >= 1 synonym
  const antonyms = cleanList(gen.antonyms, word, 4); // may be empty

  return { word_type, definition, sentence_usage, synonyms, antonyms };
}

// Build the merged meanings[] for `word`: primary first, then any existing extras,
// then newly-validated generated senses — de-duplicated by word_type + normalised
// definition (so same-POS polysemy is kept but exact repeats are not) and capped
// at MAX_MEANINGS. Returns the array, or null when only the primary remains (the
// caller then leaves the word without a meanings[] array).
function buildMeanings(word, generatedSenses) {
  const primary = primaryMeaning(word);
  const seen = new Set([(word.word_type || '').toLowerCase() + '|' + norm(word.definition)]);
  const extras = [];

  const existingExtras = Array.isArray(word.meanings) ? word.meanings.slice(1) : [];
  const fresh = (generatedSenses || [])
    .map(function (g) { return validateSense(g, word.word); })
    .filter(Boolean);

  existingExtras.concat(fresh).forEach(function (m) {
    if (!m) return;
    const key = (m.word_type || '').toLowerCase() + '|' + norm(m.definition);
    if (seen.has(key) || extras.length >= MAX_MEANINGS - 1) return;
    seen.add(key);
    extras.push({
      word_type: m.word_type,
      definition: m.definition,
      sentence_usage: m.sentence_usage,
      synonyms: Array.isArray(m.synonyms) ? m.synonyms : [],
      antonyms: Array.isArray(m.antonyms) ? m.antonyms : [],
    });
  });

  return extras.length === 0 ? null : [primary].concat(extras);
}

function parseOutputs(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const s = String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch (e) { return null; }
}

function loadGenerated() {
  if (!fs.existsSync(PROMPT_DIR)) return { generated: {}, fileCount: 0 };
  const files = fs.readdirSync(PROMPT_DIR).filter(function (f) { return f.endsWith('.json'); });
  const generated = {};
  let used = 0;
  files.forEach(function (f) {
    const data = JSON.parse(fs.readFileSync(path.join(PROMPT_DIR, f), 'utf8'));
    const parsed = parseOutputs(data.outputs);
    if (!parsed) return;
    used++;
    Object.keys(parsed).forEach(function (word) {
      const arr = Array.isArray(parsed[word]) ? parsed[word] : [];
      generated[word] = (generated[word] || []).concat(arr);
    });
  });
  return { generated: generated, fileCount: used };
}

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const loaded = loadGenerated();
  if (!loaded.fileCount) {
    console.error('No filled-in outputs in ' + PROMPT_DIR + ' — run build-meanings-prompts.js and paste responses first.');
    process.exit(1);
  }

  let wordsWithExtra = 0;
  let sensesAdded = 0;
  data.words.forEach(function (w) {
    const merged = buildMeanings(w, loaded.generated[w.word]);
    if (merged) {
      w.meanings = merged;
      wordsWithExtra++;
      sensesAdded += merged.length - 1;
    } else if (Array.isArray(w.meanings) && w.meanings.length <= 1) {
      delete w.meanings; // tidy a degenerate single-element array
    }
  });

  fs.writeFileSync(WORDS_PATH, JSON.stringify(data, null, 2) + '\n');
  console.log('Words with extra senses: ' + wordsWithExtra);
  console.log('Total added senses     : ' + sensesAdded);
}

if (require.main === module) main();

module.exports = {
  validateSense: validateSense,
  buildMeanings: buildMeanings,
  primaryMeaning: primaryMeaning,
  parseOutputs: parseOutputs,
};
