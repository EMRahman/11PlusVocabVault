(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  let allWords = [];
  let lastFocusedCard = null;

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
  const modalAntonyms = document.getElementById('modal-antonyms');
  const wordCountEl   = document.getElementById('word-count');
  const totalWordsEl  = document.getElementById('total-words');
  const cardTemplate  = document.getElementById('word-card-template');

  // ── Embedded word data ────────────────────────────────────────────────────
  // Data is embedded directly so the app works when opened as a local file
  // (no server required). To add more words, extend this array.
  var WORDS = [
    {
      word: 'Trepidation',
      pronunciation: 'trep-ih-DAY-shun',
      definition: 'A shaky, nervous feeling that something scary is about to happen.',
      sentence_usage: 'As he pushed open the creaking door of the abandoned mansion, a wave of cold trepidation washed over him.',
      synonyms: ['Fear', 'Anxiety', 'Apprehension'],
      antonyms: ['Confidence', 'Bravery', 'Calm'],
      usefulness_rating: 5
    },
    {
      word: 'Melancholy',
      pronunciation: 'MEL-an-kol-ee',
      definition: 'A quiet, heavy sadness that lasts a long time.',
      sentence_usage: 'The constant, drumming rain matched the melancholy mood that hung heavily over the deserted town.',
      synonyms: ['Sorrow', 'Sadness', 'Gloom'],
      antonyms: ['Joy', 'Cheerfulness', 'Exuberance'],
      usefulness_rating: 4
    },
    {
      word: 'Cacophony',
      pronunciation: 'ka-KOF-oh-nee',
      definition: 'A horrible, loud mix of messy noises.',
      sentence_usage: 'The peaceful morning was shattered by a sudden cacophony of screeching tires, blaring horns, and shouting voices.',
      synonyms: ['Din', 'Racket', 'Noise'],
      antonyms: ['Silence', 'Harmony', 'Peace'],
      usefulness_rating: 5
    },
    {
      word: 'Ephemeral',
      pronunciation: 'eh-FEM-er-al',
      definition: 'Something beautiful that lasts for only a very short time, like a bubble.',
      sentence_usage: 'The beautiful sunset was an ephemeral masterpiece, fading into darkness almost as quickly as it had appeared.',
      synonyms: ['Fleeting', 'Temporary', 'Brief'],
      antonyms: ['Permanent', 'Eternal', 'Lasting'],
      usefulness_rating: 3
    },
    {
      word: 'Ubiquitous',
      pronunciation: 'yoo-BIK-wih-tus',
      definition: 'Something that seems to be everywhere you look.',
      sentence_usage: 'In the futuristic city, glowing neon signs were ubiquitous, illuminating every dark alley and towering skyscraper.',
      synonyms: ['Everywhere', 'Omnipresent', 'Universal'],
      antonyms: ['Rare', 'Scarce', 'Uncommon'],
      usefulness_rating: 4
    },
    {
      word: 'Luminous',
      pronunciation: 'LOO-mih-nus',
      definition: 'Glowing brightly in the dark.',
      sentence_usage: 'The cave was bathed in a luminous, ethereal glow emanating from the strange crystals on the ceiling.',
      synonyms: ['Radiant', 'Shining', 'Glowing'],
      antonyms: ['Dark', 'Dull', 'Gloomy'],
      usefulness_rating: 5
    },
    {
      word: 'Serpentine',
      pronunciation: 'SER-pen-tyne',
      definition: 'Twisting and turning like a moving snake.',
      sentence_usage: 'The river carved a serpentine path through the dense, unforgiving jungle.',
      synonyms: ['Winding', 'Twisting', 'Snake-like'],
      antonyms: ['Straight', 'Direct'],
      usefulness_rating: 4
    },
    {
      word: 'Petrified',
      pronunciation: 'PET-rih-fyd',
      definition: 'So incredibly scared that you freeze up like a stone statue.',
      sentence_usage: 'Rooted to the spot, the young boy stood entirely petrified as the shadow detached itself from the wall.',
      synonyms: ['Terrified', 'Paralyzed', 'Frozen'],
      antonyms: ['Fearless', 'Relaxed', 'Unbothered'],
      usefulness_rating: 5
    },
    {
      word: 'Dilapidated',
      pronunciation: 'dih-LAP-ih-day-tid',
      definition: 'Old, broken, and falling apart from being ignored for a long time.',
      sentence_usage: 'At the end of the lane sat a dilapidated cottage, its roof caved in and windows shattered by time.',
      synonyms: ['Ruined', 'Decaying', 'Crumbling'],
      antonyms: ['Pristine', 'Immaculate', 'Restored'],
      usefulness_rating: 5
    },
    {
      word: 'Voracious',
      pronunciation: 'voh-RAY-shus',
      definition: 'Super hungry, like you could eat absolutely everything in sight.',
      sentence_usage: 'After wandering in the wilderness for three days, the survivor ate the berries with a voracious appetite.',
      synonyms: ['Ravenous', 'Insatiable', 'Greedy'],
      antonyms: ['Satisfied', 'Full', 'Quenched'],
      usefulness_rating: 4
    }
  ];

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
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
    article.setAttribute('aria-label', 'View details for ' + word.word);

    clone.querySelector('.card-word').textContent = word.word;
    clone.querySelector('.card-definition').textContent = word.definition;
    clone.querySelector('.card-stars').appendChild(buildStars(word.usefulness_rating));

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
    modalTitle.textContent = wordObj.word;
    modalPronunciation.textContent = wordObj.pronunciation || '';

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
