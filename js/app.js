(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  var allWords = [];
  var lastFocusedCard = null;

  // ── View counts (persisted in localStorage) ────────────────────────────────
  var VIEW_COUNTS_KEY = 'vocabVault_viewCounts';
  var TTS_VOICE_KEY   = '11plus-tts-voice';
  var TTS_PITCH_KEY   = '11plus-tts-pitch';
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
      utter.pitch = ttsPitch;
      if (ttsVoice) utter.voice = ttsVoice;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  // ── TTS read-along ────────────────────────────────────────────────────────
  var ttsWordData       = null;   // {fullText, words:[{el,start,end,sentenceIdx}], sentences:[[firstWordIdx,lastWordIdx],...], bar}
  var ttsPlaying        = false;
  var ttsRate           = 1.0;
  var ttsActiveIdx      = -1;
  var ttsActiveSentence = -1;
  var ttsActiveUtter    = null;   // SpeechSynthesisUtterance currently driving the bar
  var ttsCurrentBar     = null;   // {readBtn, controls, playPauseBtn}
  var ttsVoice          = null;   // SpeechSynthesisVoice | null
  var ttsPitch          = 1.0;
  var allVoiceSelectEls = [];     // one per TTS bar, kept in sync

  function loadVoices() {
    if (!('speechSynthesis' in window)) return;
    var voices = window.speechSynthesis.getVoices();
    var enVoices = voices.filter(function (v) { return /^en/i.test(v.lang); });
    if (enVoices.length === 0) return;

    // Lower score = higher quality. Neural/Natural/Online voices are markedly
    // better than standard browser voices on Windows (Microsoft) and Mac (Siri).
    function voiceScore(v) {
      var isNatural = /natural|neural|online/i.test(v.name);
      var isGB = /^en-GB/i.test(v.lang);
      var isUS = /^en-US/i.test(v.lang);
      if (isNatural && isGB) return 0;
      if (isNatural && isUS) return 1;
      if (isNatural)         return 2;
      if (isGB)              return 3;
      if (isUS)              return 4;
      return 5;
    }

    function voiceDisplayName(v) {
      var isNatural = /natural|neural|online/i.test(v.name);
      var n = v.name
        .replace(/^Microsoft\s+/i, '')
        .replace(/\s+Online\s*\(Natural\)/i, '')
        .replace(/\s+Online\b/i, '')
        .replace(/\s+Neural\b/i, '')
        .replace(/\s+-\s+English[^)]*$/i, '');
      return (isNatural ? '★ ' : '') + n + ' (' + v.lang + ')';
    }

    enVoices.sort(function (a, b) {
      var diff = voiceScore(a) - voiceScore(b);
      return diff !== 0 ? diff : a.name.localeCompare(b.name);
    });

    // null = never set (first visit); '' = user explicitly chose Default
    var savedName    = localStorage.getItem(TTS_VOICE_KEY);
    var isFirstVisit = savedName === null;
    var bestVoice    = enVoices[0];

    allVoiceSelectEls.forEach(function (sel) {
      var target = isFirstVisit ? bestVoice.name : (savedName || '');
      sel.innerHTML = '<option value="">Default (browser)</option>';
      enVoices.forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = voiceDisplayName(v);
        sel.appendChild(opt);
      });
      sel.value = target;
      if (!sel.value) sel.value = isFirstVisit ? bestVoice.name : '';
    });

    var targetName = isFirstVisit ? bestVoice.name : (savedName || '');
    ttsVoice = enVoices.find(function (v) { return v.name === targetName; }) || (isFirstVisit ? bestVoice : null);

    if (isFirstVisit && ttsVoice) {
      try { localStorage.setItem(TTS_VOICE_KEY, ttsVoice.name); } catch (e) {}
    }
  }

  function ttsSetActiveSentence(sIdx) {
    if (sIdx === ttsActiveSentence) return;
    if (ttsActiveSentence >= 0 && ttsWordData && ttsWordData.sentences[ttsActiveSentence]) {
      ttsWordData.sentences[ttsActiveSentence].classList.remove('tts-sentence-active');
    }
    ttsActiveSentence = sIdx;
    if (sIdx >= 0 && ttsWordData && ttsWordData.sentences[sIdx]) {
      ttsWordData.sentences[sIdx].classList.add('tts-sentence-active');
    }
  }

  function ttsActivateWord(idx) {
    if (ttsActiveIdx >= 0 && ttsWordData && ttsWordData.words[ttsActiveIdx]) {
      ttsWordData.words[ttsActiveIdx].el.classList.remove('tts-active');
    }
    ttsActiveIdx = idx;
    if (idx >= 0 && ttsWordData && ttsWordData.words[idx]) {
      var w = ttsWordData.words[idx];
      w.el.classList.add('tts-active');
      ttsSetActiveSentence(typeof w.sentenceIdx === 'number' ? w.sentenceIdx : -1);
      w.el.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    }
  }

  function ttsClearActive() {
    if (ttsActiveIdx >= 0 && ttsWordData && ttsWordData.words[ttsActiveIdx]) {
      ttsWordData.words[ttsActiveIdx].el.classList.remove('tts-active');
    }
    ttsActiveIdx = -1;
    ttsSetActiveSentence(-1);
  }

  function ttsBarShowIdle(bar) {
    bar.readBtn.classList.remove('hidden');
    bar.controls.classList.add('hidden');
  }

  function ttsBarShowActive(bar, playing) {
    bar.readBtn.classList.add('hidden');
    bar.controls.classList.remove('hidden');
    bar.playPauseBtn.textContent = playing ? '⏸ Pause' : '▶ Resume';
    bar.playPauseBtn.setAttribute('aria-label', playing ? 'Pause reading' : 'Resume reading');
  }

  function ttsDetachActiveUtter() {
    if (!ttsActiveUtter) return;
    // speechSynthesis.cancel() fires onend (or onerror) asynchronously for the
    // pending utterance. Detach handlers so the stale callback can't flip the
    // bar back to idle after we've already started a new utterance.
    ttsActiveUtter.onend = null;
    ttsActiveUtter.onerror = null;
    ttsActiveUtter.onboundary = null;
    ttsActiveUtter = null;
  }

  function ttsStart(startChar) {
    if (!ttsWordData || !ttsWordData.fullText || !('speechSynthesis' in window)) return;
    var offset = (typeof startChar === 'number' && startChar > 0) ? startChar : 0;
    var textToSpeak = offset > 0 ? ttsWordData.fullText.slice(offset) : ttsWordData.fullText;
    ttsDetachActiveUtter();
    window.speechSynthesis.cancel();
    ttsClearActive();
    var utter = new SpeechSynthesisUtterance(textToSpeak);
    utter.lang = 'en-GB';
    utter.rate = ttsRate;
    utter.pitch = ttsPitch;
    if (ttsVoice) utter.voice = ttsVoice;
    utter.onboundary = function (evt) {
      if (evt.name !== 'word') return;
      var ci = evt.charIndex + offset;
      var words = ttsWordData ? ttsWordData.words : [];
      for (var i = 0; i < words.length; i++) {
        if (ci >= words[i].start && ci < words[i].end) { ttsActivateWord(i); return; }
        if (words[i].start > ci) { ttsActivateWord(i); return; }
      }
    };
    utter.onend = function () {
      if (utter !== ttsActiveUtter) return;
      ttsActiveUtter = null;
      ttsClearActive();
      ttsPlaying = false;
      if (ttsCurrentBar) ttsBarShowIdle(ttsCurrentBar);
    };
    utter.onerror = function () {
      if (utter !== ttsActiveUtter) return;
      ttsActiveUtter = null;
      ttsClearActive();
      ttsPlaying = false;
      if (ttsCurrentBar) ttsBarShowIdle(ttsCurrentBar);
    };
    ttsActiveUtter = utter;
    window.speechSynthesis.speak(utter);
    ttsPlaying = true;
  }

  function initTapToJump() {
    document.addEventListener('click', function (e) {
      if (!ttsWordData || !ttsWordData.container) return;
      var span = closestByClass(e.target, 'tts-word');
      if (!span) return;
      if (!ttsWordData.container.contains(span)) return;
      var words = ttsWordData.words;
      for (var i = 0; i < words.length; i++) {
        if (words[i].el === span) { ttsJumpToWord(i); return; }
      }
    });
  }

  function ttsJumpToWord(idx) {
    if (!ttsWordData || !ttsWordData.words[idx]) return;
    var bar = ttsCurrentBar || ttsWordData.bar;
    if (!bar) return;
    if (ttsCurrentBar && ttsCurrentBar !== bar) {
      ttsBarShowIdle(ttsCurrentBar);
    }
    ttsCurrentBar = bar;
    ttsBarShowActive(bar, true);
    ttsStart(ttsWordData.words[idx].start);
    ttsActivateWord(idx);
  }

  function ttsPause() {
    if (!ttsPlaying) return;
    window.speechSynthesis.pause();
    ttsPlaying = false;
  }

  function ttsResume() {
    if (ttsPlaying) return;
    window.speechSynthesis.resume();
    ttsPlaying = true;
  }

  function ttsStop() {
    ttsDetachActiveUtter();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    ttsPlaying = false;
    ttsClearActive();
    if (ttsCurrentBar) {
      ttsBarShowIdle(ttsCurrentBar);
      ttsCurrentBar = null;
    }
  }

  function initTTSBar(readBtnEl, controlsEl, playPauseBtnEl, stopBtnEl, speedBtnList, voiceSelectEl, pitchBtnList) {
    var bar = { readBtn: readBtnEl, controls: controlsEl, playPauseBtn: playPauseBtnEl };

    if (voiceSelectEl) {
      allVoiceSelectEls.push(voiceSelectEl);
      loadVoices();
      voiceSelectEl.addEventListener('change', function () {
        var name = voiceSelectEl.value;
        var voices = window.speechSynthesis.getVoices();
        ttsVoice = voices.find(function (v) { return v.name === name; }) || null;
        try { localStorage.setItem(TTS_VOICE_KEY, name); } catch (e) {}
        allVoiceSelectEls.forEach(function (sel) { if (sel !== voiceSelectEl) sel.value = name; });
        if (ttsCurrentBar) { ttsStop(); ttsCurrentBar = bar; ttsBarShowActive(bar, true); ttsStart(); }
      });
    }

    if (pitchBtnList && pitchBtnList.length) {
      forEachNode(pitchBtnList, function (btn) {
        btn.addEventListener('click', function () {
          var pitch = parseFloat(btn.dataset.pitch);
          if (isNaN(pitch)) return;
          ttsPitch = pitch;
          try { localStorage.setItem(TTS_PITCH_KEY, String(pitch)); } catch (e) {}
          document.querySelectorAll('.tts-pitch-btn').forEach(function (b) {
            b.classList.toggle('tts-speed-active', b.dataset.pitch === btn.dataset.pitch);
          });
          if (ttsCurrentBar) { ttsStop(); ttsCurrentBar = bar; ttsBarShowActive(bar, true); ttsStart(); }
        });
      });
    }

    readBtnEl.addEventListener('click', function () {
      ttsStop();
      ttsCurrentBar = bar;
      ttsBarShowActive(bar, true);
      ttsStart();
    });

    playPauseBtnEl.addEventListener('click', function () {
      if (ttsPlaying) { ttsPause(); ttsBarShowActive(bar, false); }
      else             { ttsResume(); ttsBarShowActive(bar, true);  }
    });

    stopBtnEl.addEventListener('click', function () { ttsStop(); });

    forEachNode(speedBtnList, function (btn) {
      btn.addEventListener('click', function () {
        var rate = parseFloat(btn.dataset.rate);
        if (isNaN(rate)) return;
        ttsRate = rate;
        forEachNode(speedBtnList, function (b) {
          b.classList.toggle('tts-speed-active', b.dataset.rate === btn.dataset.rate);
        });
        if (ttsCurrentBar === bar) {
          ttsStop();
          ttsCurrentBar = bar;
          ttsBarShowActive(bar, true);
          ttsStart();
        }
      });
    });

    return bar;
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
    initTapToJump();
    fetch('data/words.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        allWords = data.words;
        updateWordCountDisplay(allWords.length);
        renderCards(allWords);
        attachEventListeners();
        initGloss();
        initStoryMode();
        initHistoryMode();
        initDailyNews();
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
    isQuestMode  : false,
    customPool   : null,
    returnTo     : null,
    onComplete   : null
  };

  var questState = {
    worlds: [
      {
        id: 'forest', name: 'Forest of Clues', emoji: '🌲',
        quests: [
          { id: 'forest-1', title: 'The Ancient Grove',      words: ['Abundant','Altar','Amiable','Analogy','Bleak','Blossom','Brisk','Clambered','Clone','Collapse'] },
          { id: 'forest-2', title: 'Whispers in the Dark',   words: ['Commotion','Cosmetic','Crisp','Defiant','Dialect','Dilapidated','Divert','Eerie','Emerald','Espionage'] },
          { id: 'forest-3', title: 'The Hidden Path',        words: ['Faltered','Flourish','Gnarled','Huddled','Illicit','Insight','Lurched','Mandate','Mantra','Matrix'] },
          { id: 'forest-4', title: 'Shadows and Firelight',  words: ['Meandered','Neglect','Nimble','Overjoyed','Palm','Placid','Precious','Preservation','Prickly','Quaint'] },
          { id: 'forest-5', title: "The Fox's Secret",       words: ['Quivered','Reckless','Rehabilitate','Rustling','Secrete','Sector','Serene','Simultaneous','Sinuous','Skeletal'] },
          { id: 'forest-6', title: 'Heart of the Wood',      words: ['Solemn','Specimen','Stealthy','Tangled','Towering','Tranquil','Transparent','Uncanny','Vigilant','Wilderness'] }
        ]
      },
      {
        id: 'castle', name: 'Castle of Synonyms', emoji: '🏰',
        quests: [
          { id: 'castle-1', title: 'The Iron Gate',      words: ['Allege','Apex','Artefact','Budge','Bustling','Collision','Compensate','Concealed','Consumerism','Conviction'] },
          { id: 'castle-2', title: 'The Great Hall',     words: ['Daunt','Domestic','Drastic','Dreary','Extravagant','Fraught','Hierarchy','Hypothesis','Indescribable','Jovial'] },
          { id: 'castle-3', title: 'The Dungeon Below',  words: ['Knackered','Labyrinthine','Lawful','Opulent','Perception','Perplexed','Provision','Sentiment','Serpentine','Stifling'] },
          { id: 'castle-4', title: 'The Royal Banquet',  words: ['Technician','Thunderous','Twilight','Uneasy','Vibrant','Volatile','Weary','Yearned'] }
        ]
      },
      {
        id: 'dragon', name: 'Dragon Mountain', emoji: '🐉',
        quests: [
          { id: 'dragon-1', title: 'The Dragon Awakens', words: ['Amateur','Anticipation','Avatar','Barricade','Bewildered','Ceaseless','Census','Crimson','Delusion','Drifted'] },
          { id: 'dragon-2', title: 'Fire and Fury',      words: ['Duly','Enraged','Excerpt','Exquisite','Fragile','Haste','Illegible','Lapse','Mischievous','Misinterpret'] },
          { id: 'dragon-3', title: "The Dragon's Hoard", words: ['Noxious','Ominous','Passive','Persistent','Proud','Puny','Putrid','Reluctant','Scurried','Shrouded'] },
          { id: 'dragon-4', title: 'Taming the Beast',   words: ['Smother','Smouldering','Stubborn','Thrifty','Thrilled','Turbulent','Vague','Valiant','Wandered'] }
        ]
      },
      {
        id: 'fairies', name: 'Fairy Glen', emoji: '🧚',
        quests: [
          { id: 'fairies-1', title: 'Moonlit Meadow',            words: ['Agitated','Arduous','Astonished','Avail','Canyon','Captivating','Compassion','Compel','Delicate'] },
          { id: 'fairies-2', title: 'The Fairy Ring',            words: ['Denote','Desolate','Determined','Diligent','Discriminate','Disperse','Elegant','Encapsulate','Ephemeral'] },
          { id: 'fairies-3', title: 'Silver Wings',              words: ['Finite','Forsake','Glistening','Graceful','Illuminated','Impatient','Imprison','Incandescent','Incompatible'] },
          { id: 'fairies-4', title: 'The Lost Glade',            words: ['Inedible','Inflection','Lavish','Livelihood','Luminous','Majestic','Mysterious','Obsession','Opportune'] },
          { id: 'fairies-5', title: 'Enchanted Bloom',           words: ['Petrified','Piercing','Ragged','Rational','Rectify','Rickety','Rite','Scarlet','Spectacular'] },
          { id: 'fairies-6', title: "The Fairy Queen's Trial",   words: ['Tender','Tumultuous','Ubiquitous','Vast','Vivid','Whirling','Withered','Wretched','Zealous'] }
        ]
      },
      {
        id: 'army-battle', name: 'Army Battle Fields', emoji: '🛡️',
        quests: [
          { id: 'army-1', title: 'The Call to Arms',  words: ['Belligerent','Bellowed','Bias','Calamity','Cautious','Cemetery','Clandestine','Consensus','Contentious','Context'] },
          { id: 'army-2', title: 'Into the Fray',     words: ['Courageous','Eager','Earthly','Elated','Evasive','Flickered','Fractious','Furnish','Glorious','Grim','Hieroglyph'] },
          { id: 'army-3', title: 'The Siege',         words: ['Hospitality','Hostile','Immortal','Inflammatory','Memorial','Muttered','Obedient','Panorama','Peculiar','Poised'] },
          { id: 'army-4', title: 'Victory at Dawn',   words: ['Ravenous','Reassuring','Rigour','Spatial','Spirited','Sprightly','Successive','Timid','Vault','Whimsical'] }
        ]
      },
      {
        id: 'sea-journey', name: 'Sea Journey Isles', emoji: '⛵',
        quests: [
          { id: 'sea-1', title: 'Setting Sail',        words: ['Aloft','Amplify','Cacophony','Circulate','Circumstance','Contemplate','Contented','Cove','Dazzling','Electrocute'] },
          { id: 'sea-2', title: 'Stormy Waters',       words: ['Epidemic','Faded','Ferocious','Forfeit','Forlorn','Fragrant','Gargantuan','Gloomy','Haunted','Hearty'] },
          { id: 'sea-3', title: 'The Deep Blue',       words: ['Hesitant','Hollow','Humid','Impermeable','Infuse','Jubilant','Lament','Looming','Melancholy','Menacing'] },
          { id: 'sea-4', title: 'Lost at Sea',         words: ['Miserable','Misty','Murky','Nocturnal','Nostalgic','Notorious','Perilous','Precarious','Prominent','Radiant'] },
          { id: 'sea-5', title: 'Island of Wonders',   words: ['Resilient','Resolute','Rippling','Savage','Scout','Shimmering','Shrieked','Shrivel','Splendid','Staggered'] },
          { id: 'sea-6', title: 'The Final Voyage',    words: ['Stout','Stupendous','Substitute','Sulky','Supple','Surged','Swift','Teeming','Temperate','Tempestuous'] },
          { id: 'sea-7', title: "Harbour's End",       words: ['Tense','Trepidation','Tribute','Unruly','Vigorous','Virtuous','Voracious','Warily','Wistful'] }
        ]
      },
      {
        id: 'wizard-school', name: 'Wizard School Towers', emoji: '🧙',
        quests: [
          { id: 'wizard-1', title: 'The First Spell',           words: ['Abuse','Acknowledge','Allocate','Barrage','Chaotic','Collective','Convention','Deterrent','Devout','Duration'] },
          { id: 'wizard-2', title: 'Halls of Knowledge',        words: ['Exemplify','Expertise','Figurehead','Frantic','Glimmer','Hack','Immense','Impressive','Inconsistent','Ingenious'] },
          { id: 'wizard-3', title: 'The Forbidden Tower',       words: ['Inscription','Legacy','Lingered','Obscure','Ornate','Plagiarise','Plateau','Progressive','Proximity','Realm'] },
          { id: 'wizard-4', title: 'Masters and Apprentices',   words: ['Rebuke','Regime','Resolution','Robust','Saga','Scrutinise','Sociable','Sparse','Stimulate','Subjective'] },
          { id: 'wizard-5', title: 'The Final Enchantment',     words: ['Subtle','Sufficient','Suspicious','Tolerant','Tremulous','Triumphant','Unidentified','Variant','Verge','Vicious'] }
        ]
      }
    ],
    activeWorldIndex: 0,
    activeQuestId: null,
    progress: { completed: [], xp: 0, coins: 0 }
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
      if (parsed && Array.isArray(parsed.completed)) {
        questState.progress = parsed;
      }
      // Old progress format (worldIndex-based) is intentionally discarded.
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

  // The setup screen's option buttons are the source of truth for a normal
  // quiz, so re-read them in case a quest or scoped quiz changed quizState.
  function syncQuizStateFromSetup() {
    var activeScope  = document.querySelector('.quiz-scope-btn.active');
    var activeLength = document.querySelector('[data-length].active');
    var activeMode   = document.querySelector('[data-mode].active');
    if (activeScope)  quizState.scope  = activeScope.dataset.scope;
    if (activeLength) quizState.length = parseInt(activeLength.dataset.length, 10);
    if (activeMode)   quizState.mode   = activeMode.dataset.mode;
  }

  function openQuizOverlay() {
    clearQuizAdvanceTimeout();
    quizOverlay.classList.remove('hidden');
    quizOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    // Story Quest and scoped (story/news) quizzes always play mixed question
    // types on a fixed word set, so skip the setup screen.
    if (quizState.isQuestMode || quizState.customPool) {
      startQuiz();
      return;
    }
    syncQuizStateFromSetup();
    updateQuizSetupSummary();
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
    var returnTo = quizState.returnTo;
    quizState.customPool = null;
    quizState.returnTo = null;
    quizState.onComplete = null;
    if (returnTo === 'story') {
      reopenStoryReading();
    } else if (returnTo === 'news') {
      reopenNewsReading();
    } else if (returnTo === 'history') {
      reopenHistoryReading();
    } else {
      quizLaunchBtn.focus();
    }
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
    var totalQuests = 0;
    questState.worlds.forEach(function (w) { totalQuests += w.quests.length; });
    var completedCount = p.completed.length;
    var completionPct = totalQuests > 0 ? Math.round((completedCount / totalQuests) * 100) : 0;
    questWallet.textContent = 'XP: ' + p.xp + ' · Coins: ' + p.coins + ' · Quests done: ' + completedCount + '/' + totalQuests;
    questProgressFill.style.width = completionPct + '%';
    questProgressLabel.textContent = completionPct + '%';
    questProgressTrack.setAttribute('aria-valuenow', completionPct);
    questWorldList.innerHTML = '';

    questState.worlds.forEach(function (world, worldIdx) {
      var card = document.createElement('div');
      card.className = 'quest-world-card';
      var worldDone = world.quests.filter(function (q) {
        return p.completed.indexOf(q.id) !== -1;
      }).length;
      card.innerHTML =
        '<h3>' + world.emoji + ' ' + world.name + '</h3>' +
        '<p class="quest-world-meta">' + worldDone + '/' + world.quests.length + ' quests completed</p>';
      var list = document.createElement('div');
      list.className = 'quest-item-list';
      world.quests.forEach(function (quest, questIdx) {
        var done = p.completed.indexOf(quest.id) !== -1;
        var btn = document.createElement('button');
        btn.className = 'quest-item-btn' + (done ? ' done' : '');
        btn.innerHTML =
          (done ? '<span class="quest-item-tick">✓</span> ' : '') +
          quest.title +
          ' <span class="quest-item-count">(' + quest.words.length + ' words)</span>';
        btn.addEventListener('click', function () { startQuest(worldIdx, questIdx); });
        list.appendChild(btn);
      });
      card.appendChild(list);
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
    var basePool;
    var distractorPool;
    if (quizState.customPool) {
      // Scoped quiz (story / daily news): questions come from a fixed word set,
      // but distractors are drawn from every word so there are always enough.
      basePool = quizState.customPool;
      distractorPool = allWords;
    } else {
      basePool = quizState.scope === '5star'
        ? allWords.filter(function (w) { return w.usefulness_rating === 5; })
        : allWords;
      distractorPool = quizState.scope === 'weakest' ? allWords : basePool;
    }

    // Story Quest: when no customPool is set, restrict to words themed for the
    // active world. With named quests customPool is always set, so this guard
    // only fires as a safety fallback.
    if (quizState.isQuestMode && !quizState.customPool) {
      var worldId = questState.worlds[questState.activeWorldIndex || 0].id;
      basePool = basePool.filter(function (w) {
        return w.themed_quest && w.themed_quest.theme === worldId;
      });
    }

    var pool = quizState.scope === 'weakest'
      ? buildWeakestPool(allWords)
      : basePool;

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

    var tier;
    if (score === total)       tier = { emoji: '🏆', title: 'Perfect score!' };
    else if (score >= total * 0.7) tier = { emoji: '⭐', title: 'Star performance!' };
    else if (score >= total * 0.4) tier = { emoji: '👍', title: 'Good effort!' };
    else                           tier = { emoji: '💪', title: 'Keep practising!' };

    quizEndEmoji.textContent = tier.emoji;
    quizEndTitle.textContent = tier.title;
    quizEndScore.textContent = score + ' / ' + total + ' correct';

    if (quizState.customPool) {
      // Scoped quizzes keep their own progress, so they bypass the generic
      // per-options personal best to avoid colliding keys.
      var bestText = quizState.onComplete ? quizState.onComplete(score, total) : '';
      quizEndBest.textContent = bestText || '';
    } else {
      var previousBest = getQuizBest();
      var isNewBest = score > previousBest;
      saveQuizBest(score);
      quizEndBest.textContent = isNewBest
        ? 'New personal best! 🎉'
        : (previousBest > 0 ? 'Personal best for these options: ' + previousBest + ' / ' + total : '');
      // applyQuestRewards appends to the line above, so it must run after it.
      if (quizState.isQuestMode) {
        applyQuestRewards(score, total);
      }
    }

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

  function startQuest(worldIdx, questIdx) {
    var world = questState.worlds[worldIdx];
    var quest = world.quests[questIdx];
    questState.activeWorldIndex = worldIdx;
    questState.activeQuestId = quest.id;
    var questWords = quest.words;
    var pool = allWords.filter(function (w) {
      return questWords.indexOf(w.word) !== -1;
    });
    quizState.scope = 'all';
    quizState.length = Math.min(10, pool.length);
    quizState.mode = 'mixed';
    quizState.isQuestMode = true;
    quizState.customPool = pool;
    quizState.onComplete = function (score, total) {
      return applyQuestRewards(score, total);
    };
    closeQuestOverlay();
    openQuizOverlay();
  }

  function applyQuestRewards(score, total) {
    var passed = score >= Math.ceil(total * 0.7);
    var bonusCoins = passed ? 30 : 10;
    var gainedXp = score * 8;
    questState.progress.coins += bonusCoins;
    questState.progress.xp += gainedXp;
    if (passed && questState.activeQuestId) {
      var qid = questState.activeQuestId;
      if (questState.progress.completed.indexOf(qid) === -1) {
        questState.progress.completed.push(qid);
      }
    }
    saveQuestProgress();
    return 'Quest rewards: +' + gainedXp + ' XP, +' + bonusCoins + ' coins';
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

  // ── Scoped quiz launcher (shared by Story Mode & Daily News) ───────────────
  function startScopedQuiz(words, opts) {
    opts = opts || {};
    quizState.scope       = 'all';
    quizState.length      = words.length;
    quizState.mode        = 'mixed';
    quizState.isQuestMode = false;
    quizState.customPool  = words;
    quizState.returnTo    = opts.returnTo || null;
    quizState.onComplete  = opts.onComplete || null;
    openQuizOverlay();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READING HIGHLIGHTS & INLINE GLOSS
  // Shared by Story Mode and Daily News reading views.
  // ═══════════════════════════════════════════════════════════════════════════

  var glossEl = null;

  // Common inflections so a featured word is still highlighted when the prose
  // uses a plural or a different tense.
  function wordVariants(word) {
    var w = word.toLowerCase();
    var set = {};
    set[w] = true;
    set[w + 's'] = true;
    set[w + 'es'] = true;
    if (/[^aeiou]y$/.test(w)) set[w.slice(0, -1) + 'ies'] = true;
    if (w.charAt(w.length - 1) === 'e') {
      set[w + 'd'] = true;
      set[w.slice(0, -1) + 'ing'] = true;
    } else {
      set[w + 'ed'] = true;
      set[w + 'ing'] = true;
    }
    return Object.keys(set);
  }

  function buildHighlightMatcher(featuredWords) {
    var map = {};
    featuredWords.forEach(function (wObj) {
      wordVariants(wObj.word).forEach(function (v) {
        if (!map[v]) map[v] = wObj;
      });
    });
    var variants = Object.keys(map);
    if (!variants.length) return null;
    variants.sort(function (a, b) { return b.length - a.length; });
    var escaped = variants.map(function (v) {
      return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    });
    return { regex: new RegExp('\\b(' + escaped.join('|') + ')\\b', 'gi'), map: map };
  }

  function fillParagraph(pEl, text, matcher) {
    if (!matcher) { pEl.textContent = text; return; }
    matcher.regex.lastIndex = 0;
    var lastIndex = 0;
    var m;
    while ((m = matcher.regex.exec(text)) !== null) {
      if (m.index > lastIndex) {
        pEl.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
      }
      var wObj = matcher.map[m[0].toLowerCase()];
      if (wObj) {
        var span = document.createElement('span');
        span.className = 'vocab-highlight';
        span.textContent = m[0];
        span.tabIndex = 0;
        span.setAttribute('role', 'button');
        span.setAttribute('aria-label', m[0] + ' — tap for the meaning');
        span.dataset.glossWord = wObj.word;
        pEl.appendChild(span);
      } else {
        pEl.appendChild(document.createTextNode(m[0]));
      }
      lastIndex = m.index + m[0].length;
    }
    if (lastIndex < text.length) {
      pEl.appendChild(document.createTextNode(text.slice(lastIndex)));
    }
  }

  function renderReadingBody(containerEl, paragraphs, featuredWords, ttsBar) {
    containerEl.innerHTML = '';
    var matcher = buildHighlightMatcher(featuredWords);
    var wordEntries = [];
    var sentences = []; // array of <span class="tts-sentence"> wrapper elements
    var sentenceIdx = -1;
    var sentenceEl = null;
    var startNewSentence = true;
    var offset = 0;

    function openSentence(p) {
      sentenceIdx += 1;
      sentenceEl = document.createElement('span');
      sentenceEl.className = 'tts-sentence';
      sentences[sentenceIdx] = sentenceEl;
      p.appendChild(sentenceEl);
      startNewSentence = false;
    }

    paragraphs.forEach(function (text, pIdx) {
      if (pIdx > 0) {
        offset += 1; // space separator between paragraphs in fullText
        startNewSentence = true;
      }
      var p = document.createElement('p');
      sentenceEl = null;
      var re = /([A-Za-z’'][A-Za-z’']*)|([^A-Za-z’']+)/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var token = m[0];
        if (m[1]) { // word token
          if (startNewSentence || !sentenceEl) openSentence(p);
          var span = document.createElement('span');
          span.className = 'tts-word';
          span.textContent = token;
          var wObj = matcher && matcher.map[token.toLowerCase()];
          if (!wObj && matcher) {
            matcher.regex.lastIndex = 0;
            var rm = matcher.regex.exec(token);
            if (rm && rm[0].toLowerCase() === token.toLowerCase()) wObj = matcher.map[rm[0].toLowerCase()];
          }
          if (wObj) {
            span.classList.add('vocab-highlight');
            span.tabIndex = 0;
            span.setAttribute('role', 'button');
            span.setAttribute('aria-label', token + ' — tap for the meaning');
            span.dataset.glossWord = wObj.word;
          }
          wordEntries.push({ el: span, start: offset, end: offset + token.length, sentenceIdx: sentenceIdx });
          sentenceEl.appendChild(span);
        } else { // non-word token
          var hasTerminator = /[.!?]/.test(token);
          // Trailing whitespace after a terminator belongs to the gap between
          // sentences — keep it outside the sentence wrapper so the highlight
          // doesn't bleed past the punctuation.
          if (hasTerminator) {
            var splitMatch = token.match(/^([\s\S]*?[.!?]+["'’”)\]]*)([\s\S]*)$/);
            if (splitMatch) {
              var inside = splitMatch[1];
              var outside = splitMatch[2];
              if (sentenceEl) sentenceEl.appendChild(document.createTextNode(inside));
              else p.appendChild(document.createTextNode(inside));
              if (outside) p.appendChild(document.createTextNode(outside));
            } else if (sentenceEl) {
              sentenceEl.appendChild(document.createTextNode(token));
            } else {
              p.appendChild(document.createTextNode(token));
            }
            startNewSentence = true;
          } else if (sentenceEl) {
            sentenceEl.appendChild(document.createTextNode(token));
          } else {
            p.appendChild(document.createTextNode(token));
          }
        }
        offset += token.length;
      }
      containerEl.appendChild(p);
    });

    ttsActiveIdx = -1;
    ttsActiveSentence = -1;
    ttsWordData = {
      fullText: paragraphs.join(' '),
      words: wordEntries,
      sentences: sentences,
      bar: ttsBar || null,
      container: containerEl
    };
  }

  function ensureGloss() {
    if (glossEl) return glossEl;
    glossEl = document.createElement('div');
    glossEl.className = 'vocab-gloss hidden';
    glossEl.setAttribute('role', 'tooltip');
    document.body.appendChild(glossEl);
    return glossEl;
  }

  function showGloss(spanEl, wordObj) {
    var g = ensureGloss();
    g.innerHTML = '';
    var word = document.createElement('div');
    word.className = 'vocab-gloss-word';
    word.textContent = wordObj.word;
    var type = document.createElement('div');
    type.className = 'vocab-gloss-type';
    type.textContent = getWordType(wordObj);
    var def = document.createElement('div');
    def.className = 'vocab-gloss-def';
    def.textContent = wordObj.definition;
    g.appendChild(word);
    g.appendChild(type);
    g.appendChild(def);

    g.classList.remove('hidden');
    var rect = spanEl.getBoundingClientRect();
    var gRect = g.getBoundingClientRect();
    var top = rect.bottom + 8;
    if (top + gRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - gRect.height - 8);
    }
    var left = rect.left;
    if (left + gRect.width > window.innerWidth - 8) {
      left = window.innerWidth - gRect.width - 8;
    }
    if (left < 8) left = 8;
    g.style.top = top + 'px';
    g.style.left = left + 'px';
  }

  function hideGloss() {
    if (glossEl) glossEl.classList.add('hidden');
  }

  function glossIsOpen() {
    return glossEl && !glossEl.classList.contains('hidden');
  }

  function initGloss() {
    document.addEventListener('click', function (e) {
      var span = closestByClass(e.target, 'vocab-highlight');
      if (span) {
        var wObj = findWordByName(span.dataset.glossWord);
        if (wObj) showGloss(span, wObj);
        return;
      }
      if (glossIsOpen() && !closestByClass(e.target, 'vocab-gloss')) {
        hideGloss();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var span = closestByClass(e.target, 'vocab-highlight');
      if (!span) return;
      e.preventDefault();
      var wObj = findWordByName(span.dataset.glossWord);
      if (wObj) showGloss(span, wObj);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // STORY MODE
  // A library of hand-written stories that use vocabulary words in context,
  // followed by a quiz scoped to that story's words.
  // ═══════════════════════════════════════════════════════════════════════════

  var STORY_PROGRESS_KEY = 'vocabVault_storyProgress';
  var stories = [];
  var storyProgress = {};
  var currentStory = null;
  var storyTTSBar = null;

  var storyLaunchBtn     = document.getElementById('story-launch-btn');
  var storyOverlay       = document.getElementById('story-overlay');
  var storyLibraryScreen = document.getElementById('story-library-screen');
  var storyReadingScreen = document.getElementById('story-reading-screen');
  var storyCloseBtn      = document.getElementById('story-close-btn');
  var storyBackBtn       = document.getElementById('story-back-btn');
  var storyList          = document.getElementById('story-list');
  var storyReadingEmoji  = document.getElementById('story-reading-emoji');
  var storyReadingTitle  = document.getElementById('story-reading-title');
  var storyReadingBody   = document.getElementById('story-reading-body');
  var storyQuizBtn       = document.getElementById('story-quiz-btn');

  function loadStoryProgress() {
    try {
      var raw = localStorage.getItem(STORY_PROGRESS_KEY);
      storyProgress = raw ? JSON.parse(raw) : {};
    } catch (e) {
      storyProgress = {};
    }
  }

  function saveStoryProgress() {
    try { localStorage.setItem(STORY_PROGRESS_KEY, JSON.stringify(storyProgress)); } catch (e) {}
  }

  function storyWordObjects(story) {
    var out = [];
    (story.words || []).forEach(function (name) {
      var w = findWordByName(name);
      if (w) out.push(w);
    });
    return out;
  }

  function renderStoryLibrary() {
    storyList.innerHTML = '';
    if (!stories.length) {
      var empty = document.createElement('p');
      empty.className = 'story-card-blurb';
      empty.textContent = 'Stories are still loading — try again in a moment.';
      storyList.appendChild(empty);
      return;
    }
    stories.forEach(function (story) {
      var card = document.createElement('button');
      card.className = 'story-card';
      card.type = 'button';

      var title = document.createElement('span');
      title.className = 'story-card-title';
      title.textContent = story.emoji + ' ' + story.title;

      var blurb = document.createElement('span');
      blurb.className = 'story-card-blurb';
      blurb.textContent = story.blurb;

      var meta = document.createElement('span');
      meta.className = 'story-card-meta';

      var wordsTag = document.createElement('span');
      wordsTag.className = 'story-card-tag';
      wordsTag.textContent = storyWordObjects(story).length + ' words';
      meta.appendChild(wordsTag);

      var prog = storyProgress[story.id];
      if (prog && typeof prog.bestScore === 'number') {
        var scoreTag = document.createElement('span');
        scoreTag.className = 'story-card-tag story-card-score';
        scoreTag.textContent = 'Best ' + prog.bestScore + '/' + prog.total;
        meta.appendChild(scoreTag);
      } else if (prog && prog.read) {
        var readTag = document.createElement('span');
        readTag.className = 'story-card-tag story-card-score';
        readTag.textContent = '✓ Read';
        meta.appendChild(readTag);
      }

      card.appendChild(title);
      card.appendChild(blurb);
      card.appendChild(meta);
      card.addEventListener('click', function () { openStory(story); });
      storyList.appendChild(card);
    });
  }

  function showStoryScreen(screenEl) {
    [storyLibraryScreen, storyReadingScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openStory(story) {
    currentStory = story;
    var prog = storyProgress[story.id] || {};
    prog.read = true;
    storyProgress[story.id] = prog;
    saveStoryProgress();

    storyReadingEmoji.textContent = story.emoji;
    storyReadingTitle.textContent = story.title;
    renderReadingBody(storyReadingBody, story.paragraphs, storyWordObjects(story), storyTTSBar);
    showStoryScreen(storyReadingScreen);
    storyReadingScreen.scrollTop = 0;
    storyBackBtn.focus();
  }

  function openStoryOverlay() {
    renderStoryLibrary();
    showStoryScreen(storyLibraryScreen);
    storyOverlay.classList.remove('hidden');
    storyOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    storyCloseBtn.focus();
  }

  function closeStoryOverlay() {
    ttsStop();
    hideGloss();
    storyOverlay.classList.add('hidden');
    storyOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentStory = null;
    storyLaunchBtn.focus();
  }

  // Re-show the story reading view after a story quiz closes.
  function reopenStoryReading() {
    if (!currentStory) { closeStoryOverlay(); return; }
    storyOverlay.classList.remove('hidden');
    storyOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showStoryScreen(storyReadingScreen);
    storyQuizBtn.focus();
  }

  function recordStoryResult(story, score, total) {
    var prog = storyProgress[story.id] || {};
    prog.read = true;
    if (typeof prog.bestScore !== 'number' || score > prog.bestScore) {
      prog.bestScore = score;
      prog.total = total;
    }
    storyProgress[story.id] = prog;
    saveStoryProgress();
    if (score === total) return 'Story complete — perfect score! 🎉';
    return 'Best for this story: ' + prog.bestScore + ' / ' + prog.total;
  }

  function initStoryMode() {
    loadStoryProgress();

    storyLaunchBtn.addEventListener('click', openStoryOverlay);
    storyCloseBtn.addEventListener('click', closeStoryOverlay);

    storyBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderStoryLibrary();
      showStoryScreen(storyLibraryScreen);
      storyCloseBtn.focus();
    });

    storyQuizBtn.addEventListener('click', function () {
      if (!currentStory) return;
      var words = storyWordObjects(currentStory);
      if (!words.length) return;
      var story = currentStory;
      ttsStop();
      hideGloss();
      storyOverlay.classList.add('hidden');
      storyOverlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(words, {
        returnTo: 'story',
        onComplete: function (score, total) {
          return recordStoryResult(story, score, total);
        }
      });
    });

    storyOverlay.addEventListener('click', function (e) {
      if (e.target === storyOverlay) closeStoryOverlay();
    });

    storyReadingScreen.addEventListener('scroll', hideGloss);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (storyOverlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeStoryOverlay();
    });

    storyTTSBar = initTTSBar(
      document.getElementById('story-tts-read-btn'),
      document.getElementById('story-tts-controls'),
      document.getElementById('story-tts-playpause'),
      document.getElementById('story-tts-stop'),
      document.querySelectorAll('#story-tts-controls .tts-speed-btn'),
      document.getElementById('story-tts-voice'),
      document.querySelectorAll('#story-tts-controls .tts-pitch-btn')
    );

    fetch('data/stories.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        stories = (data && data.stories) || [];
        if (!storyOverlay.classList.contains('hidden') &&
            !storyLibraryScreen.classList.contains('hidden')) {
          renderStoryLibrary();
        }
      })
      .catch(function () { stories = []; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HISTORY MODE
  // A timeline of hand-written history articles — from the Big Bang to today —
  // each featuring vocabulary words in context, followed by a quiz.
  // ═══════════════════════════════════════════════════════════════════════════

  var HISTORY_PROGRESS_KEY = 'vocabVault_historyProgress';
  var historyArticles = [];
  var historyProgress = {};
  var currentArticle = null;
  var historyTTSBar = null;

  var historyLaunchBtn      = document.getElementById('history-launch-btn');
  var historyOverlay        = document.getElementById('history-overlay');
  var historyLibraryScreen  = document.getElementById('history-library-screen');
  var historyReadingScreen  = document.getElementById('history-reading-screen');
  var historyCloseBtn       = document.getElementById('history-close-btn');
  var historyBackBtn        = document.getElementById('history-back-btn');
  var historyList           = document.getElementById('history-list');
  var historyReadingEmoji   = document.getElementById('history-reading-emoji');
  var historyReadingEra     = document.getElementById('history-reading-era');
  var historyReadingTitle   = document.getElementById('history-reading-title');
  var historyReadingBody    = document.getElementById('history-reading-body');
  var historyQuizBtn        = document.getElementById('history-quiz-btn');

  function loadHistoryProgress() {
    try {
      var raw = localStorage.getItem(HISTORY_PROGRESS_KEY);
      historyProgress = raw ? JSON.parse(raw) : {};
    } catch (e) {
      historyProgress = {};
    }
  }

  function saveHistoryProgress() {
    try { localStorage.setItem(HISTORY_PROGRESS_KEY, JSON.stringify(historyProgress)); } catch (e) {}
  }

  function articleWordObjects(article) {
    var out = [];
    (article.words || []).forEach(function (name) {
      var w = findWordByName(name);
      if (w) out.push(w);
    });
    return out;
  }

  function renderHistoryLibrary() {
    historyList.innerHTML = '';
    if (!historyArticles.length) {
      var empty = document.createElement('p');
      empty.className = 'story-card-blurb';
      empty.textContent = 'History articles are still loading — try again in a moment.';
      historyList.appendChild(empty);
      return;
    }
    historyArticles.forEach(function (article) {
      var card = document.createElement('button');
      card.className = 'story-card';
      card.type = 'button';

      var title = document.createElement('span');
      title.className = 'story-card-title';
      title.textContent = article.emoji + ' ' + article.title;

      var era = document.createElement('span');
      era.className = 'history-card-era';
      era.textContent = article.era;

      var blurb = document.createElement('span');
      blurb.className = 'story-card-blurb';
      blurb.textContent = article.blurb;

      var meta = document.createElement('span');
      meta.className = 'story-card-meta';
      meta.appendChild(era);

      var wordsTag = document.createElement('span');
      wordsTag.className = 'story-card-tag';
      wordsTag.textContent = articleWordObjects(article).length + ' words';
      meta.appendChild(wordsTag);

      var prog = historyProgress[article.id];
      if (prog && typeof prog.bestScore === 'number') {
        var scoreTag = document.createElement('span');
        scoreTag.className = 'story-card-tag story-card-score';
        scoreTag.textContent = 'Best ' + prog.bestScore + '/' + prog.total;
        meta.appendChild(scoreTag);
      } else if (prog && prog.read) {
        var readTag = document.createElement('span');
        readTag.className = 'story-card-tag story-card-score';
        readTag.textContent = '✓ Read';
        meta.appendChild(readTag);
      }

      card.appendChild(title);
      card.appendChild(blurb);
      card.appendChild(meta);
      card.addEventListener('click', function () { openArticle(article); });
      historyList.appendChild(card);
    });
  }

  function showHistoryScreen(screenEl) {
    [historyLibraryScreen, historyReadingScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openArticle(article) {
    currentArticle = article;
    var prog = historyProgress[article.id] || {};
    prog.read = true;
    historyProgress[article.id] = prog;
    saveHistoryProgress();

    historyReadingEmoji.textContent = article.emoji;
    historyReadingEra.textContent = article.era;
    historyReadingTitle.textContent = article.title;
    renderReadingBody(historyReadingBody, article.paragraphs, articleWordObjects(article), historyTTSBar);
    showHistoryScreen(historyReadingScreen);
    historyReadingScreen.scrollTop = 0;
    historyBackBtn.focus();
  }

  function openHistoryOverlay() {
    renderHistoryLibrary();
    showHistoryScreen(historyLibraryScreen);
    historyOverlay.classList.remove('hidden');
    historyOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    historyCloseBtn.focus();
  }

  function closeHistoryOverlay() {
    ttsStop();
    hideGloss();
    historyOverlay.classList.add('hidden');
    historyOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentArticle = null;
    historyLaunchBtn.focus();
  }

  function reopenHistoryReading() {
    if (!currentArticle) { closeHistoryOverlay(); return; }
    historyOverlay.classList.remove('hidden');
    historyOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showHistoryScreen(historyReadingScreen);
    historyQuizBtn.focus();
  }

  function recordArticleResult(article, score, total) {
    var prog = historyProgress[article.id] || {};
    prog.read = true;
    if (typeof prog.bestScore !== 'number' || score > prog.bestScore) {
      prog.bestScore = score;
      prog.total = total;
    }
    historyProgress[article.id] = prog;
    saveHistoryProgress();
    if (score === total) return 'Article complete — perfect score! 🎉';
    return 'Best for this article: ' + prog.bestScore + ' / ' + prog.total;
  }

  function initHistoryMode() {
    loadHistoryProgress();

    historyLaunchBtn.addEventListener('click', openHistoryOverlay);
    historyCloseBtn.addEventListener('click', closeHistoryOverlay);

    historyBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderHistoryLibrary();
      showHistoryScreen(historyLibraryScreen);
      historyCloseBtn.focus();
    });

    historyQuizBtn.addEventListener('click', function () {
      if (!currentArticle) return;
      var words = articleWordObjects(currentArticle);
      if (!words.length) return;
      var article = currentArticle;
      ttsStop();
      hideGloss();
      historyOverlay.classList.add('hidden');
      historyOverlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(words, {
        returnTo: 'history',
        onComplete: function (score, total) {
          return recordArticleResult(article, score, total);
        }
      });
    });

    historyOverlay.addEventListener('click', function (e) {
      if (e.target === historyOverlay) closeHistoryOverlay();
    });

    historyReadingScreen.addEventListener('scroll', hideGloss);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (historyOverlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeHistoryOverlay();
    });

    historyTTSBar = initTTSBar(
      document.getElementById('history-tts-read-btn'),
      document.getElementById('history-tts-controls'),
      document.getElementById('history-tts-playpause'),
      document.getElementById('history-tts-stop'),
      document.querySelectorAll('#history-tts-controls .tts-speed-btn'),
      document.getElementById('history-tts-voice'),
      document.querySelectorAll('#history-tts-controls .tts-pitch-btn')
    );

    fetch('data/history.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        historyArticles = (data && data.articles) || [];
        if (!historyOverlay.classList.contains('hidden') &&
            !historyLibraryScreen.classList.contains('hidden')) {
          renderHistoryLibrary();
        }
      })
      .catch(function () { historyArticles = []; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DAILY NEWS MODE
  // The app picks a daily word set, builds a prompt the parent runs in an AI
  // chat, then highlights the pasted-back news and quizzes on the same words.
  // ═══════════════════════════════════════════════════════════════════════════

  var NEWS_KEY = 'vocabVault_dailyNews';
  var newsData = { wordCount: 10, streak: 0, lastCompletedDate: null, edition: null };
  var newsWords = [];
  var newsTTSBar = null;

  var newsLaunchBtn      = document.getElementById('news-launch-btn');
  var newsOverlay        = document.getElementById('news-overlay');
  var newsGenerateScreen = document.getElementById('news-generate-screen');
  var newsReadingScreen  = document.getElementById('news-reading-screen');
  var newsCloseBtn       = document.getElementById('news-close-btn');
  var newsEditBtn        = document.getElementById('news-edit-btn');
  var newsDateLabel      = document.getElementById('news-date-label');
  var newsStreakEl       = document.getElementById('news-streak');
  var newsCountBtns      = document.querySelectorAll('[data-news-count]');
  var newsWordChips      = document.getElementById('news-word-chips');
  var newsPromptEl       = document.getElementById('news-prompt');
  var newsCopyBtn        = document.getElementById('news-copy-btn');
  var newsPasteEl        = document.getElementById('news-paste');
  var newsShowBtn        = document.getElementById('news-show-btn');
  var newsReadingBody    = document.getElementById('news-reading-body');
  var newsQuizBtn        = document.getElementById('news-quiz-btn');

  function dayKey(date) {
    return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate();
  }

  function todayKey() {
    return dayKey(new Date());
  }

  function yesterdayKey() {
    var d = new Date();
    d.setDate(d.getDate() - 1);
    return dayKey(d);
  }

  // The stored streak is only "live" when the last completed day was today or
  // yesterday; once a day is missed the run has lapsed and reads as zero.
  function effectiveStreak() {
    if (newsData.streak > 0 &&
        (newsData.lastCompletedDate === todayKey() ||
         newsData.lastCompletedDate === yesterdayKey())) {
      return newsData.streak;
    }
    return 0;
  }

  function loadNewsData() {
    try {
      var raw = localStorage.getItem(NEWS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          newsData.wordCount = parsed.wordCount || 10;
          newsData.streak = parsed.streak || 0;
          newsData.lastCompletedDate = parsed.lastCompletedDate || null;
          newsData.edition = parsed.edition || null;
        }
      }
    } catch (e) {}
    if ([10, 15, 20].indexOf(newsData.wordCount) === -1) newsData.wordCount = 10;
  }

  function saveNewsData() {
    try { localStorage.setItem(NEWS_KEY, JSON.stringify(newsData)); } catch (e) {}
  }

  // Stable 32-bit string hash; seeds the daily word picker so the chosen set
  // is deterministic for a given calendar day.
  function hashString(str) {
    var h = 0;
    for (var i = 0; i < str.length; i++) {
      h = ((h << 5) - h + str.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
  }

  // Deterministic 0..1 generator (LCG) so the daily word set is stable within
  // a calendar day but rotates from one day to the next.
  function seededRandom(seed) {
    var s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function pickDailyWords(n) {
    var rng = seededRandom(hashString(todayKey()));
    var tier = { 'new': 3, learning: 2, mastered: 1 };
    var scored = allWords.map(function (w) {
      return { word: w, score: (tier[getMasteryStatus(w.word)] || 1) + rng() };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, Math.min(n, scored.length)).map(function (x) { return x.word; });
  }

  // Returns today's word objects, caching the chosen set in the edition so the
  // selection does not shift as mastery changes during the day.
  function resolveDailyWords() {
    var ed = newsData.edition;
    if (ed && ed.date === todayKey() && ed.wordCount === newsData.wordCount &&
        ed.words && ed.words.length) {
      var objs = [];
      ed.words.forEach(function (name) {
        var w = findWordByName(name);
        if (w) objs.push(w);
      });
      if (objs.length) return objs;
    }
    var picked = pickDailyWords(newsData.wordCount);
    newsData.edition = {
      date: todayKey(),
      wordCount: newsData.wordCount,
      words: picked.map(function (w) { return w.word; }),
      text: (ed && ed.date === todayKey()) ? (ed.text || '') : ''
    };
    saveNewsData();
    return picked;
  }

  function buildNewsPrompt(words) {
    var list = words.map(function (w) { return w.word; }).join(', ');
    var today = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
    });
    return 'You are helping a UK 10 to 11 year old child who is preparing for the 11+ exam to build their vocabulary.\n\n' +
      'Today is ' + today + '. Please write them a "Daily News" roundup of what is genuinely happening ' +
      'in the news right now. Start from the real top stories that adults are reading and talking about this ' +
      'week — the main front-page headlines — based on stories from the past few days. ' +
      'If you can search the web, do so, so the stories are accurate and up to date. Do not invent news.\n\n' +
      'Your job is to take those big grown-up news stories and rewrite them for children in the style of ' +
      'BBC Newsround (https://www.bbc.co.uk/newsround), the children\'s news programme. That means:\n' +
      '- Cover the genuine top stories of the week, including important serious ones such as world events, ' +
      'politics, conflicts, the economy or nature, not only light topics. The goal is to keep the child genuinely ' +
      'informed about what is happening in the real world.\n' +
      '- For each big story, explain not just what happened but why it matters and how it can affect ' +
      'everyday life in the UK — for example, how tensions between countries can change the price of petrol, ' +
      'food or energy that families pay at home.\n' +
      '- Explain serious stories calmly, clearly and sensitively, with reassurance, so they are never frightening or upsetting.\n' +
      '- Balance the serious stories with at least one lighter, positive one: science, space, sport, animals, the environment or an amazing achievement.\n' +
      '- Assume the child knows little background, so explain who, what and where simply, including any countries or people mentioned.\n\n' +
      'Write 3 or 4 short news snippets, about 300 to 450 words in total, each with a clear, punchy headline.\n\n' +
      'The roundup must naturally include EVERY one of these vocabulary words, each used at least once, ' +
      'in a way that makes the meaning easy to guess from the sentence:\n' + list + '\n\n' +
      'Rules:\n' +
      '- Use British English spelling.\n' +
      '- Keep the tone calm, kind, clear and age-appropriate, just like Newsround.\n' +
      '- Use each vocabulary word in clear context so its meaning is obvious.\n' +
      '- Put each vocabulary word in bold the first time it appears.\n\n' +
      'Give me just the news text, with a short headline for each snippet.';
  }

  function updateNewsShowBtn() {
    newsShowBtn.disabled = newsPasteEl.value.trim().length === 0;
  }

  function renderNewsGenerateScreen() {
    var now = new Date();
    newsDateLabel.textContent = now.toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
    var streak = effectiveStreak();
    newsStreakEl.textContent = streak > 0
      ? '🔥 ' + streak + '-day streak'
      : 'Finish today\'s news quiz to start a streak!';

    forEachNode(newsCountBtns, function (b) {
      var active = parseInt(b.dataset.newsCount, 10) === newsData.wordCount;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', active ? 'true' : 'false');
    });

    newsWords = resolveDailyWords();

    newsWordChips.innerHTML = '';
    newsWords.forEach(function (w) {
      var chip = document.createElement('span');
      chip.className = 'news-chip';
      chip.textContent = w.word;
      newsWordChips.appendChild(chip);
    });

    newsPromptEl.value = buildNewsPrompt(newsWords);

    var ed = newsData.edition;
    newsPasteEl.value = (ed && ed.date === todayKey() && ed.text) ? ed.text : '';
    updateNewsShowBtn();
  }

  function stripMarkdown(text) {
    return text
      .replace(/^\s*#+\s*/, '')
      .replace(/(\*\*|__|\*|`)/g, '');
  }

  function renderNewsReading() {
    var text = (newsData.edition && newsData.edition.text) || newsPasteEl.value || '';
    var paragraphs = text.split(/\n+/)
      .map(function (p) { return stripMarkdown(p).trim(); })
      .filter(function (p) { return p.length; });
    if (!paragraphs.length) paragraphs = [stripMarkdown(text)];
    renderReadingBody(newsReadingBody, paragraphs, newsWords, newsTTSBar);
  }

  function showNewsScreen(screenEl) {
    [newsGenerateScreen, newsReadingScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openNewsOverlay() {
    renderNewsGenerateScreen();
    showNewsScreen(newsGenerateScreen);
    newsOverlay.classList.remove('hidden');
    newsOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    newsCloseBtn.focus();
  }

  function closeNewsOverlay() {
    ttsStop();
    hideGloss();
    newsOverlay.classList.add('hidden');
    newsOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    newsLaunchBtn.focus();
  }

  // Re-show the news reading view after a news quiz closes.
  function reopenNewsReading() {
    newsOverlay.classList.remove('hidden');
    newsOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    renderNewsGenerateScreen();
    renderNewsReading();
    showNewsScreen(newsReadingScreen);
    newsQuizBtn.focus();
  }

  function recordNewsResult(score, total) {
    var today = todayKey();
    if (newsData.lastCompletedDate !== today) {
      newsData.streak = (newsData.lastCompletedDate === yesterdayKey())
        ? (newsData.streak || 0) + 1
        : 1;
      newsData.lastCompletedDate = today;
    }
    if (newsData.edition) newsData.edition.quizDone = true;
    saveNewsData();
    var streakMsg = '🔥 ' + newsData.streak + '-day streak!';
    if (score === total) return 'Perfect score! ' + streakMsg;
    return 'Daily news done — ' + streakMsg;
  }

  function initDailyNews() {
    loadNewsData();

    newsLaunchBtn.addEventListener('click', openNewsOverlay);
    newsCloseBtn.addEventListener('click', closeNewsOverlay);

    forEachNode(newsCountBtns, function (btn) {
      btn.addEventListener('click', function () {
        var n = parseInt(this.dataset.newsCount, 10);
        if (newsData.wordCount === n) return;
        newsData.wordCount = n;
        saveNewsData();
        renderNewsGenerateScreen();
      });
    });

    newsCopyBtn.addEventListener('click', function () {
      var text = newsPromptEl.value;
      function showCopied() {
        newsCopyBtn.textContent = '✓ Copied!';
        newsCopyBtn.classList.add('copied');
        setTimeout(function () {
          newsCopyBtn.textContent = 'Copy prompt';
          newsCopyBtn.classList.remove('copied');
        }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(showCopied, function () {
          newsPromptEl.focus();
          newsPromptEl.select();
          showCopied();
        });
      } else {
        newsPromptEl.focus();
        newsPromptEl.select();
        try { document.execCommand('copy'); } catch (e) {}
        showCopied();
      }
    });

    newsPasteEl.addEventListener('input', updateNewsShowBtn);

    newsShowBtn.addEventListener('click', function () {
      if (newsPasteEl.value.trim().length === 0) return;
      if (!newsData.edition || newsData.edition.date !== todayKey()) {
        resolveDailyWords();
      }
      newsData.edition.text = newsPasteEl.value;
      newsData.edition.wordCount = newsData.wordCount;
      newsData.edition.words = newsWords.map(function (w) { return w.word; });
      saveNewsData();
      renderNewsReading();
      showNewsScreen(newsReadingScreen);
      newsReadingScreen.scrollTop = 0;
      newsEditBtn.focus();
    });

    newsEditBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderNewsGenerateScreen();
      showNewsScreen(newsGenerateScreen);
      newsCloseBtn.focus();
    });

    newsQuizBtn.addEventListener('click', function () {
      if (!newsWords.length) return;
      ttsStop();
      hideGloss();
      newsOverlay.classList.add('hidden');
      newsOverlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(newsWords, {
        returnTo: 'news',
        onComplete: function (score, total) {
          return recordNewsResult(score, total);
        }
      });
    });

    newsOverlay.addEventListener('click', function (e) {
      if (e.target === newsOverlay) closeNewsOverlay();
    });

    newsReadingScreen.addEventListener('scroll', hideGloss);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (newsOverlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeNewsOverlay();
    });

    newsTTSBar = initTTSBar(
      document.getElementById('news-tts-read-btn'),
      document.getElementById('news-tts-controls'),
      document.getElementById('news-tts-playpause'),
      document.getElementById('news-tts-stop'),
      document.querySelectorAll('#news-tts-controls .tts-speed-btn'),
      document.getElementById('news-tts-voice'),
      document.querySelectorAll('#news-tts-controls .tts-pitch-btn')
    );
  }

  // ── TTS voice/pitch init ──────────────────────────────────────────────────
  (function () {
    var savedPitch = parseFloat(localStorage.getItem(TTS_PITCH_KEY));
    if (!isNaN(savedPitch)) {
      ttsPitch = savedPitch;
      var savedStr = String(savedPitch);
      document.querySelectorAll('.tts-pitch-btn').forEach(function (b) {
        b.classList.toggle('tts-speed-active', b.dataset.pitch === savedStr);
      });
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.addEventListener('voiceschanged', loadVoices);
    }
  }());

})();
