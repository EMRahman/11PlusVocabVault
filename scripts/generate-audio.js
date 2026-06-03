#!/usr/bin/env node
'use strict';

/**
 * scripts/generate-audio.js
 *
 * Pre-generates audio files for vocabulary words and reading articles using
 * the Gemini Text-to-Speech API (gemini-3.1-flash-tts-preview, voice: Achernar).
 *
 * ── Setup ────────────────────────────────────────────────────────────────────
 * 1. Get a Google AI API key:
 *    https://aistudio.google.com/app/apikey
 *
 * 2. Install the SDK:
 *    npm install @google/generative-ai
 *
 * 3. Export your key:
 *    export GOOGLE_API_KEY=your_key_here
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *    node scripts/generate-audio.js                           # all sections
 *    node scripts/generate-audio.js --section animals         # one section
 *    node scripts/generate-audio.js --section insects,fables  # multiple
 *    node scripts/generate-audio.js --dry-run                 # cost preview, no API calls
 *    node scripts/generate-audio.js --dry-run --section words
 *    node scripts/generate-audio.js --force                   # regenerate all
 *    node scripts/generate-audio.js --voice Aoede             # override voice
 *
 * ── Sections ─────────────────────────────────────────────────────────────────
 *    words      vocabulary pronunciations  →  audio/words/ + audio/full/
 *    animals    animal articles            →  audio/articles/animals/
 *    insects    insect articles            →  audio/articles/insects/
 *    history    history articles           →  audio/articles/history/
 *    fables     fable articles             →  audio/articles/fables/
 *    stories    story articles             →  audio/articles/stories/
 *    proverbs   proverb collections        →  audio/articles/proverbs/
 *
 * ── Pricing (gemini-3.1-flash-tts-preview) ───────────────────────────────────
 *    Input  (text)  : $1.00 / 1M tokens    (~4 chars per token)
 *    Output (audio) : $20.00 / 1M tokens   (25 tokens per second of audio)
 *
 *    Full-library estimate (all sections, 375 K chars):
 *      Input  tokens ≈    94 K  →   $0.09
 *      Output tokens ≈   729 K  →  $14.58
 *      Total                    →  ~$14.67
 *
 *    Audio output is saved as .wav (PCM) or .mp3 depending on what the API
 *    returns. Actual token counts from the API response are used when
 *    available, so the final cost shown is exact, not estimated.
 *
 * ── Voice options (British English) ─────────────────────────────────────────
 *    Achernar  female  (default)
 *    Aoede     female
 *    Charon    male
 *    Fenrir    male
 *    Verify full list at: https://cloud.google.com/text-to-speech/docs/voices
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

const fs   = require('fs');
const path = require('path');

// ── Dependency check ──────────────────────────────────────────────────────────
let GoogleGenerativeAI;
try {
  ({ GoogleGenerativeAI } = require('@google/generative-ai'));
} catch {
  console.error([
    '',
    'ERROR: @google/generative-ai is not installed.',
    '',
    'Run:  npm install @google/generative-ai',
    '',
  ].join('\n'));
  process.exit(1);
}

// ── Pricing constants ─────────────────────────────────────────────────────────
const INPUT_PRICE_PER_M  = 1.00;   // $ per 1M input tokens (text)
const OUTPUT_PRICE_PER_M = 20.00;  // $ per 1M output tokens (audio)
const AUDIO_TOKENS_PER_SEC = 25;   // tokens per second of audio (Google spec)
const EST_WORDS_PER_MIN    = 140;  // estimated TTS speaking rate for cost preview
const EST_CHARS_PER_WORD   = 5.5;  // avg English chars per word (inc. space)
const EST_CHARS_PER_TOKEN  = 4;    // input text: approx 4 chars per token

// ── CLI args ──────────────────────────────────────────────────────────────────
const args      = process.argv.slice(2);
const force     = args.includes('--force');
const dryRun    = args.includes('--dry-run');

function argVal(flag) {
  const eq  = args.find(a => a.startsWith(`${flag}=`));
  if (eq) return eq.slice(flag.length + 1);
  const idx = args.indexOf(flag);
  return (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('--'))
    ? args[idx + 1] : null;
}

const MODEL       = 'gemini-3.1-flash-tts-preview';
const VOICE       = argVal('--voice') || 'Achernar';
const sectionArg  = argVal('--section');
const onlySections = sectionArg ? new Set(sectionArg.split(',').map(s => s.trim())) : null;

function shouldRun(key) { return !onlySections || onlySections.has(key); }

// ── Paths ─────────────────────────────────────────────────────────────────────
const ROOT = path.join(__dirname, '..');

// ── Article sources ───────────────────────────────────────────────────────────
// Add future article types here — nothing else needs changing.
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
    // English paragraphs only — `proverbs[]` contains native-language text
    // (Japanese, Arabic, etc.) which is intentionally excluded.
    toText : item => [item.title + '.', item.blurb, ...item.paragraphs].join(' '),
  },
];

// ── Token / cost helpers ──────────────────────────────────────────────────────
function estimateTokens(text) {
  const inputTokens  = Math.ceil(text.length / EST_CHARS_PER_TOKEN);
  const audioSecs    = (text.length / EST_CHARS_PER_WORD) / (EST_WORDS_PER_MIN / 60);
  const outputTokens = Math.ceil(audioSecs * AUDIO_TOKENS_PER_SEC);
  return { inputTokens, outputTokens };
}

function tokenCost(inputTokens, outputTokens) {
  return (inputTokens / 1_000_000 * INPUT_PRICE_PER_M)
       + (outputTokens / 1_000_000 * OUTPUT_PRICE_PER_M);
}

function fmtUSD(n)    { return `$${n.toFixed(4)}`; }
function fmtNum(n)    { return n.toLocaleString(); }
function fmtTok(n)    { return Math.round(n).toLocaleString(); }

// ── Audio save ────────────────────────────────────────────────────────────────
// Wrap raw PCM bytes in a minimal WAV header so browsers can play the file.
function pcmToWav(pcm, sampleRate = 24000, channels = 1, bitDepth = 16) {
  const dataLen  = pcm.length;
  const header   = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);                                    // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * bitDepth / 8, 28); // byte rate
  header.writeUInt16LE(channels * bitDepth / 8, 32);              // block align
  header.writeUInt16LE(bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataLen, 40);
  return Buffer.concat([header, pcm]);
}

function saveAudioPart(part, basePath) {
  const { data, mimeType = '' } = part.inlineData;
  const base  = mimeType.split(';')[0].trim().toLowerCase();
  let   buf   = Buffer.from(data, 'base64');
  let   ext   = '.wav';

  if (base === 'audio/mpeg' || base === 'audio/mp3') {
    ext = '.mp3';
  } else if (base === 'audio/pcm' || base === 'audio/l16') {
    buf = pcmToWav(buf);      // PCM → WAV
    ext = '.wav';
  }
  // audio/wav and unknowns: save as-is with .wav extension

  const outPath = basePath + ext;
  fs.writeFileSync(outPath, buf);
  return { outPath, ext, mimeType };
}

// ── Gemini TTS call ───────────────────────────────────────────────────────────
async function synthesise(model, text, basePath) {
  const result = await model.generateContent({
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: VOICE },
        },
      },
    },
  });

  const candidate = result.response.candidates?.[0];
  if (!candidate) throw new Error('No candidates in Gemini response');

  const audioPart = candidate.content?.parts?.find(p => p.inlineData);
  if (!audioPart) throw new Error('No audio data in Gemini response');

  const saved = saveAudioPart(audioPart, basePath);

  // Real token counts from the API — used for precise cost tracking.
  const meta = result.response.usageMetadata || {};
  return {
    ...saved,
    inputTokens : meta.promptTokenCount     || estimateTokens(text).inputTokens,
    outputTokens: meta.candidatesTokenCount || estimateTokens(text).outputTokens,
  };
}

function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

// Checks for any audio file with the given base path (ignoring extension).
function audioExists(basePath) {
  return ['.wav', '.mp3', '.ogg'].some(ext => fs.existsSync(basePath + ext));
}

// ── Words ─────────────────────────────────────────────────────────────────────
async function generateWords(model) {
  const words   = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'words.json'), 'utf8')).words;
  const wordDir = path.join(ROOT, 'audio', 'words');
  const fullDir = path.join(ROOT, 'audio', 'full');

  if (!dryRun) {
    fs.mkdirSync(wordDir, { recursive: true });
    fs.mkdirSync(fullDir, { recursive: true });
  }

  const pad = String(words.length).length;
  let generated = 0, skipped = 0, errors = 0;
  let inputTokens = 0, outputTokens = 0;

  for (let i = 0; i < words.length; i++) {
    const w        = words[i];
    const slug     = w.word.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const wordBase = path.join(wordDir, slug);
    const fullBase = path.join(fullDir, slug);
    const label    = `[${String(i + 1).padStart(pad)}/${words.length}] ${w.word}`;

    const needWord = dryRun || force || !audioExists(wordBase);
    const needFull = dryRun || force || !audioExists(fullBase);

    if (!needWord && !needFull) {
      skipped++;
      if (!dryRun) console.log(`  ${label} — skipped`);
      continue;
    }

    if (!dryRun) process.stdout.write(`  ${label}…`);

    try {
      if (needWord) {
        const wordText   = w.word;
        const est        = estimateTokens(wordText);
        inputTokens  += est.inputTokens;
        outputTokens += est.outputTokens;
        if (!dryRun) {
          const r = await synthesise(model, wordText, wordBase);
          inputTokens  += r.inputTokens  - est.inputTokens;   // swap estimate for actual
          outputTokens += r.outputTokens - est.outputTokens;
          await sleep(350);
        }
      }
      if (needFull) {
        const fullText = `${w.word}. ${w.definition}. Example: ${w.sentence_usage}`;
        const est      = estimateTokens(fullText);
        inputTokens  += est.inputTokens;
        outputTokens += est.outputTokens;
        if (!dryRun) {
          const r = await synthesise(model, fullText, fullBase);
          inputTokens  += r.inputTokens  - est.inputTokens;
          outputTokens += r.outputTokens - est.outputTokens;
          await sleep(350);
        }
      }
      generated++;
      if (!dryRun) process.stdout.write(' ✓\n');
    } catch (err) {
      errors++;
      if (!dryRun) process.stdout.write(` FAILED — ${err.message}\n`);
    }
  }

  return { label: 'words', items: words.length, generated, skipped, errors, inputTokens, outputTokens };
}

// ── Articles ──────────────────────────────────────────────────────────────────
async function generateArticles(model) {
  const allResults = [];

  for (const source of ARTICLE_SOURCES) {
    if (!shouldRun(source.key)) continue;

    const items = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'data', source.file), 'utf8')
    )[source.dataKey];

    if (!dryRun) {
      fs.mkdirSync(source.outDir, { recursive: true });
      console.log(`\n  ── ${source.key} (${items.length} articles) ──`);
    }

    const pad = String(items.length).length;
    let gen = 0, skip = 0, err = 0, inTok = 0, outTok = 0;

    for (let i = 0; i < items.length; i++) {
      const item    = items[i];
      const id      = source.id(item);
      const text    = source.toText(item);
      const bytes   = Buffer.byteLength(text, 'utf8');
      const basePath = path.join(source.outDir, id);
      const label   = `  [${String(i + 1).padStart(pad)}/${items.length}] ${id}`;

      if (!dryRun && !force && audioExists(basePath)) {
        skip++;
        console.log(`${label} — skipped`);
        continue;
      }

      if (!dryRun) process.stdout.write(`${label}…`);

      // Gemini plain-text input limit is 32 768 tokens ≈ ~130 K chars.
      // All current articles are under 5 K chars, so this is a safety net only.
      if (bytes > 128_000) {
        if (!dryRun) process.stdout.write(` SKIPPED — ${bytes} bytes exceeds 128 K limit\n`);
        err++;
        continue;
      }

      const est = estimateTokens(text);
      inTok  += est.inputTokens;
      outTok += est.outputTokens;

      if (!dryRun) {
        try {
          const r = await synthesise(model, text, basePath);
          inTok  += r.inputTokens  - est.inputTokens;
          outTok += r.outputTokens - est.outputTokens;
          gen++;
          await sleep(350);
          process.stdout.write(' ✓\n');
        } catch (e) {
          err++;
          process.stdout.write(` FAILED — ${e.message}\n`);
        }
      } else {
        gen++;
      }
    }

    allResults.push({ label: source.key, items: items.length, gen, skip, err, inTok, outTok });
  }

  return allResults;
}

// ── Summary table ─────────────────────────────────────────────────────────────
function printSummary(rows) {
  const LINE = '─'.repeat(78);
  const W    = { label: 24, items: 6, inTok: 10, outTok: 11, inCost: 9, outCost: 9, total: 10 };

  const h = (s, w) => s.padStart(w);
  console.log(`\n${LINE}`);
  console.log(`  Cost summary  —  model: ${MODEL}  |  voice: ${VOICE}${dryRun ? '  [DRY RUN]' : ''}`);
  console.log(`  Input: $${INPUT_PRICE_PER_M.toFixed(2)}/1M tokens  |  Output: $${OUTPUT_PRICE_PER_M.toFixed(2)}/1M audio tokens (25 tok/sec)`);
  console.log(LINE);
  console.log(
    '  ' +
    'Section'.padEnd(W.label) +
    h('Items', W.items) +
    h('In tok', W.inTok) +
    h('Out tok', W.outTok) +
    h('In $', W.inCost) +
    h('Out $', W.outCost) +
    h('Total', W.total)
  );
  console.log('  ' + '-'.repeat(76));

  let totItems = 0, totIn = 0, totOut = 0;

  for (const r of rows) {
    const inC  = r.inputTokens  / 1_000_000 * INPUT_PRICE_PER_M;
    const outC = r.outputTokens / 1_000_000 * OUTPUT_PRICE_PER_M;
    console.log(
      '  ' +
      r.label.padEnd(W.label) +
      h(String(r.items), W.items) +
      h(fmtTok(r.inputTokens), W.inTok) +
      h(fmtTok(r.outputTokens), W.outTok) +
      h(fmtUSD(inC), W.inCost) +
      h(fmtUSD(outC), W.outCost) +
      h(fmtUSD(inC + outC), W.total)
    );
    totItems += r.items;
    totIn    += r.inputTokens;
    totOut   += r.outputTokens;
  }

  const totInC  = totIn  / 1_000_000 * INPUT_PRICE_PER_M;
  const totOutC = totOut / 1_000_000 * OUTPUT_PRICE_PER_M;
  console.log('  ' + '-'.repeat(76));
  console.log(
    '  ' +
    'TOTAL'.padEnd(W.label) +
    h(String(totItems), W.items) +
    h(fmtTok(totIn), W.inTok) +
    h(fmtTok(totOut), W.outTok) +
    h(fmtUSD(totInC), W.inCost) +
    h(fmtUSD(totOutC), W.outCost) +
    h(fmtUSD(totInC + totOutC), W.total)
  );
  console.log(LINE);
  if (dryRun) {
    console.log('  Token counts are ESTIMATED (actual values recorded during real runs).');
  } else {
    console.log('  Token counts use actual API response metadata where available.');
  }
  console.log();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!dryRun && !apiKey) {
    console.error([
      '',
      'ERROR: GOOGLE_API_KEY is not set.',
      '',
      'Get a key at: https://aistudio.google.com/app/apikey',
      'Then run:  export GOOGLE_API_KEY=your_key_here',
      '',
    ].join('\n'));
    process.exit(1);
  }

  const client = dryRun ? null : new GoogleGenerativeAI(apiKey);
  const model  = dryRun ? null : client.getGenerativeModel({ model: MODEL });

  console.log(`\nGemini TTS  |  model: ${MODEL}  |  voice: ${VOICE}${dryRun ? '  [DRY RUN]' : ''}`);

  const summaryRows = [];
  let anyErrors = false;

  // Words
  if (shouldRun('words')) {
    if (!dryRun) {
      console.log('\n' + '─'.repeat(42));
      console.log('  Vocabulary words');
      console.log('─'.repeat(42) + '\n');
    }
    const r = await generateWords(model);
    summaryRows.push({ label: 'words (pronounce)', items: r.items, inputTokens: r.inputTokens / 2, outputTokens: r.outputTokens / 2 });
    summaryRows.push({ label: 'words (full defs)', items: r.items, inputTokens: r.inputTokens / 2, outputTokens: r.outputTokens / 2 });
    if (r.errors > 0) anyErrors = true;
  }

  // Articles
  const articleSections = ARTICLE_SOURCES.filter(s => shouldRun(s.key));
  if (articleSections.length > 0) {
    if (!dryRun) {
      console.log('\n' + '─'.repeat(42));
      console.log('  Reading articles');
      console.log('─'.repeat(42));
    }
    const results = await generateArticles(model);
    for (const r of results) {
      summaryRows.push({ label: r.label, items: r.items, inputTokens: r.inTok, outputTokens: r.outTok });
      if (r.err > 0) anyErrors = true;
    }
  }

  printSummary(summaryRows);

  if (!dryRun && anyErrors) {
    console.log('  Some items failed. Re-run without --force to retry only failed items.\n');
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\nFatal:', err.message);
  process.exit(1);
});
