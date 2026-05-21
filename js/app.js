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

  // ── Mastery (persisted in localStorage) ────────────────────────────────────
  // For each word: { correct: n, incorrect: n, lastWrong: timestamp }
  var MASTERY_KEY = 'vocabVault_mastery';
  var mastery = {};

  function loadMastery() {
    try {
      var stored = localStorage.getItem(MASTERY_KEY);
      mastery = stored ? JSON.parse(stored) : {};
    } catch (e) {
      mastery = {};
    }
  }

  function saveMastery() {
    try { localStorage.setItem(MASTERY_KEY, JSON.stringify(mastery)); } catch (e) {}
  }

  function getMasteryStatus(wordName) {
    var m = mastery[wordName];
    if (!m || (m.correct === 0 && m.incorrect === 0)) return 'new';
    if (m.correct >= 3 && (m.correct - m.incorrect) >= 2) return 'mastered';
    return 'learning';
  }

  function recordAnswer(wordName, isCorrect) {
    var m = mastery[wordName] || { correct: 0, incorrect: 0, lastWrong: 0 };
    if (isCorrect) {
      m.correct++;
    } else {
      m.incorrect++;
      m.lastWrong = Date.now();
    }
    mastery[wordName] = m;
    saveMastery();
  }

  // ── Audio pronunciation ────────────────────────────────────────────────────
  function speakWord(word) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(word);
      utter.lang = 'en-GB';
      utter.rate = 0.9;
      utter.pitch = 1;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  var state = {
    query: '',
    ratingFilter: null, // null = all, 3-5 = exact match
    unviewedOnly: false,
    masteryFilter: 'all', // 'all' | 'new' | 'learning' | 'mastered'
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  var wordGrid      = document.getElementById('word-grid');
  var searchInput   = document.getElementById('search-input');
  var filterBtns    = document.querySelectorAll('.filter-btn');
  var viewFilterBtns = document.querySelectorAll('.view-filter-btn');
  var masteryFilterBtns = document.querySelectorAll('.mastery-filter-btn');
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
  var modalSpeakBtn   = document.getElementById('modal-speak-btn');
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


  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    loadViewCounts();
    loadMastery();
    fetch('data/words.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        allWords = data.words;
        updateWordCountDisplay(allWords.length);
        renderCards(allWords);
        attachEventListeners();
        initQuiz();
        var allScopeBtn = document.getElementById('quiz-scope-all-btn');
        if (allScopeBtn) {
          allScopeBtn.textContent = 'All ' + allWords.length + ' words';
        }
      });
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
    var masteryStatus = getMasteryStatus(word.word);

    var footer = document.createElement('div');
    footer.className = 'card-footer';

    if (masteryStatus !== 'new') {
      var badge = document.createElement('span');
      badge.className = 'mastery-badge mastery-' + masteryStatus;
      badge.textContent = masteryStatus === 'mastered' ? '✓ Mastered' : '📘 Learning';
      footer.appendChild(badge);
    }

    if (count > 0) {
      var countEl = document.createElement('span');
      countEl.className = 'card-view-count';
      countEl.textContent = 'Viewed ' + count + (count === 1 ? ' time' : ' times');
      footer.appendChild(countEl);
    }

    if (footer.childNodes.length > 0) {
      article.appendChild(footer);
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
      '<p>Try a different search, change the viewed filter, or choose a 3-, 4-, or 5-star rating.</p>';
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

    if (state.unviewedOnly) {
      results = results.filter(function (w) {
        return (viewCounts[w.word] || 0) === 0;
      });
    }

    if (state.masteryFilter !== 'all') {
      results = results.filter(function (w) {
        return getMasteryStatus(w.word) === state.masteryFilter;
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
      var footer = card.querySelector('.card-footer');
      if (!footer) {
        footer = document.createElement('div');
        footer.className = 'card-footer';
        card.appendChild(footer);
      }
      var existing = footer.querySelector('.card-view-count');
      if (existing) {
        existing.textContent = text;
      } else {
        var countEl = document.createElement('span');
        countEl.className = 'card-view-count';
        countEl.textContent = text;
        footer.appendChild(countEl);
      }
    }

    if (state.unviewedOnly) {
      applyFilters();
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
    if ('speechSynthesis' in window) {
      try { window.speechSynthesis.cancel(); } catch (e) {}
    }
    modalOverlay.classList.add('hidden');
    modalOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (lastFocusedCard && lastFocusedCard.isConnected) {
      lastFocusedCard.focus();
    } else if (searchInput) {
      searchInput.focus();
    }
    lastFocusedCard = null;
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

    // Viewed status filter buttons
    forEachNode(viewFilterBtns, function (btn) {
      btn.addEventListener('click', function () {
        var viewFilter = this.dataset.viewFilter;

        forEachNode(viewFilterBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });

        state.unviewedOnly = viewFilter === 'unviewed';
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        applyFilters();
      });
    });

    // Mastery filter buttons
    forEachNode(masteryFilterBtns, function (btn) {
      btn.addEventListener('click', function () {
        forEachNode(masteryFilterBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        state.masteryFilter = this.dataset.masteryFilter || 'all';
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        applyFilters();
      });
    });

    // Speak button (audio pronunciation in modal)
    if (modalSpeakBtn) {
      modalSpeakBtn.addEventListener('click', function () {
        var word = modalTitle.textContent;
        if (word) speakWord(word);
      });
    }

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
  // Completely isolated from browse/filter logic. Reads allWords array (read-only).
  // ═══════════════════════════════════════════════════════════════════════════

  var QUIZ_BEST_KEY   = 'vocabVault_quizBest';
  var QUIZ_BESTS_KEY  = 'vocabVault_quizBests';
  var QUEST_PROGRESS_KEY = 'vocabVault_questProgress';
  var DEFAULT_QUIZ_LENGTH = 5;

  var quizState = {
    questions    : [],
    currentIndex : 0,
    score        : 0,
    streak       : 0,
    scope        : 'all',
    length       : DEFAULT_QUIZ_LENGTH,
    mode         : 'mixed',
    misses       : [],
    personalBest : 0,
    personalBests: {},
    isQuestMode  : false
  };

  var questState = {
    worlds: [
      { id: 'forest', name: 'Forest of Clues', emoji: '🌲', theme: 'Forest' },
      { id: 'castle', name: 'Castle of Synonyms', emoji: '🏰', theme: 'Castle' },
      { id: 'dragon', name: 'Dragon Mountain', emoji: '🐉', theme: 'Dragon' },
      { id: 'fairies', name: 'Fairy Glen', emoji: '🧚', theme: 'Fairies' },
      { id: 'army-battle', name: 'Army Battle Fields', emoji: '🛡️', theme: 'Army Battle' },
      { id: 'sea-journey', name: 'Sea Journey Isles', emoji: '⛵', theme: 'Sea Journey' },
      { id: 'wizard-school', name: 'Wizard School Towers', emoji: '🧙', theme: 'Wizard School' }
    ],
    progress: { worldIndex: 0, levelsWonInWorld: 0, xp: 0, coins: 0 }
  };

  // ── Quiz DOM refs ──────────────────────────────────────────────────────────
  var quizOverlay        = document.getElementById('quiz-overlay');
  var quizSetupEl        = document.getElementById('quiz-setup');
  var quizSetupClose     = document.getElementById('quiz-setup-close');
  var quizStartBtn       = document.getElementById('quiz-start-btn');
  var quizSetupSubtitle  = document.getElementById('quiz-setup-subtitle');
  var quizScopeBtns      = document.querySelectorAll('.quiz-scope-btn');
  var quizLengthBtns     = document.querySelectorAll('[data-length]');
  var quizModeBtns       = document.querySelectorAll('[data-mode]');
  var quizPersonalBestEl = document.getElementById('quiz-personal-best');
  var quizLaunchBtn      = document.getElementById('quiz-launch-btn');
  var questLaunchBtn     = document.getElementById('quest-launch-btn');
  var questOverlay       = document.getElementById('quest-overlay');
  var questMapScreen     = document.getElementById('quest-map-screen');
  var questCloseBtn      = document.getElementById('quest-close-btn');
  var questWorldList     = document.getElementById('quest-world-list');
  var questWallet        = document.getElementById('quest-wallet');
  var questProgressFill  = document.getElementById('quest-progress-fill');
  var questProgressLabel = document.getElementById('quest-progress-label');
  var questProgressTrack = document.getElementById('quest-progress-track');

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
  var quizReview         = document.getElementById('quiz-review');
  var quizReviewList     = document.getElementById('quiz-review-list');
  var quizPlayAgainBtn   = document.getElementById('quiz-play-again-btn');
  var quizBackBtn        = document.getElementById('quiz-back-btn');
  var quizAdvanceTimeout = null;

  // ── Persistence ────────────────────────────────────────────────────────────
  function getQuizBestKey() {
    return [quizState.scope, quizState.length, quizState.mode].join(':');
  }

  function getQuizBest() {
    return quizState.personalBests[getQuizBestKey()] || 0;
  }

  function loadQuizBest() {
    try {
      var storedMap = localStorage.getItem(QUIZ_BESTS_KEY);
      quizState.personalBests = storedMap ? JSON.parse(storedMap) : {};

      // Carry forward an older single best score for the original default quiz.
      var legacyBest = localStorage.getItem(QUIZ_BEST_KEY);
      if (legacyBest && !quizState.personalBests['all:10:mixed']) {
        quizState.personalBests['all:10:mixed'] = parseInt(legacyBest, 10) || 0;
      }
    } catch (e) {
      quizState.personalBests = {};
    }
    quizState.personalBest = getQuizBest();
  }

  function saveQuizBest(score) {
    var key = getQuizBestKey();
    if (score > getQuizBest()) {
      quizState.personalBests[key] = score;
      quizState.personalBest = score;
      try { localStorage.setItem(QUIZ_BESTS_KEY, JSON.stringify(quizState.personalBests)); } catch (e) {}
    }
  }

  function loadQuestProgress() {
    try {
      var raw = localStorage.getItem(QUEST_PROGRESS_KEY);
      if (!raw) return;
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.worldIndex === 'number') {
        questState.progress = parsed;
      }
    } catch (e) {}
  }

  function saveQuestProgress() {
    try { localStorage.setItem(QUEST_PROGRESS_KEY, JSON.stringify(questState.progress)); } catch (e) {}
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
    updateQuizSetupSummary();
    quizOverlay.classList.remove('hidden');
    quizOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Story Quest always plays mixed question types across all words, so skip
    // the setup screen and drop the player straight into the quiz.
    if (quizState.isQuestMode) {
      startQuiz();
      return;
    }
    showQuizScreen(quizSetupEl);
    quizSetupClose.focus();
  }

  function closeQuizOverlay() {
    clearQuizAdvanceTimeout();
    quizOverlay.classList.add('hidden');
    quizOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    // Re-render the grid so mastery badges reflect any quiz progress.
    applyFilters();
    quizState.isQuestMode = false;
    quizLaunchBtn.focus();
  }

  function openQuestOverlay() {
    renderQuestMap();
    questOverlay.classList.remove('hidden');
    questOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    questCloseBtn.focus();
  }

  function closeQuestOverlay() {
    questOverlay.classList.add('hidden');
    questOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    questLaunchBtn.focus();
  }

  function renderQuestMap() {
    var p = questState.progress;
    var totalLevels = questState.worlds.length * 5;
    var completedLevels = Math.min((p.worldIndex * 5) + p.levelsWonInWorld, totalLevels);
    var completionPct = Math.round((completedLevels / totalLevels) * 100);
    questWallet.textContent = 'XP: ' + p.xp + ' · Coins: ' + p.coins + ' · Current world: ' + (p.worldIndex + 1) + '/' + questState.worlds.length;
    questProgressFill.style.width = completionPct + '%';
    questProgressLabel.textContent = completionPct + '%';
    questProgressTrack.setAttribute('aria-valuenow', completionPct);
    questWorldList.innerHTML = '';

    questState.worlds.forEach(function (world, idx) {
      var card = document.createElement('div');
      card.className = 'quest-world-card';
      var completed = idx < p.worldIndex ? 5 : (idx === p.worldIndex ? p.levelsWonInWorld : 0);
      card.innerHTML =
        '<h3>' + world.emoji + ' ' + world.name + '</h3>' +
        '<p class="quest-world-meta">' + completed + '/5 quest rounds won · Mixed themes &amp; question types</p>';
      var btn = document.createElement('button');
      btn.className = 'quiz-start-btn';
      btn.textContent = idx === p.worldIndex ? 'Start world' : 'Switch to theme';
      btn.addEventListener('click', function () { startQuestWorld(idx); });
      card.appendChild(btn);
      questWorldList.appendChild(card);
    });
  }

  // Resolve the quest theme for a word from its pre-generated themed_quest
  // data, so the world label always matches the themed sentence shown.
  function getQuestTheme(wordObj) {
    var themed = getThemedQuest(wordObj);
    var themeId = themed && themed.theme;
    for (var i = 0; i < questState.worlds.length; i++) {
      if (questState.worlds[i].id === themeId) return questState.worlds[i];
    }
    return questState.worlds[0];
  }

  function clearQuizAdvanceTimeout() {
    if (quizAdvanceTimeout !== null) {
      clearTimeout(quizAdvanceTimeout);
      quizAdvanceTimeout = null;
    }
  }

  function getQuizModeLabel() {
    if (quizState.mode === 'definition') return 'Definition → word';
    if (quizState.mode === 'word') return 'Word → meaning';
    if (quizState.mode === 'sentence') return 'Sentence blank';
    return 'Mixed question types';
  }

  function updateQuizSetupSummary() {
    quizState.personalBest = getQuizBest();
    quizSetupSubtitle.textContent = quizState.length + ' questions · ' + getQuizModeLabel();
    updatePersonalBestDisplay();
  }

  function updatePersonalBestDisplay() {
    if (quizState.personalBest > 0) {
      quizPersonalBestEl.textContent = 'Personal best for these options: ' + quizState.personalBest + ' / ' + quizState.length;
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
    var sameType = correctWord.word_type
      ? candidates.filter(function (w) { return w.word_type === correctWord.word_type; })
      : [];

    var picks = [];
    shuffle(sameType).forEach(function (w) {
      if (picks.length < count) picks.push(w);
    });
    if (picks.length < count) {
      var others = candidates.filter(function (w) { return picks.indexOf(w) === -1; });
      shuffle(others).forEach(function (w) {
        if (picks.length < count) picks.push(w);
      });
    }
    return picks;
  }

  function getSentenceBlank(wordObj) {
    var sentence = wordObj.sentence_usage || '';
    var escapedWord = wordObj.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var wordPattern = new RegExp('\\b' + escapedWord + '\\b', 'i');

    if (!wordPattern.test(sentence)) {
      return null;
    }

    return sentence.replace(wordPattern, '_____');
  }

  // Theme-aware sentences generated per word (see TOKEN_COST_ESTIMATE.md).
  function getThemedQuest(wordObj) {
    return wordObj && wordObj.themed_quest ? wordObj.themed_quest : null;
  }

  // In Story Quest the cloze sentence is pre-themed and pre-blanked in the
  // word data; elsewhere fall back to blanking the static example sentence.
  function getQuestSentenceBlank(wordObj) {
    var themed = getThemedQuest(wordObj);
    if (themed && themed.sentence) return themed.sentence;
    return getSentenceBlank(wordObj);
  }

  function getQuestionTypesForWord(wordObj) {
    // Story Quest plays only themed fill-in-the-blank clozes: the word, one of
    // its synonyms, or one of its antonyms completing a themed sentence.
    if (quizState.isQuestMode) {
      var questTypes = [];
      if (getQuestSentenceBlank(wordObj)) questTypes.push('sentence');
      if (hasUsableThemedRelation(wordObj, 'synonym')) questTypes.push('synonym');
      if (hasUsableThemedRelation(wordObj, 'antonym')) questTypes.push('antonym');
      return questTypes.length ? questTypes : ['sentence'];
    }

    var types = ['definition', 'word'];
    if (getSentenceBlank(wordObj)) {
      types.push('sentence');
    }
    if (wordObj.synonyms && wordObj.synonyms.length) {
      types.push('synonym');
    }
    if (wordObj.antonyms && wordObj.antonyms.length) {
      types.push('antonym');
    }
    return types;
  }

  function caseInsensitiveSet(items) {
    var set = {};
    items.forEach(function (s) { if (s) set[s.toLowerCase()] = true; });
    return set;
  }

  // In Story Quest, a synonym/antonym question is a themed fill-in-the-blank:
  // returns { cloze, answer } when the word has a valid themed relation cloze.
  function getThemedRelation(wordObj, kind) {
    var themed = getThemedQuest(wordObj);
    var relation = themed && themed[kind];
    if (relation && typeof relation.cloze === 'string' && relation.answer) {
      return relation;
    }
    return null;
  }

  // True when a word's themed synonym/antonym cloze is usable as a quest
  // question: its answer must be one of the word's own synonyms/antonyms,
  // matching the gate buildRelationQuestion applies.
  function hasUsableThemedRelation(wordObj, kind) {
    var relation = getThemedRelation(wordObj, kind);
    if (!relation) return false;
    var positives = (kind === 'synonym' ? wordObj.synonyms : wordObj.antonyms) || [];
    return positives.indexOf(relation.answer) !== -1;
  }

  function buildRelationQuestion(wordObj, pool, kind) {
    var positives = (kind === 'synonym' ? wordObj.synonyms : wordObj.antonyms) || [];
    var negatives = (kind === 'synonym' ? wordObj.antonyms : wordObj.synonyms) || [];
    if (!positives.length) return null;

    // Quest mode: the themed cloze fixes which synonym/antonym is the answer.
    var cloze = null;
    var correct = null;
    if (quizState.isQuestMode) {
      var relation = getThemedRelation(wordObj, kind);
      if (relation && positives.indexOf(relation.answer) !== -1) {
        correct = relation.answer;
        cloze = relation.cloze;
      }
    }
    if (correct === null) {
      correct = positives[Math.floor(Math.random() * positives.length)];
    }
    var blocked = caseInsensitiveSet(positives.concat([wordObj.word]));

    var distractorPool = [];
    negatives.forEach(function (n) {
      if (!blocked[n.toLowerCase()]) distractorPool.push(n);
    });

    shuffle(pool).forEach(function (w) {
      if (distractorPool.length >= 12) return;
      var name = w.word;
      if (!blocked[name.toLowerCase()] && distractorPool.indexOf(name) === -1) {
        distractorPool.push(name);
      }
    });

    var distractors = shuffle(distractorPool).slice(0, 3);
    if (distractors.length < 3) return null;

    var choices = shuffle([correct].concat(distractors));
    return {
      type         : kind,
      questionWord : wordObj,
      sentenceBlank: cloze,
      choices      : choices,
      correctIndex : choices.indexOf(correct)
    };
  }

  function buildQuestion(wordObj, type, pool) {
    if (type === 'synonym' || type === 'antonym') {
      return buildRelationQuestion(wordObj, pool, type);
    }

    var distractors = pickDistractors(wordObj, pool, 3);
    var ordered = shuffle([wordObj].concat(distractors));
    var correctIndex = ordered.indexOf(wordObj);
    var choices = ordered.map(function (c) {
      return type === 'word' ? c.definition : c.word;
    });
    return {
      type         : type,
      questionWord : wordObj,
      sentenceBlank: type === 'sentence'
        ? (quizState.isQuestMode ? getQuestSentenceBlank(wordObj) : getSentenceBlank(wordObj))
        : null,
      choices      : choices,
      correctIndex : correctIndex
    };
  }

  function buildWeakestPool(basePool) {
    // Words that have at least one wrong answer, sorted by miss-margin desc
    // then most recent miss. Falls back to filling with random words from base.
    var withMisses = basePool.filter(function (w) {
      var m = mastery[w.word];
      return m && m.incorrect > 0 && (m.incorrect - m.correct) >= 0;
    });
    withMisses.sort(function (a, b) {
      var ma = mastery[a.word];
      var mb = mastery[b.word];
      var diffA = ma.incorrect - ma.correct;
      var diffB = mb.incorrect - mb.correct;
      if (diffB !== diffA) return diffB - diffA;
      return (mb.lastWrong || 0) - (ma.lastWrong || 0);
    });

    if (withMisses.length >= quizState.length) return withMisses;

    // Pad with non-mastered words so the quiz can run.
    var seen = {};
    withMisses.forEach(function (w) { seen[w.word] = true; });
    var pad = shuffle(basePool.filter(function (w) {
      return !seen[w.word] && getMasteryStatus(w.word) !== 'mastered';
    }));
    var combined = withMisses.concat(pad);

    // If everything is mastered (or basePool empty), fall back to a shuffled
    // copy of basePool so the user can keep practising rather than seeing the
    // overlay crash with no questions to render.
    if (combined.length === 0) {
      return shuffle(basePool);
    }
    return combined;
  }

  function buildQuizSession() {
    var basePool = quizState.scope === '5star'
      ? allWords.filter(function (w) { return w.usefulness_rating === 5; })
      : allWords;

    var pool = quizState.scope === 'weakest'
      ? buildWeakestPool(allWords)
      : basePool;

    var distractorPool = quizState.scope === 'weakest' ? allWords : basePool;

    var questionPool = pool;
    if (quizState.mode === 'sentence') {
      questionPool = pool.filter(function (w) { return getSentenceBlank(w); });
    } else if (quizState.mode === 'synonym') {
      questionPool = pool.filter(function (w) { return w.synonyms && w.synonyms.length; });
    } else if (quizState.mode === 'antonym') {
      questionPool = pool.filter(function (w) { return w.antonyms && w.antonyms.length; });
    }

    var count = Math.min(quizState.length, questionPool.length);
    var ordered = quizState.scope === 'weakest'
      ? questionPool.slice(0, count)
      : shuffle(questionPool).slice(0, count);

    var questions = [];
    ordered.forEach(function (word) {
      var availableTypes = getQuestionTypesForWord(word);
      var type = quizState.mode === 'mixed'
        ? shuffle(availableTypes)[0]
        : quizState.mode;
      var q = buildQuestion(word, type, distractorPool);
      if (q) questions.push(q);
    });
    return questions;
  }

  // ── Rendering ──────────────────────────────────────────────────────────────
  function resetQuizAnswerFocus() {
    if (document.activeElement && quizAnswersGrid.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  function renderQuestion(index) {
    var q = quizState.questions[index];
    var total = quizState.questions.length;

    // Ensure no answer button remains visually/keyboard selected between questions.
    resetQuizAnswerFocus();

    // Progress
    var pct = (index / total) * 100;
    quizProgressFill.style.width = pct + '%';
    quizProgressWrap.setAttribute('aria-valuenow', index);

    // Meta
    quizCounter.textContent      = 'Q ' + (index + 1) + ' of ' + total;
    quizScoreDisplay.textContent = 'Score: ' + quizState.score;
    quizStreakEl.textContent     = quizState.streak >= 2 ? '🔥 ' + quizState.streak : '';

    // Question — in quest mode each question is themed to its own word.
    var theme = quizState.isQuestMode ? getQuestTheme(q.questionWord) : null;
    var labelTask, payloadText;
    if (q.type === 'definition') {
      labelTask   = ': What word means this?';
      payloadText = q.questionWord.definition;
    } else if (q.type === 'sentence') {
      labelTask   = ': Which word best completes this sentence?';
      payloadText = q.sentenceBlank;
    } else if (q.type === 'synonym') {
      labelTask   = ': Which word means almost the SAME as this?';
      payloadText = q.questionWord.word;
    } else if (q.type === 'antonym') {
      labelTask   = ': Which word means the OPPOSITE of this?';
      payloadText = q.questionWord.word;
    } else {
      labelTask   = ': What does this word mean?';
      payloadText = q.questionWord.word;
    }

    // Story Quest: every question is a themed fill-in-the-blank sentence — the
    // word, a synonym or an antonym completes the story line.
    if (theme) {
      payloadText = q.sentenceBlank;
      quizQuestionLabel.textContent =
        theme.emoji + ' ' + theme.theme + ' Quest: Complete the themed sentence';
    } else {
      quizQuestionLabel.textContent = 'Quiz' + labelTask;
    }

    quizQuestionText.innerHTML = '';
    var coreEl = document.createElement('span');
    coreEl.className = 'quiz-question-core';
    coreEl.textContent = payloadText;
    quizQuestionText.appendChild(coreEl);

    // Answer buttons
    quizAnswersGrid.innerHTML = '';
    q.choices.forEach(function (choice, i) {
      var btn = document.createElement('button');
      btn.className    = 'quiz-answer-btn';
      btn.dataset.idx  = i;
      btn.setAttribute('aria-pressed', 'false');
      btn.textContent  = choice;
      quizAnswersGrid.appendChild(btn);
    });

    // Clear feedback
    quizFeedback.className = 'quiz-feedback';
    quizFeedback.textContent = '';

    // Move focus away from the answer grid after each re-render so the
    // previously chosen answer position does not look preselected.
    if (quizQuestionScreen) {
      quizQuestionScreen.setAttribute('tabindex', '-1');
      quizQuestionScreen.focus({ preventScroll: true });
    }
  }

  // ── Answer handling ────────────────────────────────────────────────────────
  var CORRECT_PHRASES = ['✓ Brilliant!', '✓ Spot on!', '✓ Nice work!', '✓ Excellent!'];

  function handleAnswer(chosenIndex) {
    var q = quizState.questions[quizState.currentIndex];
    var buttons = quizAnswersGrid.querySelectorAll('.quiz-answer-btn');
    var isCorrect = chosenIndex === q.correctIndex;
    var chosenText = q.choices[chosenIndex];

    // Disable all buttons immediately
    forEachNode(buttons, function (b) { b.disabled = true; });

    // Apply colour feedback
    buttons[q.correctIndex].classList.add('correct');
    buttons[chosenIndex].setAttribute('aria-pressed', 'true');
    if (!isCorrect) {
      buttons[chosenIndex].classList.add('wrong');
    }

    // Persist mastery for this word
    recordAnswer(q.questionWord.word, isCorrect);

    // Update score / streak
    if (isCorrect) {
      quizState.score++;
      quizState.streak++;
    } else {
      quizState.streak = 0;
      quizState.misses.push({
        word: q.questionWord.word,
        definition: q.questionWord.definition,
        chosen: chosenText
      });
    }

    // Feedback strip
    quizFeedback.className = 'quiz-feedback visible ' +
      (isCorrect ? 'feedback-correct' : 'feedback-wrong');
    if (isCorrect) {
      quizFeedback.textContent = CORRECT_PHRASES[Math.floor(Math.random() * CORRECT_PHRASES.length)];
    } else {
      quizFeedback.textContent = '✗ The answer was: ' + q.choices[q.correctIndex];
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
    var previousBest = getQuizBest();
    var isNewBest = score > previousBest;
    saveQuizBest(score);

    var tier;
    if (score === total)       tier = { emoji: '🏆', title: 'Perfect score!' };
    else if (score >= total * 0.7) tier = { emoji: '⭐', title: 'Star performance!' };
    else if (score >= total * 0.4) tier = { emoji: '👍', title: 'Good effort!' };
    else                           tier = { emoji: '💪', title: 'Keep practising!' };

    quizEndEmoji.textContent = tier.emoji;
    quizEndTitle.textContent = tier.title;
    quizEndScore.textContent = score + ' / ' + total + ' correct';
    if (quizState.isQuestMode) {
      applyQuestRewards(score, total);
    }
    quizEndBest.textContent  = isNewBest
      ? 'New personal best! 🎉'
      : (previousBest > 0 ? 'Personal best for these options: ' + previousBest + ' / ' + total : '');

    renderQuizReview();
    showQuizScreen(quizEndScreen);
    quizPlayAgainBtn.focus();
  }

  function renderQuizReview() {
    quizReviewList.innerHTML = '';
    if (quizState.misses.length === 0) {
      quizReview.classList.add('hidden');
      return;
    }

    quizState.misses.forEach(function (miss) {
      var item = document.createElement('li');
      item.className = 'quiz-review-item';

      var word = document.createElement('strong');
      word.textContent = miss.word;

      var definition = document.createElement('span');
      definition.textContent = miss.definition;

      var chosen = document.createElement('small');
      chosen.textContent = 'You chose: ' + miss.chosen;

      item.appendChild(word);
      item.appendChild(definition);
      item.appendChild(chosen);
      quizReviewList.appendChild(item);
    });

    quizReview.classList.remove('hidden');
  }

  // ── Start quiz ─────────────────────────────────────────────────────────────
  function startQuiz() {
    clearQuizAdvanceTimeout();
    quizState.currentIndex = 0;
    quizState.score        = 0;
    quizState.streak       = 0;
    quizState.misses       = [];
    quizState.questions    = buildQuizSession();
    quizProgressWrap.setAttribute('aria-valuemax', quizState.questions.length);
    showQuizScreen(quizQuestionScreen);
    renderQuestion(0);
    quizExitBtn.focus();
  }

  function startQuestWorld(worldIndex) {
    questState.progress.worldIndex = worldIndex;
    quizState.scope = 'all';
    quizState.length = 5;
    quizState.mode = 'mixed';
    quizState.isQuestMode = true;
    closeQuestOverlay();
    openQuizOverlay();
  }

  function applyQuestRewards(score, total) {
    var passed = score >= Math.ceil(total * 0.7);
    var bonusCoins = passed ? 30 : 10;
    var gainedXp = score * 8;
    questState.progress.coins += bonusCoins;
    questState.progress.xp += gainedXp;
    if (passed) {
      questState.progress.levelsWonInWorld += 1;
      if (questState.progress.levelsWonInWorld >= 5 && questState.progress.worldIndex < questState.worlds.length - 1) {
        questState.progress.worldIndex += 1;
        questState.progress.levelsWonInWorld = 0;
      }
    }
    saveQuestProgress();
    quizEndBest.textContent += ' · Quest rewards: +' + gainedXp + ' XP, +' + bonusCoins + ' coins';
  }

  // ── Event listeners ────────────────────────────────────────────────────────
  function initQuiz() {
    loadQuizBest();
    loadQuestProgress();

    quizLaunchBtn.addEventListener('click', openQuizOverlay);
    questLaunchBtn.addEventListener('click', openQuestOverlay);
    questCloseBtn.addEventListener('click', closeQuestOverlay);
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
        updateQuizSetupSummary();
      });
    });

    forEachNode(quizLengthBtns, function (btn) {
      btn.addEventListener('click', function () {
        forEachNode(quizLengthBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        quizState.length = parseInt(this.dataset.length, 10);
        updateQuizSetupSummary();
      });
    });

    forEachNode(quizModeBtns, function (btn) {
      btn.addEventListener('click', function () {
        forEachNode(quizModeBtns, function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        this.classList.add('active');
        this.setAttribute('aria-pressed', 'true');
        quizState.mode = this.dataset.mode;
        updateQuizSetupSummary();
      });
    });

    updateQuizSetupSummary();

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
      if (e.key === 'Escape' && !questOverlay.classList.contains('hidden')) {
        closeQuestOverlay();
      }
    });
  }

})();
