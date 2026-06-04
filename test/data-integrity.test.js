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
    'fables.json': 'fables',
    'history.json': 'articles',
    'proverbs.json': 'collections',
    'stories.json': 'stories',
  };
  for (const [file, key] of Object.entries(collections)) {
    const data = readJSON(file);
    assert.ok(
      Array.isArray(data[key]) && data[key].length > 0,
      `${file}: expected a non-empty "${key}" array`,
    );
  }
});
