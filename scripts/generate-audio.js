#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-audio.js
 *
 * Pre-generates MP3 audio files for all vocabulary words and reading articles
 * using Google Cloud Text-to-Speech.
 *
 * ── Google Cloud Setup ───────────────────────────────────────────────────────
 * 1. Create (or reuse) a Google Cloud project:
 *    https://console.cloud.google.com/
 *
 * 2. Enable the Cloud Text-to-Speech API:
 *    https://console.cloud.google.com/apis/library/texttospeech.googleapis.com
 *
 * 3. Create a Service Account, download its JSON key:
 *    IAM & Admin → Service Accounts → Create → Manage Keys → Add Key → JSON
 *
 * 4. Export the credentials path:
 *    export GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * ── Local Setup ──────────────────────────────────────────────────────────────
 *    npm install @google-cloud/text-to-speech
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *    node scripts/generate-audio.js                           # all sections
 *    node scripts/generate-audio.js --section animals         # one section
 *    node scripts/generate-audio.js --section animals,insects # multiple
 *    node scripts/generate-audio.js --dry-run                 # cost preview only
 *    node scripts/generate-audio.js --dry-run --section fables
 *    node scripts/generate-audio.js --force                   # regenerate all
 *    node scripts/generate-audio.js --voice en-GB-Neural2-A   # override voice
 *    node scripts/generate-audio.js --price 16.00             # override $/1M chars
 *
 * ── Available sections ───────────────────────────────────────────────────────
 *    words      vocabulary pronunciations  (audio/words/ + audio/full/)
 *    animals    animal articles            (audio/articles/animals/)
 *    insects    insect articles            (audio/articles/insects/)
 *    history    history articles           (audio/articles/history/)
 *    fables     fable articles             (audio/articles/fables/)
 *    stories    story articles             (audio/articles/stories/)
 *    proverbs   proverb collections        (audio/articles/proverbs/)
 *
 * ── Voice ────────────────────────────────────────────────────────────────────
 *    Default: en-GB-Chirp3-HD-Achernar  (Chirp 3 HD, British English, Female)
 *    This is the Chirp 3 / Gemini Flash TTS preview voice named Achernar.
 *    Verify the exact API name at: https://cloud.google.com/text-to-speech/docs/voices
 *
 *    Other good British English options:
 *      en-GB-Chirp3-HD-Aoede    female
 *      en-GB-Chirp3-HD-Charon   male
 *      en-GB-Chirp3-HD-Fenrir   male
 *      en-GB-Neural2-A          female  (older, confirmed pricing)
 *      en-GB-Neural2-B          male    (older, confirmed pricing)
 *
 * ── Pricing ──────────────────────────────────────────────────────────────────
 *    Chirp 3 HD / Gemini Flash TTS (Preview):  estimated ~$30.00/1M chars
 *    Neural2 / WaveNet:                         confirmed  $16.00/1M chars
 *    Standard:                                  confirmed   $4.00/1M chars
 *
 *    IMPORTANT: Verify Chirp 3 / Gemini TTS pricing before a large run:
 *    https://cloud.google.com/text-to-speech/pricing
 *    Override with --price <usd-per-million-chars>  e.g. --price 30.00
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
const args    = process.argv.slice(2);
const force   = args.includes('--force');
const dryRun  = args.includes('--dry-run');

