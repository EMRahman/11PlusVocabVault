// Characterisation tests for js/quest-levels.js — the pure level/selection logic
// behind Constellation Quest's progressive galaxies. A deterministic injected
// shuffle (identity) makes the hub-first / BFS / proximity picks golden, so any
// change to the selection order or the level/exhaustion maths fails here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  selectClusterBatch,
  clusterRemaining,
  isCorpusExhausted,
  clustersWithWordsRemaining,
  countCapturedPerCluster,
  deriveBeaconStates,
} from '../js/quest-levels.js';

const identity = (arr) => arr.slice(); // deterministic stand-in for shuffle

// A small synthetic galaxy: hub + graph neighbours + a couple of graph-isolated
// words reachable only by 3D proximity.
//   Alpha: hub A, A–B–C chain, plus D,E reachable only via positions.
//   Beta:  hub X, X–Y edge, plus Z via positions.
const CLUSTERS = [
  { id: 0, name: 'A', words: ['A', 'B', 'C', 'D', 'E'], neighbors: [1] },
  { id: 1, name: 'X', words: ['X', 'Y', 'Z'], neighbors: [0] },
];
const NEIGHBORS = {
  A: ['B', 'Q'],   // Q is outside the cluster → filtered out
  B: ['A', 'C'],
  C: ['B'],
  X: ['Y'],
  Y: ['X'],
};
const POSITIONS = {
  A: [0, 0, 0], B: [1, 0, 0], C: [2, 0, 0], D: [0.5, 0, 0], E: [9, 0, 0],
  X: [0, 5, 0], Y: [0, 6, 0], Z: [0, 7, 0],
};

// ── selectClusterBatch ──────────────────────────────────────────────────────────
test('selectClusterBatch returns the hub first, then graph neighbours', () => {
  const out = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, {}, 3, identity);
  assert.deepEqual(out, ['A', 'B', 'C'], 'hub A, then hop-1 B, then hop-2 C');
});

test('selectClusterBatch skips a captured hub and already-captured words', () => {
  const captured = { A: true, B: true };
  const out = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, captured, 3, identity);
  // A,B captured → hub skipped, graph hop from A yields C; proximity fills D then E.
  assert.deepEqual(out, ['C', 'D', 'E'], 'continues with the next uncaptured words');
  assert.ok(!out.includes('A') && !out.includes('B'), 'never re-serves captured words');
});

test('selectClusterBatch honours the perCluster cap', () => {
  const out = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, {}, 2, identity);
  assert.equal(out.length, 2);
  assert.deepEqual(out, ['A', 'B']);
});

test('selectClusterBatch falls back to 3D proximity when the graph is sparse', () => {
  // Empty graph → only the hub comes from layers 0–2; the rest by distance to hub.
  // Distances to A: B=1, D=0.25, C=4, E=81 → nearest order D, B, C.
  const out = selectClusterBatch(CLUSTERS[0], {}, POSITIONS, {}, 3, identity);
  assert.deepEqual(out, ['A', 'D', 'B'], 'hub, then nearest-by-position uncaptured words');
});

test('selectClusterBatch returns [] when the cluster is fully captured', () => {
  const captured = { A: true, B: true, C: true, D: true, E: true };
  const out = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, captured, 3, identity);
  assert.deepEqual(out, [], 'a drained cluster yields nothing (will instant-clear)');
});

test('selectClusterBatch never includes words from other clusters', () => {
  const out = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, {}, 5, identity);
  out.forEach((w) => assert.ok(CLUSTERS[0].words.includes(w), `${w} is in-cluster`));
  assert.ok(!out.includes('Q'), 'cross-cluster graph neighbour Q excluded');
});

test('selectClusterBatch drains a cluster over successive levels with disjoint batches', () => {
  const captured = {};
  const seen = [];
  for (let level = 0; level < 5; level++) {
    const batch = selectClusterBatch(CLUSTERS[0], NEIGHBORS, POSITIONS, captured, 3, identity);
    if (batch.length === 0) break;
    batch.forEach((w) => {
      assert.ok(!captured[w], `level ${level}: ${w} not served before`);
      captured[w] = true;
      seen.push(w);
    });
  }
  assert.deepEqual(seen.slice().sort(), ['A', 'B', 'C', 'D', 'E'], 'every word served exactly once');
  assert.equal(seen.length, new Set(seen).size, 'no word served twice across levels');
});

