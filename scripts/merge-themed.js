#!/usr/bin/env node
'use strict';

// Validates the Haiku-generated themed text from scripts/batches/*.out.json and
// merges it into data/words.json as a `themed_quest` field on each word.
//
// Merge is update-in-place: only fields present in the generation output are
// touched, so synonym/antonym clozes can be regenerated without disturbing the
// definition/word/sentence text. definition/word/sentence are strings; synonym
// and antonym are { cloze, answer } objects (a themed fill-in-the-blank whose
// answer is a synonym/antonym of the word).

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

// A synonym/antonym slot is a themed cloze whose blank is completed by a
// synonym (resp. antonym) of the word. Returns { cloze, answer } or null.
function validateRelationCloze(value, src, type) {
  if (!value || typeof value !== 'object') return null;
  const cloze = String(value.cloze || '').trim().replace(/_{3,}/g, '_____');
  const rawAnswer = String(value.answer || '').trim();
  const list = (type === 'synonym' ? src.synonyms : src.antonyms) || [];
  const related = (src.synonyms || []).concat(src.antonyms || []);

  // answer must match an entry of the matching list (kept in the list's case)
  const answer = list.filter(function (s) {
    return s.toLowerCase() === rawAnswer.toLowerCase();
  })[0];
  if (!answer) return null;

  if ((cloze.match(/_____/g) || []).length !== 1) return null;
  const wc = wordCount(cloze);
  if (wc < 6 || wc > 32) return null;
  // the cloze must not give anything away: not the word, not any of its
  // synonyms/antonyms (the answer is the blank; others would be ambiguous).
  if (containsWord(cloze, src.word)) return null;
  if (related.some(function (r) { return containsWord(cloze, r); })) return null;

  return { cloze: cloze, answer: answer };
}

// Returns the valid generated fields for one word, plus the rejected ones.
// Fields absent from the generation output are left out of both lists so the
// caller can leave them untouched.
function validateEntry(generated, src) {
  const out = {};
  const rejected = [];
  TYPES.forEach(function (type) {
    if (!generated || generated[type] === undefined || generated[type] === null) return;

    if (type === 'synonym' || type === 'antonym') {
      const cloze = validateRelationCloze(generated[type], src, type);
      if (cloze) out[type] = cloze;
      else rejected.push(type);
      return;
    }

    // definition / word / sentence are plain strings.
    let text = String(generated[type] || '').trim();
    const wc = wordCount(text);
    let ok = !!text && wc >= 6 && wc <= 32;

    if (ok && type === 'definition') {
      // A clue for the answer: demonstrate the meaning without naming it.
      if (namesWord(text, src.word)) ok = false;
    } else if (ok && type === 'sentence') {
      // A fill-in-the-gap cloze: exactly one blank, the word itself removed.
      text = text.replace(/_{3,}/g, '_____');
      if ((text.match(/_____/g) || []).length !== 1 || containsWord(text, src.word)) ok = false;
    } else if (ok) {
      // The word slot is a plain example sentence using the word.
      if (!containsWord(text, src.word)) ok = false;
    }

    if (ok) out[type] = text;
    else rejected.push(type);
  });
  return { out: out, rejected: rejected };
}

// Layers every *.out.json generation file into one word -> fields map. Base
// "batch-*"/"syn-*" files are applied first and retry files (e.g.
// "correction-*") after, so a regenerated field always overrides the original.
function loadGenerated() {
  const allOut = fs.existsSync(BATCH_DIR)
    ? fs.readdirSync(BATCH_DIR).filter(function (f) { return /\.out\.json$/.test(f); })
    : [];
  const isBase = function (f) { return /^(batch|syn)-\d+\.out\.json$/.test(f); };
  const outFiles = allOut.filter(isBase).sort()
    .concat(allOut.filter(function (f) { return !isBase(f); }).sort());
  const generated = {};
  outFiles.forEach(function (f) {
    const results = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8')).results || {};
    Object.keys(results).forEach(function (word) {
      generated[word] = Object.assign(generated[word] || {}, results[word]);
    });
  });
  return { generated: generated, fileCount: outFiles.length };
}

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));

  const loaded = loadGenerated();
  if (!loaded.fileCount) {
    console.error('No *.out.json files in ' + BATCH_DIR + ' - run the generation step first.');
    process.exit(1);
  }
  const generated = loaded.generated;

  let wordsUpdated = 0;
  let fieldsKept = 0;
  let fieldsRejected = 0;

  data.words.forEach(function (w) {
    const gen = generated[w.word];
    if (!gen) return;
    const result = validateEntry(gen, w);
    if (!Object.keys(result.out).length && !result.rejected.length) return;

    const tq = w.themed_quest || (w.themed_quest = {});
    if (!tq.theme) tq.theme = themes.getWordTheme(w).id;
    Object.assign(tq, result.out);
    result.rejected.forEach(function (field) { delete tq[field]; });

    // synonym/antonym must be a { cloze, answer } object or absent — drop any
    // stale value (e.g. an earlier plain-sentence string) of the wrong shape.
    ['synonym', 'antonym'].forEach(function (rel) {
      if (tq[rel] && (typeof tq[rel] !== 'object' || typeof tq[rel].cloze !== 'string')) {
        delete tq[rel];
      }
    });

    fieldsKept += Object.keys(result.out).length;
    fieldsRejected += result.rejected.length;
    wordsUpdated++;
  });

  fs.writeFileSync(WORDS_PATH, JSON.stringify(data, null, 2) + '\n');

  console.log('Words updated      : ' + wordsUpdated + ' / ' + data.words.length);
  console.log('Themed fields kept : ' + fieldsKept + ' / ' + (fieldsKept + fieldsRejected));
  console.log('Fields rejected    : ' + fieldsRejected);
}

module.exports = { validateEntry: validateEntry, loadGenerated: loadGenerated, TYPES: TYPES };

if (require.main === module) main();
