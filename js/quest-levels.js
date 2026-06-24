// quest-levels.js — pure level/selection logic for Constellation Quest
// (js/word-quest-3d.js), extracted so it can be unit-tested under `node --test`
// without a DOM or Three.js. The game closure keeps ownership of all mutable
// state (capturedWords, the loaded clusters/neighbour graph/positions) and passes
// it in here. Mirrors the pattern in js/selection.js.
'use strict';

// Default shuffle: Fisher–Yates on a copy. Tests inject a deterministic shuffle
// (e.g. identity) so the hub-first / BFS / proximity picks are golden.
function defaultShuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Pick up to `perCluster` UNCAPTURED words for one cluster, hub-first, then a
// 2-hop BFS over the synonym graph (neighborMap) staying inside the cluster, then
// a 3D-proximity fallback to the hub when the graph is sparse. `captured` is a
// plain map { word: true }. Returns 0..perCluster word names (fewer only when the
// cluster is nearly/already exhausted). This is the pure extraction of the old
// in-file `pickNearbyWords`; behaviour is identical for a given shuffle.
export function selectClusterBatch(cluster, neighborMap, positions, captured, perCluster, shuffleFn) {
  var shuffle = shuffleFn || defaultShuffle;
  neighborMap = neighborMap || {};
  positions = positions || {};
  captured = captured || {};
  var hub = cluster.name;
  var clusterWordSet = new Set(cluster.words);
  var visited = new Set();
  var selected = [];

  function tryAdd(w) {
    if (selected.length >= perCluster) return;
    if (visited.has(w) || captured[w]) return;
    visited.add(w);
    selected.push(w);
  }

  // Layer 0 — hub word itself
  visited.add(hub);
  if (!captured[hub] && clusterWordSet.has(hub)) selected.push(hub);

  // Layer 1 — direct graph neighbours of the hub that live in this cluster
  var hop1 = shuffle((neighborMap[hub] || []).filter(function (w) { return clusterWordSet.has(w); }));
  hop1.forEach(tryAdd);

  // Layer 2 — neighbours of layer-1 words, still within the cluster
  if (selected.length < perCluster) {
    hop1.forEach(function (w1) {
      shuffle((neighborMap[w1] || []).filter(function (w) { return clusterWordSet.has(w); })).forEach(tryAdd);
    });
  }

  // Fallback — nearest uncaptured words by 3D proximity to the hub
  if (selected.length < perCluster && positions[hub]) {
    var hubPos = positions[hub];
    var byDist = cluster.words
      .filter(function (w) { return !visited.has(w) && !captured[w] && positions[w]; })
      .sort(function (a, b) {
        var pa = positions[a], pb = positions[b];
        var da = (pa[0] - hubPos[0]) * (pa[0] - hubPos[0]) + (pa[1] - hubPos[1]) * (pa[1] - hubPos[1]) + (pa[2] - hubPos[2]) * (pa[2] - hubPos[2]);
        var db = (pb[0] - hubPos[0]) * (pb[0] - hubPos[0]) + (pb[1] - hubPos[1]) * (pb[1] - hubPos[1]) + (pb[2] - hubPos[2]) * (pb[2] - hubPos[2]);
        return da - db;
      });
    byDist.forEach(tryAdd);
  }

  return selected;
}

// How many of a cluster's words are not yet captured.
export function clusterRemaining(cluster, captured) {
  captured = captured || {};
  var n = 0;
  for (var i = 0; i < cluster.words.length; i++) {
    if (!captured[cluster.words[i]]) n++;
  }
  return n;
}

// True when NO cluster can yield an uncaptured word — the whole galaxy is done,
// so the next level would be empty everywhere. This is the loop terminator.
export function isCorpusExhausted(clusters, captured) {
  for (var i = 0; i < clusters.length; i++) {
    if (clusterRemaining(clusters[i], captured) > 0) return false;
  }
  return true;
}

// How many clusters still have at least one uncaptured word (for level/labels).
export function clustersWithWordsRemaining(clusters, captured) {
  var n = 0;
  for (var i = 0; i < clusters.length; i++) {
    if (clusterRemaining(clusters[i], captured) > 0) n++;
  }
  return n;
}

// Rebuild the { clusterIndex: capturedCount } map from a captured snapshot — used
// to restore `clusterProgress` (label display) when resuming a saved journey.
// Keyed by ARRAY INDEX to match word-quest-3d.js's index-based state lookups.
export function countCapturedPerCluster(clusters, captured) {
  captured = captured || {};
  var out = {};
  clusters.forEach(function (cl, c) {
    var n = 0;
    for (var i = 0; i < cl.words.length; i++) {
      if (captured[cl.words[i]]) n++;
    }
    out[c] = n;
  });
  return out;
}

// Rebuild beacon states { clusterIndex: 'locked'|'unlocked'|'cleared' } from the
// set of clusters cleared this level, mirroring the live unlock rule (clearing a
// cluster unlocks its neighbours). Keyed by ARRAY INDEX to match word-quest-3d.js
// (`clearedIds` and `unlockedIndex` are indices; `beaconState` is read by index);
// neighbour values are cluster IDs and are mapped to indices. `unlockedIndex`
// guarantees at least one playable cluster is open. Used on resume.
export function deriveBeaconStates(clusters, clearedIds, unlockedIndex) {
  var clearedSet = new Set(clearedIds || []);
  var idToIdx = {};
  clusters.forEach(function (cl, c) { idToIdx[cl.id] = c; });
  var states = {};
  clusters.forEach(function (cl, c) {
    states[c] = clearedSet.has(c) ? 'cleared' : 'locked';
  });
  // A cleared cluster unlocks its still-locked neighbours.
  clearedSet.forEach(function (c) {
    var cl = clusters[c];
    if (!cl) return;
    (cl.neighbors || []).forEach(function (nid) {
      var nc = idToIdx[nid];
      if (nc !== undefined && states[nc] === 'locked') states[nc] = 'unlocked';
    });
  });
  if (unlockedIndex !== null && unlockedIndex !== undefined && states[unlockedIndex] === 'locked') {
    states[unlockedIndex] = 'unlocked';
  }
  return states;
}