// ── clusterRemaining ────────────────────────────────────────────────────────────
test('clusterRemaining counts uncaptured words', () => {
  assert.equal(clusterRemaining(CLUSTERS[0], {}), 5);
  assert.equal(clusterRemaining(CLUSTERS[0], { A: true, C: true }), 3);
  assert.equal(clusterRemaining(CLUSTERS[1], { X: true, Y: true, Z: true }), 0);
});

// ── isCorpusExhausted ───────────────────────────────────────────────────────────
test('isCorpusExhausted is false until every cluster is drained', () => {
  assert.equal(isCorpusExhausted(CLUSTERS, {}), false);
  assert.equal(isCorpusExhausted(CLUSTERS, { A: true, B: true, C: true, D: true, E: true }), false,
    'one cluster drained, the other still has words');
  const all = {};
  CLUSTERS.forEach((cl) => cl.words.forEach((w) => { all[w] = true; }));
  assert.equal(isCorpusExhausted(CLUSTERS, all), true, 'all clusters drained → exhausted');
});

// ── clustersWithWordsRemaining ──────────────────────────────────────────────────
test('clustersWithWordsRemaining counts clusters that still have words', () => {
  assert.equal(clustersWithWordsRemaining(CLUSTERS, {}), 2);
  assert.equal(clustersWithWordsRemaining(CLUSTERS, { A: true, B: true, C: true, D: true, E: true }), 1);
  const all = {};
  CLUSTERS.forEach((cl) => cl.words.forEach((w) => { all[w] = true; }));
  assert.equal(clustersWithWordsRemaining(CLUSTERS, all), 0);
});

// ── countCapturedPerCluster ─────────────────────────────────────────────────────
test('countCapturedPerCluster rebuilds per-cluster capture counts', () => {
  const out = countCapturedPerCluster(CLUSTERS, { A: true, B: true, X: true });
  assert.deepEqual(out, { 0: 2, 1: 1 });
  assert.deepEqual(countCapturedPerCluster(CLUSTERS, {}), { 0: 0, 1: 0 }, 'empty capture map → all zero');
});

// ── deriveBeaconStates ──────────────────────────────────────────────────────────
test('deriveBeaconStates marks cleared clusters and unlocks their neighbours', () => {
  // Cluster 0 cleared → its neighbour (1) unlocks; nothing else cleared.
  const states = deriveBeaconStates(CLUSTERS, [0], 0);
  assert.equal(states[0], 'cleared');
  assert.equal(states[1], 'unlocked', 'neighbour of a cleared cluster unlocks');
});

test('deriveBeaconStates falls back to unlocking the given start cluster', () => {
  // Nothing cleared → everything locked except the explicit start cluster.
  const states = deriveBeaconStates(CLUSTERS, [], 1);
  assert.deepEqual(states, { 0: 'locked', 1: 'unlocked' });
});

// Regression guard: word-quest-3d.js tracks beacon/progress state by ARRAY INDEX
// while cluster `.id` is a separate field and `.neighbors` hold ids. These two
// fixtures deliberately make id != index so a relapse to id-keyed output fails.
const REINDEXED = [
  { id: 10, name: 'A', words: ['A', 'B'], neighbors: [20] }, // array index 0; neighbour id 20 = index 1
  { id: 20, name: 'X', words: ['X'], neighbors: [10] },      // array index 1
];

test('countCapturedPerCluster keys by array index even when id != index', () => {
  assert.deepEqual(countCapturedPerCluster(REINDEXED, { A: true }), { 0: 1, 1: 0 });
});

test('deriveBeaconStates keys by index and maps neighbour ids to indices', () => {
  const states = deriveBeaconStates(REINDEXED, [0], 0); // cleared array index 0
  assert.deepEqual(states, { 0: 'cleared', 1: 'unlocked' },
    'index 0 cleared; its neighbour (id 20 → index 1) unlocks, not states[20]');
});
