(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let allWords = [];
  let lastFocusedCard = null;

  // ── View counts (persisted in localStorage) ────────────────────────────────
  var VIEW_COUNTS_KEY = 'vocabVault_viewCounts';
  var viewCounts = {};

  function loadViewCounts() {
    try {
      var stored = localStorage.getItem(VIEW_COUNTS_KEY);
      viewCounts = stored ? JSON.parse(stored) : {};
    } catch (e) {
      viewCounts = {};
    }
  }

  function saveViewCounts() {
    try {
      localStorage.setItem(VIEW_COUNTS_KEY, JSON.stringify(viewCounts));
    } catch (e) {}
  }

  function incrementViewCount(word) {
    viewCounts[word] = (viewCounts[word] || 0) + 1;
    saveViewCounts();
  }

  const state = {
    query: '',
    ratingFilter: null, // null = all, 1-5 = exact match
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const wordGrid      = document.getElementById('word-grid');
  const searchInput   = document.getElementById('search-input');
  const filterBtns    = document.querySelectorAll('.filter-btn');
  const modalOverlay  = document.getElementById('modal-overlay');
  const modalCard     = document.getElementById('modal-card');
  const modalClose    = document.getElementById('modal-close');
  const modalTitle         = document.getElementById('modal-word-title');
  const modalPronunciation = document.getElementById('modal-pronunciation');
  const modalStars         = document.getElementById('modal-stars');
  const modalDef      = document.getElementById('modal-definition');
  const modalSentence = document.getElementById('modal-sentence');
  const modalSynonyms = document.getElementById('modal-synonyms');
  const modalAntonyms   = document.getElementById('modal-antonyms');
  const linkDefine      = document.getElementById('link-define');
  const linkExamples    = document.getElementById('link-examples');
  const modalViewCount  = document.getElementById('modal-view-count');
  const wordCountEl     = document.getElementById('word-count');
  const totalWordsEl  = document.getElementById('total-words');
  const cardTemplate  = document.getElementById('word-card-template');

  // ── Embedded word data ────────────────────────────────────────────────────
  // Data is embedded directly so the app works when opened as a local file
  // (no server required). To add more words, extend this array.
  var WORDS = [
  {
    "word": "Trepidation",
    "pronunciation": "trep-ih-DAY-shun",
    "definition": "A shaky, nervous feeling that something scary is about to happen.",
    "sentence_usage": "As he pushed open the creaking door of the abandoned mansion, a wave of cold trepidation washed over him.",
    "synonyms": [
      "Fear",
      "Anxiety",
      "Apprehension"
    ],
    "antonyms": [
      "Confidence",
      "Bravery",
      "Calm"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Melancholy",
    "pronunciation": "MEL-an-kol-ee",
    "definition": "A quiet, heavy sadness that lasts a long time.",
    "sentence_usage": "The constant, drumming rain matched the melancholy mood that hung heavily over the deserted town.",
    "synonyms": [
      "Sorrow",
      "Sadness",
      "Gloom"
    ],
    "antonyms": [
      "Joy",
      "Cheerfulness",
      "Exuberance"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Cacophony",
    "pronunciation": "ka-KOF-oh-nee",
    "definition": "A horrible, loud mix of messy noises.",
    "sentence_usage": "The peaceful morning was shattered by a sudden cacophony of screeching tires, blaring horns, and shouting voices.",
    "synonyms": [
      "Din",
      "Racket",
      "Noise"
    ],
    "antonyms": [
      "Silence",
      "Harmony",
      "Peace"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Ephemeral",
    "pronunciation": "eh-FEM-er-al",
    "definition": "Something beautiful that lasts for only a very short time, like a bubble.",
    "sentence_usage": "The beautiful sunset was an ephemeral masterpiece, fading into darkness almost as quickly as it had appeared.",
    "synonyms": [
      "Fleeting",
      "Temporary",
      "Brief"
    ],
    "antonyms": [
      "Permanent",
      "Eternal",
      "Lasting"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Ubiquitous",
    "pronunciation": "yoo-BIK-wih-tus",
    "definition": "Something that seems to be everywhere you look.",
    "sentence_usage": "In the futuristic city, glowing neon signs were ubiquitous, illuminating every dark alley and towering skyscraper.",
    "synonyms": [
      "Everywhere",
      "Omnipresent",
      "Universal"
    ],
    "antonyms": [
      "Rare",
      "Scarce",
      "Uncommon"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Luminous",
    "pronunciation": "LOO-mih-nus",
    "definition": "Glowing brightly in the dark.",
    "sentence_usage": "The cave was bathed in a luminous, ethereal glow emanating from the strange crystals on the ceiling.",
    "synonyms": [
      "Radiant",
      "Shining",
      "Glowing"
    ],
    "antonyms": [
      "Dark",
      "Dull",
      "Gloomy"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Serpentine",
    "pronunciation": "SER-pen-tyne",
    "definition": "Twisting and turning like a moving snake.",
    "sentence_usage": "The river carved a serpentine path through the dense, unforgiving jungle.",
    "synonyms": [
      "Winding",
      "Twisting",
      "Snake-like"
    ],
    "antonyms": [
      "Straight",
      "Direct"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Petrified",
    "pronunciation": "PET-rih-fyd",
    "definition": "So incredibly scared that you freeze up like a stone statue.",
    "sentence_usage": "Rooted to the spot, the young boy stood entirely petrified as the shadow detached itself from the wall.",
    "synonyms": [
      "Terrified",
      "Paralyzed",
      "Frozen"
    ],
    "antonyms": [
      "Fearless",
      "Relaxed",
      "Unbothered"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Dilapidated",
    "pronunciation": "dih-LAP-ih-day-tid",
    "definition": "Old, broken, and falling apart from being ignored for a long time.",
    "sentence_usage": "At the end of the lane sat a dilapidated cottage, its roof caved in and windows shattered by time.",
    "synonyms": [
      "Ruined",
      "Decaying",
      "Crumbling"
    ],
    "antonyms": [
      "Pristine",
      "Immaculate",
      "Restored"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Voracious",
    "pronunciation": "voh-RAY-shus",
    "definition": "Super hungry, like you could eat absolutely everything in sight.",
    "sentence_usage": "After wandering in the wilderness for three days, the survivor ate the berries with a voracious appetite.",
    "synonyms": [
      "Ravenous",
      "Insatiable",
      "Greedy"
    ],
    "antonyms": [
      "Satisfied",
      "Full",
      "Quenched"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Abundant",
    "pronunciation": "uh-BUN-duhnt",
    "definition": "More than enough of something.",
    "sentence_usage": "Abundant berries hung from the hedge, turning the lane into a feast of colour.",
    "synonyms": [
      "Plentiful",
      "Ample",
      "Overflowing"
    ],
    "antonyms": [
      "Scarce",
      "Rare",
      "Meagre"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Agitated",
    "pronunciation": "AJ-ih-tay-tid",
    "definition": "Upset and unable to stay calm.",
    "sentence_usage": "The agitated horse stamped the ground as thunder rolled across the hills.",
    "synonyms": [
      "Upset",
      "Restless",
      "Disturbed"
    ],
    "antonyms": [
      "Calm",
      "Peaceful",
      "Settled"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Amiable",
    "pronunciation": "AY-mee-uh-bul",
    "definition": "Friendly and pleasant to be around.",
    "sentence_usage": "The amiable shopkeeper greeted every child with a warm smile and a cheerful joke.",
    "synonyms": [
      "Friendly",
      "Kind",
      "Pleasant"
    ],
    "antonyms": [
      "Grumpy",
      "Hostile",
      "Unkind"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ancient",
    "pronunciation": "AYN-shunt",
    "definition": "Very old and from a long time ago.",
    "sentence_usage": "Ancient stones circled the hilltop, guarding secrets from long-forgotten ages.",
    "synonyms": [
      "Old",
      "Antique",
      "Age-old"
    ],
    "antonyms": [
      "Modern",
      "New",
      "Recent"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Anticipation",
    "pronunciation": "an-tiss-ih-PAY-shun",
    "definition": "An excited feeling about something that is about to happen.",
    "sentence_usage": "In breathless anticipation, the class waited for the theatre curtain to rise.",
    "synonyms": [
      "Excitement",
      "Expectation",
      "Hope"
    ],
    "antonyms": [
      "Dread",
      "Surprise",
      "Disappointment"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Astonished",
    "pronunciation": "uh-STON-isht",
    "definition": "Very surprised.",
    "sentence_usage": "Mia stared at the floating lanterns, too astonished to say a single word.",
    "synonyms": [
      "Amazed",
      "Shocked",
      "Startled"
    ],
    "antonyms": [
      "Unimpressed",
      "Bored",
      "Expectant"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Bewildered",
    "pronunciation": "bih-WIL-derd",
    "definition": "Very confused and unsure what is happening.",
    "sentence_usage": "The bewildered explorer spun in circles when every path in the cave looked the same.",
    "synonyms": [
      "Confused",
      "Puzzled",
      "Perplexed"
    ],
    "antonyms": [
      "Certain",
      "Clear-headed",
      "Sure"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Bleak",
    "pronunciation": "BLEEK",
    "definition": "Cold, empty, and without much hope.",
    "sentence_usage": "A bleak wind swept across the moor, carrying whispers through the dry grass.",
    "synonyms": [
      "Gloomy",
      "Barren",
      "Harsh"
    ],
    "antonyms": [
      "Hopeful",
      "Bright",
      "Welcoming"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Blossom",
    "pronunciation": "BLOS-uhm",
    "definition": "To burst into flowers or grow beautifully.",
    "sentence_usage": "With a splash of spring rain, the orchard began to blossom overnight.",
    "synonyms": [
      "Bloom",
      "Flower",
      "Flourish"
    ],
    "antonyms": [
      "Wither",
      "Fade",
      "Wilt"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Brisk",
    "pronunciation": "BRISK",
    "definition": "Quick, lively, and full of energy.",
    "sentence_usage": "They set off at a brisk pace before the sun could melt the silver frost.",
    "synonyms": [
      "Quick",
      "Lively",
      "Swift"
    ],
    "antonyms": [
      "Slow",
      "Lazy",
      "Sluggish"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Bustling",
    "pronunciation": "BUS-ling",
    "definition": "Full of busy movement and noise.",
    "sentence_usage": "The bustling market overflowed with voices, spices, and clattering carts.",
    "synonyms": [
      "Busy",
      "Lively",
      "Crowded"
    ],
    "antonyms": [
      "Quiet",
      "Still",
      "Empty"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Calamity",
    "pronunciation": "kuh-LAM-ih-tee",
    "definition": "A terrible event that causes lots of trouble.",
    "sentence_usage": "What began as a prank soon turned into a calamity when the paint spilled across the stage.",
    "synonyms": [
      "Disaster",
      "Catastrophe",
      "Misfortune"
    ],
    "antonyms": [
      "Blessing",
      "Success",
      "Triumph"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Captivating",
    "pronunciation": "KAP-tih-vay-ting",
    "definition": "So interesting or beautiful that it holds all your attention.",
    "sentence_usage": "The storyteller's captivating voice made the campfire shadows seem alive.",
    "synonyms": [
      "Enchanting",
      "Fascinating",
      "Spellbinding"
    ],
    "antonyms": [
      "Dull",
      "Boring",
      "Uninteresting"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Cautious",
    "pronunciation": "KAW-shus",
    "definition": "Careful to avoid danger or mistakes.",
    "sentence_usage": "Cautious steps carried the children across the icy bridge above the roaring stream.",
    "synonyms": [
      "Careful",
      "Wary",
      "Alert"
    ],
    "antonyms": [
      "Reckless",
      "Careless",
      "Bold"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ceaseless",
    "pronunciation": "SEES-lis",
    "definition": "Never stopping.",
    "sentence_usage": "The ceaseless tapping of rain on the roof kept everyone awake through the night.",
    "synonyms": [
      "Endless",
      "Constant",
      "Unbroken"
    ],
    "antonyms": [
      "Occasional",
      "Stopped",
      "Rare"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Chaotic",
    "pronunciation": "kay-OT-ik",
    "definition": "Very messy, wild, and out of control.",
    "sentence_usage": "Books, socks, and half-finished maps covered the floor in chaotic heaps.",
    "synonyms": [
      "Wild",
      "Disorderly",
      "Messy"
    ],
    "antonyms": [
      "Orderly",
      "Calm",
      "Neat"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Clambered",
    "pronunciation": "KLAM-berd",
    "definition": "Climbed with hands and feet in an awkward way.",
    "sentence_usage": "He clambered over the fallen tree trunk to reach the hidden nest.",
    "synonyms": [
      "Climbed",
      "Scrambled",
      "Scaled"
    ],
    "antonyms": [
      "Descended",
      "Dropped",
      "Slid"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Clandestine",
    "pronunciation": "klan-DES-tin",
    "definition": "Done in secret so nobody notices.",
    "sentence_usage": "They held a clandestine meeting behind the curtain while the audience applauded.",
    "synonyms": [
      "Secret",
      "Hidden",
      "Sneaky"
    ],
    "antonyms": [
      "Open",
      "Public",
      "Obvious"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Collapse",
    "pronunciation": "kuh-LAPS",
    "definition": "To suddenly fall down.",
    "sentence_usage": "With a groan of splintering wood, the old shed began to collapse.",
    "synonyms": [
      "Fall",
      "Crumble",
      "Topple"
    ],
    "antonyms": [
      "Stand",
      "Rise",
      "Remain"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Commotion",
    "pronunciation": "kuh-MOH-shun",
    "definition": "A noisy fuss with lots of movement.",
    "sentence_usage": "A sudden commotion in the playground sent teachers hurrying across the field.",
    "synonyms": [
      "Uproar",
      "Disturbance",
      "Racket"
    ],
    "antonyms": [
      "Calm",
      "Peace",
      "Order"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Compassion",
    "pronunciation": "kuhm-PASH-un",
    "definition": "A kind wish to help someone who is hurting.",
    "sentence_usage": "Her compassion showed when she wrapped her scarf around the shivering puppy.",
    "synonyms": [
      "Kindness",
      "Care",
      "Mercy"
    ],
    "antonyms": [
      "Cruelty",
      "Meanness",
      "Harshness"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Concealed",
    "pronunciation": "kuhn-SEELD",
    "definition": "Hidden so it cannot easily be seen.",
    "sentence_usage": "A concealed lever behind the painting opened the secret staircase.",
    "synonyms": [
      "Hidden",
      "Covered",
      "Disguised"
    ],
    "antonyms": [
      "Visible",
      "Exposed",
      "Obvious"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Contented",
    "pronunciation": "kuhn-TEN-tid",
    "definition": "Quietly happy and satisfied.",
    "sentence_usage": "The cat looked contented as it purred beside the warm kitchen stove.",
    "synonyms": [
      "Satisfied",
      "Happy",
      "Pleased"
    ],
    "antonyms": [
      "Unhappy",
      "Restless",
      "Dissatisfied"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Courageous",
    "pronunciation": "kuh-RAY-jus",
    "definition": "Very brave.",
    "sentence_usage": "With one courageous leap, Zara crossed the rushing stream and pulled her friend to safety.",
    "synonyms": [
      "Brave",
      "Bold",
      "Fearless"
    ],
    "antonyms": [
      "Cowardly",
      "Timid",
      "Afraid"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Crisp",
    "pronunciation": "KRISP",
    "definition": "Fresh, cool, and pleasantly sharp.",
    "sentence_usage": "A crisp autumn breeze scattered gold leaves across the playground.",
    "synonyms": [
      "Fresh",
      "Cool",
      "Sharp"
    ],
    "antonyms": [
      "Stale",
      "Damp",
      "Soft"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Dazzling",
    "pronunciation": "DAZ-ling",
    "definition": "Extremely bright or impressive.",
    "sentence_usage": "The dazzling chandelier sprayed diamonds of light around the ballroom.",
    "synonyms": [
      "Brilliant",
      "Sparkling",
      "Blinding"
    ],
    "antonyms": [
      "Dull",
      "Dim",
      "Drab"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Defiant",
    "pronunciation": "dih-FY-unt",
    "definition": "Boldly refusing to obey.",
    "sentence_usage": "The defiant robin stayed on the gate even as the dog barked below.",
    "synonyms": [
      "Rebellious",
      "Bold",
      "Resistant"
    ],
    "antonyms": [
      "Obedient",
      "Submissive",
      "Compliant"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Delicate",
    "pronunciation": "DEL-ih-kut",
    "definition": "Fine, light, and easy to damage.",
    "sentence_usage": "A delicate layer of frost turned every blade of grass into crystal.",
    "synonyms": [
      "Fragile",
      "Fine",
      "Tender"
    ],
    "antonyms": [
      "Strong",
      "Tough",
      "Sturdy"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Desolate",
    "pronunciation": "DES-uh-lut",
    "definition": "Empty, lonely, and sad.",
    "sentence_usage": "The desolate beach stretched for miles without a single footprint in the sand.",
    "synonyms": [
      "Lonely",
      "Barren",
      "Bleak"
    ],
    "antonyms": [
      "Crowded",
      "Cheerful",
      "Lively"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Determined",
    "pronunciation": "dih-TUR-mind",
    "definition": "Fully decided to keep going and not give up.",
    "sentence_usage": "Determined to finish the race, Arjun pushed through the mud and rain.",
    "synonyms": [
      "Resolved",
      "Steady",
      "Persistent"
    ],
    "antonyms": [
      "Uncertain",
      "Lazy",
      "Wavering"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Diligent",
    "pronunciation": "DIL-ih-junt",
    "definition": "Hard-working and careful.",
    "sentence_usage": "The diligent apprentice polished every brass handle until it gleamed like gold.",
    "synonyms": [
      "Hard-working",
      "Careful",
      "Industrious"
    ],
    "antonyms": [
      "Lazy",
      "Careless",
      "Idle"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Disperse",
    "pronunciation": "dih-SPURS",
    "definition": "To spread out in different directions.",
    "sentence_usage": "At the blast of the whistle, the pigeons began to disperse into the pale morning sky.",
    "synonyms": [
      "Scatter",
      "Spread",
      "Separate"
    ],
    "antonyms": [
      "Gather",
      "Collect",
      "Assemble"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Dreary",
    "pronunciation": "DREER-ee",
    "definition": "Dull, grey, and a bit depressing.",
    "sentence_usage": "A dreary afternoon hung over the town, with clouds smudging the sky like charcoal.",
    "synonyms": [
      "Dull",
      "Gloomy",
      "Drab"
    ],
    "antonyms": [
      "Bright",
      "Cheerful",
      "Sunny"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Eager",
    "pronunciation": "EE-gur",
    "definition": "Very ready and excited to do something.",
    "sentence_usage": "The eager pupils rushed to the window when snowflakes started to fall.",
    "synonyms": [
      "Keen",
      "Excited",
      "Ready"
    ],
    "antonyms": [
      "Reluctant",
      "Unwilling",
      "Lazy"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Eerie",
    "pronunciation": "EER-ee",
    "definition": "Strange and spooky in a way that makes you uneasy.",
    "sentence_usage": "An eerie silence settled over the forest after the owl's sudden cry.",
    "synonyms": [
      "Spooky",
      "Unsettling",
      "Ghostly"
    ],
    "antonyms": [
      "Comforting",
      "Familiar",
      "Cheerful"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Elated",
    "pronunciation": "ee-LAY-tid",
    "definition": "Extremely happy and proud.",
    "sentence_usage": "Elated by her surprise victory, Nina skipped all the way home.",
    "synonyms": [
      "Overjoyed",
      "Thrilled",
      "Delighted"
    ],
    "antonyms": [
      "Miserable",
      "Downcast",
      "Sad"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Elegant",
    "pronunciation": "EL-ih-gunt",
    "definition": "Graceful and stylish.",
    "sentence_usage": "The swan glided in an elegant curve across the moonlit lake.",
    "synonyms": [
      "Graceful",
      "Stylish",
      "Refined"
    ],
    "antonyms": [
      "Clumsy",
      "Awkward",
      "Plain"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Emerald",
    "pronunciation": "EM-er-uld",
    "definition": "A rich, deep green colour.",
    "sentence_usage": "Emerald light filtered through the leaves and painted the path below.",
    "synonyms": [
      "Green",
      "Jewel-like",
      "Verdant"
    ],
    "antonyms": [
      "Colourless",
      "Dull",
      "Grey"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Enormous",
    "pronunciation": "ih-NOR-mus",
    "definition": "Very, very big.",
    "sentence_usage": "An enormous wave rose above the boat like a moving wall of glass.",
    "synonyms": [
      "Huge",
      "Massive",
      "Gigantic"
    ],
    "antonyms": [
      "Tiny",
      "Small",
      "Little"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Enraged",
    "pronunciation": "en-RAYJD",
    "definition": "Extremely angry.",
    "sentence_usage": "Enraged by the broken promise, the dragon slammed its tail against the cave floor.",
    "synonyms": [
      "Furious",
      "Livid",
      "Infuriated"
    ],
    "antonyms": [
      "Calm",
      "Pleased",
      "Peaceful"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Exhausted",
    "pronunciation": "ig-ZAW-stid",
    "definition": "So tired that you have almost no energy left.",
    "sentence_usage": "By the end of the climb, the exhausted hikers could hardly lift their boots.",
    "synonyms": [
      "Tired",
      "Worn-out",
      "Drained"
    ],
    "antonyms": [
      "Energetic",
      "Rested",
      "Lively"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Exquisite",
    "pronunciation": "EK-skwiz-it",
    "definition": "Extremely beautiful and carefully made.",
    "sentence_usage": "An exquisite pattern of ice spread across the window like silver lace.",
    "synonyms": [
      "Beautiful",
      "Delicate",
      "Lovely"
    ],
    "antonyms": [
      "Ugly",
      "Rough",
      "Plain"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Faded",
    "pronunciation": "FAY-did",
    "definition": "Grown weaker, paler, or less clear.",
    "sentence_usage": "The faded sign still pointed towards the harbour, although half its paint had peeled away.",
    "synonyms": [
      "Pale",
      "Dimmed",
      "Worn"
    ],
    "antonyms": [
      "Bright",
      "Fresh",
      "Vivid"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Faltered",
    "pronunciation": "FAWL-terd",
    "definition": "Hesitated or lost strength for a moment.",
    "sentence_usage": "His voice faltered when he heard footsteps echoing behind him in the tunnel.",
    "synonyms": [
      "Wavered",
      "Stumbled",
      "Hesitated"
    ],
    "antonyms": [
      "Continued",
      "Steadied",
      "Persisted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ferocious",
    "pronunciation": "fuh-ROH-shus",
    "definition": "Very fierce and wild.",
    "sentence_usage": "The ferocious storm clawed at the windows with wind and rain.",
    "synonyms": [
      "Fierce",
      "Savage",
      "Violent"
    ],
    "antonyms": [
      "Gentle",
      "Mild",
      "Tame"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Flourish",
    "pronunciation": "FLUR-ish",
    "definition": "To grow or do very well.",
    "sentence_usage": "With sunshine and patience, the tiny seedlings began to flourish in the school garden.",
    "synonyms": [
      "Thrive",
      "Prosper",
      "Bloom"
    ],
    "antonyms": [
      "Fail",
      "Decline",
      "Wither"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Forlorn",
    "pronunciation": "for-LORN",
    "definition": "Lonely and sad because something is missing.",
    "sentence_usage": "A forlorn whistle drifted from the station after the last train had gone.",
    "synonyms": [
      "Lonely",
      "Sad",
      "Mournful"
    ],
    "antonyms": [
      "Hopeful",
      "Happy",
      "Comforted"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Fragrant",
    "pronunciation": "FRAY-grunt",
    "definition": "Having a sweet or pleasant smell.",
    "sentence_usage": "Fragrant roses climbed the gate and filled the air with summer sweetness.",
    "synonyms": [
      "Sweet-smelling",
      "Perfumed",
      "Aromatic"
    ],
    "antonyms": [
      "Smelly",
      "Stinky",
      "Foul"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Frantic",
    "pronunciation": "FRAN-tik",
    "definition": "Wild with worry, fear, or hurry.",
    "sentence_usage": "Frantic footsteps thundered upstairs as everyone searched for the missing key.",
    "synonyms": [
      "Panicked",
      "Wild",
      "Desperate"
    ],
    "antonyms": [
      "Calm",
      "Controlled",
      "Relaxed"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Gargantuan",
    "pronunciation": "gar-GAN-choo-un",
    "definition": "Extremely huge.",
    "sentence_usage": "A gargantuan shadow rose from the sea and blocked the setting sun.",
    "synonyms": [
      "Huge",
      "Enormous",
      "Massive"
    ],
    "antonyms": [
      "Tiny",
      "Miniature",
      "Small"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Glimmer",
    "pronunciation": "GLIM-er",
    "definition": "A faint, small light.",
    "sentence_usage": "A glimmer of gold shone beneath the dusty floorboards.",
    "synonyms": [
      "Flicker",
      "Spark",
      "Twinkle"
    ],
    "antonyms": [
      "Darkness",
      "Blackness",
      "Shadow"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Gloomy",
    "pronunciation": "GLOO-mee",
    "definition": "Dark, sad, or without much cheer.",
    "sentence_usage": "The gloomy corridor seemed to swallow every sound except the drip of water.",
    "synonyms": [
      "Dark",
      "Sad",
      "Miserable"
    ],
    "antonyms": [
      "Cheerful",
      "Bright",
      "Sunny"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Glorious",
    "pronunciation": "GLOR-ee-us",
    "definition": "Wonderful, splendid, and full of beauty.",
    "sentence_usage": "It was a glorious morning, with birdsong rising through the clear blue air.",
    "synonyms": [
      "Splendid",
      "Magnificent",
      "Wonderful"
    ],
    "antonyms": [
      "Awful",
      "Terrible",
      "Dreadful"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Graceful",
    "pronunciation": "GRAYS-ful",
    "definition": "Moving in a smooth and lovely way.",
    "sentence_usage": "The graceful deer leapt over the brook without disturbing a single reed.",
    "synonyms": [
      "Elegant",
      "Smooth",
      "Poised"
    ],
    "antonyms": [
      "Clumsy",
      "Awkward",
      "Ungainly"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Grim",
    "pronunciation": "GRIM",
    "definition": "Serious, dark, and worrying.",
    "sentence_usage": "A grim expression spread across the captain's face as the fog swallowed the lighthouse.",
    "synonyms": [
      "Stern",
      "Bleak",
      "Harsh"
    ],
    "antonyms": [
      "Cheerful",
      "Bright",
      "Hopeful"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Glistening",
    "pronunciation": "GLISS-un-ing",
    "definition": "Shining with a wet or polished sparkle.",
    "sentence_usage": "Glistening raindrops clung to the spider web like tiny pearls.",
    "synonyms": [
      "Sparkling",
      "Shining",
      "Gleaming"
    ],
    "antonyms": [
      "Dull",
      "Matte",
      "Dim"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Gnarled",
    "pronunciation": "NARLD",
    "definition": "Twisted and rough, usually because of age.",
    "sentence_usage": "A gnarled oak tree crouched beside the path like an old giant.",
    "synonyms": [
      "Twisted",
      "Knotted",
      "Crooked"
    ],
    "antonyms": [
      "Smooth",
      "Straight",
      "Even"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Haunted",
    "pronunciation": "HAWN-tid",
    "definition": "Seeming to be visited by ghosts or troubled memories.",
    "sentence_usage": "The haunted house loomed over the village with boarded windows and a leaning porch.",
    "synonyms": [
      "Spooky",
      "Ghostly",
      "Cursed"
    ],
    "antonyms": [
      "Peaceful",
      "Welcoming",
      "Safe"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Hearty",
    "pronunciation": "HAR-tee",
    "definition": "Warm, strong, and full of energy or enthusiasm.",
    "sentence_usage": "A hearty laugh burst from Grandad as the puppy chased its own tail.",
    "synonyms": [
      "Warm",
      "Strong",
      "Enthusiastic"
    ],
    "antonyms": [
      "Weak",
      "Faint",
      "Cold"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Hesitant",
    "pronunciation": "HEZ-ih-tunt",
    "definition": "Slow to act because you are unsure.",
    "sentence_usage": "She gave a hesitant knock before pushing open the office door.",
    "synonyms": [
      "Unsure",
      "Wavering",
      "Timid"
    ],
    "antonyms": [
      "Certain",
      "Decisive",
      "Bold"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Huddled",
    "pronunciation": "HUD-uld",
    "definition": "Crowded closely together for warmth or safety.",
    "sentence_usage": "The chicks huddled beneath their mother when the first drops of rain fell.",
    "synonyms": [
      "Crouched",
      "Clustered",
      "Gathered"
    ],
    "antonyms": [
      "Spread-out",
      "Separated",
      "Scattered"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Illuminated",
    "pronunciation": "ih-LOO-mih-nay-tid",
    "definition": "Lit up brightly.",
    "sentence_usage": "The moon illuminated the ruined tower, turning every stone silver-white.",
    "synonyms": [
      "Lit",
      "Brightened",
      "Lighted"
    ],
    "antonyms": [
      "Darkened",
      "Shadowed",
      "Dimmed"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Immense",
    "pronunciation": "ih-MENS",
    "definition": "Extremely large.",
    "sentence_usage": "An immense door of carved oak swung slowly open on its rusty hinges.",
    "synonyms": [
      "Huge",
      "Vast",
      "Enormous"
    ],
    "antonyms": [
      "Tiny",
      "Little",
      "Small"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Impatient",
    "pronunciation": "im-PAY-shunt",
    "definition": "Unable to wait calmly.",
    "sentence_usage": "Impatient to begin, Leo tapped his pencil against the desk like a tiny drum.",
    "synonyms": [
      "Restless",
      "Eager",
      "Irritable"
    ],
    "antonyms": [
      "Patient",
      "Calm",
      "Relaxed"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Impressive",
    "pronunciation": "im-PRESS-iv",
    "definition": "So good, big, or clever that it makes people admire it.",
    "sentence_usage": "The castle's impressive towers rose above the valley like stone spears.",
    "synonyms": [
      "Remarkable",
      "Striking",
      "Amazing"
    ],
    "antonyms": [
      "Ordinary",
      "Plain",
      "Unremarkable"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Incandescent",
    "pronunciation": "in-kan-DES-unt",
    "definition": "Shining with a bright, glowing light.",
    "sentence_usage": "The incandescent lava lit the cavern with a dangerous orange glow.",
    "synonyms": [
      "Glowing",
      "Radiant",
      "Brilliant"
    ],
    "antonyms": [
      "Dark",
      "Dull",
      "Dim"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Ingenious",
    "pronunciation": "in-JEEN-yus",
    "definition": "Very clever and inventive.",
    "sentence_usage": "Her ingenious plan used mirrors to bounce sunlight into the gloomy attic.",
    "synonyms": [
      "Clever",
      "Inventive",
      "Smart"
    ],
    "antonyms": [
      "Foolish",
      "Simple",
      "Clumsy"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Jovial",
    "pronunciation": "JOH-vee-ul",
    "definition": "Cheerful and friendly.",
    "sentence_usage": "The jovial baker hummed a tune as he handed out warm buns.",
    "synonyms": [
      "Cheerful",
      "Jolly",
      "Friendly"
    ],
    "antonyms": [
      "Gloomy",
      "Sour",
      "Miserable"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Jubilant",
    "pronunciation": "JOO-bih-lunt",
    "definition": "Bursting with joy and celebration.",
    "sentence_usage": "The team was jubilant when the winning goal rippled the net.",
    "synonyms": [
      "Triumphant",
      "Delighted",
      "Joyful"
    ],
    "antonyms": [
      "Downcast",
      "Mournful",
      "Disappointed"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Knackered",
    "pronunciation": "NAK-erd",
    "definition": "Extremely tired.",
    "sentence_usage": "After the charity run, even the most talkative pupils were completely knackered.",
    "synonyms": [
      "Exhausted",
      "Worn-out",
      "Tired"
    ],
    "antonyms": [
      "Energetic",
      "Fresh",
      "Rested"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Labyrinthine",
    "pronunciation": "lab-uh-RIN-thine",
    "definition": "Like a maze with many twisting turns.",
    "sentence_usage": "Labyrinthine corridors curled beneath the palace, confusing every visitor who entered.",
    "synonyms": [
      "Maze-like",
      "Twisting",
      "Complex"
    ],
    "antonyms": [
      "Simple",
      "Straight",
      "Clear"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Lament",
    "pronunciation": "luh-MENT",
    "definition": "To show sadness about a loss.",
    "sentence_usage": "The villagers gathered to lament the great oak that had fallen in the storm.",
    "synonyms": [
      "Mourn",
      "Grieve",
      "Regret"
    ],
    "antonyms": [
      "Celebrate",
      "Rejoice",
      "Praise"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Lavish",
    "pronunciation": "LAV-ish",
    "definition": "Rich, grand, and more than enough.",
    "sentence_usage": "A lavish banquet covered the table with roasted meats, fruits, and sparkling drinks.",
    "synonyms": [
      "Luxurious",
      "Grand",
      "Extravagant"
    ],
    "antonyms": [
      "Plain",
      "Simple",
      "Meagre"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Lingered",
    "pronunciation": "LING-gerd",
    "definition": "Stayed longer than expected.",
    "sentence_usage": "The smell of cinnamon lingered in the kitchen long after the pies had cooled.",
    "synonyms": [
      "Remained",
      "Stayed",
      "Hung-on"
    ],
    "antonyms": [
      "Left",
      "Vanished",
      "Departed"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Looming",
    "pronunciation": "LOO-ming",
    "definition": "Appearing large, dark, and threatening.",
    "sentence_usage": "A looming cliff rose above the boat, hiding the sky from view.",
    "synonyms": [
      "Threatening",
      "Overhanging",
      "Towering"
    ],
    "antonyms": [
      "Distant",
      "Tiny",
      "Receding"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Lurched",
    "pronunciation": "LURCHT",
    "definition": "Moved suddenly and awkwardly.",
    "sentence_usage": "The bus lurched forward, sending backpacks sliding across the floor.",
    "synonyms": [
      "Jolted",
      "Staggered",
      "Swayed"
    ],
    "antonyms": [
      "Glided",
      "Balanced",
      "Steadied"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Majestic",
    "pronunciation": "muh-JES-tik",
    "definition": "Grand and beautiful in a powerful way.",
    "sentence_usage": "A majestic eagle circled above the valley, silent and sure.",
    "synonyms": [
      "Grand",
      "Magnificent",
      "Regal"
    ],
    "antonyms": [
      "Lowly",
      "Plain",
      "Small"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Meandered",
    "pronunciation": "mee-AN-derd",
    "definition": "Moved or followed a path with many gentle bends.",
    "sentence_usage": "The stream meandered through the meadow like a ribbon of glass.",
    "synonyms": [
      "Wandered",
      "Wound",
      "Curved"
    ],
    "antonyms": [
      "Rushed",
      "Shot",
      "Streamed"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Menacing",
    "pronunciation": "MEN-uh-sing",
    "definition": "Looking as if it could cause danger.",
    "sentence_usage": "Menacing clouds gathered over the sea and swallowed the last patch of blue.",
    "synonyms": [
      "Threatening",
      "Ominous",
      "Frightening"
    ],
    "antonyms": [
      "Friendly",
      "Safe",
      "Comforting"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Mischievous",
    "pronunciation": "MIS-chuh-vus",
    "definition": "Playfully naughty.",
    "sentence_usage": "A mischievous grin spread across Ben's face as he hid the treasure map.",
    "synonyms": [
      "Playful",
      "Cheeky",
      "Naughty"
    ],
    "antonyms": [
      "Well-behaved",
      "Serious",
      "Obedient"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Miserable",
    "pronunciation": "MIZ-er-uh-bul",
    "definition": "Very unhappy and uncomfortable.",
    "sentence_usage": "Soaked by the storm, the campers looked miserable beneath the flapping tent.",
    "synonyms": [
      "Unhappy",
      "Wretched",
      "Gloomy"
    ],
    "antonyms": [
      "Cheerful",
      "Comfortable",
      "Delighted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Misty",
    "pronunciation": "MIS-tee",
    "definition": "Filled with light fog.",
    "sentence_usage": "A misty veil drifted over the lake and softened the shapes of the boats.",
    "synonyms": [
      "Foggy",
      "Hazy",
      "Cloudy"
    ],
    "antonyms": [
      "Clear",
      "Bright",
      "Sharp"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Muttered",
    "pronunciation": "MUT-erd",
    "definition": "Spoke in a low, unclear voice.",
    "sentence_usage": "He muttered a worried warning as the floorboards creaked beneath them.",
    "synonyms": [
      "Mumbled",
      "Whispered",
      "Grumbled"
    ],
    "antonyms": [
      "Shouted",
      "Declared",
      "Announced"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Mysterious",
    "pronunciation": "mis-TEER-ee-us",
    "definition": "Difficult to explain or understand.",
    "sentence_usage": "A mysterious package appeared on the doorstep without a name or note.",
    "synonyms": [
      "Strange",
      "Secretive",
      "Puzzling"
    ],
    "antonyms": [
      "Clear",
      "Obvious",
      "Plain"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Nimble",
    "pronunciation": "NIM-bul",
    "definition": "Quick and light in movement.",
    "sentence_usage": "The nimble fox darted between tree roots and vanished into the ferns.",
    "synonyms": [
      "Agile",
      "Quick",
      "Spry"
    ],
    "antonyms": [
      "Clumsy",
      "Slow",
      "Awkward"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Nocturnal",
    "pronunciation": "nok-TUR-nul",
    "definition": "Active at night.",
    "sentence_usage": "Nocturnal creatures stirred in the hedges as the village lamps blinked on.",
    "synonyms": [
      "Night-time",
      "Night-active",
      "After-dark"
    ],
    "antonyms": [
      "Daytime",
      "Diurnal",
      "Sunlit"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Nostalgic",
    "pronunciation": "nos-TAL-jik",
    "definition": "Feeling warm but sad when remembering the past.",
    "sentence_usage": "The crackling tune made Grandma nostalgic for summers by the seaside.",
    "synonyms": [
      "Wistful",
      "Sentimental",
      "Yearning"
    ],
    "antonyms": [
      "Forgetful",
      "Unmoved",
      "Future-looking"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Notorious",
    "pronunciation": "noh-TOR-ee-us",
    "definition": "Famous for something bad.",
    "sentence_usage": "The notorious pirate was whispered about in every harbour tavern.",
    "synonyms": [
      "Infamous",
      "Dishonourable",
      "Wicked"
    ],
    "antonyms": [
      "Respected",
      "Honourable",
      "Praised"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Noxious",
    "pronunciation": "NOK-shus",
    "definition": "Harmful or very unpleasant, especially in smell.",
    "sentence_usage": "Noxious smoke curled from the cauldron and stung everyone's eyes.",
    "synonyms": [
      "Toxic",
      "Foul",
      "Harmful"
    ],
    "antonyms": [
      "Fresh",
      "Safe",
      "Pleasant"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Obedient",
    "pronunciation": "oh-BEE-dee-unt",
    "definition": "Willing to do as you are told.",
    "sentence_usage": "The obedient dog sat at once when its owner raised a hand.",
    "synonyms": [
      "Well-behaved",
      "Compliant",
      "Respectful"
    ],
    "antonyms": [
      "Defiant",
      "Rebellious",
      "Disobedient"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Obscure",
    "pronunciation": "ub-SKYOOR",
    "definition": "Hard to see, notice, or understand.",
    "sentence_usage": "An obscure symbol was scratched into the wall behind the curtain.",
    "synonyms": [
      "Hidden",
      "Unclear",
      "Vague"
    ],
    "antonyms": [
      "Clear",
      "Obvious",
      "Famous"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ominous",
    "pronunciation": "OM-ih-nus",
    "definition": "Giving the feeling that something bad is about to happen.",
    "sentence_usage": "An ominous rumble rolled beneath the ground before the cave began to shake.",
    "synonyms": [
      "Threatening",
      "Sinister",
      "Menacing"
    ],
    "antonyms": [
      "Reassuring",
      "Hopeful",
      "Promising"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Opulent",
    "pronunciation": "OP-yuh-lunt",
    "definition": "Rich, luxurious, and expensive-looking.",
    "sentence_usage": "Opulent curtains of velvet framed the stage like a royal cloak.",
    "synonyms": [
      "Luxurious",
      "Sumptuous",
      "Grand"
    ],
    "antonyms": [
      "Poor",
      "Simple",
      "Plain"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ornate",
    "pronunciation": "or-NAYT",
    "definition": "Decorated with lots of fancy detail.",
    "sentence_usage": "An ornate mirror hung above the fireplace, edged with carved roses and birds.",
    "synonyms": [
      "Decorated",
      "Fancy",
      "Detailed"
    ],
    "antonyms": [
      "Plain",
      "Simple",
      "Bare"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Overjoyed",
    "pronunciation": "oh-ver-JOYD",
    "definition": "Extremely happy.",
    "sentence_usage": "She was overjoyed when the lost necklace glittered from the flower bed.",
    "synonyms": [
      "Delighted",
      "Thrilled",
      "Ecstatic"
    ],
    "antonyms": [
      "Heartbroken",
      "Sad",
      "Miserable"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Peculiar",
    "pronunciation": "pih-KYOO-lee-er",
    "definition": "Strange in an interesting way.",
    "sentence_usage": "A peculiar humming noise drifted from the clock at midnight.",
    "synonyms": [
      "Odd",
      "Strange",
      "Unusual"
    ],
    "antonyms": [
      "Normal",
      "Ordinary",
      "Typical"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Perilous",
    "pronunciation": "PER-il-us",
    "definition": "Very dangerous.",
    "sentence_usage": "The climbers edged along the perilous ledge above the crashing waves.",
    "synonyms": [
      "Dangerous",
      "Risky",
      "Hazardous"
    ],
    "antonyms": [
      "Safe",
      "Secure",
      "Protected"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Perplexed",
    "pronunciation": "per-PLEKST",
    "definition": "Confused because something is difficult to understand.",
    "sentence_usage": "Jaden looked perplexed when the map showed a road straight through the lake.",
    "synonyms": [
      "Puzzled",
      "Confused",
      "Baffled"
    ],
    "antonyms": [
      "Certain",
      "Sure",
      "Enlightened"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Persistent",
    "pronunciation": "per-SIS-tunt",
    "definition": "Keeping going and refusing to give up.",
    "sentence_usage": "A persistent drizzle followed them all the way to the mountain hut.",
    "synonyms": [
      "Determined",
      "Steady",
      "Tenacious"
    ],
    "antonyms": [
      "Lazy",
      "Fickle",
      "Yielding"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Piercing",
    "pronunciation": "PEER-sing",
    "definition": "Very sharp, bright, or strong.",
    "sentence_usage": "A piercing scream shattered the silence of the sleeping house.",
    "synonyms": [
      "Sharp",
      "Shrill",
      "Penetrating"
    ],
    "antonyms": [
      "Soft",
      "Gentle",
      "Muffled"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Placid",
    "pronunciation": "PLASS-id",
    "definition": "Calm and peaceful, without strong movement or emotion.",
    "sentence_usage": "The pond lay placid beneath the dawn, smooth as polished glass.",
    "synonyms": [
      "Calm",
      "Still",
      "Peaceful"
    ],
    "antonyms": [
      "Agitated",
      "Wild",
      "Rough"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Poised",
    "pronunciation": "POYZD",
    "definition": "Balanced, calm, and ready.",
    "sentence_usage": "The gymnast stood poised on the beam before springing into the air.",
    "synonyms": [
      "Balanced",
      "Ready",
      "Composed"
    ],
    "antonyms": [
      "Clumsy",
      "Unsteady",
      "Flustered"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Precious",
    "pronunciation": "PRESH-us",
    "definition": "Very valuable or loved.",
    "sentence_usage": "She tucked the precious letter safely inside a wooden box.",
    "synonyms": [
      "Valuable",
      "Dear",
      "Cherished"
    ],
    "antonyms": [
      "Worthless",
      "Unwanted",
      "Cheap"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Prickly",
    "pronunciation": "PRIK-lee",
    "definition": "Covered in sharp points or easily annoyed.",
    "sentence_usage": "A prickly hedge guarded the narrow path to the orchard.",
    "synonyms": [
      "Spiky",
      "Sharp",
      "Bristly"
    ],
    "antonyms": [
      "Smooth",
      "Soft",
      "Gentle"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Proud",
    "pronunciation": "PROWD",
    "definition": "Very pleased with yourself or someone else.",
    "sentence_usage": "Proud of her painting, Eva carried it home as carefully as treasure.",
    "synonyms": [
      "Pleased",
      "Satisfied",
      "Honoured"
    ],
    "antonyms": [
      "Ashamed",
      "Embarrassed",
      "Humble"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Puny",
    "pronunciation": "PYOO-nee",
    "definition": "Very small and weak.",
    "sentence_usage": "The puny candle flame could not warm the vast, draughty hall.",
    "synonyms": [
      "Tiny",
      "Weak",
      "Feeble"
    ],
    "antonyms": [
      "Mighty",
      "Strong",
      "Huge"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Quaint",
    "pronunciation": "KWAYNT",
    "definition": "Charmingly old-fashioned.",
    "sentence_usage": "A quaint row of cottages lined the lane with crooked chimneys and flower boxes.",
    "synonyms": [
      "Charming",
      "Old-fashioned",
      "Picturesque"
    ],
    "antonyms": [
      "Modern",
      "Plain",
      "Unattractive"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Quivered",
    "pronunciation": "KWIV-erd",
    "definition": "Shook with small quick movements.",
    "sentence_usage": "The leaf quivered when the first raindrop landed upon it.",
    "synonyms": [
      "Trembled",
      "Shivered",
      "Shook"
    ],
    "antonyms": [
      "Steadied",
      "Stilled",
      "Settled"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Radiant",
    "pronunciation": "RAY-dee-unt",
    "definition": "Shining brightly or looking full of happiness.",
    "sentence_usage": "Her radiant smile brightened the room more quickly than the lamps.",
    "synonyms": [
      "Glowing",
      "Bright",
      "Beaming"
    ],
    "antonyms": [
      "Dull",
      "Gloomy",
      "Dark"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Ragged",
    "pronunciation": "RAG-id",
    "definition": "Rough, torn, or uneven.",
    "sentence_usage": "Ragged clouds crawled across the moon like ripped grey cloth.",
    "synonyms": [
      "Torn",
      "Rough",
      "Shabby"
    ],
    "antonyms": [
      "Neat",
      "Smooth",
      "Tidy"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Ravenous",
    "pronunciation": "RAV-uh-nus",
    "definition": "Extremely hungry.",
    "sentence_usage": "After swimming for hours, the children were ravenous and cheered at the sight of sandwiches.",
    "synonyms": [
      "Hungry",
      "Starving",
      "Famished"
    ],
    "antonyms": [
      "Full",
      "Satisfied",
      "Stuffed"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Reassuring",
    "pronunciation": "ree-uh-SHOOR-ing",
    "definition": "Making someone feel calmer and safer.",
    "sentence_usage": "Dad's reassuring nod gave her the courage to step onto the stage.",
    "synonyms": [
      "Comforting",
      "Soothing",
      "Encouraging"
    ],
    "antonyms": [
      "Worrying",
      "Threatening",
      "Scary"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Reckless",
    "pronunciation": "REK-lis",
    "definition": "Doing dangerous things without thinking.",
    "sentence_usage": "With a reckless laugh, he rode straight into the muddy stream.",
    "synonyms": [
      "Careless",
      "Wild",
      "Foolhardy"
    ],
    "antonyms": [
      "Careful",
      "Cautious",
      "Sensible"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Reluctant",
    "pronunciation": "rih-LUK-tunt",
    "definition": "Not wanting to do something.",
    "sentence_usage": "Reluctant to leave the fire, the campers pulled their blankets tighter.",
    "synonyms": [
      "Unwilling",
      "Hesitant",
      "Dubious"
    ],
    "antonyms": [
      "Eager",
      "Willing",
      "Ready"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Resilient",
    "pronunciation": "rih-ZIL-yunt",
    "definition": "Able to recover quickly after difficulty.",
    "sentence_usage": "The resilient little plant pushed through the cracked pavement after the storm.",
    "synonyms": [
      "Strong",
      "Tough",
      "Adaptable"
    ],
    "antonyms": [
      "Fragile",
      "Weak",
      "Delicate"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Resolute",
    "pronunciation": "REZ-uh-loot",
    "definition": "Very determined and sure.",
    "sentence_usage": "Resolute and steady, the captain kept the ship pointed towards the light.",
    "synonyms": [
      "Determined",
      "Firm",
      "Steadfast"
    ],
    "antonyms": [
      "Unsure",
      "Wavering",
      "Weak"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Rickety",
    "pronunciation": "RIK-ih-tee",
    "definition": "Weak and shaky, as if it might fall apart.",
    "sentence_usage": "They tiptoed across the rickety bridge while the river foamed below.",
    "synonyms": [
      "Shaky",
      "Unstable",
      "Wobbly"
    ],
    "antonyms": [
      "Strong",
      "Solid",
      "Sturdy"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Rippling",
    "pronunciation": "RIP-ling",
    "definition": "Moving in small waves.",
    "sentence_usage": "Rippling laughter spread through the hall when the magician dropped his hat.",
    "synonyms": [
      "Undulating",
      "Waving",
      "Flowing"
    ],
    "antonyms": [
      "Still",
      "Flat",
      "Motionless"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Robust",
    "pronunciation": "roh-BUST",
    "definition": "Strong, healthy, and sturdy.",
    "sentence_usage": "A robust oak door protected the library from the howling wind.",
    "synonyms": [
      "Strong",
      "Sturdy",
      "Healthy"
    ],
    "antonyms": [
      "Fragile",
      "Weak",
      "Flimsy"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Rustling",
    "pronunciation": "RUSS-ling",
    "definition": "Making a soft swishing sound.",
    "sentence_usage": "Rustling leaves whispered above their heads as dusk crept in.",
    "synonyms": [
      "Swishing",
      "Whispering",
      "Murmuring"
    ],
    "antonyms": [
      "Silence",
      "Stillness",
      "Quiet"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Savage",
    "pronunciation": "SAV-ij",
    "definition": "Fierce, violent, and wild.",
    "sentence_usage": "Savage waves hammered the cliffs until white spray burst high into the air.",
    "synonyms": [
      "Fierce",
      "Brutal",
      "Wild"
    ],
    "antonyms": [
      "Gentle",
      "Tame",
      "Mild"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Scarlet",
    "pronunciation": "SKAR-lit",
    "definition": "A bright red colour.",
    "sentence_usage": "Scarlet petals floated across the pond like tiny boats of fire.",
    "synonyms": [
      "Crimson",
      "Red",
      "Ruby"
    ],
    "antonyms": [
      "Pale",
      "Colourless",
      "White"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Scurried",
    "pronunciation": "SKUR-eed",
    "definition": "Moved quickly with short, hurried steps.",
    "sentence_usage": "Mice scurried across the barn floor when the lantern flickered on.",
    "synonyms": [
      "Rushed",
      "Darted",
      "Scampered"
    ],
    "antonyms": [
      "Strolled",
      "Lingered",
      "Paused"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Serene",
    "pronunciation": "suh-REEN",
    "definition": "Calm and peaceful.",
    "sentence_usage": "The garden looked serene beneath the first light of dawn.",
    "synonyms": [
      "Peaceful",
      "Calm",
      "Tranquil"
    ],
    "antonyms": [
      "Chaotic",
      "Noisy",
      "Agitated"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Shimmering",
    "pronunciation": "SHIM-er-ing",
    "definition": "Shining with a soft, wavering light.",
    "sentence_usage": "A shimmering curtain of heat rose above the desert road.",
    "synonyms": [
      "Sparkling",
      "Gleaming",
      "Glittering"
    ],
    "antonyms": [
      "Dull",
      "Matte",
      "Dim"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Shrieked",
    "pronunciation": "SHREEKT",
    "definition": "Cried out in a loud, high voice.",
    "sentence_usage": "She shrieked when the icy water splashed over the side of the boat.",
    "synonyms": [
      "Screamed",
      "Yelped",
      "Cried"
    ],
    "antonyms": [
      "Whispered",
      "Murmured",
      "Muttered"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Shrouded",
    "pronunciation": "SHROW-did",
    "definition": "Covered or hidden, often by mist, darkness, or cloth.",
    "sentence_usage": "The mountain peak was shrouded in cloud and mystery.",
    "synonyms": [
      "Covered",
      "Veiled",
      "Hidden"
    ],
    "antonyms": [
      "Revealed",
      "Exposed",
      "Visible"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Sinuous",
    "pronunciation": "SIN-yoo-us",
    "definition": "Bending in smooth curves.",
    "sentence_usage": "A sinuous trail wound through the reeds towards the old boathouse.",
    "synonyms": [
      "Curving",
      "Winding",
      "Twisting"
    ],
    "antonyms": [
      "Straight",
      "Rigid",
      "Direct"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Skeletal",
    "pronunciation": "SKEL-uh-tul",
    "definition": "Very thin or bare like a skeleton.",
    "sentence_usage": "Skeletal trees clawed at the winter sky with leafless branches.",
    "synonyms": [
      "Bony",
      "Gaunt",
      "Bare"
    ],
    "antonyms": [
      "Plump",
      "Leafy",
      "Full"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Solemn",
    "pronunciation": "SOL-um",
    "definition": "Serious and quiet.",
    "sentence_usage": "A solemn hush filled the chapel as the candles flickered.",
    "synonyms": [
      "Serious",
      "Grave",
      "Quiet"
    ],
    "antonyms": [
      "Playful",
      "Cheerful",
      "Light-hearted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Sparse",
    "pronunciation": "SPARS",
    "definition": "Thinly spread, with not much there.",
    "sentence_usage": "Sparse grass clung to the dry hillside between patches of stone.",
    "synonyms": [
      "Scant",
      "Thin",
      "Meagre"
    ],
    "antonyms": [
      "Thick",
      "Dense",
      "Abundant"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Spectacular",
    "pronunciation": "spek-TAK-yuh-ler",
    "definition": "Very impressive to look at.",
    "sentence_usage": "Fireworks burst above the river in a spectacular shower of colour.",
    "synonyms": [
      "Amazing",
      "Stunning",
      "Magnificent"
    ],
    "antonyms": [
      "Ordinary",
      "Dull",
      "Plain"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Spirited",
    "pronunciation": "SPIR-it-id",
    "definition": "Full of life, courage, or energy.",
    "sentence_usage": "The spirited pony tossed its mane and raced across the field.",
    "synonyms": [
      "Lively",
      "Energetic",
      "Feisty"
    ],
    "antonyms": [
      "Lifeless",
      "Dull",
      "Tired"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Splendid",
    "pronunciation": "SPLEN-did",
    "definition": "Very beautiful or excellent.",
    "sentence_usage": "What a splendid view stretched from the castle tower to the sea.",
    "synonyms": [
      "Wonderful",
      "Magnificent",
      "Excellent"
    ],
    "antonyms": [
      "Awful",
      "Terrible",
      "Poor"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Sprightly",
    "pronunciation": "SPRYT-lee",
    "definition": "Lively and full of energy.",
    "sentence_usage": "Despite his age, the gardener remained sprightly and quick on his feet.",
    "synonyms": [
      "Lively",
      "Brisk",
      "Energetic"
    ],
    "antonyms": [
      "Sluggish",
      "Tired",
      "Slow"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Staggered",
    "pronunciation": "STAG-erd",
    "definition": "Walked in an unsteady way.",
    "sentence_usage": "The sailor staggered across the deck as the storm lifted the ship.",
    "synonyms": [
      "Stumbled",
      "Lurched",
      "Swayed"
    ],
    "antonyms": [
      "Steadied",
      "Balanced",
      "Strode"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Stealthy",
    "pronunciation": "STEL-thee",
    "definition": "Quiet and careful so nobody notices.",
    "sentence_usage": "A stealthy fox slipped through the moonlit garden without a sound.",
    "synonyms": [
      "Sneaky",
      "Silent",
      "Secretive"
    ],
    "antonyms": [
      "Noisy",
      "Clumsy",
      "Obvious"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Stifling",
    "pronunciation": "STY-fling",
    "definition": "Uncomfortably hot or airless.",
    "sentence_usage": "The stifling attic trapped the heat of the afternoon like an oven.",
    "synonyms": [
      "Suffocating",
      "Airless",
      "Boiling"
    ],
    "antonyms": [
      "Fresh",
      "Cool",
      "Breezy"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Stout",
    "pronunciation": "STOWT",
    "definition": "Strong, thick, and solid.",
    "sentence_usage": "A stout rope held the boat steady against the tug of the tide.",
    "synonyms": [
      "Strong",
      "Solid",
      "Sturdy"
    ],
    "antonyms": [
      "Thin",
      "Weak",
      "Flimsy"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Stubborn",
    "pronunciation": "STUB-urn",
    "definition": "Refusing to change your mind or give in.",
    "sentence_usage": "The stubborn goat planted its hooves and would not cross the bridge.",
    "synonyms": [
      "Headstrong",
      "Determined",
      "Obstinate"
    ],
    "antonyms": [
      "Flexible",
      "Agreeable",
      "Yielding"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Stupendous",
    "pronunciation": "styoo-PEN-dus",
    "definition": "Amazingly large or wonderful.",
    "sentence_usage": "The explorers gasped at the stupendous waterfall thundering into the gorge.",
    "synonyms": [
      "Amazing",
      "Gigantic",
      "Marvelous"
    ],
    "antonyms": [
      "Tiny",
      "Ordinary",
      "Unimpressive"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Subtle",
    "pronunciation": "SUT-ul",
    "definition": "Small or quiet in a clever way that is not obvious.",
    "sentence_usage": "A subtle smile flickered across her face when the riddle was solved.",
    "synonyms": [
      "Faint",
      "Slight",
      "Gentle"
    ],
    "antonyms": [
      "Obvious",
      "Strong",
      "Blatant"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Sulky",
    "pronunciation": "SUL-kee",
    "definition": "Quietly bad-tempered and unhappy.",
    "sentence_usage": "Sulky after losing the game, he sat with folded arms by the window.",
    "synonyms": [
      "Grumpy",
      "Moody",
      "Sullen"
    ],
    "antonyms": [
      "Cheerful",
      "Pleasant",
      "Jolly"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Surged",
    "pronunciation": "SURJD",
    "definition": "Moved suddenly forwards with great force.",
    "sentence_usage": "Water surged through the broken gate and rushed across the yard.",
    "synonyms": [
      "Rushed",
      "Swept",
      "Billowed"
    ],
    "antonyms": [
      "Retreated",
      "Ebbed",
      "Paused"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Suspicious",
    "pronunciation": "suh-SPISH-us",
    "definition": "Feeling that something is not right.",
    "sentence_usage": "She gave the mysterious parcel a suspicious glance before touching it.",
    "synonyms": [
      "Wary",
      "Doubtful",
      "Mistrustful"
    ],
    "antonyms": [
      "Trusting",
      "Certain",
      "Confident"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Swift",
    "pronunciation": "SWIFT",
    "definition": "Very fast.",
    "sentence_usage": "A swift shadow skimmed over the grass as the hawk dived.",
    "synonyms": [
      "Fast",
      "Quick",
      "Rapid"
    ],
    "antonyms": [
      "Slow",
      "Sluggish",
      "Leisurely"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Tangled",
    "pronunciation": "TANG-guld",
    "definition": "Twisted together in a messy knot.",
    "sentence_usage": "Tangled roots crawled across the path like sleeping snakes.",
    "synonyms": [
      "Twisted",
      "Knotted",
      "Snarled"
    ],
    "antonyms": [
      "Smooth",
      "Straight",
      "Untangled"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Teeming",
    "pronunciation": "TEE-ming",
    "definition": "Full of moving life.",
    "sentence_usage": "The rock pool was teeming with darting fish and tiny waving crabs.",
    "synonyms": [
      "Swarming",
      "Brimming",
      "Packed"
    ],
    "antonyms": [
      "Empty",
      "Bare",
      "Deserted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Tempestuous",
    "pronunciation": "tem-PES-choo-us",
    "definition": "Very stormy or full of strong emotion.",
    "sentence_usage": "The sea turned tempestuous, hurling foam over the harbour wall.",
    "synonyms": [
      "Stormy",
      "Turbulent",
      "Wild"
    ],
    "antonyms": [
      "Calm",
      "Gentle",
      "Peaceful"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Tender",
    "pronunciation": "TEN-der",
    "definition": "Gentle, soft, and caring.",
    "sentence_usage": "With tender hands, she bandaged the robin's tiny wing.",
    "synonyms": [
      "Gentle",
      "Soft",
      "Kind"
    ],
    "antonyms": [
      "Harsh",
      "Rough",
      "Cruel"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Tense",
    "pronunciation": "TENS",
    "definition": "Stiff or worried because something might happen.",
    "sentence_usage": "A tense silence gripped the courtroom before the verdict was read.",
    "synonyms": [
      "Nervous",
      "Strained",
      "Uneasy"
    ],
    "antonyms": [
      "Relaxed",
      "Calm",
      "Loose"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Thrifty",
    "pronunciation": "THRIF-tee",
    "definition": "Careful not to waste money or supplies.",
    "sentence_usage": "The thrifty inventor saved every screw and spring for future projects.",
    "synonyms": [
      "Careful",
      "Economical",
      "Saving"
    ],
    "antonyms": [
      "Wasteful",
      "Extravagant",
      "Careless"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Thrilled",
    "pronunciation": "THRILD",
    "definition": "Very excited and pleased.",
    "sentence_usage": "She was thrilled to spot a dolphin leaping beside the ferry.",
    "synonyms": [
      "Excited",
      "Delighted",
      "Elated"
    ],
    "antonyms": [
      "Bored",
      "Disappointed",
      "Miserable"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Thunderous",
    "pronunciation": "THUN-der-us",
    "definition": "Extremely loud like thunder.",
    "sentence_usage": "Thunderous applause shook the hall after the final note rang out.",
    "synonyms": [
      "Deafening",
      "Roaring",
      "Booming"
    ],
    "antonyms": [
      "Quiet",
      "Soft",
      "Muted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Timid",
    "pronunciation": "TIM-id",
    "definition": "Shy and not very brave.",
    "sentence_usage": "The timid rabbit paused at the edge of the clearing before hopping out.",
    "synonyms": [
      "Shy",
      "Nervous",
      "Meek"
    ],
    "antonyms": [
      "Bold",
      "Confident",
      "Brave"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Towering",
    "pronunciation": "TOW-er-ing",
    "definition": "Very tall and impressive.",
    "sentence_usage": "Towering pines hemmed the path and blocked the fading light.",
    "synonyms": [
      "Lofty",
      "Soaring",
      "High"
    ],
    "antonyms": [
      "Tiny",
      "Low",
      "Short"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Tranquil",
    "pronunciation": "TRANG-kwil",
    "definition": "Peaceful and calm.",
    "sentence_usage": "A tranquil hush settled over the snow-covered village.",
    "synonyms": [
      "Peaceful",
      "Still",
      "Serene"
    ],
    "antonyms": [
      "Noisy",
      "Chaotic",
      "Agitated"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Tremulous",
    "pronunciation": "TREM-yuh-lus",
    "definition": "Shaking slightly because of fear or emotion.",
    "sentence_usage": "In a tremulous voice, he read the final line of the letter.",
    "synonyms": [
      "Shaky",
      "Quivering",
      "Unsteady"
    ],
    "antonyms": [
      "Steady",
      "Firm",
      "Confident"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Triumphant",
    "pronunciation": "try-UM-funt",
    "definition": "Feeling proud and happy after success.",
    "sentence_usage": "Triumphant cheers erupted when the puzzle box finally clicked open.",
    "synonyms": [
      "Victorious",
      "Proud",
      "Successful"
    ],
    "antonyms": [
      "Defeated",
      "Beaten",
      "Downcast"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Turbulent",
    "pronunciation": "TUR-byuh-lunt",
    "definition": "Very rough, disturbed, or troubled.",
    "sentence_usage": "The plane shook in the turbulent clouds above the mountains.",
    "synonyms": [
      "Rough",
      "Stormy",
      "Unsettled"
    ],
    "antonyms": [
      "Smooth",
      "Calm",
      "Still"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Twilight",
    "pronunciation": "TWY-light",
    "definition": "The soft light just before night.",
    "sentence_usage": "In the purple twilight, the castle looked both beautiful and eerie.",
    "synonyms": [
      "Dusk",
      "Gloaming",
      "Evening"
    ],
    "antonyms": [
      "Daybreak",
      "Noon",
      "Sunrise"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Uncanny",
    "pronunciation": "un-KAN-ee",
    "definition": "Strangely unusual in a surprising way.",
    "sentence_usage": "There was an uncanny likeness between the portrait and the new visitor.",
    "synonyms": [
      "Strange",
      "Weird",
      "Remarkable"
    ],
    "antonyms": [
      "Normal",
      "Ordinary",
      "Natural"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Uneasy",
    "pronunciation": "un-EE-zee",
    "definition": "Slightly worried or uncomfortable.",
    "sentence_usage": "An uneasy feeling prickled the back of her neck as the music stopped.",
    "synonyms": [
      "Worried",
      "Nervous",
      "Troubled"
    ],
    "antonyms": [
      "Relaxed",
      "Comfortable",
      "Assured"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Unruly",
    "pronunciation": "un-ROO-lee",
    "definition": "Hard to control.",
    "sentence_usage": "Unruly curls bounced around his face no matter how much water he used.",
    "synonyms": [
      "Wild",
      "Disorderly",
      "Untamed"
    ],
    "antonyms": [
      "Tidy",
      "Controlled",
      "Orderly"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Vague",
    "pronunciation": "VAYG",
    "definition": "Not clear or exact.",
    "sentence_usage": "He gave a vague answer that solved nothing at all.",
    "synonyms": [
      "Unclear",
      "Fuzzy",
      "Uncertain"
    ],
    "antonyms": [
      "Clear",
      "Exact",
      "Specific"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Valiant",
    "pronunciation": "VAL-yunt",
    "definition": "Very brave and determined.",
    "sentence_usage": "The valiant knight rode towards the dragon despite the flames.",
    "synonyms": [
      "Brave",
      "Heroic",
      "Courageous"
    ],
    "antonyms": [
      "Cowardly",
      "Timid",
      "Fearful"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Vast",
    "pronunciation": "VAST",
    "definition": "Extremely large and wide.",
    "sentence_usage": "A vast plain stretched to the horizon beneath the silver moon.",
    "synonyms": [
      "Huge",
      "Immense",
      "Expansive"
    ],
    "antonyms": [
      "Tiny",
      "Narrow",
      "Small"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Vibrant",
    "pronunciation": "VY-brunt",
    "definition": "Full of bright colour or energy.",
    "sentence_usage": "Vibrant banners fluttered above the street festival in the spring wind.",
    "synonyms": [
      "Bright",
      "Lively",
      "Colourful"
    ],
    "antonyms": [
      "Dull",
      "Muted",
      "Drab"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Vicious",
    "pronunciation": "VISH-us",
    "definition": "Very cruel or violent.",
    "sentence_usage": "The vicious dog bared its teeth and snarled at the gate.",
    "synonyms": [
      "Cruel",
      "Savage",
      "Brutal"
    ],
    "antonyms": [
      "Kind",
      "Gentle",
      "Mild"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Vigilant",
    "pronunciation": "VIJ-ih-lunt",
    "definition": "Watchful and alert for danger.",
    "sentence_usage": "Vigilant guards paced the walls as darkness closed around the fort.",
    "synonyms": [
      "Alert",
      "Watchful",
      "Observant"
    ],
    "antonyms": [
      "Careless",
      "Sleepy",
      "Unaware"
    ],
    "usefulness_rating": 5
  },
  {
    "word": "Vigorous",
    "pronunciation": "VIG-er-us",
    "definition": "Strong, healthy, and full of force.",
    "sentence_usage": "With vigorous strokes, she rowed the boat away from the rocks.",
    "synonyms": [
      "Energetic",
      "Strong",
      "Forceful"
    ],
    "antonyms": [
      "Weak",
      "Feeble",
      "Lethargic"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Vivid",
    "pronunciation": "VIV-id",
    "definition": "Very bright, strong, or clear in the mind.",
    "sentence_usage": "He could still remember the vivid blue of the kingfisher's wings.",
    "synonyms": [
      "Bright",
      "Clear",
      "Striking"
    ],
    "antonyms": [
      "Dull",
      "Faded",
      "Blurred"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Wandered",
    "pronunciation": "WON-derd",
    "definition": "Moved around without a clear plan.",
    "sentence_usage": "They wandered through the old lanes until they found the hidden square.",
    "synonyms": [
      "Roamed",
      "Strolled",
      "Drifted"
    ],
    "antonyms": [
      "Stayed",
      "Settled",
      "Remained"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Warily",
    "pronunciation": "WAIR-uh-lee",
    "definition": "In a careful and suspicious way.",
    "sentence_usage": "The fox warily approached the picnic basket, ready to flee at any sound.",
    "synonyms": [
      "Cautiously",
      "Carefully",
      "Suspiciously"
    ],
    "antonyms": [
      "Boldly",
      "Trustingly",
      "Carelessly"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Weary",
    "pronunciation": "WEER-ee",
    "definition": "Very tired.",
    "sentence_usage": "Weary travellers sank onto the benches as the train steamed in.",
    "synonyms": [
      "Tired",
      "Exhausted",
      "Drained"
    ],
    "antonyms": [
      "Fresh",
      "Energetic",
      "Rested"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Whimsical",
    "pronunciation": "WIM-zih-kul",
    "definition": "Playfully unusual and imaginative.",
    "sentence_usage": "A whimsical clockwork bird sang from the shelf every hour.",
    "synonyms": [
      "Playful",
      "Fanciful",
      "Quirky"
    ],
    "antonyms": [
      "Serious",
      "Ordinary",
      "Practical"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Whirling",
    "pronunciation": "WHER-ling",
    "definition": "Spinning around quickly.",
    "sentence_usage": "Whirling snowflakes danced in the lamplight like tiny white moths.",
    "synonyms": [
      "Spinning",
      "Twisting",
      "Circling"
    ],
    "antonyms": [
      "Still",
      "Motionless",
      "Stationary"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Wistful",
    "pronunciation": "WIST-ful",
    "definition": "Quietly sad because you want something you cannot have.",
    "sentence_usage": "She cast a wistful glance at the sea as the ship disappeared into fog.",
    "synonyms": [
      "Longing",
      "Yearning",
      "Nostalgic"
    ],
    "antonyms": [
      "Content",
      "Satisfied",
      "Cheerful"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Withered",
    "pronunciation": "WITH-erd",
    "definition": "Dried up, shrivelled, or weakened.",
    "sentence_usage": "Withered petals carpeted the greenhouse floor after the heatwave.",
    "synonyms": [
      "Shrivelled",
      "Dried",
      "Faded"
    ],
    "antonyms": [
      "Fresh",
      "Blooming",
      "Healthy"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Wretched",
    "pronunciation": "RECH-id",
    "definition": "Very unhappy, poor, or unpleasant.",
    "sentence_usage": "Lost in the rain without a coat, he felt thoroughly wretched.",
    "synonyms": [
      "Miserable",
      "Awful",
      "Pitiful"
    ],
    "antonyms": [
      "Happy",
      "Comfortable",
      "Delighted"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Yearned",
    "pronunciation": "YERND",
    "definition": "Wanted something very much.",
    "sentence_usage": "She yearned to see the northern lights with her own eyes.",
    "synonyms": [
      "Longed",
      "Desired",
      "Craved"
    ],
    "antonyms": [
      "Disliked",
      "Rejected",
      "Ignored"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Zealous",
    "pronunciation": "ZEL-us",
    "definition": "Full of eager energy for something.",
    "sentence_usage": "A zealous volunteer stayed behind to stack every chair after the concert.",
    "synonyms": [
      "Enthusiastic",
      "Passionate",
      "Eager"
    ],
    "antonyms": [
      "Apathetic",
      "Lazy",
      "Indifferent"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Aloft",
    "pronunciation": "uh-LOFT",
    "definition": "Up in the air or held high.",
    "sentence_usage": "The kite soared aloft above the hill, tugging hard at the string.",
    "synonyms": [
      "Above",
      "Airborne",
      "High"
    ],
    "antonyms": [
      "Grounded",
      "Low",
      "Down"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Bellowed",
    "pronunciation": "BEL-ohd",
    "definition": "Shouted in a very loud voice.",
    "sentence_usage": "The giant bellowed across the valley, making pebbles dance on the path.",
    "synonyms": [
      "Roared",
      "Shouted",
      "Thundered"
    ],
    "antonyms": [
      "Whispered",
      "Murmured",
      "Hushed"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Crimson",
    "pronunciation": "KRIM-zun",
    "definition": "A deep, rich red colour.",
    "sentence_usage": "Crimson leaves spun through the courtyard like sparks from a fire.",
    "synonyms": [
      "Scarlet",
      "Ruby",
      "Red"
    ],
    "antonyms": [
      "Pale",
      "White",
      "Colourless"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Drifted",
    "pronunciation": "DRIF-tid",
    "definition": "Moved slowly and lightly.",
    "sentence_usage": "Feathers drifted through the open window and settled on the desk.",
    "synonyms": [
      "Floated",
      "Glided",
      "Wandered"
    ],
    "antonyms": [
      "Rushed",
      "Plunged",
      "Raced"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Flickered",
    "pronunciation": "FLIK-erd",
    "definition": "Shone or moved unsteadily.",
    "sentence_usage": "Candlelight flickered across the tunnel walls and made the shadows dance.",
    "synonyms": [
      "Fluttered",
      "Wavered",
      "Blinkered"
    ],
    "antonyms": [
      "Glowed steadily",
      "Stayed still",
      "Shone firmly"
    ],
    "usefulness_rating": 3
  },
  {
    "word": "Hollow",
    "pronunciation": "HOL-oh",
    "definition": "Empty inside or echoing.",
    "sentence_usage": "A hollow knock came from the trapdoor beneath the carpet.",
    "synonyms": [
      "Empty",
      "Echoing",
      "Vacant"
    ],
    "antonyms": [
      "Solid",
      "Full",
      "Filled"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Murky",
    "pronunciation": "MUR-kee",
    "definition": "Dark and hard to see through.",
    "sentence_usage": "Murky water swirled around the old pier and hid what lay below.",
    "synonyms": [
      "Dark",
      "Cloudy",
      "Gloomy"
    ],
    "antonyms": [
      "Clear",
      "Bright",
      "Transparent"
    ],
    "usefulness_rating": 4
  },
  {
    "word": "Smouldering",
    "pronunciation": "SMOHL-der-ing",
    "definition": "Burning slowly with smoke but little flame.",
    "sentence_usage": "Smouldering logs glowed red in the hearth long after everyone had gone to bed.",
    "synonyms": [
      "Smoking",
      "Glowing",
      "Burning"
    ],
    "antonyms": [
      "Extinguished",
      "Cold",
      "Drenched"
    ],
    "usefulness_rating": 4
  }
];

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    loadViewCounts();
    allWords = WORDS;
    updateWordCountDisplay(allWords.length);
    renderCards(allWords);
    attachEventListeners();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderCards(words) {
    wordGrid.innerHTML = '';

    if (words.length === 0) {
      wordGrid.appendChild(buildEmptyState());
      return;
    }

    const fragment = document.createDocumentFragment();
    words.forEach(function (word, index) {
      fragment.appendChild(buildCard(word, index));
    });
    wordGrid.appendChild(fragment);
  }

  function buildCard(word, index) {
    const clone = cardTemplate.content.cloneNode(true);
    const article = clone.querySelector('.word-card');

    article.dataset.wordIndex = index;
    article.dataset.wordName = word.word;
    article.setAttribute('aria-label', 'View details for ' + word.word);

    clone.querySelector('.card-word').textContent = word.word;
    clone.querySelector('.card-definition').textContent = word.definition;
    clone.querySelector('.card-stars').appendChild(buildStars(word.usefulness_rating));

    var count = viewCounts[word.word] || 0;
    if (count > 0) {
      var countEl = document.createElement('p');
      countEl.className = 'card-view-count';
      countEl.textContent = 'Viewed ' + count + (count === 1 ? ' time' : ' times');
      article.appendChild(countEl);
    }

    return clone;
  }

  function buildStars(rating, total) {
    total = total || 5;
    const frag = document.createDocumentFragment();
    for (let i = 1; i <= total; i++) {
      const span = document.createElement('span');
      span.className = 'star ' + (i <= rating ? 'star--filled' : 'star--empty');
      span.setAttribute('aria-hidden', 'true');
      span.textContent = '★';
      frag.appendChild(span);
    }
    return frag;
  }

  function buildEmptyState() {
    const div = document.createElement('div');
    div.className = 'empty-state';
    div.innerHTML =
      '<span class="empty-state-emoji">🔍</span>' +
      '<h3>No words found</h3>' +
      '<p>Try a different search or change the star filter.</p>';
    return div;
  }

  function updateWordCountDisplay(count) {
    if (wordCountEl) wordCountEl.textContent = count + ' words';
    if (totalWordsEl) totalWordsEl.textContent = count;
  }

  // ── Filtering ──────────────────────────────────────────────────────────────
  function applyFilters() {
    let results = allWords;

    if (state.query) {
      const q = state.query;
      results = results.filter(function (w) {
        return w.word.toLowerCase().includes(q);
      });
    }

    if (state.ratingFilter !== null) {
      const r = state.ratingFilter;
      results = results.filter(function (w) {
        return w.usefulness_rating === r;
      });
    }

    renderCards(results);
  }

  // ── Modal ──────────────────────────────────────────────────────────────────
  function openModal(wordObj) {
    incrementViewCount(wordObj.word);

    // Update the count badge on the card without re-rendering
    var card = wordGrid.querySelector('[data-word-name="' + wordObj.word + '"]');
    if (card) {
      var count = viewCounts[wordObj.word];
      var text = 'Viewed ' + count + (count === 1 ? ' time' : ' times');
      var existing = card.querySelector('.card-view-count');
      if (existing) {
        existing.textContent = text;
      } else {
        var countEl = document.createElement('p');
        countEl.className = 'card-view-count';
        countEl.textContent = text;
        card.appendChild(countEl);
      }
    }

    modalTitle.textContent = wordObj.word;
    modalPronunciation.textContent = wordObj.pronunciation || '';

    var encoded = encodeURIComponent(wordObj.word);
    linkDefine.href    = 'https://www.google.com/search?q=define+' + encoded;
    linkExamples.href  = 'https://www.google.com/search?q=' + encoded + '+example+sentences';

    modalStars.innerHTML = '';
    modalStars.appendChild(buildStars(wordObj.usefulness_rating));
    modalStars.setAttribute('aria-label', wordObj.usefulness_rating + ' out of 5 stars');

    modalDef.textContent = wordObj.definition;
    modalSentence.textContent = wordObj.sentence_usage;

    modalSynonyms.innerHTML = '';
    wordObj.synonyms.forEach(function (s) {
      const li = document.createElement('li');
      li.textContent = s;
      modalSynonyms.appendChild(li);
    });

    modalAntonyms.innerHTML = '';
    wordObj.antonyms.forEach(function (a) {
      const li = document.createElement('li');
      li.textContent = a;
      modalAntonyms.appendChild(li);
    });

    if (modalViewCount) {
      var count = viewCounts[wordObj.word];
      modalViewCount.textContent = 'Viewed ' + count + (count === 1 ? ' time' : ' times');
    }

    modalOverlay.classList.remove('hidden');
    modalOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    modalClose.focus();
  }

  function closeModal() {
    modalOverlay.classList.add('hidden');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocusedCard) {
      lastFocusedCard.focus();
      lastFocusedCard = null;
    }
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  function attachEventListeners() {
    // Search
    searchInput.addEventListener('input', function () {
      state.query = this.value.toLowerCase().trim();
      applyFilters();
    });

    // Rating filter buttons
    filterBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        const rating = this.dataset.rating;

        filterBtns.forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });

        if (rating === 'all') {
          state.ratingFilter = null;
        } else {
          const parsed = parseInt(rating, 10);
          // Toggle: clicking the already-active filter clears it
          if (state.ratingFilter === parsed) {
            state.ratingFilter = null;
            // Re-activate "All" button
            document.querySelector('.filter-btn[data-rating="all"]').classList.add('active');
            document.querySelector('.filter-btn[data-rating="all"]').setAttribute('aria-pressed', 'true');
            applyFilters();
            return;
          }
          state.ratingFilter = parsed;
        }

        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        applyFilters();
      });
    });

    // Card clicks — event delegation on the grid
    wordGrid.addEventListener('click', function (e) {
      const card = e.target.closest('.word-card');
      if (!card) return;
      const index = parseInt(card.dataset.wordIndex, 10);
      if (isNaN(index)) return;

      // Find the word from the currently displayed filtered set by matching
      // the word text, since indices in the filtered list may differ
      const wordName = card.querySelector('.card-word').textContent;
      const wordObj = allWords.find(function (w) { return w.word === wordName; });
      if (!wordObj) return;

      lastFocusedCard = card;
      openModal(wordObj);
    });

    // Card keyboard activation (Enter / Space)
    wordGrid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const card = e.target.closest('.word-card');
      if (!card) return;
      e.preventDefault();
      card.click();
    });

    // Close modal
    modalClose.addEventListener('click', closeModal);

    modalOverlay.addEventListener('click', function (e) {
      if (e.target === modalOverlay) closeModal();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !modalOverlay.classList.contains('hidden')) {
        closeModal();
      }
    });
  }

  // ── Boot ───────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', init);
})();
