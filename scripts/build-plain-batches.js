#!/usr/bin/env node
'use strict';

// Final retry pass for TOKEN_COST_ESTIMATE.md generation. The word/synonym/
// antonym slots all just need a plain themed example sentence, but naming a
// slot "antonym" makes the model write an opposite-meaning sentence. This
// builder emits neutral, label-free batches: each word simply needs N plain
// example sentences. merge-themed.js maps the returned array back to its slots.

const fs = require('fs');
const path = require('path');
const themes = require('./themes-lib.js');
const merge = require('./merge-themed.js');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const BATCH_DIR = path.join(__dirname, 'batches');
const BATCH_SIZE = 40;
const PLAIN_SLOTS = ['word', 'synonym', 'antonym'];

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));

  const generated = {};
  fs.readdirSync(BATCH_DIR)
    .filter(function (f) { return /\.out\.json$/.test(f); })
    .sort()
    .forEach(function (f) {
      const results = JSON.parse(fs.readFileSync(path.join(BATCH_DIR, f), 'utf8')).results || {};
      Object.keys(results).forEach(function (w) {
        generated[w] = Object.assign(generated[w] || {}, results[w]);
      });
    });

  const words = [];
  data.words.forEach(function (w) {
    const gen = generated[w.word];
    const rejected = (gen ? merge.validateEntry(gen, w).rejected : merge.TYPES.slice())
      .filter(function (t) { return PLAIN_SLOTS.indexOf(t) !== -1; });
    if (!rejected.length) return;
    const theme = themes.getWordTheme(w);
    words.push({
      word: w.word,
      word_type: w.word_type || 'Word',
      definition: w.definition || '',
      banned: (w.synonyms || []).concat(w.antonyms || []),
      theme: theme.id,
      theme_name: theme.name,
      count: rejected.length,
      slots: rejected
    });
  });

  let batchCount = 0;
  for (let i = 0; i < words.length; i += BATCH_SIZE) {
    batchCount++;
    const slice = words.slice(i, i + BATCH_SIZE);
    const sliceThemes = {};
    slice.forEach(function (w) { sliceThemes[w.theme] = themes.THEME_DESCRIPTORS[w.theme]; });
    const file = path.join(BATCH_DIR, 'plain-' + String(batchCount).padStart(2, '0') + '.json');
    fs.writeFileSync(file, JSON.stringify({ batch: batchCount, themes: sliceThemes, words: slice }, null, 2));
  }

  const sentenceCount = words.reduce(function (n, w) { return n + w.slots.length; }, 0);
  console.log('Words needing plain sentences : ' + words.length);
  console.log('Sentences to regenerate       : ' + sentenceCount);
  console.log('Batches (plain-NN.json)       : ' + batchCount);
}

main();
