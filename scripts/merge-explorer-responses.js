#!/usr/bin/env node
'use strict';

// Validates the model responses pasted into scripts/explorer-prompts/*.json
// (under the `outputs` field) and merges them into data/word-explorer.json.
// Existing entries are preserved unless overwritten by a valid new one.
//
// Run: node scripts/merge-explorer-responses.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXPLORER_PATH = path.join(ROOT, 'data', 'word-explorer.json');
const PROMPT_DIR = path.join(__dirname, 'explorer-prompts');

const ORIGINS = new Set(['Latin','Greek','Old English','Old Norse','French','Arabic','Germanic','Other']);
const TRENDS = new Set(['rising','steady','declining']);

function parseOutputs(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  let s = String(raw).trim();
  // Strip optional markdown fence
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(s); } catch (e) { return null; }
}

function validEtymology(v) {
  if (!v || typeof v !== 'object') return null;
  const origin = String(v.origin || '').trim();
  if (!ORIGINS.has(origin)) return null;
  const root = String(v.root || '').trim();
  if (!root) return null;
  const rootMeaning = String(v.rootMeaning || '').trim();
  if (!rootMeaning) return null;
  const approxYear = Number(v.approxYear);
  if (!Number.isFinite(approxYear) || approxYear < 500 || approxYear > 2100) return null;
  const cousins = Array.isArray(v.cousins) ? v.cousins.filter(function (c) { return typeof c === 'string' && c.trim().length > 0; }).slice(0, 6) : [];
  const kidExplanation = String(v.kidExplanation || '').trim();
  if (kidExplanation.length < 10 || kidExplanation.length > 240) return null;
  return { origin: origin, root: root, rootMeaning: rootMeaning, approxYear: approxYear, cousins: cousins, kidExplanation: kidExplanation };
}

function validPopularity(v) {
  if (!v || typeof v !== 'object') return null;
  const peakDecade = Number(v.peakDecade);
  if (!Number.isFinite(peakDecade) || peakDecade < 1500 || peakDecade > 2030) return null;
  const rarity = Number(v.rarity);
  if (!Number.isInteger(rarity) || rarity < 1 || rarity > 5) return null;
  const trend = String(v.trend || '').trim();
  if (!TRENDS.has(trend)) return null;
  const kidNote = String(v.kidNote || '').trim();
  if (kidNote.length < 5 || kidNote.length > 240) return null;
  return { peakDecade: peakDecade, rarity: rarity, trend: trend, kidNote: kidNote };
}

function main() {
  if (!fs.existsSync(PROMPT_DIR)) {
    console.error('No prompt directory at ' + PROMPT_DIR + ' — run build-explorer-prompts.js first.');
    process.exit(1);
  }
  const explorer = fs.existsSync(EXPLORER_PATH)
    ? JSON.parse(fs.readFileSync(EXPLORER_PATH, 'utf8'))
    : { etymology: {}, popularity: {}, mood: {} };
  explorer.etymology = explorer.etymology || {};
  explorer.popularity = explorer.popularity || {};
  explorer.mood = explorer.mood || {};

  let addedE = 0, addedP = 0, rejectedE = 0, rejectedP = 0, skipped = 0;
  const files = fs.readdirSync(PROMPT_DIR).filter(function (f) { return f.endsWith('.json'); });
  files.forEach(function (f) {
    const file = path.join(PROMPT_DIR, f);
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const parsed = parseOutputs(data.outputs);
    if (!parsed) { skipped++; return; }
    Object.keys(parsed).forEach(function (word) {
      if (data.kind === 'etymology') {
        const v = validEtymology(parsed[word]);
        if (v) { explorer.etymology[word] = v; addedE++; } else { rejectedE++; }
      } else if (data.kind === 'popularity') {
        const v = validPopularity(parsed[word]);
        if (v) { explorer.popularity[word] = v; addedP++; } else { rejectedP++; }
      }
    });
  });

  explorer.generated = new Date().toISOString();
  fs.writeFileSync(EXPLORER_PATH, JSON.stringify(explorer));
  console.log('Etymology: +' + addedE + ' merged (' + rejectedE + ' rejected)');
  console.log('Popularity: +' + addedP + ' merged (' + rejectedP + ' rejected)');
  if (skipped) console.log('Skipped ' + skipped + ' file(s) with no/invalid `outputs` field.');
  console.log('Total now: etymology=' + Object.keys(explorer.etymology).length + ', popularity=' + Object.keys(explorer.popularity).length);
}

main();
