'use strict';

// Shared theme-assignment logic for the themed-sentence generation pipeline.
// getWordTheme mirrors the function of the same name in js/app.js so that the
// theme baked into words.json matches the theme the app picks at runtime.

// Story Quest worlds, in the same order as js/app.js so hash tie-breaks match.
const WORLDS = [
  { id: 'forest', name: 'Forest of Clues' },
  { id: 'castle', name: 'Castle of Synonyms' },
  { id: 'dragon', name: 'Dragon Mountain' },
  { id: 'fairies', name: 'Fairy Glen' },
  { id: 'army-battle', name: 'Army Battle Fields' },
  { id: 'sea-journey', name: 'Sea Journey Isles' },
  { id: 'wizard-school', name: 'Wizard School Towers' }
];

// Copied verbatim from THEME_KEYWORDS in js/app.js.
const THEME_KEYWORDS = {
  forest: ['forest', 'forests', 'tree', 'trees', 'wood', 'woods', 'wooden', 'leaf', 'leaves', 'branch', 'branches', 'nature', 'natural', 'plant', 'plants', 'garden', 'flower', 'flowers', 'root', 'roots', 'grow', 'grew', 'growth', 'hedge', 'meadow', 'vine', 'moss', 'soil', 'seed', 'seeds', 'blossom', 'bloom', 'countryside', 'lane', 'orchard', 'grove'],
  castle: ['castle', 'castles', 'king', 'queen', 'royal', 'crown', 'knight', 'knights', 'throne', 'noble', 'palace', 'lord', 'lady', 'kingdom', 'banquet', 'fortress', 'realm', 'regal', 'majesty', 'prince', 'princess', 'court', 'courtier'],
  dragon: ['dragon', 'dragons', 'fire', 'fiery', 'flame', 'flames', 'mountain', 'mountains', 'cave', 'caves', 'beast', 'beasts', 'scale', 'scales', 'roar', 'roared', 'treasure', 'hoard', 'smoke', 'ash', 'claw', 'claws', 'lair', 'monster', 'blaze', 'ember', 'embers'],
  fairies: ['fairy', 'fairies', 'magic', 'magical', 'glow', 'glowing', 'sparkle', 'sparkling', 'shimmer', 'wing', 'wings', 'glen', 'moon', 'moonlight', 'wish', 'wishes', 'tiny', 'delicate', 'glitter', 'enchant', 'enchanted', 'pixie', 'dew', 'petal', 'petals', 'graceful'],
  'army-battle': ['battle', 'fight', 'fighting', 'fought', 'war', 'wars', 'army', 'soldier', 'soldiers', 'weapon', 'weapons', 'attack', 'attacked', 'enemy', 'enemies', 'conquer', 'defend', 'defence', 'defense', 'aggressive', 'hostile', 'combat', 'troop', 'troops', 'march', 'marched', 'victory', 'defeat', 'charge', 'siege', 'brave', 'courage', 'bold', 'command', 'commander', 'captain', 'general', 'fierce'],
  'sea-journey': ['sea', 'seas', 'ship', 'ships', 'sail', 'sailed', 'sailing', 'ocean', 'oceans', 'wave', 'waves', 'water', 'voyage', 'sailor', 'sailors', 'tide', 'tides', 'harbour', 'harbor', 'fish', 'boat', 'boats', 'shore', 'coast', 'island', 'deck', 'anchor', 'current', 'storm', 'splash', 'marine', 'port', 'crew'],
  'wizard-school': ['wizard', 'wizards', 'spell', 'spells', 'study', 'studied', 'learn', 'learned', 'learning', 'book', 'books', 'school', 'knowledge', 'potion', 'potions', 'lesson', 'lessons', 'scholar', 'wise', 'wisdom', 'clever', 'intelligent', 'teach', 'taught', 'pupil', 'exam', 'library', 'scroll', 'scrolls']
};

// Rich descriptors handed to the generation model so sentences sit in the world.
const THEME_DESCRIPTORS = {
  forest: 'the Forest of Clues - a hushed woodland of mossy trails, ancient trees, owls, squirrels, ferns and dappled green light',
  castle: 'the Castle of Synonyms - a grand stone castle of kings, queens, knights, banners, scrolls, banquets and torch-lit halls',
  dragon: 'Dragon Mountain - a smouldering peak of caves, glowing embers, scales, treasure hoards, drifting smoke and a great dragon',
  fairies: 'the Fairy Glen - a glittering moonlit glade of tiny fairies, glowing toadstools, sparkles, dew drops and delicate wings',
  'army-battle': 'the Army Battle Fields - a brave campaign of soldiers, captains, shields, banners, marching troops and clever tactics (adventurous, never gory)',
  'sea-journey': 'the Sea Journey Isles - a rolling voyage of tall ships, sails, waves, sailors, harbours, islands and salty sea air',
  'wizard-school': 'Wizard School Towers - a busy magic school of spellbooks, potions, wands, lessons, floating candles, scrolls and clever pupils'
};

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Most keyword hits wins; a stable hash breaks ties (and handles zero hits).
function getWordTheme(wordObj) {
  const haystack = ((wordObj.definition || '') + ' ' + (wordObj.sentence_usage || '')).toLowerCase();
  const tokens = {};
  haystack.split(/[^a-z]+/).forEach(function (t) { if (t) tokens[t] = true; });

  let bestScore = 0;
  let leaders = [];
  WORLDS.forEach(function (world) {
    let score = 0;
    (THEME_KEYWORDS[world.id] || []).forEach(function (kw) { if (tokens[kw]) score++; });
    if (score > bestScore) { bestScore = score; leaders = [world]; }
    else if (score === bestScore) { leaders.push(world); }
  });

  return bestScore > 0
    ? leaders[hashString(wordObj.word) % leaders.length]
    : WORLDS[hashString(wordObj.word) % WORLDS.length];
}

module.exports = { WORLDS: WORLDS, THEME_KEYWORDS: THEME_KEYWORDS, THEME_DESCRIPTORS: THEME_DESCRIPTORS, getWordTheme: getWordTheme };
