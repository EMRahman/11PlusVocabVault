// Characterisation tests for js/storage.js (persistence + mastery logic).
// Golden thresholds are taken from the original getMasteryStatus/recordAnswer.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mastery, viewCounts } from '../js/store.js';
import {
  getMasteryStatus,
  recordAnswer,
  incrementViewCount,
  loadMastery,
  loadViewCounts,
} from '../js/storage.js';

// Minimal in-memory localStorage stub (Node has none).
class MemStorage {
  constructor() { this.m = new Map(); }
  getItem(k) { return this.m.has(k) ? this.m.get(k) : null; }
  setItem(k, v) { this.m.set(k, String(v)); }
  removeItem(k) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

function clear(obj) { Object.keys(obj).forEach((k) => delete obj[k]); }

beforeEach(() => {
  globalThis.localStorage = new MemStorage();
  clear(mastery);
  clear(viewCounts);
});

test('getMasteryStatus: new / learning / mastered thresholds (characterisation)', () => {
  assert.equal(getMasteryStatus('Unseen'), 'new');            // no entry at all
  mastery['Zero'] = { correct: 0, incorrect: 0 };
  assert.equal(getMasteryStatus('Zero'), 'new');              // explicit zeroes
  mastery['Learn'] = { correct: 2, incorrect: 0 };
  assert.equal(getMasteryStatus('Learn'), 'learning');        // correct < 3
  mastery['Edge'] = { correct: 3, incorrect: 2 };             // margin 1 (< 2)
  assert.equal(getMasteryStatus('Edge'), 'learning');
  mastery['Master'] = { correct: 3, incorrect: 1 };           // >=3 and margin >=2
  assert.equal(getMasteryStatus('Master'), 'mastered');
});

test('recordAnswer accumulates correct/incorrect and stamps lastWrong on a miss', () => {
  recordAnswer('Word', true);
  assert.equal(mastery['Word'].correct, 1);
  assert.equal(mastery['Word'].incorrect, 0);
  const before = Date.now();
  recordAnswer('Word', false);
  assert.equal(mastery['Word'].correct, 1);
  assert.equal(mastery['Word'].incorrect, 1);
  assert.ok(mastery['Word'].lastWrong >= before);
});

test('recordAnswer drives a word to mastered after enough correct answers', () => {
  assert.equal(getMasteryStatus('W'), 'new');
  recordAnswer('W', true);
  assert.equal(getMasteryStatus('W'), 'learning');
  recordAnswer('W', true);
  recordAnswer('W', true);
  assert.equal(getMasteryStatus('W'), 'mastered'); // 3 correct, margin 3
});

test('recordAnswer reports the mastery transition it caused', () => {
  // new → learning on the first answer.
  let r = recordAnswer('T', true);
  assert.deepEqual(r, { status: 'learning', previousStatus: 'new', becameMastered: false });
  r = recordAnswer('T', true);
  assert.equal(r.becameMastered, false);
  // Third correct (margin 3): learning → mastered fires exactly once.
  r = recordAnswer('T', true);
  assert.deepEqual(r, { status: 'mastered', previousStatus: 'learning', becameMastered: true });
  // Already mastered: no repeat celebration.
  r = recordAnswer('T', true);
  assert.deepEqual(r, { status: 'mastered', previousStatus: 'mastered', becameMastered: false });
});

test('recordAnswer never reports becameMastered on a wrong answer', () => {
  // 3 correct + 1 incorrect = margin 2: still mastered, but the transition
  // happened on the third correct, not the miss.
  recordAnswer('M', true);
  recordAnswer('M', true);
  const third = recordAnswer('M', true);
  assert.equal(third.becameMastered, true);
  const miss = recordAnswer('M', false);
  assert.equal(miss.status, 'mastered'); // margin still 2
  assert.equal(miss.becameMastered, false);
  // A second miss drops it back to learning; re-mastering celebrates again.
  const miss2 = recordAnswer('M', false);
  assert.equal(miss2.status, 'learning');
  const regain = recordAnswer('M', true); // 4 correct, 2 incorrect → margin 2
  assert.deepEqual(regain, { status: 'mastered', previousStatus: 'learning', becameMastered: true });
});

test('mastery persists across save/load, and load mutates the binding in place', () => {
  recordAnswer('Persisted', true);  // saveMastery writes to the stub
  const ref = mastery;
  clear(mastery);                   // simulate a fresh page (in-memory wiped)
  assert.equal(getMasteryStatus('Persisted'), 'new');
  loadMastery();                    // reload from the stub
  assert.equal(getMasteryStatus('Persisted'), 'learning');
  assert.strictEqual(mastery, ref, 'loadMastery must not reassign the imported binding');
});

test('view counts increment, persist, and reload in place', () => {
  incrementViewCount('Apple');
  incrementViewCount('Apple');
  assert.equal(viewCounts['Apple'], 2);
  const ref = viewCounts;
  clear(viewCounts);
  loadViewCounts();
  assert.equal(viewCounts['Apple'], 2);
  assert.strictEqual(viewCounts, ref, 'loadViewCounts must not reassign the imported binding');
});
