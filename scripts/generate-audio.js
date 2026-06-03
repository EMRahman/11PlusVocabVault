#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-audio.js
 *
 * Pre-generates MP3 audio files for all vocabulary words and reading articles
 * using Google Cloud Text-to-Speech (Neural2 / WaveNet voices).
 *
 * ── Google Cloud Setup ───────────────────────────────────────────────────────
 * 1. Create (or reuse) a Google Cloud project:
 *    https://console.cloud.google.com/
 *
 * 2. Enable the Cloud Text-to-Speech API for that project:
 *    https://console.cloud.google.com/apis/library/texttospeech.googleapis.com
 *
 * 3. Create a Service Account and download its JSON key:
 *    Console → IAM & Admin → Service Accounts → Create → "Text-to-Speech User"
 *    → Manage Keys → Add Key → JSON → Download
 *
 * 4. Tell the SDK where the key lives:
 *    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * ── Local Setup ──────────────────────────────────────────────────────────────
 *    npm install @google-cloud/text-to-speech
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *    node scripts/generate-audio.js                          # everything
 *    node scripts/generate-audio.js --words-only             # skip articles
 *    node scripts/generate-audio.js --articles-only          # skip words
 *    node scripts/generate-audio.js --voice en-GB-Neural2-B  # male voice
 *    node scripts/generate-audio.js --force                  # regenerate all
 *
 * ── Recommended voices (British English) ─────────────────────────────────────
 *    en-GB-Neural2-A  female  (default)
 *    en-GB-Neural2-B  male
 *    en-GB-Neural2-C  female
 *    en-GB-Neural2-D  male
 *    en-GB-Wavenet-A  female  (slightly cheaper, still very natural)
 *    en-GB-Wavenet-B  male
 *
 * ── Output ───────────────────────────────────────────────────────────────────
 *    audio/words/{slug}.mp3             — word pronunciation only (slow, clear)
 *    audio/full/{slug}.mp3             — word + definition + example sentence
 *    audio/articles/animals/{id}.mp3   — full animal article read-aloud
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *    437 words  × ~140 chars avg  ≈  62 K chars
 *    10 articles × ~4 000 chars avg ≈  40 K chars
 *    Grand total ≈ 102 K chars — well within the 1 M char/month free tier.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Dependency check ──────────────────────────────────────────────────────────
let TextToSpeechClient;
try {
  ({ TextToSpeechClient } = require('@google-cloud/text-to-speech'));
} catch {
  console.error([
    '',
    'ERROR: @google-cloud/text-to-speech is not installed.',
    '',
    'Run:  npm install @google-cloud/text-to-speech',
    '',
  ].join('\n'));
  process.exit(1);
}

// ── CLI args ──────────────────────────────────────────────────────────────────
const args        = process.argv.slice(2);
const force       = args.includes('--force');
const wordsOnly   = args.includes('--words-only');    // skip articles
const articlesOnly = args.includes('--articles-only'); // skip words
const voiceEq     = args.find(a => a.startsWith('--voice='));
const voiceIdx    = args.indexOf('--voice');
const VOICE       = voiceEq
  ? voiceEq.slice('--voice='.length)
  : (voiceIdx !== -1 && args[voiceIdx + 1] && !args[voiceIdx + 1].startsWith('--'))
    ? args[voiceIdx + 1]
    : 'en-GB-Neural2-A';

const doWords    = !articlesOnly;
const doArticles = !wordsOnly;

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');

