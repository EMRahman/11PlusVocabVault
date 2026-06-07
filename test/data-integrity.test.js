// Data-integrity tests for the JSON content under data/.
//
// These guard against malformed or truncated data (which would break the quiz,
// cards, or reading modes at runtime) without needing a browser. They run as
// part of `node --test`, alongside the unit tests, in the same CI job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readJSON = (name) => JSON.parse(readFileSync(join(DATA_DIR, name), 'utf8'));

const REQUIRED_STRING_FIELDS = ['word', 'definition', 'word_type', 'pronunciation', 'sentence_usage'];

test('words.json exposes a non-empty words array', () => {
  const data = readJSON('words.json');
  assert.ok(Array.isArray(data.words), 'data.words must be an array');
  assert.ok(data.words.length > 0, 'words array must not be empty');
});

test('every word has the required non-empty string fields', () => {
  const { words } = readJSON('words.json');
  for (const w of words) {
    const label = typeof w.word === 'string' && w.word ? w.word : '(missing word)';
    for (const field of REQUIRED_STRING_FIELDS) {
      assert.equal(typeof w[field], 'string', `${label}: ${field} must be a string`);
      assert.notEqual(w[field].trim(), '', `${label}: ${field} must not be empty`);
    }
  }
});

test('every usefulness_rating is an integer from 1 to 5', () => {
  const { words } = readJSON('words.json');
  for (const w of words) {
    const r = w.usefulness_rating;
    assert.ok(
      Number.isInteger(r) && r >= 1 && r <= 5,
      `${w.word}: usefulness_rating must be an integer 1-5, got ${JSON.stringify(r)}`,
    );
  }
});

test('synonyms and antonyms are non-empty arrays of non-empty strings', () => {
  const { words } = readJSON('words.json');
  for (const w of words) {
    for (const field of ['synonyms', 'antonyms']) {
      const arr = w[field];
      assert.ok(Array.isArray(arr) && arr.length > 0, `${w.word}: ${field} must be a non-empty array`);
      for (const item of arr) {
        assert.equal(typeof item, 'string', `${w.word}: ${field} entries must be strings`);
        assert.notEqual(item.trim(), '', `${w.word}: ${field} entries must not be empty`);
      }
    }
  }
});

test('every word has a usable pre-baked themed_quest for Story Quest', () => {
  // Story Quest (app.js) reads wordObj.themed_quest at runtime: `theme` selects
  // the world, `sentence` is the pre-blanked cloze, and `word` is the answer. A
  // word shipped without it passes the other checks but silently degrades the
  // mode. synonym/antonym are intentionally optional — Story Quest falls back to
  // the sentence cloze when a themed relation is absent.
  const { words } = readJSON('words.json');
  for (const w of words) {
    const tq = w.themed_quest;
    assert.ok(tq && typeof tq === 'object', `${w.word}: missing themed_quest`);
    for (const field of ['theme', 'word', 'sentence']) {
      assert.equal(typeof tq[field], 'string', `${w.word}: themed_quest.${field} must be a string`);
      assert.notEqual(tq[field].trim(), '', `${w.word}: themed_quest.${field} must not be empty`);
    }
    assert.ok(/_/.test(tq.sentence), `${w.word}: themed_quest.sentence must contain a "_____" cloze blank`);
  }
});

