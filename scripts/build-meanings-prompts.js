#!/usr/bin/env node
'use strict';

// Generates prompt batches that ask a model for the ADDITIONAL common meanings of
// each word — the senses beyond the one already curated in words.json. Matches the
// offline-batch pattern of build-explorer-prompts.js / build-batches.js.
//
// Model tier: Haiku (claude-haiku-4-5). Enumerating a common word's main senses is
// factual and well-bounded — the same "bulk price wins" tier the explorer
// etymology pass uses. See MULTIPLE_MEANINGS_PLAN.md §6.
//
// We already hold a curated *primary* sense per word, so we only generate the
// delta: up to 2 OTHER senses an 11+ child should know. merge-meanings.js keeps
// the primary as meanings[0] and appends the validated extras.
//
// Output: scripts/meanings-prompts/meanings-NN.json — each file carries a ready
// `prompt`, the `inputs` (word context), and an empty `outputs` for the model
// response. Merge with:  node scripts/merge-meanings.js
//
// Run: node scripts/build-meanings-prompts.js
//      node scripts/build-meanings-prompts.js --all   (re-generate even for words
//                                                       that already have meanings[])

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const PROMPT_DIR = path.join(__dirname, 'meanings-prompts');
const MODEL = 'claude-haiku-4-5-20251001';
const BATCH = 25;

function args() {
  const a = { all: false };
  process.argv.slice(2).forEach(function (s) { if (s === '--all') a.all = true; });
  return a;
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Words still needing a generation pass: those without an extra sense yet (unless
// --all). A word already carrying meanings[].length > 1 has been handled.
function todoWords(words, all) {
  return words.filter(function (w) {
    if (all) return true;
    return !(Array.isArray(w.meanings) && w.meanings.length > 1);
  });
}

function meaningsPrompt(batch) {
  const lines = batch.map(function (w) {
    return '- ' + w.word + ' — primary sense already covered: (' +
      (w.word_type || '?') + ') ' + (w.definition || '');
  }).join('\n');
  return [
    'You are helping write a vocabulary app for 8-11 year-old children studying for UK 11+ entrance exams.',
    '',
    'Each word below already has ONE curated meaning (shown). For each word, give any OTHER common meanings a bright 11-year-old should know — the distinct senses we are currently missing.',
    '',
    'Reply ONLY with a JSON object whose keys are the exact word strings and whose values are ARRAYS (0 to 2 items) of additional senses. Each sense is an object:',
    '',
    '{',
    '  "word_type":  "Noun" | "Verb" | "Adjective" | "Adverb" | "Preposition" | ...,',
    '  "definition": "kid-friendly meaning, <= 25 words, MUST NOT contain the word itself or its stem",',
    '  "example":    "one natural sentence, <= 30 words, that MUST contain the word",',
    '  "synonyms":   ["2-3 synonyms for THIS sense"],',
    '  "antonyms":   ["0-3 antonyms for THIS sense, [] if none is natural"]',
    '}',
    '',
    'Rules:',
    '- Return an EMPTY array for a word that genuinely has no other common 11+ meaning. Do not pad.',
    '- A sense must be clearly DIFFERENT from the primary shown, not a re-wording of it.',
    '- The definition must not give the word away (no using the word or an obvious stem of it).',
    '- The example sentence must use the word in THAT sense.',
    '- Return ONLY the JSON object — no prose, no markdown fences.',
    '',
    'Words:',
    lines,
  ].join('\n');
}

function main() {
  const opts = args();
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const todo = todoWords(data.words, opts.all);

  fs.rmSync(PROMPT_DIR, { recursive: true, force: true });
  fs.mkdirSync(PROMPT_DIR, { recursive: true });

  const groups = chunks(todo, BATCH);
  groups.forEach(function (batch, i) {
    const idx = String(i).padStart(2, '0');
    const out = {
      kind: 'meanings',
      model: MODEL,
      batchIndex: i,
      totalBatches: groups.length,
      inputs: batch.map(function (w) {
        return { word: w.word, word_type: w.word_type, definition: w.definition };
      }),
      prompt: meaningsPrompt(batch),
      outputs: null,
    };
    fs.writeFileSync(path.join(PROMPT_DIR, 'meanings-' + idx + '.json'), JSON.stringify(out, null, 2));
  });

  console.log('meanings: ' + todo.length + ' words → ' + groups.length + ' batch file(s) for ' + MODEL);
  console.log('');
  console.log('Next steps:');
  console.log('  1. Send each scripts/meanings-prompts/*.json "prompt" to the model in "model".');
  console.log('  2. Paste the JSON response into that file\'s "outputs" field.');
  console.log('  3. Run:  node scripts/merge-meanings.js');
}

if (require.main === module) main();

module.exports = { todoWords: todoWords, meaningsPrompt: meaningsPrompt };