// ── Article sources ───────────────────────────────────────────────────────────
// To add a new article type (insects, fables, history, etc.) add an entry here.
const ARTICLE_SOURCES = [
  {
    key    : 'animals',
    file   : path.join(ROOT, 'data', 'animals.json'),
    outDir : path.join(ROOT, 'audio', 'articles', 'animals'),
    // Returns the array of articles from the parsed JSON.
    extract: data => data.animals,
    // Filesystem-safe identifier used as the filename (already slug-ready).
    id     : item => item.id,
    // Full text sent to TTS: title, blurb, then each paragraph in order.
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  // { key: 'insects',  file: ..., outDir: ..., extract: d => d.insects,  id: i => i.id, toText: i => ... },
  // { key: 'fables',   file: ..., outDir: ..., extract: d => d.fables,   id: i => i.id, toText: i => ... },
  // { key: 'history',  file: ..., outDir: ..., extract: d => d.history,  id: i => i.id, toText: i => ... },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function toSlug(word) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function synthesise(client, input, outPath) {
  const [response] = await client.synthesizeSpeech({
    input,
    voice      : { languageCode: 'en-GB', name: VOICE },
    audioConfig: { audioEncoding: 'MP3' },
  });
  fs.writeFileSync(outPath, response.audioContent, 'binary');
}

function printSection(title) {
  const line = '─'.repeat(42);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  console.log(`${line}\n`);
}

function printSummary(label, generated, skipped, errors) {
  console.log(`  ${label.padEnd(14)} generated: ${generated}  skipped: ${skipped}  errors: ${errors}`);
}

// ── Words ─────────────────────────────────────────────────────────────────────
async function generateWords(client) {
  const words   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'words.json'), 'utf8')).words;
  const wordDir = path.join(ROOT, 'audio', 'words');
  const fullDir = path.join(ROOT, 'audio', 'full');

  fs.mkdirSync(wordDir, { recursive: true });
  fs.mkdirSync(fullDir, { recursive: true });

  const pad = String(words.length).length;
  let generated = 0, skipped = 0, errors = 0;

  for (let i = 0; i < words.length; i++) {
    const w       = words[i];
    const s       = toSlug(w.word);
    const wordOut = path.join(wordDir, `${s}.mp3`);
    const fullOut = path.join(fullDir, `${s}.mp3`);

    const needWord = force || !fs.existsSync(wordOut);
    const needFull = force || !fs.existsSync(fullOut);
    const label    = `[${String(i + 1).padStart(pad)}/${words.length}] ${w.word}`;

    if (!needWord && !needFull) {
      skipped++;
      console.log(`  ${label} — skipped`);
      continue;
    }

    process.stdout.write(`  ${label}…`);

    try {
      if (needWord) {
        const ssml = `<speak><prosody rate="slow">${xmlEscape(w.word)}</prosody></speak>`;
        await synthesise(client, { ssml }, wordOut);
        await sleep(220);
      }
      if (needFull) {
        const text = `${w.word}. ${w.definition}. Example: ${w.sentence_usage}`;
        await synthesise(client, { text }, fullOut);
        await sleep(220);
      }
      generated++;
      process.stdout.write(' ✓\n');
    } catch (err) {
      errors++;
      process.stdout.write(` FAILED — ${err.message}\n`);
    }
  }

  return { generated, skipped, errors };
}

// ── Articles ──────────────────────────────────────────────────────────────────
async function generateArticles(client) {
  const totals = { generated: 0, skipped: 0, errors: 0 };

  for (const source of ARTICLE_SOURCES) {
    const items = source.extract(JSON.parse(fs.readFileSync(source.file, 'utf8')));
    fs.mkdirSync(source.outDir, { recursive: true });

    const pad = String(items.length).length;
    console.log(`  ${source.key} (${items.length} articles)`);

    for (let i = 0; i < items.length; i++) {
      const item   = items[i];
      const id     = source.id(item);
      const outPath = path.join(source.outDir, `${id}.mp3`);
      const label  = `  [${String(i + 1).padStart(pad)}/${items.length}] ${id}`;

      if (!force && fs.existsSync(outPath)) {
        totals.skipped++;
        console.log(`${label} — skipped`);
        continue;
      }

      process.stdout.write(`${label}…`);

      try {
        const text = source.toText(item);

        // Google Cloud TTS plain-text input limit is 5 000 bytes.
        // All current articles are ~3 700–4 400 chars, so we're comfortably inside.
        // If a future article exceeds this, split it into paragraphs and concatenate
        // the resulting audio buffers, or switch the input to SSML (25 000 byte limit).
        if (Buffer.byteLength(text, 'utf8') > 4900) {
          process.stdout.write(' SKIPPED — text exceeds 4 900 bytes (split required)\n');
          totals.errors++;
          continue;
        }

        await synthesise(client, { text }, outPath);
        await sleep(220);
        totals.generated++;
        process.stdout.write(' ✓\n');
      } catch (err) {
        totals.errors++;
        process.stdout.write(` FAILED — ${err.message}\n`);
      }
    }

    console.log();
  }

  return totals;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn([
      '',
      'WARNING: GOOGLE_APPLICATION_CREDENTIALS is not set.',
      'The SDK will try Application Default Credentials (gcloud auth login).',
      'If that fails, set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json',
      '',
    ].join('\n'));
  }

  const client = new TextToSpeechClient();
  console.log(`\nGoogle Cloud TTS  |  voice: ${VOICE}`);

  const results = {};

  if (doWords) {
    printSection('Vocabulary words');
    results.words = await generateWords(client);
  }

  if (doArticles) {
    printSection('Reading articles');
    results.articles = await generateArticles(client);
  }

  // ── Final summary ──────────────────────────────────────────────────────────
  const line = '─'.repeat(42);
  console.log(`\n${line}`);
  console.log('  Summary');
  console.log(line);
  let anyErrors = false;
  for (const [label, r] of Object.entries(results)) {
    printSummary(label, r.generated, r.skipped, r.errors);
    if (r.errors > 0) anyErrors = true;
  }
  console.log(line);

  if (anyErrors) {
    console.log('\n  Re-run without --force to retry only failed items.\n');
    process.exit(1);
  }

  console.log('\n  Done. Commit the audio/ directory, then wire app.js to');
  console.log('  use these files before falling back to speechSynthesis.\n');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