function argVal(flag) {
  const eq  = args.find(a => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--'))
    ? args[idx + 1] : null;
}

const VOICE         = argVal('--voice') || 'en-GB-Chirp3-HD-Achernar';
const PRICE_PER_M   = parseFloat(argVal('--price') || '30.00'); // USD per 1M chars
const sectionArg    = argVal('--section');
const onlySections  = sectionArg ? new Set(sectionArg.split(',').map(s => s.trim())) : null;

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');

// ── Article sources ───────────────────────────────────────────────────────────
// To add a new section, add one entry here — nothing else needs to change.
const ARTICLE_SOURCES = [
  {
    key    : 'animals',
    file   : 'animals.json',
    dataKey: 'animals',
    outDir : path.join(ROOT, 'audio', 'articles', 'animals'),
    id     : item => item.id,
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  {
    key    : 'insects',
    file   : 'insects.json',
    dataKey: 'insects',
    outDir : path.join(ROOT, 'audio', 'articles', 'insects'),
    id     : item => item.id,
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  {
    key    : 'history',
    file   : 'history.json',
    dataKey: 'articles',
    outDir : path.join(ROOT, 'audio', 'articles', 'history'),
    id     : item => item.id,
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  {
    key    : 'fables',
    file   : 'fables.json',
    dataKey: 'fables',
    outDir : path.join(ROOT, 'audio', 'articles', 'fables'),
    id     : item => item.id,
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  {
    key    : 'stories',
    file   : 'stories.json',
    dataKey: 'stories',
    outDir : path.join(ROOT, 'audio', 'articles', 'stories'),
    id     : item => item.id,
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
  {
    key    : 'proverbs',
    file   : 'proverbs.json',
    dataKey: 'collections',
    outDir : path.join(ROOT, 'audio', 'articles', 'proverbs'),
    id     : item => item.id,
    // English paragraphs only — the `proverbs` array contains native-language
    // text (Japanese, Arabic, etc.) which is intentionally skipped here.
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function toSlug(word) {
  return word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

function xmlEscape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtCost(chars) {
  return `$${(chars / 1_000_000 * PRICE_PER_M).toFixed(4)}`;
}

function fmtChars(n) { return n.toLocaleString(); }

async function synthesise(client, input, outPath) {
  if (dryRun) return; // don't call the API in dry-run mode
  const [response] = await client.synthesizeSpeech({
    input,
    voice      : { languageCode: 'en-GB', name: VOICE },
    audioConfig: { audioEncoding: 'MP3' },
  });
  fs.writeFileSync(outPath, response.audioContent, 'binary');
}

// ── Per-section result tracking ───────────────────────────────────────────────
// Each section returns { generated, skipped, errors, chars }
const sectionResults = [];

function shouldRun(key) {
  return !onlySections || onlySections.has(key);
}

// ── Words ─────────────────────────────────────────────────────────────────────
async function generateWords(client) {
  const words   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'words.json'), 'utf8')).words;
  const wordDir = path.join(ROOT, 'audio', 'words');
  const fullDir = path.join(ROOT, 'audio', 'full');

  if (!dryRun) {
    fs.mkdirSync(wordDir, { recursive: true });
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const pad = String(words.length).length;
  let generated = 0, skipped = 0, errors = 0, chars = 0;

  for (let i = 0; i < words.length; i++) {
    const w       = words[i];
    const s       = toSlug(w.word);
    const wordOut = path.join(wordDir, `${s}.mp3`);
    const fullOut = path.join(fullDir, `${s}.mp3`);

    const needWord = dryRun || force || !fs.existsSync(wordOut);
    const needFull = dryRun || force || !fs.existsSync(fullOut);
    const label    = `[${String(i + 1).padStart(pad)}/${words.length}] ${w.word}`;

    if (!needWord && !needFull) {
      skipped++;
      if (!dryRun) console.log(`  ${label} — skipped`);
      continue;
    }

    if (!dryRun) process.stdout.write(`  ${label}…`);

    try {
      if (needWord) {
        const ssml     = `<speak><prosody rate="slow">${xmlEscape(w.word)}</prosody></speak>`;
        const wordChars = Buffer.byteLength(w.word, 'utf8');
        await synthesise(client, { ssml }, wordOut);
        chars += wordChars;
        if (needWord && !dryRun) await sleep(220);
      }
      if (needFull) {
        const text     = `${w.word}. ${w.definition}. Example: ${w.sentence_usage}`;
        const fullChars = Buffer.byteLength(text, 'utf8');
        await synthesise(client, { text }, fullOut);
        chars += fullChars;
        if (!dryRun) await sleep(220);
      }
      generated++;
      if (!dryRun) process.stdout.write(' ✓\n');
    } catch (err) {
      errors++;
      if (!dryRun) process.stdout.write(` FAILED — ${err.message}\n`);
    }
  }

  return { label: 'words', generated, skipped, errors, chars };
}

// ── Articles ──────────────────────────────────────────────────────────────────
async function generateArticles(client) {
  const totals = { label: 'articles', generated: 0, skipped: 0, errors: 0, chars: 0 };
  const bySection = [];

  for (const source of ARTICLE_SOURCES) {
    if (!shouldRun(source.key)) continue;

    const items = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data', source.file), 'utf8')
    )[source.dataKey];

    if (!dryRun) fs.mkdirSync(source.outDir, { recursive: true });

    const pad = String(items.length).length;
    let gen = 0, skip = 0, err = 0, sectionChars = 0;

    if (!dryRun) console.log(`\n  ── ${source.key} (${items.length} articles) ──`);

    for (let i = 0; i < items.length; i++) {
      const item    = items[i];
      const id      = source.id(item);
      const outPath = path.join(source.outDir, `${id}.mp3`);
      const text    = source.toText(item);
      const bytes   = Buffer.byteLength(text, 'utf8');
      const label   = `  [${String(i + 1).padStart(pad)}/${items.length}] ${id}`;

      if (!dryRun && !force && fs.existsSync(outPath)) {
        skip++;
        console.log(`${label} — skipped`);
        continue;
      }

      if (!dryRun) process.stdout.write(`${label}…`);

      // Google Cloud TTS plain-text limit is 5 000 bytes.
      if (bytes > 4900) {
        if (!dryRun) process.stdout.write(` SKIPPED — ${bytes} bytes exceeds 4 900 limit\n`);
        err++;
        continue;
      }

      try {
        await synthesise(client, { text }, outPath);
        sectionChars += bytes;
        gen++;
        if (!dryRun) {
          await sleep(220);
          process.stdout.write(' ✓\n');
        }
      } catch (e) {
        err++;
        if (!dryRun) process.stdout.write(` FAILED — ${e.message}\n`);
      }
    }

    bySection.push({ key: source.key, items: items.length, chars: sectionChars, gen, skip, err });
    totals.generated += gen;
    totals.skipped   += skip;
    totals.errors    += err;
    totals.chars     += sectionChars;
  }

  return { totals, bySection };
}

// ── Summary table ─────────────────────────────────────────────────────────────
function printCostSummary(rows) {
  const LINE = '─'.repeat(70);
  const isGemini = /chirp3|journey|gemini/i.test(VOICE);
  const priceNote = isGemini
    ? '  ⚠  Gemini/Chirp3 pricing is ESTIMATED. Confirm at cloud.google.com/text-to-speech/pricing'
    : '  Pricing confirmed for Neural2/WaveNet voices.';

  console.log(`\n${LINE}`);
  console.log(`  Cost summary`);
  console.log(`  Voice: ${VOICE}`);
  console.log(`  Rate:  $${PRICE_PER_M.toFixed(2)} / 1M chars${isGemini ? ' (estimated — use --price to override)' : ''}`);
  console.log(`${LINE}`);
  console.log(`  ${'Section'.padEnd(24)} ${'Items'.padStart(6)} ${'Chars'.padStart(10)} ${'Est. cost'.padStart(12)}`);
  console.log(`  ${'-'.repeat(56)}`);

  let totalChars = 0, totalItems = 0;
  for (const r of rows) {
    console.log(`  ${r.label.padEnd(24)} ${String(r.items).padStart(6)} ${fmtChars(r.chars).padStart(10)} ${fmtCost(r.chars).padStart(12)}`);
    totalChars += r.chars;
    totalItems += r.items;
  }

  console.log(`  ${'-'.repeat(56)}`);
  console.log(`  ${'TOTAL'.padEnd(24)} ${String(totalItems).padStart(6)} ${fmtChars(totalChars).padStart(10)} ${fmtCost(totalChars).padStart(12)}`);
  console.log(LINE);
  console.log(priceNote);

  const freeRemaining = Math.max(0, 1_000_000 - totalChars);
  if (/neural2|wavenet/i.test(VOICE)) {
    console.log(`  Free tier remaining: ${fmtChars(freeRemaining)} of 1,000,000 chars`);
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!dryRun && !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.warn([
      '',
      'WARNING: GOOGLE_APPLICATION_CREDENTIALS is not set.',
      'The SDK will try Application Default Credentials (gcloud auth login).',
      'If that fails, set GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json',
      '',
    ].join('\n'));
  }

  const client = dryRun ? null : new TextToSpeechClient();

  console.log(`\nGoogle Cloud TTS  |  voice: ${VOICE}${dryRun ? '  [DRY RUN — no API calls]' : ''}`);

  const summaryRows = [];
  let anyErrors = false;

  // Words
  if (shouldRun('words')) {
    if (!dryRun) {
      const LINE = '─'.repeat(42);
      console.log(`\n${LINE}\n  Vocabulary words\n${LINE}\n`);
    }
    const r = await generateWords(client);
    summaryRows.push({ label: 'words (pronounce)', items: 437, chars: r.chars, ...r });
    if (r.errors > 0) anyErrors = true;
  }

  // Articles
  const articleSections = ARTICLE_SOURCES.filter(s => shouldRun(s.key));
  if (articleSections.length > 0) {
    if (!dryRun) {
      const LINE = '─'.repeat(42);
      console.log(`\n${LINE}\n  Reading articles\n${LINE}`);
    }
    const { totals, bySection } = await generateArticles(client);
    for (const s of bySection) {
      summaryRows.push({ label: s.key, items: s.items, chars: s.chars });
    }
    if (totals.errors > 0) anyErrors = true;
  }

  printCostSummary(summaryRows);

  if (!dryRun && anyErrors) {
    console.log('  Re-run without --force to retry only failed items.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
