#!/usr/bin/env node
'use strict';

// Precomputes 3D coordinates for the Word Universe view.
// Builds a similarity graph from each word's synonyms/antonyms, then runs a
// force-directed layout in 3D. Output is shipped as JSON so the phone client
// just renders — no physics on device.
//
// Edge rules (case-insensitive name match against the corpus):
//   - if word B appears in word A's synonym list  -> attractive spring (w 1.0)
//   - if A and B share K synonyms                 -> attractive spring (w 0.5*K)
//   - if word B appears in word A's antonym list  -> repulsive pair    (w 1.0)
//
// Run:  node scripts/build-word-positions.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const WORDS_PATH = path.join(ROOT, 'data', 'words.json');
const OUT_PATH = path.join(ROOT, 'data', 'word-positions.json');

const ITERATIONS = 1200;
const INITIAL_TEMP = 0.6;
const REST_LENGTH = 0.35;
const K_REPULSE = 0.0025;
const K_ATTRACT = 0.15;
const K_ANTONYM = 0.012;
const SEED = 11;

// Clustering (for the Constellation Quest game). k-means over the final 3D
// layout: spatial proximity there is a faithful proxy for semantic similarity,
// since the force layout already pulls synonyms together and pushes antonyms
// apart. Deterministic via the same LCG seed so the result is stable.
const CLUSTER_K = 12;
const KMEANS_ITERS = 40;
const CLUSTER_MIN = 12;
const CLUSTER_MAX = 45;

function lcgRandom(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function norm(name) {
  return String(name || '').trim().toLowerCase();
}

function buildGraph(words) {
  const index = new Map();
  words.forEach(function (w, i) { index.set(norm(w.word), i); });

  const attract = new Map(); // "i|j" (i<j) -> weight
  const repel = new Map();

  function addAttract(i, j, w) {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = a + '|' + b;
    attract.set(key, (attract.get(key) || 0) + w);
  }
  function addRepel(i, j, w) {
    if (i === j) return;
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = a + '|' + b;
    repel.set(key, (repel.get(key) || 0) + w);
  }

  // Direct mentions: if a synonym/antonym label matches another corpus word
  words.forEach(function (w, i) {
    (w.synonyms || []).forEach(function (s) {
      const j = index.get(norm(s));
      if (j !== undefined) addAttract(i, j, 1.0);
    });
    (w.antonyms || []).forEach(function (a) {
      const j = index.get(norm(a));
      if (j !== undefined) addRepel(i, j, 1.0);
    });
  });

  // Shared-synonym similarity: words that point at the same external thesaurus
  // labels probably mean similar things even if neither is in the corpus
  const synSets = words.map(function (w) {
    return new Set((w.synonyms || []).map(norm));
  });
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
      const a = synSets[i];
      const b = synSets[j];
      if (a.size === 0 || b.size === 0) continue;
      let shared = 0;
      a.forEach(function (s) { if (b.has(s)) shared++; });
      if (shared > 0) addAttract(i, j, 0.5 * shared);
    }
  }

  const edges = [];
  attract.forEach(function (w, key) {
    const parts = key.split('|');
    edges.push({ i: +parts[0], j: +parts[1], w: w });
  });
  const antiEdges = [];
  repel.forEach(function (w, key) {
    const parts = key.split('|');
    antiEdges.push({ i: +parts[0], j: +parts[1], w: w });
  });
  return { edges: edges, antiEdges: antiEdges };
}

