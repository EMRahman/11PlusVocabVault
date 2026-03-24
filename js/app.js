(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var allWords = [];
  var lastFocusedCard = null;

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

  var state = {
    query: '',
    ratingFilter: null, // null = all, 1-5 = exact match
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  var wordGrid      = document.getElementById('word-grid');
  var searchInput   = document.getElementById('search-input');
  var filterBtns    = document.querySelectorAll('.filter-btn');
  var modalOverlay  = document.getElementById('modal-overlay');
  var modalCard     = document.getElementById('modal-card');
  var modalClose    = document.getElementById('modal-close');
  var modalTitle         = document.getElementById('modal-word-title');
  var modalWordType      = document.getElementById('modal-word-type');
  var modalPronunciation = document.getElementById('modal-pronunciation');
  var modalStars         = document.getElementById('modal-stars');
  var modalDef      = document.getElementById('modal-definition');
  var modalSentence = document.getElementById('modal-sentence');
  var modalSynonyms = document.getElementById('modal-synonyms');
  var modalAntonyms   = document.getElementById('modal-antonyms');
  var linkDefine      = document.getElementById('link-define');
  var linkExamples    = document.getElementById('link-examples');
  var modalViewCount  = document.getElementById('modal-view-count');
  var wordCountEl     = document.getElementById('word-count');
  var totalWordsEl  = document.getElementById('total-words');

  function forEachNode(list, callback) {
    Array.prototype.forEach.call(list, callback);
  }

  function closestByClass(element, className) {
    while (element && element !== document) {
      if (element.classList && element.classList.contains(className)) {
        return element;
      }
      element = element.parentNode;
    }
    return null;
  }

  function findWordByName(name) {
    for (var i = 0; i < allWords.length; i++) {
      if (allWords[i].word === name) {
        return allWords[i];
      }
    }
    return null;
  }

  // ── Embedded word data ────────────────────────────────────────────────────
  // Data is embedded directly so the app works when opened as a local file
  // (no server required). To add more words, extend this array.
  var WORDS =   [
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
      "usefulness_rating": 5,
      "word_type": "Noun"
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
      "usefulness_rating": 4,
      "word_type": "Noun"
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
      "usefulness_rating": 5,
      "word_type": "Noun"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Noun"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Verb"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Noun"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Verb"
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
      "usefulness_rating": 4,
      "word_type": "Noun"
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
      "usefulness_rating": 5,
      "word_type": "Noun"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Verb"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Noun"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Verb"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Noun"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Verb"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adverb"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Noun"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adverb"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adverb"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 5,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adverb"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Noun"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 3,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
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
      "usefulness_rating": 4,
      "word_type": "Adjective"
    },
    {
      "word": "Volatile",
      "pronunciation": "VOL-uh-tyle",
      "definition": "Likely to change suddenly and become dangerous or violent very quickly.",
      "sentence_usage": "The border region remained volatile after the ceasefire, with every rumour threatening to spark fresh clashes.",
      "synonyms": [
        "Unstable",
        "Explosive",
        "Unpredictable"
      ],
      "antonyms": [
        "Stable",
        "Steady",
        "Peaceful"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Belligerent",
      "pronunciation": "buh-LIJ-er-uhnt",
      "definition": "Aggressive and ready to argue or fight.",
      "sentence_usage": "The belligerent leader delivered a fiery speech that made the crowded chamber fall into an uneasy silence.",
      "synonyms": [
        "Hostile",
        "Aggressive",
        "Combative"
      ],
      "antonyms": [
        "Peaceful",
        "Friendly",
        "Calm"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Contentious",
      "pronunciation": "kun-TEN-shus",
      "definition": "Likely to cause strong disagreement or argument.",
      "sentence_usage": "The contentious debate over the new law split the council and filled the town hall with angry voices.",
      "synonyms": [
        "Disputed",
        "Divisive",
        "Argumentative"
      ],
      "antonyms": [
        "Agreed",
        "Peaceful",
        "Harmonious"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Fractious",
      "pronunciation": "FRAK-shus",
      "definition": "Bad-tempered and difficult to keep under control.",
      "sentence_usage": "As shortages worsened, the normally orderly crowd became fractious and impossible to soothe.",
      "synonyms": [
        "Unruly",
        "Irritable",
        "Troublesome"
      ],
      "antonyms": [
        "Cooperative",
        "Docile",
        "Peaceful"
      ],
      "usefulness_rating": 4,
      "word_type": "Adjective"
    },
    {
      "word": "Inflammatory",
      "pronunciation": "in-FLAM-uh-tor-ee",
      "definition": "Designed to stir up anger or strong feelings.",
      "sentence_usage": "One inflammatory remark was enough to send the already tense meeting into chaos.",
      "synonyms": [
        "Provocative",
        "Inciting",
        "Agitating"
      ],
      "antonyms": [
        "Soothing",
        "Calming",
        "Moderate"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Precarious",
      "pronunciation": "prih-KAIR-ee-us",
      "definition": "Unsteady or unsafe because it could suddenly get worse.",
      "sentence_usage": "Peace remained precarious, with both sides watching each other from behind the shattered barricades.",
      "synonyms": [
        "Unstable",
        "Uncertain",
        "Risky"
      ],
      "antonyms": [
        "Secure",
        "Stable",
        "Safe"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Tumultuous",
      "pronunciation": "too-MUL-choo-us",
      "definition": "Very noisy, disorderly, and full of wild confusion.",
      "sentence_usage": "The tumultuous protest surged through the square, with banners snapping above the roaring crowd.",
      "synonyms": [
        "Chaotic",
        "Turbulent",
        "Disorderly"
      ],
      "antonyms": [
        "Orderly",
        "Calm",
        "Peaceful"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Fragile",
      "pronunciation": "FRAJ-yle",
      "definition": "Easily broken or likely to fail if not handled carefully.",
      "sentence_usage": "The negotiators knew the fragile agreement could collapse with a single careless decision.",
      "synonyms": [
        "Delicate",
        "Weak",
        "Breakable"
      ],
      "antonyms": [
        "Strong",
        "Solid",
        "Secure"
      ],
      "usefulness_rating": 4,
      "word_type": "Adjective"
    },
    {
      "word": "Fraught",
      "pronunciation": "frawt",
      "definition": "Filled with stress, danger, or difficulty.",
      "sentence_usage": "Their fraught journey through the besieged city was slowed by fear, rubble, and warning sirens.",
      "synonyms": [
        "Tense",
        "Troubled",
        "Risky"
      ],
      "antonyms": [
        "Easy",
        "Calm",
        "Safe"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Hostile",
      "pronunciation": "HOS-tyle",
      "definition": "Unfriendly and ready to oppose or attack.",
      "sentence_usage": "The hostile exchange between the rival groups made the square feel dangerous and unstable.",
      "synonyms": [
        "Aggressive",
        "Antagonistic",
        "Unfriendly"
      ],
      "antonyms": [
        "Friendly",
        "Welcoming",
        "Peaceful"
      ],
      "usefulness_rating": 5,
      "word_type": "Adjective"
    },
    {
      "word": "Infuse",
      "pronunciation": "",
      "definition": "A vocabulary word: infuse.",
      "sentence_usage": "We used 'infuse' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Inscription",
      "pronunciation": "",
      "definition": "A vocabulary word: inscription.",
      "sentence_usage": "We used 'inscription' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Inflection",
      "pronunciation": "",
      "definition": "A vocabulary word: inflection.",
      "sentence_usage": "We used 'inflection' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Inedible",
      "pronunciation": "",
      "definition": "A vocabulary word: inedible.",
      "sentence_usage": "We used 'inedible' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Inconsistent",
      "pronunciation": "",
      "definition": "A vocabulary word: inconsistent.",
      "sentence_usage": "We used 'inconsistent' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Indescribable",
      "pronunciation": "",
      "definition": "A vocabulary word: indescribable.",
      "sentence_usage": "We used 'indescribable' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Imprison",
      "pronunciation": "",
      "definition": "A vocabulary word: imprison.",
      "sentence_usage": "We used 'imprison' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Incompatible",
      "pronunciation": "",
      "definition": "A vocabulary word: incompatible.",
      "sentence_usage": "We used 'incompatible' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Impermeable",
      "pronunciation": "",
      "definition": "A vocabulary word: impermeable.",
      "sentence_usage": "We used 'impermeable' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Immortal",
      "pronunciation": "",
      "definition": "A vocabulary word: immortal.",
      "sentence_usage": "We used 'immortal' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Hypothesis",
      "pronunciation": "",
      "definition": "A vocabulary word: hypothesis.",
      "sentence_usage": "We used 'hypothesis' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Illegible",
      "pronunciation": "",
      "definition": "A vocabulary word: illegible.",
      "sentence_usage": "We used 'illegible' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Verge",
      "pronunciation": "",
      "definition": "A vocabulary word: verge.",
      "sentence_usage": "We used 'verge' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Vault",
      "pronunciation": "",
      "definition": "A vocabulary word: vault.",
      "sentence_usage": "We used 'vault' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Variant",
      "pronunciation": "",
      "definition": "A vocabulary word: variant.",
      "sentence_usage": "We used 'variant' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Usage",
      "pronunciation": "",
      "definition": "A vocabulary word: usage.",
      "sentence_usage": "We used 'usage' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Upgrade",
      "pronunciation": "",
      "definition": "A vocabulary word: upgrade.",
      "sentence_usage": "We used 'upgrade' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "University",
      "pronunciation": "",
      "definition": "A vocabulary word: university.",
      "sentence_usage": "We used 'university' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Unidentified",
      "pronunciation": "",
      "definition": "A vocabulary word: unidentified.",
      "sentence_usage": "We used 'unidentified' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Underline",
      "pronunciation": "",
      "definition": "A vocabulary word: underline.",
      "sentence_usage": "We used 'underline' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Tribute",
      "pronunciation": "",
      "definition": "A vocabulary word: tribute.",
      "sentence_usage": "We used 'tribute' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Transparent",
      "pronunciation": "",
      "definition": "A vocabulary word: transparent.",
      "sentence_usage": "We used 'transparent' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Transmission",
      "pronunciation": "",
      "definition": "A vocabulary word: transmission.",
      "sentence_usage": "We used 'transmission' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Tolerant",
      "pronunciation": "",
      "definition": "A vocabulary word: tolerant.",
      "sentence_usage": "We used 'tolerant' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Temperate",
      "pronunciation": "",
      "definition": "A vocabulary word: temperate.",
      "sentence_usage": "We used 'temperate' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Technician",
      "pronunciation": "",
      "definition": "A vocabulary word: technician.",
      "sentence_usage": "We used 'technician' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Supple",
      "pronunciation": "",
      "definition": "A vocabulary word: supple.",
      "sentence_usage": "We used 'supple' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Sufficient",
      "pronunciation": "",
      "definition": "A vocabulary word: sufficient.",
      "sentence_usage": "We used 'sufficient' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Successive",
      "pronunciation": "",
      "definition": "A vocabulary word: successive.",
      "sentence_usage": "We used 'successive' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Substitute",
      "pronunciation": "",
      "definition": "A vocabulary word: substitute.",
      "sentence_usage": "We used 'substitute' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Subjective",
      "pronunciation": "",
      "definition": "A vocabulary word: subjective.",
      "sentence_usage": "We used 'subjective' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Stimulate",
      "pronunciation": "",
      "definition": "A vocabulary word: stimulate.",
      "sentence_usage": "We used 'stimulate' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Specimen",
      "pronunciation": "",
      "definition": "A vocabulary word: specimen.",
      "sentence_usage": "We used 'specimen' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Spatial",
      "pronunciation": "",
      "definition": "A vocabulary word: spatial.",
      "sentence_usage": "We used 'spatial' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Sociable",
      "pronunciation": "",
      "definition": "A vocabulary word: sociable.",
      "sentence_usage": "We used 'sociable' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Smother",
      "pronunciation": "",
      "definition": "A vocabulary word: smother.",
      "sentence_usage": "We used 'smother' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Simultaneous",
      "pronunciation": "",
      "definition": "A vocabulary word: simultaneous.",
      "sentence_usage": "We used 'simultaneous' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Shrivel",
      "pronunciation": "",
      "definition": "A vocabulary word: shrivel.",
      "sentence_usage": "We used 'shrivel' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Sentiment",
      "pronunciation": "",
      "definition": "A vocabulary word: sentiment.",
      "sentence_usage": "We used 'sentiment' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Sediment",
      "pronunciation": "",
      "definition": "A vocabulary word: sediment.",
      "sentence_usage": "We used 'sediment' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Sector",
      "pronunciation": "",
      "definition": "A vocabulary word: sector.",
      "sentence_usage": "We used 'sector' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Secrete",
      "pronunciation": "",
      "definition": "A vocabulary word: secrete.",
      "sentence_usage": "We used 'secrete' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Scrutinise",
      "pronunciation": "",
      "definition": "A vocabulary word: scrutinise.",
      "sentence_usage": "We used 'scrutinise' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Scout",
      "pronunciation": "",
      "definition": "A vocabulary word: scout.",
      "sentence_usage": "We used 'scout' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Saga",
      "pronunciation": "",
      "definition": "A vocabulary word: saga.",
      "sentence_usage": "We used 'saga' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rite",
      "pronunciation": "",
      "definition": "A vocabulary word: rite.",
      "sentence_usage": "We used 'rite' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rigour",
      "pronunciation": "",
      "definition": "A vocabulary word: rigour.",
      "sentence_usage": "We used 'rigour' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Resolution",
      "pronunciation": "",
      "definition": "A vocabulary word: resolution.",
      "sentence_usage": "We used 'resolution' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rephrase",
      "pronunciation": "",
      "definition": "A vocabulary word: rephrase.",
      "sentence_usage": "We used 'rephrase' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rehabilitate",
      "pronunciation": "",
      "definition": "A vocabulary word: rehabilitate.",
      "sentence_usage": "We used 'rehabilitate' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Regime",
      "pronunciation": "",
      "definition": "A vocabulary word: regime.",
      "sentence_usage": "We used 'regime' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rectify",
      "pronunciation": "",
      "definition": "A vocabulary word: rectify.",
      "sentence_usage": "We used 'rectify' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rebuke",
      "pronunciation": "",
      "definition": "A vocabulary word: rebuke.",
      "sentence_usage": "We used 'rebuke' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Realm",
      "pronunciation": "",
      "definition": "A vocabulary word: realm.",
      "sentence_usage": "We used 'realm' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Reactive",
      "pronunciation": "",
      "definition": "A vocabulary word: reactive.",
      "sentence_usage": "We used 'reactive' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Reactivate",
      "pronunciation": "",
      "definition": "A vocabulary word: reactivate.",
      "sentence_usage": "We used 'reactivate' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Rational",
      "pronunciation": "",
      "definition": "A vocabulary word: rational.",
      "sentence_usage": "We used 'rational' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Radioactive",
      "pronunciation": "",
      "definition": "A vocabulary word: radioactive.",
      "sentence_usage": "We used 'radioactive' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Questionnaire",
      "pronunciation": "",
      "definition": "A vocabulary word: questionnaire.",
      "sentence_usage": "We used 'questionnaire' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Putrid",
      "pronunciation": "",
      "definition": "A vocabulary word: putrid.",
      "sentence_usage": "We used 'putrid' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Publication",
      "pronunciation": "",
      "definition": "A vocabulary word: publication.",
      "sentence_usage": "We used 'publication' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Proximity",
      "pronunciation": "",
      "definition": "A vocabulary word: proximity.",
      "sentence_usage": "We used 'proximity' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Provision",
      "pronunciation": "",
      "definition": "A vocabulary word: provision.",
      "sentence_usage": "We used 'provision' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Prominent",
      "pronunciation": "",
      "definition": "A vocabulary word: prominent.",
      "sentence_usage": "We used 'prominent' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Progressive",
      "pronunciation": "",
      "definition": "A vocabulary word: progressive.",
      "sentence_usage": "We used 'progressive' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Preservation",
      "pronunciation": "",
      "definition": "A vocabulary word: preservation.",
      "sentence_usage": "We used 'preservation' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Pneumatic",
      "pronunciation": "",
      "definition": "A vocabulary word: pneumatic.",
      "sentence_usage": "We used 'pneumatic' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Plateau",
      "pronunciation": "",
      "definition": "A vocabulary word: plateau.",
      "sentence_usage": "We used 'plateau' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Plagiarise",
      "pronunciation": "",
      "definition": "A vocabulary word: plagiarise.",
      "sentence_usage": "We used 'plagiarise' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Perception",
      "pronunciation": "",
      "definition": "A vocabulary word: perception.",
      "sentence_usage": "We used 'perception' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Pattern",
      "pronunciation": "",
      "definition": "A vocabulary word: pattern.",
      "sentence_usage": "We used 'pattern' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Passive",
      "pronunciation": "",
      "definition": "A vocabulary word: passive.",
      "sentence_usage": "We used 'passive' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Paraphrase",
      "pronunciation": "",
      "definition": "A vocabulary word: paraphrase.",
      "sentence_usage": "We used 'paraphrase' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Panorama",
      "pronunciation": "",
      "definition": "A vocabulary word: panorama.",
      "sentence_usage": "We used 'panorama' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Palm",
      "pronunciation": "",
      "definition": "A vocabulary word: palm.",
      "sentence_usage": "We used 'palm' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Opportune",
      "pronunciation": "",
      "definition": "A vocabulary word: opportune.",
      "sentence_usage": "We used 'opportune' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Obsession",
      "pronunciation": "",
      "definition": "A vocabulary word: obsession.",
      "sentence_usage": "We used 'obsession' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Nutrition",
      "pronunciation": "",
      "definition": "A vocabulary word: nutrition.",
      "sentence_usage": "We used 'nutrition' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Nervous",
      "pronunciation": "",
      "definition": "A vocabulary word: nervous.",
      "sentence_usage": "We used 'nervous' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Neglect",
      "pronunciation": "",
      "definition": "A vocabulary word: neglect.",
      "sentence_usage": "We used 'neglect' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Misinterpret",
      "pronunciation": "",
      "definition": "A vocabulary word: misinterpret.",
      "sentence_usage": "We used 'misinterpret' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Microchip",
      "pronunciation": "",
      "definition": "A vocabulary word: microchip.",
      "sentence_usage": "We used 'microchip' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Memorial",
      "pronunciation": "",
      "definition": "A vocabulary word: memorial.",
      "sentence_usage": "We used 'memorial' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Matrix",
      "pronunciation": "",
      "definition": "A vocabulary word: matrix.",
      "sentence_usage": "We used 'matrix' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Mantra",
      "pronunciation": "",
      "definition": "A vocabulary word: mantra.",
      "sentence_usage": "We used 'mantra' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Mandate",
      "pronunciation": "",
      "definition": "A vocabulary word: mandate.",
      "sentence_usage": "We used 'mandate' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Livelihood",
      "pronunciation": "",
      "definition": "A vocabulary word: livelihood.",
      "sentence_usage": "We used 'livelihood' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Legacy",
      "pronunciation": "",
      "definition": "A vocabulary word: legacy.",
      "sentence_usage": "We used 'legacy' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Lawful",
      "pronunciation": "",
      "definition": "A vocabulary word: lawful.",
      "sentence_usage": "We used 'lawful' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Lapse",
      "pronunciation": "",
      "definition": "A vocabulary word: lapse.",
      "sentence_usage": "We used 'lapse' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Kiln",
      "pronunciation": "",
      "definition": "A vocabulary word: kiln.",
      "sentence_usage": "We used 'kiln' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Invoice",
      "pronunciation": "",
      "definition": "A vocabulary word: invoice.",
      "sentence_usage": "We used 'invoice' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Interfere",
      "pronunciation": "",
      "definition": "A vocabulary word: interfere.",
      "sentence_usage": "We used 'interfere' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Install",
      "pronunciation": "",
      "definition": "A vocabulary word: install.",
      "sentence_usage": "We used 'install' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    },
    {
      "word": "Insight",
      "pronunciation": "",
      "definition": "A vocabulary word: insight.",
      "sentence_usage": "We used 'insight' in our vocabulary lesson.",
      "synonyms": [],
      "antonyms": [],
      "usefulness_rating": 4,
      "word_type": "Word"
    }
  ];

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    loadViewCounts();
    allWords = WORDS;
    updateWordCountDisplay(allWords.length);
    renderCards(allWords);
    attachEventListeners();
    initQuiz();
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderCards(words) {
    wordGrid.innerHTML = '';

    if (words.length === 0) {
      wordGrid.appendChild(buildEmptyState());
      return;
    }

    var fragment = document.createDocumentFragment();
    words.forEach(function (word, index) {
      fragment.appendChild(buildCard(word, index));
    });
    wordGrid.appendChild(fragment);
  }

  function buildCard(word, index) {
    var article = document.createElement('article');
    var header = document.createElement('div');
    var meta = document.createElement('div');
    var title = document.createElement('h2');
    var typeBadge = document.createElement('span');
    var stars = document.createElement('div');
    var definition = document.createElement('p');
    var wordType = getWordType(word);

    article.className = 'word-card';
    article.tabIndex = 0;
    article.setAttribute('role', 'button');
    article.dataset.wordIndex = index;
    article.dataset.wordName = word.word;
    article.setAttribute('aria-label', 'View details for ' + word.word + ', ' + wordType);

    header.className = 'card-header';
    meta.className = 'card-meta';
    title.className = 'card-word';
    title.textContent = word.word;
    typeBadge.className = 'card-type';
    typeBadge.textContent = wordType;
    stars.className = 'card-stars';
    stars.appendChild(buildStars(word.usefulness_rating));
    definition.className = 'card-definition';
    definition.textContent = word.definition;

    meta.appendChild(title);
    meta.appendChild(typeBadge);
    header.appendChild(meta);
    header.appendChild(stars);
    article.appendChild(header);
    article.appendChild(definition);

    var count = viewCounts[word.word] || 0;
    if (count > 0) {
      var countEl = document.createElement('p');
      countEl.className = 'card-view-count';
      countEl.textContent = 'Viewed ' + count + (count === 1 ? ' time' : ' times');
      article.appendChild(countEl);
    }

    return article;
  }

  function buildStars(rating, total) {
    total = total || 5;
    var frag = document.createDocumentFragment();
    for (var i = 1; i <= total; i++) {
      var span = document.createElement('span');
      span.className = 'star ' + (i <= rating ? 'star--filled' : 'star--empty');
      span.setAttribute('aria-hidden', 'true');
      span.textContent = '★';
      frag.appendChild(span);
    }
    return frag;
  }

  function getWordType(wordObj) {
    if (wordObj.word_type) {
      return wordObj.word_type;
    }
    return 'Word';
  }

  function buildEmptyState() {
    var div = document.createElement('div');
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
    var results = allWords;

    if (state.query) {
      var q = state.query;
      results = results.filter(function (w) {
        return w.word.toLowerCase().indexOf(q) !== -1;
      });
    }

    if (state.ratingFilter !== null) {
      var r = state.ratingFilter;
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
    if (modalWordType) {
      modalWordType.textContent = getWordType(wordObj);
    }
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
      var li = document.createElement('li');
      li.textContent = s;
      modalSynonyms.appendChild(li);
    });

    modalAntonyms.innerHTML = '';
    wordObj.antonyms.forEach(function (a) {
      var li = document.createElement('li');
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
    forEachNode(filterBtns, function (btn) {
      btn.addEventListener('click', function () {
        var rating = this.dataset.rating;

        forEachNode(filterBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });

        if (rating === 'all') {
          state.ratingFilter = null;
        } else {
          var parsed = parseInt(rating, 10);
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
      var card = closestByClass(e.target, 'word-card');
      if (!card) return;
      var index = parseInt(card.dataset.wordIndex, 10);
      if (isNaN(index)) return;

      // Find the word from the currently displayed filtered set by matching
      // the word text, since indices in the filtered list may differ
      var wordName = card.querySelector('.card-word').textContent;
      var wordObj = findWordByName(wordName);
      if (!wordObj) return;

      lastFocusedCard = card;
      openModal(wordObj);
    });

    // Card keyboard activation (Enter / Space)
    wordGrid.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = closestByClass(e.target, 'word-card');
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

  // ═══════════════════════════════════════════════════════════════════════════
  // QUIZ MODE
  // Completely isolated from browse/filter logic. Reads WORDS array (read-only).
  // ═══════════════════════════════════════════════════════════════════════════

  var QUIZ_BEST_KEY  = 'vocabVault_quizBest';
  var QUIZ_LENGTH    = 10;

  var quizState = {
    questions    : [],
    currentIndex : 0,
    score        : 0,
    streak       : 0,
    scope        : 'all',
    personalBest : 0
  };

  // ── Quiz DOM refs ──────────────────────────────────────────────────────────
  var quizOverlay        = document.getElementById('quiz-overlay');
  var quizSetupEl        = document.getElementById('quiz-setup');
  var quizSetupClose     = document.getElementById('quiz-setup-close');
  var quizStartBtn       = document.getElementById('quiz-start-btn');
  var quizScopeBtns      = document.querySelectorAll('.quiz-scope-btn');
  var quizPersonalBestEl = document.getElementById('quiz-personal-best');
  var quizLaunchBtn      = document.getElementById('quiz-launch-btn');

  var quizQuestionScreen = document.getElementById('quiz-question-screen');
  var quizExitBtn        = document.getElementById('quiz-exit-btn');
  var quizProgressFill   = document.getElementById('quiz-progress-fill');
  var quizProgressWrap   = document.getElementById('quiz-progress-bar-wrap');
  var quizCounter        = document.getElementById('quiz-counter');
  var quizScoreDisplay   = document.getElementById('quiz-score-display');
  var quizStreakEl        = document.getElementById('quiz-streak');
  var quizQuestionLabel  = document.getElementById('quiz-question-label');
  var quizQuestionText   = document.getElementById('quiz-question-text');
  var quizAnswersGrid    = document.getElementById('quiz-answers-grid');
  var quizFeedback       = document.getElementById('quiz-feedback');

  var quizEndScreen      = document.getElementById('quiz-end-screen');
  var quizEndEmoji       = document.getElementById('quiz-end-emoji');
  var quizEndTitle       = document.getElementById('quiz-end-title');
  var quizEndScore       = document.getElementById('quiz-end-score');
  var quizEndBest        = document.getElementById('quiz-end-best');
  var quizPlayAgainBtn   = document.getElementById('quiz-play-again-btn');
  var quizBackBtn        = document.getElementById('quiz-back-btn');
  var quizAdvanceTimeout = null;

  // ── Persistence ────────────────────────────────────────────────────────────
  function loadQuizBest() {
    try {
      var stored = localStorage.getItem(QUIZ_BEST_KEY);
      quizState.personalBest = stored ? parseInt(stored, 10) : 0;
    } catch (e) {
      quizState.personalBest = 0;
    }
  }

  function saveQuizBest(score) {
    if (score > quizState.personalBest) {
      quizState.personalBest = score;
      try { localStorage.setItem(QUIZ_BEST_KEY, score); } catch (e) {}
    }
  }

  // ── Screen management ──────────────────────────────────────────────────────
  function showQuizScreen(screenEl) {
    [quizSetupEl, quizQuestionScreen, quizEndScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openQuizOverlay() {
    clearQuizAdvanceTimeout();
    updatePersonalBestDisplay();
    quizOverlay.classList.remove('hidden');
    quizOverlay.setAttribute('aria-hidden', 'false');
    showQuizScreen(quizSetupEl);
    document.body.style.overflow = 'hidden';
    quizSetupClose.focus();
  }

  function closeQuizOverlay() {
    clearQuizAdvanceTimeout();
    quizOverlay.classList.add('hidden');
    quizOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    quizLaunchBtn.focus();
  }

  function clearQuizAdvanceTimeout() {
    if (quizAdvanceTimeout !== null) {
      clearTimeout(quizAdvanceTimeout);
      quizAdvanceTimeout = null;
    }
  }

  function updatePersonalBestDisplay() {
    if (quizState.personalBest > 0) {
      quizPersonalBestEl.textContent = 'Personal best: ' + quizState.personalBest + ' / ' + QUIZ_LENGTH;
      quizPersonalBestEl.classList.remove('hidden');
    } else {
      quizPersonalBestEl.classList.add('hidden');
    }
  }

  // ── Question generation ────────────────────────────────────────────────────
  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = a[i]; a[i] = a[j]; a[j] = tmp;
    }
    return a;
  }

  function pickDistractors(correctWord, pool, count) {
    var candidates = pool.filter(function (w) { return w.word !== correctWord.word; });
    return shuffle(candidates).slice(0, count);
  }

  function buildQuestion(wordObj, type, pool) {
    var distractors = pickDistractors(wordObj, pool, 3);
    var choices = shuffle([wordObj].concat(distractors));
    return {
      type         : type,
      questionWord : wordObj,
      choices      : choices,
      correctIndex : choices.indexOf(wordObj)
    };
  }

  function buildQuizSession() {
    var pool = quizState.scope === '5star'
      ? WORDS.filter(function (w) { return w.usefulness_rating === 5; })
      : WORDS;
    var count = Math.min(QUIZ_LENGTH, pool.length);
    var picked = shuffle(pool).slice(0, count);
    return picked.map(function (word) {
      var type = Math.random() < 0.5 ? 'definition' : 'word';
      return buildQuestion(word, type, pool);
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function renderQuestion(index) {
    var q = quizState.questions[index];
    var total = quizState.questions.length;

    // Progress
    var pct = (index / total) * 100;
    quizProgressFill.style.width = pct + '%';
    quizProgressWrap.setAttribute('aria-valuenow', index);

    // Meta
    quizCounter.textContent      = 'Q ' + (index + 1) + ' of ' + total;
    quizScoreDisplay.textContent = 'Score: ' + quizState.score;
    quizStreakEl.textContent     = quizState.streak >= 2 ? '🔥 ' + quizState.streak : '';

    // Question
    if (q.type === 'definition') {
      quizQuestionLabel.textContent = 'What word means this?';
      quizQuestionText.textContent  = q.questionWord.definition;
    } else {
      quizQuestionLabel.textContent = 'What does this word mean?';
      quizQuestionText.textContent  = q.questionWord.word;
    }

    // Answer buttons
    quizAnswersGrid.innerHTML = '';
    q.choices.forEach(function (choice, i) {
      var btn = document.createElement('button');
      btn.className    = 'quiz-answer-btn';
      btn.dataset.idx  = i;
      btn.textContent  = q.type === 'definition' ? choice.word : choice.definition;
      quizAnswersGrid.appendChild(btn);
    });

    // Clear feedback
    quizFeedback.className = 'quiz-feedback';
    quizFeedback.textContent = '';
  }

  // ── Answer handling ────────────────────────────────────────────────────────
  var CORRECT_PHRASES = ['✓ Brilliant!', '✓ Spot on!', '✓ Nice work!', '✓ Excellent!'];

  function handleAnswer(chosenIndex) {
    var q = quizState.questions[quizState.currentIndex];
    var buttons = quizAnswersGrid.querySelectorAll('.quiz-answer-btn');
    var isCorrect = chosenIndex === q.correctIndex;

    // Disable all buttons immediately
    forEachNode(buttons, function (b) { b.disabled = true; });

    // Apply colour feedback
    buttons[q.correctIndex].classList.add('correct');
    if (!isCorrect) {
      buttons[chosenIndex].classList.add('wrong');
    }

    // Update score / streak
    if (isCorrect) {
      quizState.score++;
      quizState.streak++;
    } else {
      quizState.streak = 0;
    }

    // Feedback strip
    quizFeedback.className = 'quiz-feedback visible ' +
      (isCorrect ? 'feedback-correct' : 'feedback-wrong');
    if (isCorrect) {
      quizFeedback.textContent = CORRECT_PHRASES[Math.floor(Math.random() * CORRECT_PHRASES.length)];
    } else {
      var correctText = q.type === 'definition' ? q.questionWord.word : q.questionWord.definition;
      quizFeedback.textContent = '✗ The answer was: ' + correctText;
    }

    // Advance after pause
    clearQuizAdvanceTimeout();
    quizAdvanceTimeout = setTimeout(function () {
      quizAdvanceTimeout = null;
      advanceQuiz();
    }, 1400);
  }

  function advanceQuiz() {
    quizState.currentIndex++;
    if (quizState.currentIndex >= quizState.questions.length) {
      showEndScreen();
    } else {
      renderQuestion(quizState.currentIndex);
    }
  }

  // ── End screen ─────────────────────────────────────────────────────────────
  function showEndScreen() {
    quizProgressFill.style.width = '100%';
    var score = quizState.score;
    var total = quizState.questions.length;
    var isNewBest = score > quizState.personalBest;
    saveQuizBest(score);

    var tier;
    if (score === total)       tier = { emoji: '🏆', title: 'Perfect score!' };
    else if (score >= total * 0.7) tier = { emoji: '⭐', title: 'Star performance!' };
    else if (score >= total * 0.4) tier = { emoji: '👍', title: 'Good effort!' };
    else                           tier = { emoji: '💪', title: 'Keep practising!' };

    quizEndEmoji.textContent = tier.emoji;
    quizEndTitle.textContent = tier.title;
    quizEndScore.textContent = score + ' / ' + total + ' correct';
    quizEndBest.textContent  = isNewBest
      ? 'New personal best! 🎉'
      : (quizState.personalBest > 0 ? 'Personal best: ' + quizState.personalBest + ' / ' + total : '');

    showQuizScreen(quizEndScreen);
    quizPlayAgainBtn.focus();
  }

  // ── Start quiz ─────────────────────────────────────────────────────────────
  function startQuiz() {
    clearQuizAdvanceTimeout();
    quizState.currentIndex = 0;
    quizState.score        = 0;
    quizState.streak       = 0;
    quizState.questions    = buildQuizSession();
    showQuizScreen(quizQuestionScreen);
    renderQuestion(0);
    quizExitBtn.focus();
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  function initQuiz() {
    loadQuizBest();

    quizLaunchBtn.addEventListener('click', openQuizOverlay);
    quizSetupClose.addEventListener('click', closeQuizOverlay);
    quizExitBtn.addEventListener('click', closeQuizOverlay);
    quizBackBtn.addEventListener('click', closeQuizOverlay);

    forEachNode(quizScopeBtns, function (btn) {
      btn.addEventListener('click', function () {
        forEachNode(quizScopeBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        quizState.scope = this.dataset.scope;
      });
    });

    quizStartBtn.addEventListener('click', startQuiz);
    quizPlayAgainBtn.addEventListener('click', startQuiz);

    // Answer click delegation
    quizAnswersGrid.addEventListener('click', function (e) {
      var btn = closestByClass(e.target, 'quiz-answer-btn');
      if (!btn || btn.disabled) return;
      handleAnswer(parseInt(btn.dataset.idx, 10));
    });

    // Escape closes quiz overlay (separate guard from word-detail modal)
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !quizOverlay.classList.contains('hidden')) {
        closeQuizOverlay();
      }
    });
  }

})();
