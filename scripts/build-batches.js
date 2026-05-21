#!/usr/bin/env node
'use strict';

// Implements the "assigned theme x 5 quiz types" scope from TOKEN_COST_ESTIMATE.md.
// Assigns every word its Story Quest theme, then splits the dataset into batch
// files for themed-sentence generation by the Haiku model.

const fs = require('fs');
const path = require('path');
const themes = require('./themes-lib.js');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const BATCH_DIR = path.join(__dirname, 'batches');
const BATCH_SIZE = 30;

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const words = data.words;

  fs.rmSync(BATCH_DIR, { recursive: true, force: true });
  fs.mkdirSync(BATCH_DIR, { recursive: true });

  const items = words.map(function (w) {
    const theme = themes.getWordTheme(w);
    return {
      word: w.word,
      word_type: w.word_type || 'Word',
      definition: w.definition || '',
      synonyms: w.synonyms || [],
      antonyms: w.antonyms || [],
      theme: theme.id,
      theme_name: theme.name
    };
  });

  const dist = {};
  let batchCount = 0;
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    batchCount++;
    const slice = items.slice(i, i + BATCH_SIZE);
    const usedThemes = {};
    slice.forEach(function (it) {
      usedThemes[it.theme] = themes.THEME_DESCRIPTORS[it.theme];
      dist[it.theme] = (dist[it.theme] || 0) + 1;
    });
    const file = path.join(BATCH_DIR, 'batch-' + String(batchCount).padStart(2, '0') + '.json');
    fs.writeFileSync(file, JSON.stringify({ batch: batchCount, themes: usedThemes, words: slice }, null, 2));
  }

  console.log('Words: ' + items.length + ' | Batches: ' + batchCount + ' (size ' + BATCH_SIZE + ')');
  console.log('Theme distribution: ' + JSON.stringify(dist));
}

main();
