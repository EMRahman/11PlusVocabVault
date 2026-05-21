#!/usr/bin/env node
'use strict';

// Retry pass for TOKEN_COST_ESTIMATE.md generation. Re-validates every Haiku
// output already in scripts/batches/*.out.json and writes correction batch
// files listing only the (word, quiz type) pairs that still need regenerating.
//
// Usage: node scripts/build-corrections.js [outputPrefix]   (default: correction)

const fs = require('fs');
const path = require('path');
const themes = require('./themes-lib.js');
const merge = require('./merge-themed.js');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const BATCH_DIR = path.join(__dirname, 'batches');
const PREFIX = process.argv[2] || 'correction';
const CORRECTION_BATCH_SIZE = 38;

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const generated = merge.loadGenerated().generated;

  const words = [];
  data.words.forEach(function (w) {
    const gen = generated[w.word];
    const needs = gen ? merge.validateEntry(gen, w).rejected : merge.TYPES.slice();
    if (!needs.length) return;
    const theme = themes.getWordTheme(w);
    words.push({
      word: w.word,
      word_type: w.word_type || 'Word',
      definition: w.definition || '',
      synonyms: w.synonyms || [],
      antonyms: w.antonyms || [],
      banned: (w.synonyms || []).concat(w.antonyms || []),
      theme: theme.id,
      theme_name: theme.name,
      needs: needs
    });
  });

  let batchCount = 0;
  for (let i = 0; i < words.length; i += CORRECTION_BATCH_SIZE) {
    batchCount++;
    const slice = words.slice(i, i + CORRECTION_BATCH_SIZE);
    const sliceThemes = {};
    slice.forEach(function (w) { sliceThemes[w.theme] = themes.THEME_DESCRIPTORS[w.theme]; });
    const file = path.join(BATCH_DIR, PREFIX + '-' + String(batchCount).padStart(2, '0') + '.json');
    fs.writeFileSync(file, JSON.stringify({ batch: batchCount, themes: sliceThemes, words: slice }, null, 2));
  }

  const fieldCount = words.reduce(function (n, w) { return n + w.needs.length; }, 0);
  console.log('Words needing correction : ' + words.length);
  console.log('Fields to regenerate     : ' + fieldCount);
  console.log('Batches (' + PREFIX + '-NN.json) : ' + batchCount);
}

main();
