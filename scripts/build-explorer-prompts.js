#!/usr/bin/env node
'use strict';

// Generates prompt batches for filling in the Word Explorer fields
// (etymology, popularity) on every word that doesn't yet have curated data.
// Matches the offline-batch pattern used by build-batches.js / merge-themed.js.
//
// Two model tiers, per the project preference:
//   etymology  → Haiku  (factual, well-bounded — bulk price wins)
//   popularity → Sonnet (needs historical-context judgement — quality wins)
//
// Output:
//   scripts/explorer-prompts/etymology-NN.json
//   scripts/explorer-prompts/popularity-NN.json
//
// Each batch file contains a `prompt` string ready to paste into a Claude chat,
// plus `inputs` (the word context) and an empty `outputs` field for the user
// to paste model responses back into. Merge via:
//   node scripts/merge-explorer-responses.js
//
// Run: node scripts/build-explorer-prompts.js
//      node scripts/build-explorer-prompts.js --only=etymology
//      node scripts/build-explorer-prompts.js --only=popularity

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const EXPLORER_PATH = path.join(ROOT, 'data', 'word-explorer.json');
const PROMPT_DIR = path.join(__dirname, 'explorer-prompts');

const ETYMOLOGY_BATCH = 25;
const POPULARITY_BATCH = 15;

function args() {
  const a = { only: null };
  process.argv.slice(2).forEach(function (s) {
    const m = s.match(/^--only=(.+)$/);
    if (m) a.only = m[1];
  });
  return a;
}

function loadCorpus() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  let explorer = {};
  if (fs.existsSync(EXPLORER_PATH)) {
    explorer = JSON.parse(fs.readFileSync(EXPLORER_PATH, 'utf8'));
  }
  return { words: data.words, explorer: explorer };
}

function missing(words, existingMap) {
  return words.filter(function (w) { return !existingMap[w.word]; });
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function etymologyPrompt(batch) {
  const lines = batch.map(function (w) {
    return '- ' + w.word + ' (' + (w.word_type || '?') + '): ' + (w.definition || '');
  }).join('\n');
  return [
    'You are helping write a vocabulary app for 11-year-old children studying for UK 11+ entrance exams.',
    '',
    'For each word below, give a short, accurate etymology entry suitable for a child. Reply ONLY with a JSON object whose keys are the exact word strings and whose values are objects with this shape:',
    '',
    '{',
    '  "origin":        "Latin" | "Greek" | "Old English" | "Old Norse" | "French" | "Arabic" | "Germanic" | "Other",',
    '  "root":          "the root word(s), as written in the source language",',
    '  "rootMeaning":   "short English gloss of what the root literally means",',
    '  "approxYear":    integer (approximate first known use in English, e.g. 1450),',
    '  "cousins":       ["up to 4 modern English words that share the same root"],',
    '  "kidExplanation": "1-2 sentence kid-friendly explanation, ~25 words max, no condescension"',
    '}',
    '',
    'Rules:',
    '- The kidExplanation must make the root memorable, not just restate the definition.',
    '- Skip the field "cousins" if you don\'t know any (use []), but never invent fake cousins.',
    '- approxYear is approximate; round to the nearest 50 years if uncertain.',
    '- Return ONLY the JSON object, no prose before or after, no markdown fences.',
    '',
    'Words:',
    lines,
  ].join('\n');
}

function popularityPrompt(batch) {
  const lines = batch.map(function (w) {
    return '- ' + w.word + ' (' + (w.word_type || '?') + '): ' + (w.definition || '');
  }).join('\n');
  return [
    'You are helping write a vocabulary app for 11-year-old children. For each word below, estimate how its popularity in written English has changed over time.',
    '',
    'Reply ONLY with a JSON object whose keys are the exact word strings and whose values are objects with this shape:',
    '',
    '{',
    '  "peakDecade": integer (e.g. 1860, 1990 — the decade when this word was most used in books/newspapers),',
    '  "rarity":     integer 1-5 (1 = very common today, 5 = rare today),',
    '  "trend":      "rising" | "steady" | "declining" (over the past ~50 years),',
    '  "kidNote":    "1 short sentence, ~20 words, telling a kid something memorable about when/where this word lived its best life"',
    '}',
    '',
    'Rules:',
    '- Base your estimate on what you know of English-language books, news and speech across the last 200 years.',
    '- The kidNote should sound like a friendly fact (\'Big in Victorian gothic novels...\'), not a dry stat.',
    '- Return ONLY the JSON object, no prose before or after, no markdown fences.',
    '',
    'Words:',
    lines,
  ].join('\n');
}

function writeBatches(kind, words, batchSize, promptFn, model) {
  const groups = chunks(words, batchSize);
  groups.forEach(function (batch, i) {
    const idx = String(i).padStart(2, '0');
    const out = {
      kind: kind,
      model: model,
      batchIndex: i,
      totalBatches: groups.length,
      inputs: batch.map(function (w) {
        return { word: w.word, definition: w.definition, word_type: w.word_type };
      }),
      prompt: promptFn(batch),
      outputs: null,
    };
    fs.writeFileSync(
      path.join(PROMPT_DIR, kind + '-' + idx + '.json'),
      JSON.stringify(out, null, 2)
    );
  });
  console.log('  ' + kind + ': ' + words.length + ' words → ' + groups.length + ' batch file(s) for ' + model);
}

function main() {
  const opts = args();
  const { words, explorer } = loadCorpus();
  fs.rmSync(PROMPT_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROMPT_DIR, { recursive: true });

  if (opts.only === null || opts.only === 'etymology') {
    const todo = missing(words, explorer.etymology || {});
    writeBatches('etymology', todo, ETYMOLOGY_BATCH, etymologyPrompt, 'claude-haiku-4-5-20251001');
  }
  if (opts.only === null || opts.only === 'popularity') {
    const todo = missing(words, explorer.popularity || {});
    writeBatches('popularity', todo, POPULARITY_BATCH, popularityPrompt, 'claude-sonnet-4-6');
  }
  console.log('');
  console.log('Next steps:');
  console.log('  1. Open each scripts/explorer-prompts/*.json file');
  console.log('  2. Send the "prompt" field to the model named in "model"');
  console.log('  3. Paste the JSON response into the "outputs" field of that file');
  console.log('  4. Run:  node scripts/merge-explorer-responses.js');
}

main();