function layout(words, graph) {
  const rand = lcgRandom(SEED);
  const n = words.length;
  const pos = new Array(n);
  for (let i = 0; i < n; i++) {
    pos[i] = {
      x: (rand() - 0.5) * 2,
      y: (rand() - 0.5) * 2,
      z: (rand() - 0.5) * 2,
    };
  }
  const disp = new Array(n);
  for (let i = 0; i < n; i++) disp[i] = { x: 0, y: 0, z: 0 };

  for (let iter = 0; iter < ITERATIONS; iter++) {
    const cool = INITIAL_TEMP * Math.pow(1 - iter / ITERATIONS, 1.5);

    for (let i = 0; i < n; i++) { disp[i].x = 0; disp[i].y = 0; disp[i].z = 0; }

    // All-pairs repulsion (350^2 ~ 122k ops per iter, fine)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let dz = pos[i].z - pos[j].z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 1e-6) {
          dx = (rand() - 0.5) * 1e-3;
          dy = (rand() - 0.5) * 1e-3;
          dz = (rand() - 0.5) * 1e-3;
          d2 = dx * dx + dy * dy + dz * dz + 1e-6;
        }
        const d = Math.sqrt(d2);
        const f = K_REPULSE / d2;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        const fz = (dz / d) * f;
        disp[i].x += fx; disp[i].y += fy; disp[i].z += fz;
        disp[j].x -= fx; disp[j].y -= fy; disp[j].z -= fz;
      }
    }

    // Synonym springs
    graph.edges.forEach(function (e) {
      const dx = pos[e.j].x - pos[e.i].x;
      const dy = pos[e.j].y - pos[e.i].y;
      const dz = pos[e.j].z - pos[e.i].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const stretch = d - REST_LENGTH;
      const f = K_ATTRACT * e.w * stretch;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      disp[e.i].x += fx; disp[e.i].y += fy; disp[e.i].z += fz;
      disp[e.j].x -= fx; disp[e.j].y -= fy; disp[e.j].z -= fz;
    });

    // Antonym extra repulsion
    graph.antiEdges.forEach(function (e) {
      const dx = pos[e.i].x - pos[e.j].x;
      const dy = pos[e.i].y - pos[e.j].y;
      const dz = pos[e.i].z - pos[e.j].z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 1e-6;
      const f = K_ANTONYM * e.w / d;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      const fz = (dz / d) * f;
      disp[e.i].x += fx; disp[e.i].y += fy; disp[e.i].z += fz;
      disp[e.j].x -= fx; disp[e.j].y -= fy; disp[e.j].z -= fz;
    });

    for (let i = 0; i < n; i++) {
      const m = Math.sqrt(disp[i].x * disp[i].x + disp[i].y * disp[i].y + disp[i].z * disp[i].z) + 1e-9;
      const cap = Math.min(m, cool);
      pos[i].x += (disp[i].x / m) * cap;
      pos[i].y += (disp[i].y / m) * cap;
      pos[i].z += (disp[i].z / m) * cap;
    }
  }

  // Center and scale to fit roughly within radius 1
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[i].x; cy += pos[i].y; cz += pos[i].z; }
  cx /= n; cy /= n; cz /= n;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    pos[i].x -= cx; pos[i].y -= cy; pos[i].z -= cz;
    const r = Math.sqrt(pos[i].x * pos[i].x + pos[i].y * pos[i].y + pos[i].z * pos[i].z);
    if (r > maxR) maxR = r;
  }
  const scale = 1 / (maxR || 1);
  for (let i = 0; i < n; i++) {
    pos[i].x *= scale; pos[i].y *= scale; pos[i].z *= scale;
  }
  return pos;
}

function neighborLists(words, graph, topK) {
  const n = words.length;
  const adj = new Array(n);
  for (let i = 0; i < n; i++) adj[i] = [];
  graph.edges.forEach(function (e) {
    adj[e.i].push({ j: e.j, w: e.w });
    adj[e.j].push({ j: e.i, w: e.w });
  });
  const result = {};
  for (let i = 0; i < n; i++) {
    adj[i].sort(function (a, b) { return b.w - a.w; });
    const top = adj[i].slice(0, topK).map(function (x) { return words[x.j].word; });
    if (top.length > 0) result[words[i].word] = top;
  }
  return result;
}

function round4(v) { return Math.round(v * 10000) / 10000; }

// k-means++ seeding: spread initial centroids out (probability of picking a
// point as the next centroid is proportional to its squared distance to the
// nearest already-chosen centroid).
function kmeansPlusPlusInit(pos, k, rand) {
  const n = pos.length;
  const centroids = [];
  const first = Math.floor(rand() * n) % n;
  centroids.push({ x: pos[first].x, y: pos[first].y, z: pos[first].z });
  const best = new Float64Array(n).fill(Infinity);
  while (centroids.length < k) {
    const last = centroids[centroids.length - 1];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const dx = pos[i].x - last.x, dy = pos[i].y - last.y, dz = pos[i].z - last.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[i]) best[i] = d;
      total += best[i];
    }
    let target = rand() * total, acc = 0, chosen = n - 1;
    for (let i = 0; i < n; i++) { acc += best[i]; if (acc >= target) { chosen = i; break; } }
    centroids.push({ x: pos[chosen].x, y: pos[chosen].y, z: pos[chosen].z });
  }
  return centroids;
}

