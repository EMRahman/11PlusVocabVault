#!/usr/bin/env node
'use strict';

// Bakes hand-curated etymology + popularity entries for a starter set of the
// most evocative 11+ words into data/word-explorer.json, merging with whatever
// mood data is already there. The rest of the corpus gets filled in by
// scripts/build-explorer-prompts.js + the user's LLM batch run, with merge
// happening through scripts/merge-explorer-responses.js.
//
// Run: node scripts/build-explorer-curated.js

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXPLORER_PATH = path.join(ROOT, 'data', 'word-explorer.json');

// Etymology shape: { origin, root, rootMeaning, approxYear, cousins, kidExplanation }
// Origin label is the broad family used by the Etymology Tree view.
const ETYMOLOGY = {
  Abhorrent: {
    origin: 'Latin', root: 'abhorrere', rootMeaning: 'to shrink back in horror',
    approxYear: 1450, cousins: ['abhor', 'horror', 'horrendous', 'horrid'],
    kidExplanation: 'From Latin words meaning "to shrink back" — when something is so disgusting you literally step away.',
  },
  Adamant: {
    origin: 'Greek', root: 'adamas', rootMeaning: 'unbreakable, untameable',
    approxYear: 1330, cousins: ['diamond', 'adamantine'],
    kidExplanation: 'The Greeks used this word for the hardest substance they knew — the same root gave us "diamond".',
  },
  Audacious: {
    origin: 'Latin', root: 'audax', rootMeaning: 'bold, daring',
    approxYear: 1540, cousins: ['audacity', 'audible', 'audience'],
    kidExplanation: 'From a Latin word for "daring". A cousin of "audacity" — boldness that takes nerve.',
  },
  Belligerent: {
    origin: 'Latin', root: 'bellum + gerere', rootMeaning: 'waging war',
    approxYear: 1570, cousins: ['rebel', 'antebellum'],
    kidExplanation: 'Built from Latin "bellum" (war) and "gerere" (to wage). Literally "war-waging" — ready to fight.',
  },
  Benevolent: {
    origin: 'Latin', root: 'bene + volens', rootMeaning: 'well-wishing',
    approxYear: 1440, cousins: ['benefit', 'benefactor', 'volunteer'],
    kidExplanation: 'Latin "bene" (well) + "volens" (wishing). Someone benevolent wishes you well — the opposite of malevolent.',
  },
  Cacophony: {
    origin: 'Greek', root: 'kakos + phone', rootMeaning: 'bad sound',
    approxYear: 1650, cousins: ['phonetics', 'telephone', 'symphony'],
    kidExplanation: 'Greek "kakos" (bad) + "phone" (sound). The opposite of symphony — noise that hurts your ears.',
  },
  Calamity: {
    origin: 'Latin', root: 'calamitas', rootMeaning: 'disaster, ruin',
    approxYear: 1430, cousins: ['calamitous'],
    kidExplanation: 'Originally a Roman word for a crop disaster — when the harvest is ruined, that\'s a calamity.',
  },
  Captivating: {
    origin: 'Latin', root: 'capere', rootMeaning: 'to seize, capture',
    approxYear: 1520, cousins: ['capture', 'captive', 'caption', 'receive'],
    kidExplanation: 'Same Latin root as "capture" — something so interesting it seizes your attention.',
  },
  Clandestine: {
    origin: 'Latin', root: 'clam', rootMeaning: 'secretly',
    approxYear: 1560, cousins: [],
    kidExplanation: 'From Latin "clam" meaning "secretly". A clandestine plan is one nobody is meant to see.',
  },
  Compassion: {
    origin: 'Latin', root: 'cum + pati', rootMeaning: 'to suffer with',
    approxYear: 1340, cousins: ['patient', 'passion', 'sympathy'],
    kidExplanation: 'Latin "cum" (with) + "pati" (to suffer). Compassion is literally feeling someone else\'s pain alongside them.',
  },
  Courageous: {
    origin: 'Latin', root: 'cor', rootMeaning: 'heart',
    approxYear: 1300, cousins: ['cordial', 'core', 'discourage', 'encourage'],
    kidExplanation: 'From Latin "cor" meaning "heart". Courage was thought to live in the heart — being brave is being big-hearted.',
  },
  Decrepit: {
    origin: 'Latin', root: 'decrepitus', rootMeaning: 'very old, broken down',
    approxYear: 1440, cousins: ['decrepitude'],
    kidExplanation: 'Latin for "creaky and worn out" — used for crumbling old buildings and very ancient things.',
  },
  Desolate: {
    origin: 'Latin', root: 'desolatus', rootMeaning: 'abandoned, left alone',
    approxYear: 1380, cousins: ['sole', 'solitude', 'solo'],
    kidExplanation: 'Latin "sole" means "alone". A desolate place is one that has been completely abandoned.',
  },
  Eerie: {
    origin: 'Old English', root: 'earg', rootMeaning: 'fearful, cowardly',
    approxYear: 1300, cousins: [],
    kidExplanation: 'An old Scottish word originally meaning "scared". Now we use it for things that make us feel scared.',
  },
  Exquisite: {
    origin: 'Latin', root: 'exquirere', rootMeaning: 'to search out carefully',
    approxYear: 1430, cousins: ['inquire', 'require', 'quest', 'question'],
    kidExplanation: 'Latin for "carefully sought out" — something so fine and rare you had to search hard to find it.',
  },
  Ferocious: {
    origin: 'Latin', root: 'ferox', rootMeaning: 'wild, savage',
    approxYear: 1640, cousins: ['ferocity'],
    kidExplanation: 'From Latin "ferox" meaning fierce and wild — the same family as "feral" (gone wild).',
  },
  Forlorn: {
    origin: 'Old English', root: 'forleosan', rootMeaning: 'to lose completely',
    approxYear: 1150, cousins: ['lose', 'lorn'],
    kidExplanation: 'An old English word literally meaning "completely lost" — used now for sad and hopeless feelings.',
  },
  Frantic: {
    origin: 'Greek', root: 'phren', rootMeaning: 'mind',
    approxYear: 1380, cousins: ['frenzy', 'frenetic', 'schizophrenia'],
    kidExplanation: 'From a Greek root for "the mind" — a frantic person\'s mind is racing out of control.',
  },
  Idyllic: {
    origin: 'Greek', root: 'eidyllion', rootMeaning: 'little picture',
    approxYear: 1850, cousins: ['idyll', 'idol'],
    kidExplanation: 'Greek for "a tiny picture" — first used for short poems about peaceful country life, like a postcard scene.',
  },
  Labyrinthine: {
    origin: 'Greek', root: 'labyrinthos', rootMeaning: 'maze',
    approxYear: 1620, cousins: ['labyrinth'],
    kidExplanation: 'From the Greek myth of the Labyrinth — the impossible maze built by Daedalus to hold the Minotaur.',
  },
  Lethargic: {
    origin: 'Greek', root: 'lethargos', rootMeaning: 'forgetful, dull',
    approxYear: 1390, cousins: ['lethargy', 'Lethe'],
    kidExplanation: 'Linked to Lethe, the river of forgetfulness in Greek myth. Drink from it and you\'d feel sleepy and slow.',
  },
  Magnanimous: {
    origin: 'Latin', root: 'magnus + animus', rootMeaning: 'great-souled',
    approxYear: 1580, cousins: ['magnify', 'magnitude', 'unanimous', 'animate'],
    kidExplanation: 'Latin "magnus" (great) + "animus" (soul). Literally "big-souled" — generous-hearted, above small grudges.',
  },
  Majestic: {
    origin: 'Latin', root: 'maiestas', rootMeaning: 'greatness, dignity',
    approxYear: 1600, cousins: ['majesty', 'mayor', 'major'],
    kidExplanation: 'Same root as "majesty" — the word kings and queens get. Anything majestic feels royal in scale.',
  },
  Malevolent: {
    origin: 'Latin', root: 'male + volens', rootMeaning: 'ill-wishing',
    approxYear: 1500, cousins: ['malice', 'malady', 'malign'],
    kidExplanation: 'Latin "male" (badly) + "volens" (wishing). The exact opposite of "benevolent" — wishing someone harm.',
  },
  Nefarious: {
    origin: 'Latin', root: 'nefas', rootMeaning: 'unspeakable wrong',
    approxYear: 1600, cousins: [],
    kidExplanation: 'Latin "nefas" meant something so wicked it shouldn\'t even be spoken. Nefarious plans are deeply, secretly evil.',
  },
  Pristine: {
    origin: 'Latin', root: 'pristinus', rootMeaning: 'former, original',
    approxYear: 1530, cousins: [],
    kidExplanation: 'Originally meant "like it was at the beginning" — perfectly fresh and unspoilt, as if brand new.',
  },
  Resilient: {
    origin: 'Latin', root: 'resilire', rootMeaning: 'to leap back',
    approxYear: 1640, cousins: ['resile', 'salient', 'sally'],
    kidExplanation: 'Latin "re-" (back) + "salire" (to jump). A resilient person bounces back after every setback.',
  },
  Stealthy: {
    origin: 'Old English', root: 'stelan', rootMeaning: 'to steal',
    approxYear: 1300, cousins: ['steal', 'stealth'],
    kidExplanation: 'Same Old English root as "steal" — a thief\'s quiet way of moving so nobody notices.',
  },
  Tempestuous: {
    origin: 'Latin', root: 'tempestas', rootMeaning: 'storm, weather',
    approxYear: 1400, cousins: ['tempest', 'temper', 'temperature'],
    kidExplanation: 'Latin "tempestas" first meant "weather", then "storm". A tempestuous mood is a thunderstorm of feelings.',
  },
  Tumultuous: {
    origin: 'Latin', root: 'tumultus', rootMeaning: 'uproar, commotion',
    approxYear: 1540, cousins: ['tumult'],
    kidExplanation: 'Roman crowds shouting and shoving were called "tumultus" — anything tumultuous is wild and noisy.',
  },
};

