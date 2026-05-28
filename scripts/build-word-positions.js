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

function main() {
  const data = JSON.parse(fs.readFileSync(WORDS_PATH, 'utf8'));
  const words = data.words;

  const t0 = Date.now();
  const graph = buildGraph(words);
  const pos = layout(words, graph);
  const neighbors = neighborLists(words, graph, 6);
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
  };
  fs.writeFileSync(OUT_PATH, JSON.stringify(out));
  const kb = (fs.statSync(OUT_PATH).size / 1024).toFixed(1);
  console.log('Wrote ' + OUT_PATH);
  console.log('  ' + words.length + ' words, ' + graph.edges.length + ' attractive edges, ' + graph.antiEdges.length + ' antonym pairs');
  console.log('  layout completed in ' + dt + 's, file ' + kb + ' KB');
}

main();
