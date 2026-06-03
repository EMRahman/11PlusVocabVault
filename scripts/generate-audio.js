#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-audio.js
 *
 * Pre-generates MP3 pronunciation files for all vocabulary words using
 * Google Cloud Text-to-Speech (Neural2 / WaveNet voices).
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
 *    node scripts/generate-audio.js
 *    node scripts/generate-audio.js --voice en-GB-Neural2-B   # male voice
 *    node scripts/generate-audio.js --force                   # regenerate all
 *    node scripts/generate-audio.js --words-only              # skip full files
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
 *    audio/words/{slug}.mp3  — word pronunciation only (slow and clear)
 *    audio/full/{slug}.mp3   — word + definition + example sentence
 *
 *    Slug rule: lowercase, non-alphanumeric runs → "-", e.g. "Abhorrent" → "abhorrent"
 *
 * ── Cost ─────────────────────────────────────────────────────────────────────
 *    437 words × ~140 chars avg ≈ 62 K total characters.
 *    Free tier: 1,000,000 chars/month for WaveNet and Neural2 voices.
 *    This entire run costs nothing.
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
const args       = process.argv.slice(2);
const force      = args.includes('--force');
const wordsOnly  = args.includes('--words-only');
const voiceEq    = args.find(a => a.startsWith('--voice='));
const voiceIdx   = args.indexOf('--voice');
const VOICE      = voiceEq
  ? voiceEq.slice('--voice='.length)
  : (voiceIdx !== -1 && args[voiceIdx + 1] && !args[voiceIdx + 1].startsWith('--'))
    ? args[voiceIdx + 1]
    : 'en-GB-Neural2-A';

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT     = path.join(__dirname, '..');
const WORDS    = path.join(ROOT, 'data', 'words.json');
const WORD_DIR = path.join(ROOT, 'audio', 'words');
const FULL_DIR = path.join(ROOT, 'audio', 'full');

// ── Helpers ───────────────────────────────────────────────────────────────────
function toSlug(word) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sleep(ms) {
  return new Promise(res => setTimeout(res, ms));
}

// Escape characters that are special inside XML text nodes.
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

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn([
      '',
      'WARNING: GOOGLE_APPLICATION_CREDENTIALS is not set.',
      'The SDK will try Application Default Credentials (gcloud auth login).',
      'If that fails, export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json',
      '',
    ].join('\n'));
  }

  const words = JSON.parse(fs.readFileSync(WORDS, 'utf8')).words;

  fs.mkdirSync(WORD_DIR, { recursive: true });
  if (!wordsOnly) fs.mkdirSync(FULL_DIR, { recursive: true });

  const client = new TextToSpeechClient();

  const pad = String(words.length).length;
  console.log(`\nGoogle Cloud TTS  |  voice: ${VOICE}`);
  console.log(`Generating audio for ${words.length} words…\n`);

  let generated = 0;
  let skipped   = 0;
  let errors    = 0;

  for (let i = 0; i < words.length; i++) {
    const w       = words[i];
    const s       = toSlug(w.word);
    const wordOut = path.join(WORD_DIR, `${s}.mp3`);
    const fullOut = path.join(FULL_DIR, `${s}.mp3`);

    const needWord = force || !fs.existsSync(wordOut);
    const needFull = !wordsOnly && (force || !fs.existsSync(fullOut));

    const label = `[${String(i + 1).padStart(pad)}/${words.length}] ${w.word}`;

    if (!needWord && !needFull) {
      skipped++;
      console.log(`  ${label} — skipped (already exists)`);
      continue;
    }

    process.stdout.write(`  ${label}…`);

    try {
      if (needWord) {
        // Slow, deliberate pronunciation of the word on its own.
        const ssml = `<speak><prosody rate="slow">${xmlEscape(w.word)}</prosody></speak>`;
        await synthesise(client, { ssml }, wordOut);
        await sleep(220);
      }

      if (needFull) {
        // Natural reading pace: word, then definition, then example.
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

  const line = '─'.repeat(42);
  console.log(`\n${line}`);
  console.log(`  Generated : ${generated}`);
  console.log(`  Skipped   : ${skipped}`);
  console.log(`  Errors    : ${errors}`);
  console.log(line);

  if (errors > 0) {
    console.log('\n  Re-run without --force to retry only the failed words.');
    process.exit(1);
  }

  console.log('\n  Next step: commit the audio/ directory and update app.js');
  console.log('  to play audio/words/{slug}.mp3 before falling back to');
  console.log('  speechSynthesis.\n');
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
