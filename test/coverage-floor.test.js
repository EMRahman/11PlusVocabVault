// coverage-floor.test.js — mechanical guard for the test safety net.
//
// This repo is AI-maintained and has no browser/DOM tests, so `node --test` is
// the only automated check that a change is correct. This guard fails if the
// suite shrinks below a committed baseline, or if any test is skipped — i.e. if
// the safety net is quietly weakened. See CLAUDE.md → "Test & CI governance".
//
// Raise the floors freely when you ADD coverage. LOWERING a floor (or removing /
// skipping tests) is a weakening change that needs explicit human approval.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = basename(fileURLToPath(import.meta.url));

// Baselines = current counts across the other test/*.js files (this file is
// excluded from the scan, so new test files still count toward the floor).
const TEST_FLOOR = 88;    // total `test(...)` declarations
const ASSERT_FLOOR = 293; // total `assert(...)` / `assert.x(...)` calls

function scan() {
  let tests = 0;
  let asserts = 0;
  const disabled = [];
  for (const f of readdirSync(TEST_DIR)) {
    if (!f.endsWith('.test.js') || f === SELF) continue;
    const src = readFileSync(join(TEST_DIR, f), 'utf8');
    tests += (src.match(/(?<!\.)\btest\(/g) || []).length; // exclude RegExp .test(
    asserts += (src.match(/\bassert(?:\.\w+)?\(/g) || []).length;
    // Catch every disable form node:test accepts: method (`.skip()`/`.only()`/
    // `.todo()`, incl. context `t.skip()`) and options (`{ skip|todo|only: true }`
    // or a string reason `{ skip: 'why' }`). All keep the `test(` count intact.
    if (/\.(?:skip|only|todo)\(|\b(?:skip|only|todo)\s*:\s*(?:true|['"])/.test(src)) disabled.push(f);
  }
  return { tests, asserts, disabled };
}

test('test suite has not shrunk below the committed baseline', () => {
  const { tests, asserts, disabled } = scan();
  assert.ok(
    tests >= TEST_FLOOR,
    `test count ${tests} dropped below floor ${TEST_FLOOR} — removing tests needs explicit human approval (see CLAUDE.md → Test & CI governance)`,
  );
  assert.ok(
    asserts >= ASSERT_FLOOR,
    `assertion count ${asserts} dropped below floor ${ASSERT_FLOOR} — weakening tests needs explicit human approval (see CLAUDE.md → Test & CI governance)`,
  );
  assert.deepEqual(
    disabled, [],
    `skipped/only/todo tests committed in: ${disabled.join(', ')} — disabling tests needs explicit human approval (see CLAUDE.md → Test & CI governance)`,
  );
});