function kmeans(pos, k, rand, iters) {
  const n = pos.length;
  const centroids = kmeansPlusPlusInit(pos, k, rand);
  const assign = new Int32Array(n).fill(-1);
  for (let it = 0; it < iters; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let bestC = 0, bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dx = pos[i].x - centroids[c].x, dy = pos[i].y - centroids[c].y, dz = pos[i].z - centroids[c].z;
        const d = dx * dx + dy * dy + dz * dz;
        if (d < bestD) { bestD = d; bestC = c; }
      }
      if (assign[i] !== bestC) { assign[i] = bestC; changed = true; }
    }
    const sums = [];
    for (let c = 0; c < k; c++) sums.push({ x: 0, y: 0, z: 0, n: 0 });
    for (let i = 0; i < n; i++) {
      const s = sums[assign[i]];
      s.x += pos[i].x; s.y += pos[i].y; s.z += pos[i].z; s.n++;
    }
    for (let c = 0; c < k; c++) {
      if (sums[c].n > 0) centroids[c] = { x: sums[c].x / sums[c].n, y: sums[c].y / sums[c].n, z: sums[c].z / sums[c].n };
    }
    if (!changed && it > 0) break;
  }
  return { assign: assign, centroids: centroids };
}

// Keep clusters playable: dissolve undersized clusters into the next-nearest
// centroid, and offload the farthest members of oversized clusters. A few
// passes settle it; exact balance isn't required, just a sane size range.
function balanceClusters(assign, centroids, pos, minSize, maxSize) {
  const n = pos.length;
  const k = centroids.length;
  function d2(i, c) {
    const dx = pos[i].x - centroids[c].x, dy = pos[i].y - centroids[c].y, dz = pos[i].z - centroids[c].z;
    return dx * dx + dy * dy + dz * dz;
  }
  function nearest(i, exclude) {
    let bestC = -1, bestD = Infinity;
    for (let c = 0; c < k; c++) {
      if (c === exclude || centroids[c] === null) continue;
      const d = d2(i, c);
      if (d < bestD) { bestD = d; bestC = c; }
    }
    return bestC;
  }
  function membersOf() {
    const m = []; for (let c = 0; c < k; c++) m.push([]);
    for (let i = 0; i < n; i++) if (assign[i] >= 0) m[assign[i]].push(i);
    return m;
  }
  for (let pass = 0; pass < 5; pass++) {
    let changed = false;
    let members = membersOf();
    for (let c = 0; c < k; c++) {
      if (centroids[c] === null || members[c].length === 0) continue;
      const active = centroids.filter(function (x) { return x !== null; }).length;
      if (members[c].length < minSize && active > 1) {
        centroids[c] = null;
        members[c].forEach(function (i) { assign[i] = nearest(i, c); });
        changed = true;
      }
    }
    if (changed) continue;
    members = membersOf();
    for (let c = 0; c < k; c++) {
      if (centroids[c] === null || members[c].length <= maxSize) continue;
      const sorted = members[c].slice().sort(function (a, b) { return d2(b, c) - d2(a, c); });
      const extra = members[c].length - maxSize;
      for (let t = 0; t < extra; t++) {
        const nc = nearest(sorted[t], c);
        if (nc >= 0) { assign[sorted[t]] = nc; changed = true; }
      }
    }
    if (!changed) break;
  }
  // Compact away dissolved/empty clusters and recompute centroids from members.
  const members = membersOf();
  const remap = {}; let nid = 0;
  for (let c = 0; c < k; c++) {
    if (centroids[c] !== null && members[c].length > 0) remap[c] = nid++;
  }
  for (let i = 0; i < n; i++) {
    assign[i] = remap[assign[i]] !== undefined ? remap[assign[i]] : 0;
  }
  const finalK = nid;
  const sums = [];
  for (let c = 0; c < finalK; c++) sums.push({ x: 0, y: 0, z: 0, n: 0 });
  for (let i = 0; i < n; i++) {
    const s = sums[assign[i]];
    s.x += pos[i].x; s.y += pos[i].y; s.z += pos[i].z; s.n++;
  }
  const newCentroids = [];
  for (let c = 0; c < finalK; c++) {
    newCentroids.push(sums[c].n > 0
      ? { x: sums[c].x / sums[c].n, y: sums[c].y / sums[c].n, z: sums[c].z / sums[c].n }
      : { x: 0, y: 0, z: 0 });
  }
  return { assign: assign, centroids: newCentroids };
}