// Popularity shape: { peakDecade, rarity (1-5, 5=rarest today), trend, kidNote }
// peakDecade approximates the era when the word was most common in books.
const POPULARITY = {
  Abhorrent:     { peakDecade: 1860, rarity: 4, trend: 'declining', kidNote: 'Big in Victorian novels and angry speeches. Less common today, but powerful when used.' },
  Adamant:       { peakDecade: 1960, rarity: 2, trend: 'steady',    kidNote: 'Surprisingly still common today — politicians and headlines love it.' },
  Audacious:     { peakDecade: 1900, rarity: 2, trend: 'rising',    kidNote: 'Almost faded out in the 1970s, then made a comeback — news writers love a "bold and audacious" plan.' },
  Belligerent:   { peakDecade: 1940, rarity: 3, trend: 'declining', kidNote: 'Peaked during the World Wars when nations were literally at war.' },
  Benevolent:    { peakDecade: 1860, rarity: 3, trend: 'declining', kidNote: 'Common in old novels for describing kind grandparents and rich donors.' },
  Cacophony:     { peakDecade: 2000, rarity: 3, trend: 'rising',    kidNote: 'Used more now than ever — perfect for describing noisy traffic or messy music.' },
  Calamity:      { peakDecade: 1880, rarity: 3, trend: 'declining', kidNote: 'Victorian newspapers were full of calamities. Now mostly used dramatically.' },
  Captivating:   { peakDecade: 1990, rarity: 2, trend: 'steady',    kidNote: 'Modern book reviews and adverts love this word.' },
  Clandestine:   { peakDecade: 1960, rarity: 3, trend: 'steady',    kidNote: 'A favourite in spy novels and political reporting.' },
  Compassion:    { peakDecade: 2000, rarity: 1, trend: 'rising',    kidNote: 'Used more today than at any point in history — a very modern, kind word.' },
  Courageous:    { peakDecade: 1940, rarity: 2, trend: 'steady',    kidNote: 'Peaked during wartime but has stayed strong ever since.' },
  Decrepit:      { peakDecade: 1880, rarity: 4, trend: 'declining', kidNote: 'Common when Victorians wrote about crumbling old buildings. Rarer now.' },
  Desolate:      { peakDecade: 1860, rarity: 3, trend: 'declining', kidNote: 'Romantic poets and gothic novelists used it constantly.' },
  Eerie:         { peakDecade: 1990, rarity: 2, trend: 'rising',    kidNote: 'Horror films and Halloween have kept this one alive and well.' },
  Exquisite:     { peakDecade: 1900, rarity: 2, trend: 'steady',    kidNote: 'Has barely changed since Jane Austen\'s day — still the go-to word for beautiful things.' },
  Ferocious:     { peakDecade: 1960, rarity: 2, trend: 'steady',    kidNote: 'Sports commentators and nature documentaries keep using it.' },
  Forlorn:       { peakDecade: 1820, rarity: 4, trend: 'declining', kidNote: 'A Romantic-era favourite (Keats wrote a famous line about it). Quite rare now.' },
  Frantic:       { peakDecade: 1980, rarity: 2, trend: 'steady',    kidNote: 'Used a lot in news stories about busy people and emergencies.' },
  Idyllic:       { peakDecade: 2000, rarity: 2, trend: 'rising',    kidNote: 'Travel adverts and Instagram captions love "idyllic" beaches.' },
  Labyrinthine:  { peakDecade: 1990, rarity: 4, trend: 'rising',    kidNote: 'Was almost forgotten in the 1800s, now used for confusing bureaucracy.' },
  Lethargic:     { peakDecade: 1990, rarity: 3, trend: 'steady',    kidNote: 'Health and fitness writers reach for this one a lot.' },
  Magnanimous:   { peakDecade: 1880, rarity: 4, trend: 'declining', kidNote: 'Was very common in 19th-century speeches about heroes and statesmen.' },
  Majestic:      { peakDecade: 1900, rarity: 2, trend: 'steady',    kidNote: 'Nature writing and royal coverage keep it in heavy use.' },
  Malevolent:    { peakDecade: 1980, rarity: 3, trend: 'rising',    kidNote: 'Fantasy novels and superhero films have made it more popular than ever.' },
  Nefarious:     { peakDecade: 1820, rarity: 3, trend: 'rising',    kidNote: 'Dipped for a century, now bouncing back thanks to internet humour about "nefarious schemes".' },
  Pristine:      { peakDecade: 2010, rarity: 2, trend: 'rising',    kidNote: 'More popular today than ever before — adverts love "pristine" beaches and condition.' },
  Resilient:     { peakDecade: 2020, rarity: 1, trend: 'rising',    kidNote: 'Exploded in popularity in the 21st century — a very modern compliment.' },
  Stealthy:      { peakDecade: 2000, rarity: 3, trend: 'steady',    kidNote: 'Video games and spy stories keep it in steady use.' },
  Tempestuous:   { peakDecade: 1860, rarity: 4, trend: 'declining', kidNote: 'A Romantic-era favourite for stormy seas and stormy feelings.' },
  Tumultuous:    { peakDecade: 1860, rarity: 3, trend: 'declining', kidNote: 'Common in 19th-century history books about revolutions and crowds.' },
};

function main() {
  let existing = {};
  if (fs.existsSync(EXPLORER_PATH)) {
    existing = JSON.parse(fs.readFileSync(EXPLORER_PATH, 'utf8'));
  }
  const mergedEtymology = Object.assign({}, existing.etymology || {}, ETYMOLOGY);
  const mergedPopularity = Object.assign({}, existing.popularity || {}, POPULARITY);
  const out = Object.assign({}, existing, {
    generated: new Date().toISOString(),
    mood: existing.mood || {},
    etymology: mergedEtymology,
    popularity: mergedPopularity,
  });
  fs.writeFileSync(EXPLORER_PATH, JSON.stringify(out));
  const kb = (fs.statSync(EXPLORER_PATH).size / 1024).toFixed(1);
  console.log('Curated etymology entries: ' + Object.keys(mergedEtymology).length);
  console.log('Curated popularity entries: ' + Object.keys(mergedPopularity).length);
  console.log('Wrote ' + EXPLORER_PATH + ' (' + kb + ' KB)');
}

main();