test('meanings[] (when present) is well-formed and mirrors the primary sense', () => {
  // meanings[] is OPTIONAL: single-sense / legacy words omit it and js/meanings.js
  // falls back to the flat fields. When a word DOES carry meanings[], it must:
  //  - be a non-empty array whose [0] mirrors the flat primary fields exactly
  //    (the mirror invariant js/meanings.js and the display code rely on);
  //  - hold only distinct senses — identity is word_type + normalised definition,
  //    matching scripts/merge-meanings.js, so same-part-of-speech polysemy (two
  //    noun senses) IS allowed but exact duplicates are not;
  //  - give every sense a non-empty word_type/definition/sentence_usage and a
  //    non-empty synonyms array (antonyms is an array that may be empty); and
  //  - each ADDED (non-primary) sense's sentence must contain the word, since
  //    those are authored/validated to demonstrate the word in use.
  const { words } = readJSON('words.json');
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, ' ');
  for (const w of words) {
    if (w.meanings === undefined) continue;
    assert.ok(
      Array.isArray(w.meanings) && w.meanings.length > 0,
      `${w.word}: meanings must be a non-empty array when present`,
    );

    const seen = new Set();
    w.meanings.forEach((m, i) => {
      const label = `${w.word} meaning #${i}`;
      assert.ok(m && typeof m === 'object', `${label}: must be an object`);
      for (const field of ['word_type', 'definition', 'sentence_usage']) {
        assert.equal(typeof m[field], 'string', `${label}: ${field} must be a string`);
        assert.notEqual(m[field].trim(), '', `${label}: ${field} must not be empty`);
      }
      assert.ok(Array.isArray(m.synonyms) && m.synonyms.length > 0, `${label}: synonyms must be a non-empty array`);
      assert.ok(Array.isArray(m.antonyms), `${label}: antonyms must be an array (may be empty)`);
      for (const item of m.synonyms.concat(m.antonyms)) {
        assert.equal(typeof item, 'string', `${label}: synonym/antonym entries must be strings`);
        assert.notEqual(item.trim(), '', `${label}: synonym/antonym entries must not be empty`);
      }
      // Optional per-meaning pronunciation (heteronyms like the noun "abuse").
      if (m.pronunciation !== undefined) {
        assert.equal(typeof m.pronunciation, 'string', `${label}: pronunciation must be a string when present`);
        assert.notEqual(m.pronunciation.trim(), '', `${label}: pronunciation must not be empty when present`);
      }

      const key = m.word_type.toLowerCase() + '|' + norm(m.definition);
      assert.ok(!seen.has(key), `${label}: duplicate sense (same word_type + definition)`);
      seen.add(key);

      if (i === 0) {
        // Mirror invariant: meanings[0] equals the flat primary fields.
        assert.equal(m.word_type, w.word_type, `${label}: must mirror flat word_type`);
        assert.equal(m.definition, w.definition, `${label}: must mirror flat definition`);
        assert.equal(m.sentence_usage, w.sentence_usage, `${label}: must mirror flat sentence_usage`);
        assert.deepEqual(m.synonyms, w.synonyms, `${label}: must mirror flat synonyms`);
        assert.deepEqual(m.antonyms, w.antonyms, `${label}: must mirror flat antonyms`);
      } else {
        const esc = w.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        assert.ok(
          new RegExp('\\b' + esc + '\\b', 'i').test(m.sentence_usage),
          `${label}: sentence_usage must contain "${w.word}"`,
        );
      }
    });
  }
});

test('known heteronyms keep a distinct per-sense pronunciation', () => {
  // A few words are pronounced differently depending on sense — e.g. the verb
  // "abuse" (uh-BYOOZ) vs the noun (uh-BYOOS), or the noun "construct"
  // (KON-strukt) vs the verb (kuhn-STRUKT). For those, the non-primary sense
  // MUST declare its own pronunciation that differs from the word-level
  // (primary) one, or the app would teach that sense's example sentence under
  // the wrong pronunciation. The per-meaning `pronunciation` field is optional
  // in general (most senses share one pronunciation), so this pins the known
  // heteronyms — verified against UK dictionaries — so a future meanings[]
  // regeneration pass can't silently drop the distinction. Add a row here when
  // a new heteronym sense is introduced.
  const { words } = readJSON('words.json');
  const HETERONYMS = { Abuse: 'Noun', Construct: 'Verb' };
  for (const [name, senseType] of Object.entries(HETERONYMS)) {
    const w = words.find((x) => x.word === name);
    assert.ok(w, `heteronym "${name}" must exist in words.json`);
    assert.ok(Array.isArray(w.meanings), `${name}: must carry a meanings[] array`);
    const sense = w.meanings.find((m) => m.word_type === senseType);
    assert.ok(sense, `${name}: must have a ${senseType} sense`);
    assert.equal(
      typeof sense.pronunciation, 'string',
      `${name} (${senseType}): heteronym sense must declare its own pronunciation`,
    );
    assert.notEqual(
      sense.pronunciation.trim(), '',
      `${name} (${senseType}): per-sense pronunciation must not be empty`,
    );
    assert.notEqual(
      sense.pronunciation, w.pronunciation,
      `${name} (${senseType}): per-sense pronunciation must differ from the primary "${w.pronunciation}"`,
    );
  }
});

test('word names are unique (duplicates are silently hidden by findWordByName)', () => {
  const { words } = readJSON('words.json');
  const seen = new Set();
  const duplicates = [];
  for (const w of words) {
    if (seen.has(w.word)) duplicates.push(w.word);
    seen.add(w.word);
  }
  assert.deepEqual(duplicates, [], `duplicate word names found: ${duplicates.join(', ')}`);
});

test('every data/*.json file is valid JSON', () => {
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  assert.ok(files.length > 0, 'expected at least one data/*.json file');
  for (const file of files) {
    assert.doesNotThrow(() => readJSON(file), `${file} should be valid JSON`);
  }
});