// Unlock graph: a cluster is adjacent to its 2 nearest neighbours (by centroid)
// plus any cluster it shares a synonym edge with. A centroid MST is unioned in
// so the whole graph is connected (no cluster is ever unreachable).
function buildClusterAdjacency(clusters, graph, assign) {
  const k = clusters.length;
  const adj = []; for (let c = 0; c < k; c++) adj.push(new Set());
  function cd(a, b) {
    const A = clusters[a].centroid, B = clusters[b].centroid;
    const dx = A[0] - B[0], dy = A[1] - B[1], dz = A[2] - B[2];
    return dx * dx + dy * dy + dz * dz;
  }
  graph.edges.forEach(function (e) {
    const ca = assign[e.i], cb = assign[e.j];
    if (ca !== cb) { adj[ca].add(cb); adj[cb].add(ca); }
  });
  for (let c = 0; c < k; c++) {
    const others = [];
    for (let o = 0; o < k; o++) if (o !== c) others.push({ o: o, d: cd(c, o) });
    others.sort(function (a, b) { return a.d - b.d; });
    for (let t = 0; t < Math.min(2, others.length); t++) { adj[c].add(others[t].o); adj[others[t].o].add(c); }
  }
  if (k > 1) {
    const inTree = new Array(k).fill(false);
    inTree[0] = true; let count = 1;
    while (count < k) {
      let best = null;
      for (let a = 0; a < k; a++) {
        if (!inTree[a]) continue;
        for (let b = 0; b < k; b++) {
          if (inTree[b]) continue;
          const d = cd(a, b);
          if (!best || d < best.d) best = { a: a, b: b, d: d };
        }
      }
      if (!best) break;
      inTree[best.b] = true; count++;
      adj[best.a].add(best.b); adj[best.b].add(best.a);
    }
  }
  return adj.map(function (s) { return Array.from(s).sort(function (a, b) { return a - b; }); });
}

function buildClusters(words, graph, pos) {
  const rand = lcgRandom(SEED + 7);
  const km = kmeans(pos, CLUSTER_K, rand, KMEANS_ITERS);
  const bal = balanceClusters(km.assign, km.centroids, pos, CLUSTER_MIN, CLUSTER_MAX);
  const assign = bal.assign;
  const centroids = bal.centroids;
  const k = centroids.length;

  // Degree in the similarity graph picks an evocative, recognisable hub word
  // as each constellation's name.
  const degree = new Array(words.length).fill(0);
  graph.edges.forEach(function (e) { degree[e.i]++; degree[e.j]++; });
  graph.antiEdges.forEach(function (e) { degree[e.i]++; degree[e.j]++; });

  const members = []; for (let c = 0; c < k; c++) members.push([]);
  for (let i = 0; i < words.length; i++) members[assign[i]].push(i);

  const clusters = members.map(function (mem, c) {
    let bestIdx = mem[0];
    mem.forEach(function (i) {
      if (bestIdx === undefined) { bestIdx = i; return; }
      if (degree[i] > degree[bestIdx]) { bestIdx = i; return; }
      if (degree[i] === degree[bestIdx]) {
        const ri = words[i].usefulness_rating || 0, rb = words[bestIdx].usefulness_rating || 0;
        if (ri > rb) bestIdx = i;
        else if (ri === rb && words[i].word < words[bestIdx].word) bestIdx = i;
      }
    });
    return {
      id: c,
      name: bestIdx !== undefined ? words[bestIdx].word : 'Cluster ' + c,
      centroid: [round4(centroids[c].x), round4(centroids[c].y), round4(centroids[c].z)],
      words: mem.map(function (i) { return words[i].word; }),
    };
  });

  const adj = buildClusterAdjacency(clusters, graph, assign);
  clusters.forEach(function (cl, c) { cl.neighbors = adj[c]; });
  return clusters;
}

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const words = data.words;

  const t0 = Date.now();
  const graph = buildGraph(words);
  const pos = layout(words, graph);
  const neighbors = neighborLists(words, graph, 6);
  const clusters = buildClusters(words, graph, pos);
  const dt = ((Date.now() - t0) / 1000).toFixed(2);

  // Quantize to 4 decimals to keep payload small
  const positions = {};
  for (let i = 0; i < words.length; i++) {
    const p = pos[i];
    positions[words[i].word] = [
      Math.round(p.x * 10000) / 10000,
      Math.round(p.y * 10000) / 10000,
      Math.round(p.z * 10000) / 10000,
    ];
  }

  const out = {
    generated: new Date().toISOString(),
    iterations: ITERATIONS,
    count: words.length,
    edges: graph.edges.length,
    antiEdges: graph.antiEdges.length,
    positions: positions,
    neighbors: neighbors,
    clusters: clusters,
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log('Wrote ' + OUT_PATH);
  console.log('  ' + words.length + ' words, ' + graph.edges.length + ' attractive edges, ' + graph.antiEdges.length + ' antonym pairs');
  console.log('  ' + clusters.length + ' clusters, sizes ' +
    clusters.map(function (c) { return c.words.length; }).sort(function (a, b) { return a - b; }).join(',') );
  console.log('  layout completed in ' + dt + 's, file ' + kb + ' KB');
}

main();
