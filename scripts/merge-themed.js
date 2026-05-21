#!/usr/bin/env node
'use strict';

// Validates the Haiku-generated themed sentences from scripts/batches/*.out.json
// and merges them into data/words.json as a `themed_quest` field on each word.

const fs = require('fs');
const path = require('path');
const themes = require('./themes-lib.js');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const BATCH_DIR = path.join(__dirname, 'batches');
const TYPES = ['definition', 'word', 'sentence', 'synonym', 'antonym'];

function wordRegex(word) {
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\b' + esc + '\\b', 'i');
}

function containsWord(text, word) {
  return wordRegex(word).test(text || '');
}

// The definition clue must not name the word; reject obvious shared stems too.
function namesWord(text, word) {
  if (containsWord(text, word)) return true;
  const stem = word.toLowerCase().slice(0, Math.max(4, word.length - 3));
  return stem.length >= 4 && (text || '').toLowerCase().indexOf(stem) !== -1;
}

function wordCount(text) {
  return text ? text.trim().split(/\s+/).length : 0;
}

// Returns the valid fields for one word, plus the list of rejected types.
function validateEntry(generated, src) {
  const out = {};
  const rejected = [];
  TYPES.forEach(function (type) {
    let text = ((generated && generated[type]) || '').trim();
    const wc = wordCount(text);
    let ok = !!text && wc >= 6 && wc <= 32;

    if (ok && type === 'definition') {
      // A clue for the answer: must demonstrate the meaning without naming it.
      if (namesWord(text, src.word)) ok = false;
    } else if (ok && type === 'sentence') {
      // A fill-in-the-gap cloze: exactly one blank, the word itself removed.
      text = text.replace(/_{3,}/g, '_____');
      if ((text.match(/_____/g) || []).length !== 1 || containsWord(text, src.word)) ok = false;
    } else if (ok) {
      // word / synonym / antonym example sentences must use the exact word...
      if (!containsWord(text, src.word)) ok = false;
      // ...and must not hand the player a synonym/antonym answer choice.
      if (ok && (type === 'synonym' || type === 'antonym')) {
        const related = (src.synonyms || []).concat(src.antonyms || []);
        if (related.some(function (r) { return containsWord(text, r); })) ok = false;
      }
    }

    if (ok) out[type] = text;
    else rejected.push(type);
  });
  return { out: out, rejected: rejected };
}

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));

  // Collect every generated entry across all output files. Sorting puts the
  // base "batch-*" files first and "correction-*" retry files after, so a
  // regenerated field overrides the original while untouched fields survive.
  const generated = {};
  const outFiles = fs.existsSync(BATCH_DIR)
    ? fs.readdirSync(BATCH_DIR).filter(function (f) { return /\.out\.json$/.test(f); }).sort()
    : [];
  if (!outFiles.length) {
    console.error('No *.out.json files in ' + BATCH_DIR + ' - run the generation step first.');
    process.exit(1);
  }
  outFiles.forEach(function (f) {
    const parsed = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8'));
    const results = parsed.results || {};
    Object.keys(results).forEach(function (word) {
      generated[word] = Object.assign(generated[word] || {}, results[word]);
    });
  });

  // Plain-sentence retry round: each plain-NN.raw.json holds a label-free array
  // of sentences per word; the matching plain-NN.json input gives the slot
  // order, so array[i] is mapped onto slots[i]. Applied last, so it overrides.
  fs.readdirSync(BATCH_DIR)
    .filter(function (f) { return /^plain-\d+\.json$/.test(f); })
    .sort()
    .forEach(function (f) {
      const rawPath = path.join(BATCH_DIR, f.replace(/\.json$/, '.raw.json'));
      if (!fs.existsSync(rawPath)) return;
      const input = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8'));
      const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8')).results || {};
      input.words.forEach(function (item) {
        const arr = raw[item.word];
        if (!Array.isArray(arr)) return;
        const entry = generated[item.word] || (generated[item.word] = {});
        item.slots.forEach(function (slot, i) {
          if (typeof arr[i] === 'string') entry[slot] = arr[i];
        });
      });
    });

  let wordsWithThemed = 0;
  let fieldsKept = 0;
  let fieldsRejected = 0;
  const missing = [];

  data.words.forEach(function (w) {
    const gen = generated[w.word];
    if (!gen) { missing.push(w.word); return; }
    const result = validateEntry(gen, w);
    fieldsKept += Object.keys(result.out).length;
    fieldsRejected += result.rejected.length;
    if (Object.keys(result.out).length === 0) {
      delete w.themed_quest;
      return;
    }
    w.themed_quest = Object.assign({ theme: themes.getWordTheme(w).id }, result.out);
    wordsWithThemed++;
  });

  fs.writeFileSync(WORDS_PATH, JSON.stringify(data, null, 2) + '\n');

  console.log('Words with themed_quest : ' + wordsWithThemed + ' / ' + data.words.length);
  console.log('Themed fields kept      : ' + fieldsKept + ' / ' + (fieldsKept + fieldsRejected));
  console.log('Fields rejected         : ' + fieldsRejected);
  if (missing.length) {
    console.log('Words with no output    : ' + missing.length);
    console.log('  ' + missing.join(', '));
  }
}

module.exports = { validateEntry: validateEntry, TYPES: TYPES };

if (require.main === module) main();