test('content collections expose their expected non-empty array', () => {
  const collections = {
    'animals.json': 'animals',
    'insects.json': 'insects',
    'space.json': 'space',
    'technology.json': 'technology',
    'forces.json': 'forces',
    'fables.json': 'fables',
    'history.json': 'articles',
    'money.json': 'money',
    'proverbs.json': 'collections',
    'stories.json': 'stories',
    'comics.json': 'comics',
  };
  for (const [file, key] of Object.entries(collections)) {
    const data = readJSON(file);
    assert.ok(
      Array.isArray(data[key]) && data[key].length > 0,
      `${file}: expected a non-empty "${key}" array`,
    );
  }
});

test('every comic has a title, blurb, glossary words, and renderable panels', () => {
  // The comic renderer (js/app.js) reads these fields directly; a missing one
  // would break Comic Mode at runtime. `char` must match a known SVG generator
  // (COMIC_SVG keys) — an unknown value silently falls back to Star-Sloth and
  // would mask an authoring typo.
  const KNOWN_CHARS = new Set(['starSloth', 'jolt', 'admiral', 'overClock']);
  const { comics } = readJSON('comics.json');
  comics.forEach((comic, i) => {
    const label = comic.title || `comic #${i}`;
    for (const field of ['title', 'blurb']) {
      assert.equal(typeof comic[field], 'string', `${label}: ${field} must be a string`);
      assert.notEqual(comic[field].trim(), '', `${label}: ${field} must not be empty`);
    }

    assert.ok(Array.isArray(comic.words) && comic.words.length > 0, `${label}: words must be a non-empty array`);
    for (const w of comic.words) {
      assert.equal(typeof w.word, 'string', `${label}: a word entry is missing its word`);
      assert.notEqual(w.word.trim(), '', `${label}: a word entry has an empty word`);
      assert.equal(typeof w.definition, 'string', `${label}: "${w.word}" is missing a definition`);
      assert.notEqual(w.definition.trim(), '', `${label}: "${w.word}" has an empty definition`);
    }

    assert.ok(Array.isArray(comic.panels) && comic.panels.length > 0, `${label}: panels must be a non-empty array`);
    comic.panels.forEach((p, j) => {
      assert.ok(KNOWN_CHARS.has(p.char), `${label}: panel ${j} has unknown char ${JSON.stringify(p.char)}`);
      assert.equal(typeof p.pose, 'string', `${label}: panel ${j} must have a string pose`);
      assert.notEqual(p.pose.trim(), '', `${label}: panel ${j} has an empty pose`);
    });
  });
});

test('every science/tech article is renderable and only references real vocabulary words', () => {
  // Space, Inventions & Technology, Money, and Forces of Nature Modes are built by createReadingMode
  // (js/app.js), which reads each of these fields directly and resolves
  // item.words against words.json via findWordByName. A missing field would
  // break the reading view, and a word name with no match in words.json would
  // render an unclickable highlight and break "Quiz me". This article-level
  // check is stronger than the existing animals/insects coverage on purpose —
  // it guards the "reuse existing words only" contract for these collections
  // mechanically. `subtitleField` is the per-item field createReadingMode shows
  // as the card/reading subtitle (Space: region, Inventions/Money: era, Forces: element).
  const knownWords = new Set(readJSON('words.json').words.map((w) => w.word));
  const collections = [
    { file: 'space.json', key: 'space', subtitleField: 'region' },
    { file: 'technology.json', key: 'technology', subtitleField: 'era' },
    { file: 'money.json', key: 'money', subtitleField: 'era' },
    { file: 'forces.json', key: 'forces', subtitleField: 'element' },
  ];
  for (const { file, key, subtitleField } of collections) {
    const articles = readJSON(file)[key];
    const seenIds = new Set();
    articles.forEach((article, i) => {
      const label = `${key} "${article.title || `#${i}`}"`;
      for (const field of ['id', 'title', 'emoji', subtitleField, 'blurb']) {
        assert.equal(typeof article[field], 'string', `${label}: ${field} must be a string`);
        assert.notEqual(article[field].trim(), '', `${label}: ${field} must not be empty`);
      }
      assert.ok(!seenIds.has(article.id), `${label}: duplicate id "${article.id}"`);
      seenIds.add(article.id);

      assert.ok(Array.isArray(article.paragraphs) && article.paragraphs.length > 0, `${label}: paragraphs must be a non-empty array`);
      for (const p of article.paragraphs) {
        assert.equal(typeof p, 'string', `${label}: every paragraph must be a string`);
        assert.notEqual(p.trim(), '', `${label}: paragraphs must not contain an empty string`);
      }

      assert.ok(Array.isArray(article.words) && article.words.length > 0, `${label}: words must be a non-empty array`);
      for (const w of article.words) {
        assert.ok(knownWords.has(w), `${label}: word "${w}" is not present in words.json`);
      }
    });
  }
});
