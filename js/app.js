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

  function speakWordAndDefinition(wordObj) {
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      var utter = new SpeechSynthesisUtterance(wordObj.word + '. ' + wordObj.definition);
      utter.lang = 'en-GB';
      utter.rate = 0.85;
      utter.pitch = ttsPitch;
      if (ttsVoice) utter.voice = ttsVoice;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  function restoreModalText(wordObj) {
    if (!wordObj) return;
    modalTitle.textContent    = wordObj.word;
    modalDef.textContent      = wordObj.definition;
    modalSentence.textContent = wordObj.sentence_usage;
  }

  function speakModalWord(wordObj) {
    if (!('speechSynthesis' in window)) return;
    ttsStop();

    var word     = wordObj.word;
    var def      = wordObj.definition;
    var sent     = wordObj.sentence_usage;
    var fullText = word + '. ' + def + '. Example: ' + sent;

    function tokenise(el, text, charOffset, sentIdx) {
      el.innerHTML = '';
      var entries = [];
      var re = /([A-Za-z''][A-Za-z'']*)|([^A-Za-z'']+)/g;
      var m;
      while ((m = re.exec(text)) !== null) {
        var tok = m[0];
        if (m[1]) {
          var span = document.createElement('span');
          span.className = 'tts-word';
          span.textContent = tok;
          entries.push({ el: span, start: charOffset + m.index, end: charOffset + m.index + tok.length, sentenceIdx: sentIdx });
          el.appendChild(span);
        } else {
          el.appendChild(document.createTextNode(tok));
        }
      }
      return entries;
    }

    // Wrap the title word in a span so boundary events at charIndex=0 activate
    // the title rather than prematurely firing on the first definition word.
    var titleSpan = document.createElement('span');
    titleSpan.className = 'tts-word';
    titleSpan.textContent = word;
    modalTitle.innerHTML = '';
    modalTitle.appendChild(titleSpan);
    var titleEntry = { el: titleSpan, start: 0, end: word.length, sentenceIdx: -1 };

    var defSentEl  = document.createElement('span');
    defSentEl.className = 'tts-sentence';
    var sentSentEl = document.createElement('span');
    sentSentEl.className = 'tts-sentence';

    var defOffset  = word.length + 2;              // skip "word. "
    var sentOffset = defOffset + def.length + 11;  // skip ". Example: "

    var defWords  = tokenise(defSentEl,  def,  defOffset,  0);
    var sentWords = tokenise(sentSentEl, sent, sentOffset, 1);

    modalDef.innerHTML = '';
    modalDef.appendChild(defSentEl);
    modalSentence.innerHTML = '';
    modalSentence.appendChild(sentSentEl);

    ttsWordData = {
      fullText : fullText,
      words    : [titleEntry].concat(defWords).concat(sentWords),
      sentences: [defSentEl, sentSentEl],
      bar      : null,
      container: null,
      onDone   : function () { restoreModalText(wordObj); }
    };
    ttsActiveIdx      = -1;
    ttsActiveSentence = -1;
    ttsCurrentBar     = null;
    ttsStart();
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
      if (ttsWordData && ttsWordData.onDone) { var cb = ttsWordData.onDone; ttsWordData.onDone = null; cb(); }
    };
    utter.onerror = function () {
      if (utter !== ttsActiveUtter) return;
      ttsActiveUtter = null;
      ttsClearActive();
      ttsPlaying = false;
      if (ttsCurrentBar) ttsBarShowIdle(ttsCurrentBar);
      if (ttsWordData && ttsWordData.onDone) { var cb = ttsWordData.onDone; ttsWordData.onDone = null; cb(); }
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
      // vocab-highlight taps are handled by initGloss (stop TTS, speak word + definition)
      if (span.classList.contains('vocab-highlight')) return;
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
  var modalSpeakBtn    = document.getElementById('modal-speak-btn');
  var currentModalWord = null;
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
        initFableMode();
        initProverbsMode();
        initDailyNews();
        initComicMode();
        initQuiz();
        initDetectiveMode();
        initScrambleMode();
        initFlashBlitz();
        initSynonymSnap();
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
    currentModalWord = wordObj;
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
    restoreModalText(currentModalWord);
    currentModalWord = null;
    ttsStop();
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

    // Speak button — reads word, definition and example sentence with word highlighting
    if (modalSpeakBtn) {
      modalSpeakBtn.addEventListener('click', function () {
        if (currentModalWord) speakModalWord(currentModalWord);
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
    } else if (returnTo === 'fable') {
      reopenFableReading();
    } else if (returnTo === 'proverbs') {
      reopenProverbsReading();
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
        if (wObj) {
          ttsStop();
          speakWordAndDefinition(wObj);
          showGloss(span, wObj);
        }
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
      if (wObj) {
        ttsStop();
        speakWordAndDefinition(wObj);
        showGloss(span, wObj);
      }
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
  // FABLE MODE
  // A library of classic Aesop's fables — short stories with morals — that use
  // vocabulary words in context, followed by a quiz scoped to that fable.
  // ═══════════════════════════════════════════════════════════════════════════

  var FABLE_PROGRESS_KEY = 'vocabVault_fableProgress';
  var fables = [];
  var fableProgress = {};
  var currentFable = null;
  var fableTTSBar = null;

  var fableLaunchBtn     = document.getElementById('fable-launch-btn');
  var fableOverlay       = document.getElementById('fable-overlay');
  var fableLibraryScreen = document.getElementById('fable-library-screen');
  var fableReadingScreen = document.getElementById('fable-reading-screen');
  var fableCloseBtn      = document.getElementById('fable-close-btn');
  var fableBackBtn       = document.getElementById('fable-back-btn');
  var fableList          = document.getElementById('fable-list');
  var fableReadingEmoji  = document.getElementById('fable-reading-emoji');
  var fableReadingTitle  = document.getElementById('fable-reading-title');
  var fableReadingBody   = document.getElementById('fable-reading-body');
  var fableReadingMoral  = document.getElementById('fable-reading-moral');
  var fableQuizBtn       = document.getElementById('fable-quiz-btn');

  function loadFableProgress() {
    try {
      var raw = localStorage.getItem(FABLE_PROGRESS_KEY);
      fableProgress = raw ? JSON.parse(raw) : {};
    } catch (e) {
      fableProgress = {};
    }
  }

  function saveFableProgress() {
    try { localStorage.setItem(FABLE_PROGRESS_KEY, JSON.stringify(fableProgress)); } catch (e) {}
  }

  function fableWordObjects(fable) {
    var out = [];
    (fable.words || []).forEach(function (name) {
      var w = findWordByName(name);
      if (w) out.push(w);
    });
    return out;
  }

  function renderFableLibrary() {
    fableList.innerHTML = '';
    if (!fables.length) {
      var empty = document.createElement('p');
      empty.className = 'story-card-blurb';
      empty.textContent = 'Fables are still loading — try again in a moment.';
      fableList.appendChild(empty);
      return;
    }
    fables.forEach(function (fable) {
      var card = document.createElement('button');
      card.className = 'story-card';
      card.type = 'button';

      var title = document.createElement('span');
      title.className = 'story-card-title';
      title.textContent = fable.emoji + ' ' + fable.title;

      var blurb = document.createElement('span');
      blurb.className = 'story-card-blurb';
      blurb.textContent = fable.blurb;

      var meta = document.createElement('span');
      meta.className = 'story-card-meta';

      var wordsTag = document.createElement('span');
      wordsTag.className = 'story-card-tag';
      wordsTag.textContent = fableWordObjects(fable).length + ' words';
      meta.appendChild(wordsTag);

      var prog = fableProgress[fable.id];
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
      card.addEventListener('click', function () { openFable(fable); });
      fableList.appendChild(card);
    });
  }

  function showFableScreen(screenEl) {
    [fableLibraryScreen, fableReadingScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openFable(fable) {
    currentFable = fable;
    var prog = fableProgress[fable.id] || {};
    prog.read = true;
    fableProgress[fable.id] = prog;
    saveFableProgress();

    fableReadingEmoji.textContent = fable.emoji;
    fableReadingTitle.textContent = fable.title;
    renderReadingBody(fableReadingBody, fable.paragraphs, fableWordObjects(fable), fableTTSBar);
    if (fable.moral) {
      fableReadingMoral.textContent = 'Moral: ' + fable.moral;
      fableReadingMoral.classList.remove('hidden');
    } else {
      fableReadingMoral.textContent = '';
      fableReadingMoral.classList.add('hidden');
    }
    showFableScreen(fableReadingScreen);
    fableReadingScreen.scrollTop = 0;
    fableBackBtn.focus();
  }

  function openFableOverlay() {
    renderFableLibrary();
    showFableScreen(fableLibraryScreen);
    fableOverlay.classList.remove('hidden');
    fableOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    fableCloseBtn.focus();
  }

  function closeFableOverlay() {
    ttsStop();
    hideGloss();
    fableOverlay.classList.add('hidden');
    fableOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentFable = null;
    fableLaunchBtn.focus();
  }

  function reopenFableReading() {
    if (!currentFable) { closeFableOverlay(); return; }
    fableOverlay.classList.remove('hidden');
    fableOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showFableScreen(fableReadingScreen);
    fableQuizBtn.focus();
  }

  function recordFableResult(fable, score, total) {
    var prog = fableProgress[fable.id] || {};
    prog.read = true;
    if (typeof prog.bestScore !== 'number' || score > prog.bestScore) {
      prog.bestScore = score;
      prog.total = total;
    }
    fableProgress[fable.id] = prog;
    saveFableProgress();
    if (score === total) return 'Fable complete — perfect score! 🎉';
    return 'Best for this fable: ' + prog.bestScore + ' / ' + prog.total;
  }

  function initFableMode() {
    loadFableProgress();

    fableLaunchBtn.addEventListener('click', openFableOverlay);
    fableCloseBtn.addEventListener('click', closeFableOverlay);

    fableBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderFableLibrary();
      showFableScreen(fableLibraryScreen);
      fableCloseBtn.focus();
    });

    fableQuizBtn.addEventListener('click', function () {
      if (!currentFable) return;
      var words = fableWordObjects(currentFable);
      if (!words.length) return;
      var fable = currentFable;
      ttsStop();
      hideGloss();
      fableOverlay.classList.add('hidden');
      fableOverlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(words, {
        returnTo: 'fable',
        onComplete: function (score, total) {
          return recordFableResult(fable, score, total);
        }
      });
    });

    fableOverlay.addEventListener('click', function (e) {
      if (e.target === fableOverlay) closeFableOverlay();
    });

    fableReadingScreen.addEventListener('scroll', hideGloss);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (fableOverlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeFableOverlay();
    });

    fableTTSBar = initTTSBar(
      document.getElementById('fable-tts-read-btn'),
      document.getElementById('fable-tts-controls'),
      document.getElementById('fable-tts-playpause'),
      document.getElementById('fable-tts-stop'),
      document.querySelectorAll('#fable-tts-controls .tts-speed-btn'),
      document.getElementById('fable-tts-voice'),
      document.querySelectorAll('#fable-tts-controls .tts-pitch-btn')
    );

    fetch('data/fables.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        fables = (data && data.fables) || [];
        if (!fableOverlay.classList.contains('hidden') &&
            !fableLibraryScreen.classList.contains('hidden')) {
          renderFableLibrary();
        }
      })
      .catch(function () { fables = []; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PROVERBS MODE
  // A curated library of famous proverbs from Japanese, Chinese, Indian, Greek
  // and Roman cultures. Each collection groups 3-4 native-script proverbs and a
  // connecting English commentary that uses ~10 vocabulary words.
  // ═══════════════════════════════════════════════════════════════════════════

  var PROVERBS_PROGRESS_KEY = 'vocabVault_proverbsProgress';
  var proverbCollections = [];
  var proverbProgress = {};
  var currentCollection = null;
  var proverbsTTSBar = null;

  var proverbsLaunchBtn        = document.getElementById('proverbs-launch-btn');
  var proverbsOverlay          = document.getElementById('proverbs-overlay');
  var proverbsCultureScreen    = document.getElementById('proverbs-culture-screen');
  var proverbsCulturesList     = document.getElementById('proverbs-cultures');
  var proverbsLibraryScreen    = document.getElementById('proverbs-library-screen');
  var proverbsLibraryBackBtn   = document.getElementById('proverbs-library-back-btn');
  var proverbsLibraryEmoji     = document.getElementById('proverbs-library-emoji');
  var proverbsLibraryTitle     = document.getElementById('proverbs-library-title');
  var proverbsLibrarySubtitle  = document.getElementById('proverbs-library-subtitle');
  var proverbsReadingScreen    = document.getElementById('proverbs-reading-screen');
  var proverbsCloseBtn         = document.getElementById('proverbs-close-btn');
  var proverbsBackBtn          = document.getElementById('proverbs-back-btn');
  var proverbsList             = document.getElementById('proverbs-list');
  var proverbsReadingEmoji     = document.getElementById('proverbs-reading-emoji');
  var proverbsReadingCulture   = document.getElementById('proverbs-reading-culture');
  var proverbsReadingTitle     = document.getElementById('proverbs-reading-title');
  var proverbsListCards        = document.getElementById('proverbs-list-cards');
  var proverbsReadingBody      = document.getElementById('proverbs-reading-body');
  var proverbsQuizBtn          = document.getElementById('proverbs-quiz-btn');

  var PROVERBS_CULTURE_META = [
    { name: 'Japanese',           emoji: '🎋',   tagline: 'Resilience, impermanence and the quiet joy of craft.' },
    { name: 'Chinese',            emoji: '🐉',  tagline: 'Patience, harmony and the wisdom of the long view.' },
    { name: 'Indian',             emoji: '🪷',  tagline: 'Karma, dharma and the spiritual roots of action.' },
    { name: 'Greek',              emoji: '🏛️',  tagline: 'Know thyself — moderation, change and reason.' },
    { name: 'Roman',              emoji: '🦅',  tagline: 'Duty, deeds and the calm of the Stoics.' },
    { name: 'Western Philosophy', emoji: '🧠',  tagline: 'Descartes, Kant and Nietzsche on doubt and freedom.' },
    { name: 'Persian',            emoji: '🌹',  tagline: 'Rumi, Hafez and Saadi on light, longing and the present.' },
    { name: 'Jewish',             emoji: '✡️',  tagline: 'Hillel and the Talmud on action, life and repair.' },
    { name: 'Arabic',             emoji: '☪️',  tagline: 'Hadith, the Quran and Gibran on faith and learning.' },
    { name: 'Russian',            emoji: '🪆',  tagline: 'Patience, prudence and the Russian soul.' }
  ];
  var selectedCulture = null;

  function loadProverbsProgress() {
    try {
      var raw = localStorage.getItem(PROVERBS_PROGRESS_KEY);
      proverbProgress = raw ? JSON.parse(raw) : {};
    } catch (e) {
      proverbProgress = {};
    }
  }

  function saveProverbsProgress() {
    try { localStorage.setItem(PROVERBS_PROGRESS_KEY, JSON.stringify(proverbProgress)); } catch (e) {}
  }

  function collectionWordObjects(collection) {
    var out = [];
    (collection.words || []).forEach(function (name) {
      var w = findWordByName(name);
      if (w) out.push(w);
    });
    return out;
  }

  function cultureCollections(cultureName) {
    return proverbCollections.filter(function (c) { return c.culture === cultureName; });
  }

  function cultureProgressSummary(cultureName) {
    var cols = cultureCollections(cultureName);
    var read = 0;
    cols.forEach(function (c) {
      var p = proverbProgress[c.id];
      if (p && p.read) read++;
    });
    return { read: read, total: cols.length };
  }

  function renderCulturePicker() {
    proverbsCulturesList.innerHTML = '';
    if (!proverbCollections.length) {
      var empty = document.createElement('p');
      empty.className = 'story-card-blurb';
      empty.textContent = 'Proverbs are still loading — try again in a moment.';
      proverbsCulturesList.appendChild(empty);
      return;
    }
    PROVERBS_CULTURE_META.forEach(function (meta) {
      var cols = cultureCollections(meta.name);
      if (!cols.length) return;

      var card = document.createElement('button');
      card.className = 'story-card';
      card.type = 'button';

      var title = document.createElement('span');
      title.className = 'story-card-title';
      title.textContent = meta.emoji + ' ' + meta.name;

      var blurb = document.createElement('span');
      blurb.className = 'story-card-blurb';
      blurb.textContent = meta.tagline;

      var metaEl = document.createElement('span');
      metaEl.className = 'story-card-meta';

      var countTag = document.createElement('span');
      countTag.className = 'story-card-tag';
      countTag.textContent = cols.length + ' collections';
      metaEl.appendChild(countTag);

      var prog = cultureProgressSummary(meta.name);
      if (prog.read) {
        var readTag = document.createElement('span');
        readTag.className = 'story-card-tag story-card-score';
        readTag.textContent = '✓ ' + prog.read + '/' + prog.total + ' read';
        metaEl.appendChild(readTag);
      }

      card.appendChild(title);
      card.appendChild(blurb);
      card.appendChild(metaEl);
      card.addEventListener('click', function () { openCultureLibrary(meta); });
      proverbsCulturesList.appendChild(card);
    });
  }

  function openCultureLibrary(meta) {
    selectedCulture = meta;
    proverbsLibraryEmoji.textContent = meta.emoji;
    proverbsLibraryTitle.textContent = meta.name;
    proverbsLibrarySubtitle.textContent = meta.tagline;
    renderProverbsLibrary();
    showProverbsScreen(proverbsLibraryScreen);
    proverbsLibraryScreen.scrollTop = 0;
    proverbsLibraryBackBtn.focus();
  }

  function renderProverbsLibrary() {
    proverbsList.innerHTML = '';
    var pool = selectedCulture ? cultureCollections(selectedCulture.name) : proverbCollections;
    if (!pool.length) {
      var empty = document.createElement('p');
      empty.className = 'story-card-blurb';
      empty.textContent = 'Proverbs are still loading — try again in a moment.';
      proverbsList.appendChild(empty);
      return;
    }
    pool.forEach(function (collection) {
      var card = document.createElement('button');
      card.className = 'story-card';
      card.type = 'button';

      var title = document.createElement('span');
      title.className = 'story-card-title';
      title.textContent = collection.emoji + ' ' + collection.title;

      var blurb = document.createElement('span');
      blurb.className = 'story-card-blurb';
      blurb.textContent = collection.blurb;

      var meta = document.createElement('span');
      meta.className = 'story-card-meta';

      var wordsTag = document.createElement('span');
      wordsTag.className = 'story-card-tag';
      wordsTag.textContent = collectionWordObjects(collection).length + ' words';
      meta.appendChild(wordsTag);

      var prog = proverbProgress[collection.id];
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
      card.addEventListener('click', function () { openCollection(collection); });
      proverbsList.appendChild(card);
    });
  }

  function renderProverbCards(containerEl, proverbs) {
    containerEl.innerHTML = '';
    if (!proverbs || !proverbs.length) return;
    proverbs.forEach(function (p) {
      var card = document.createElement('div');
      card.className = 'proverb-card';

      var native = document.createElement('p');
      native.className = 'proverb-native';
      if (p.lang) native.setAttribute('lang', p.lang);
      native.textContent = p.native || '';

      var roman = document.createElement('p');
      roman.className = 'proverb-romanisation';
      roman.textContent = p.romanisation || '';

      var trans = document.createElement('p');
      trans.className = 'proverb-translation';
      trans.textContent = p.translation || '';

      var meaning = document.createElement('p');
      meaning.className = 'proverb-meaning';
      meaning.textContent = p.meaning || '';

      card.appendChild(native);
      if (p.romanisation) card.appendChild(roman);
      if (p.translation) card.appendChild(trans);
      if (p.meaning) card.appendChild(meaning);
      containerEl.appendChild(card);
    });
  }

  function showProverbsScreen(screenEl) {
    [proverbsCultureScreen, proverbsLibraryScreen, proverbsReadingScreen].forEach(function (s) {
      s.classList.add('hidden');
    });
    screenEl.classList.remove('hidden');
  }

  function openCollection(collection) {
    currentCollection = collection;
    var prog = proverbProgress[collection.id] || {};
    prog.read = true;
    proverbProgress[collection.id] = prog;
    saveProverbsProgress();

    proverbsReadingEmoji.textContent = collection.emoji;
    proverbsReadingCulture.textContent = collection.culture;
    proverbsReadingTitle.textContent = collection.title;
    renderProverbCards(proverbsListCards, collection.proverbs);
    renderReadingBody(proverbsReadingBody, collection.paragraphs, collectionWordObjects(collection), proverbsTTSBar);
    showProverbsScreen(proverbsReadingScreen);
    proverbsReadingScreen.scrollTop = 0;
    proverbsBackBtn.focus();
  }

  function openProverbsOverlay() {
    selectedCulture = null;
    renderCulturePicker();
    showProverbsScreen(proverbsCultureScreen);
    proverbsOverlay.classList.remove('hidden');
    proverbsOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    proverbsCloseBtn.focus();
  }

  function closeProverbsOverlay() {
    ttsStop();
    hideGloss();
    proverbsOverlay.classList.add('hidden');
    proverbsOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentCollection = null;
    proverbsLaunchBtn.focus();
  }

  function reopenProverbsReading() {
    if (!currentCollection) { closeProverbsOverlay(); return; }
    proverbsOverlay.classList.remove('hidden');
    proverbsOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    showProverbsScreen(proverbsReadingScreen);
    proverbsQuizBtn.focus();
  }

  function recordCollectionResult(collection, score, total) {
    var prog = proverbProgress[collection.id] || {};
    prog.read = true;
    if (typeof prog.bestScore !== 'number' || score > prog.bestScore) {
      prog.bestScore = score;
      prog.total = total;
    }
    proverbProgress[collection.id] = prog;
    saveProverbsProgress();
    if (score === total) return 'Collection complete — perfect score! 🎉';
    return 'Best for this collection: ' + prog.bestScore + ' / ' + prog.total;
  }

  function initProverbsMode() {
    loadProverbsProgress();

    proverbsLaunchBtn.addEventListener('click', openProverbsOverlay);
    proverbsCloseBtn.addEventListener('click', closeProverbsOverlay);

    proverbsBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderProverbsLibrary();
      showProverbsScreen(proverbsLibraryScreen);
      proverbsLibraryBackBtn.focus();
    });

    proverbsLibraryBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      selectedCulture = null;
      renderCulturePicker();
      showProverbsScreen(proverbsCultureScreen);
      proverbsCloseBtn.focus();
    });

    proverbsQuizBtn.addEventListener('click', function () {
      if (!currentCollection) return;
      var words = collectionWordObjects(currentCollection);
      if (!words.length) return;
      var collection = currentCollection;
      ttsStop();
      hideGloss();
      proverbsOverlay.classList.add('hidden');
      proverbsOverlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(words, {
        returnTo: 'proverbs',
        onComplete: function (score, total) {
          return recordCollectionResult(collection, score, total);
        }
      });
    });

    proverbsOverlay.addEventListener('click', function (e) {
      if (e.target === proverbsOverlay) closeProverbsOverlay();
    });

    proverbsReadingScreen.addEventListener('scroll', hideGloss);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (proverbsOverlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeProverbsOverlay();
    });

    proverbsTTSBar = initTTSBar(
      document.getElementById('proverbs-tts-read-btn'),
      document.getElementById('proverbs-tts-controls'),
      document.getElementById('proverbs-tts-playpause'),
      document.getElementById('proverbs-tts-stop'),
      document.querySelectorAll('#proverbs-tts-controls .tts-speed-btn'),
      document.getElementById('proverbs-tts-voice'),
      document.querySelectorAll('#proverbs-tts-controls .tts-pitch-btn')
    );

    fetch('data/proverbs.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        proverbCollections = (data && data.collections) || [];
        if (proverbsOverlay.classList.contains('hidden')) return;
        if (!proverbsCultureScreen.classList.contains('hidden')) {
          renderCulturePicker();
        } else if (!proverbsLibraryScreen.classList.contains('hidden')) {
          renderProverbsLibrary();
        }
      })
      .catch(function () { proverbCollections = []; });
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

  // ── Word Detective Mode ──────────────────────────────────────────────────────

  var DETECTIVE_BESTS_KEY = 'vocabVault_detectiveBests';
  var DETECTIVE_POINTS    = [500, 400, 300, 200, 100];

  var detectiveState = {
    words         : [],
    index         : 0,
    score         : 0,
    clueStep      : 0,
    answered      : false,
    choices       : [],
    correctChoice : null,
    sessionLength : 5,
    bests         : {}
  };

  function initDetectiveMode() {
    try { detectiveState.bests = JSON.parse(localStorage.getItem(DETECTIVE_BESTS_KEY) || '{}'); } catch (e) { detectiveState.bests = {}; }

    document.getElementById('detective-launch-btn').addEventListener('click', openDetective);
    document.getElementById('detective-close').addEventListener('click', closeDetective);
    document.getElementById('detective-start-btn').addEventListener('click', startDetectiveGame);
    document.getElementById('detective-exit-btn').addEventListener('click', function () { showDetectiveScreen('setup'); });
    document.getElementById('detective-play-again-btn').addEventListener('click', function () { showDetectiveScreen('setup'); });
    document.getElementById('detective-done-btn').addEventListener('click', closeDetective);

    document.querySelectorAll('[data-detective-length]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-detective-length]').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        detectiveState.sessionLength = parseInt(btn.dataset.detectiveLength, 10);
        updateDetectiveBestDisplay();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('detective-overlay');
        if (overlay && !overlay.classList.contains('hidden')) closeDetective();
      }
    });
  }

  function openDetective() {
    var overlay = document.getElementById('detective-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    showDetectiveScreen('setup');
    updateDetectiveBestDisplay();
  }

  function closeDetective() {
    var overlay = document.getElementById('detective-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showDetectiveScreen(name) {
    var map = { setup: 'detective-setup', game: 'detective-game-screen', end: 'detective-end-screen' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function updateDetectiveBestDisplay() {
    var el = document.getElementById('detective-personal-best');
    var best = detectiveState.bests[detectiveState.sessionLength];
    if (best) {
      el.textContent = 'Personal best (' + detectiveState.sessionLength + ' cases): ' + best + ' pts';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function startDetectiveGame() {
    var eligible = allWords.filter(function (w) {
      return w.synonyms && w.synonyms.length && w.antonyms && w.antonyms.length;
    });
    detectiveState.words = shuffle(eligible).slice(0, detectiveState.sessionLength);
    detectiveState.index = 0;
    detectiveState.score = 0;
    showDetectiveScreen('game');
    showDetectiveQuestion();
  }

  function getDetectiveClues(wordObj) {
    var blanks = wordObj.word.replace(/./g, '_ ').trim();
    return [
      { label: 'Word type',    value: wordObj.word_type },
      { label: 'Letter count', value: wordObj.word.length + ' letters: ' + blanks },
      { label: 'A synonym is', value: wordObj.synonyms[0] },
      { label: 'An antonym is', value: wordObj.antonyms[0] },
      { label: 'Definition',   value: wordObj.definition }
    ];
  }

  function showDetectiveQuestion() {
    var wordObj = detectiveState.words[detectiveState.index];
    detectiveState.clueStep = 0;
    detectiveState.answered = false;

    var caseEl = document.getElementById('detective-case-label');
    caseEl.textContent = 'Case ' + (detectiveState.index + 1) + ' of ' + detectiveState.sessionLength;
    document.getElementById('detective-score-display').textContent = 'Score: ' + detectiveState.score;

    var stack = document.getElementById('detective-clue-stack');
    stack.innerHTML = '';
    var clues = getDetectiveClues(wordObj);
    clues.forEach(function (clue, i) {
      var card = document.createElement('div');
      card.className = 'detective-clue-card detective-clue-hidden';
      var numSpan = document.createElement('span');
      numSpan.className = 'detective-clue-number';
      numSpan.textContent = 'Clue ' + (i + 1);
      var labelSpan = document.createElement('span');
      labelSpan.className = 'detective-clue-label';
      labelSpan.textContent = clue.label + ':';
      var valSpan = document.createElement('span');
      valSpan.className = 'detective-clue-value';
      valSpan.textContent = clue.value;
      card.appendChild(numSpan);
      card.appendChild(labelSpan);
      card.appendChild(valSpan);
      stack.appendChild(card);
    });

    var distractors = pickDistractors(wordObj, allWords, 3);
    detectiveState.choices = shuffle([wordObj].concat(distractors));
    detectiveState.correctChoice = wordObj;

    document.getElementById('detective-choices').innerHTML = '';
    document.getElementById('detective-choices-hint').textContent = '';
    document.getElementById('detective-feedback').textContent = '';
    document.getElementById('detective-feedback').className = 'quiz-feedback';

    setTimeout(revealDetectiveClue, 200);
  }

  function revealDetectiveClue() {
    if (detectiveState.answered) return;
    var cards = document.querySelectorAll('#detective-clue-stack .detective-clue-card');
    var step = detectiveState.clueStep;
    if (step < cards.length) {
      cards[step].classList.remove('detective-clue-hidden');
      cards[step].classList.add('detective-clue-revealed');
      detectiveState.clueStep++;
    }
    var pts = DETECTIVE_POINTS[detectiveState.clueStep - 1] || 100;
    document.getElementById('detective-choices-hint').textContent =
      'Guess now for ' + pts + ' points — or wait for the next clue!';
    renderDetectiveChoices();
  }

  function renderDetectiveChoices() {
    var grid = document.getElementById('detective-choices');
    grid.innerHTML = '';
    detectiveState.choices.forEach(function (wordObj, i) {
      var btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.textContent = wordObj.word;
      btn.addEventListener('click', function () { detectiveGuess(i); });
      grid.appendChild(btn);
    });

    if (detectiveState.clueStep < 5) {
      var revealBtn = document.createElement('button');
      revealBtn.className = 'quiz-exit-btn';
      revealBtn.style.cssText = 'display:block;width:100%;margin-top:0.5rem;text-align:center;';
      revealBtn.textContent = 'Show next clue ↓';
      revealBtn.addEventListener('click', function () {
        revealBtn.remove();
        revealDetectiveClue();
      });
      grid.appendChild(revealBtn);
    }
  }

  function detectiveGuess(choiceIndex) {
    if (detectiveState.answered) return;
    detectiveState.answered = true;

    var correct = detectiveState.choices[choiceIndex] === detectiveState.correctChoice;
    var pts = correct ? (DETECTIVE_POINTS[detectiveState.clueStep - 1] || 100) : 0;

    var buttons = document.querySelectorAll('#detective-choices .quiz-answer-btn');
    buttons.forEach(function (btn, i) {
      btn.disabled = true;
      if (detectiveState.choices[i] === detectiveState.correctChoice) btn.classList.add('correct');
      else if (i === choiceIndex && !correct) btn.classList.add('wrong');
    });

    var allCards = document.querySelectorAll('#detective-clue-stack .detective-clue-card');
    allCards.forEach(function (card) {
      card.classList.remove('detective-clue-hidden');
      card.classList.add('detective-clue-revealed');
    });

    document.getElementById('detective-choices-hint').textContent = '';
    var fb = document.getElementById('detective-feedback');
    if (correct) {
      detectiveState.score += pts;
      document.getElementById('detective-score-display').textContent = 'Score: ' + detectiveState.score;
      fb.textContent = pts === 500 ? '⭐ First clue — genius! +500 pts'
        : '✓ Correct! +' + pts + ' points';
      fb.className = 'quiz-feedback visible feedback-correct';
    } else {
      fb.textContent = '✗ It was "' + detectiveState.correctChoice.word + '" — keep going!';
      fb.className = 'quiz-feedback visible feedback-wrong';
    }

    setTimeout(function () {
      detectiveState.index++;
      if (detectiveState.index >= detectiveState.sessionLength) {
        showDetectiveEnd();
      } else {
        showDetectiveQuestion();
      }
    }, 2200);
  }

  function showDetectiveEnd() {
    showDetectiveScreen('end');
    var score = detectiveState.score;
    var len   = detectiveState.sessionLength;
    var best  = detectiveState.bests[len] || 0;
    var isNew = score > best;
    if (isNew) {
      detectiveState.bests[len] = score;
      try { localStorage.setItem(DETECTIVE_BESTS_KEY, JSON.stringify(detectiveState.bests)); } catch (e) {}
    }
    var maxPts = len * 500;
    var pct = score / maxPts;
    document.getElementById('detective-end-emoji').textContent  = pct >= 0.8 ? '🏆' : pct >= 0.5 ? '🔍' : '🕵️';
    document.getElementById('detective-end-title').textContent  = pct >= 0.8 ? 'Master Detective!' : pct >= 0.5 ? 'Sharp Investigator!' : 'Keep Sleuthing!';
    document.getElementById('detective-end-score').textContent  = score + ' pts out of ' + maxPts + ' possible';
    document.getElementById('detective-end-best').textContent   = isNew ? '⭐ New personal best!' : 'Personal best: ' + best + ' pts';
  }

  // ── Scramble Mode ────────────────────────────────────────────────────────────

  var SCRAMBLE_BESTS_KEY = 'vocabVault_scrambleBests';

  var scrambleState = {
    words         : [],
    index         : 0,
    sessionLength : 5,
    sessionScore  : 0,
    wordScore     : 200,
    wrongAttempts : 0,
    hintsUsed     : 0,
    hintCount     : 0,
    currentWord   : null,
    bests         : {}
  };

  var scrambleTiles = [];

  function initScrambleMode() {
    try { scrambleState.bests = JSON.parse(localStorage.getItem(SCRAMBLE_BESTS_KEY) || '{}'); } catch (e) { scrambleState.bests = {}; }

    document.getElementById('scramble-launch-btn').addEventListener('click', openScramble);
    document.getElementById('scramble-close').addEventListener('click', closeScramble);
    document.getElementById('scramble-start-btn').addEventListener('click', startScramble);
    document.getElementById('scramble-exit-btn').addEventListener('click', function () { showScrambleScreen('setup'); });
    document.getElementById('scramble-play-again-btn').addEventListener('click', function () { showScrambleScreen('setup'); });
    document.getElementById('scramble-done-btn').addEventListener('click', closeScramble);
    document.getElementById('scramble-hint-btn').addEventListener('click', scrambleHint);
    document.getElementById('scramble-skip-btn').addEventListener('click', scrambleSkip);

    document.querySelectorAll('[data-scramble-length]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-scramble-length]').forEach(function (b) {
          b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
        scrambleState.sessionLength = parseInt(btn.dataset.scrambleLength, 10);
        updateScrambleBestDisplay();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('scramble-overlay');
        if (overlay && !overlay.classList.contains('hidden')) closeScramble();
      }
    });
  }

  function openScramble() {
    var overlay = document.getElementById('scramble-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    showScrambleScreen('setup');
    updateScrambleBestDisplay();
  }

  function closeScramble() {
    var overlay = document.getElementById('scramble-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showScrambleScreen(name) {
    var map = { setup: 'scramble-setup', game: 'scramble-game-screen', end: 'scramble-end-screen' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function updateScrambleBestDisplay() {
    var el = document.getElementById('scramble-personal-best');
    var best = scrambleState.bests[scrambleState.sessionLength];
    if (best) {
      el.textContent = 'Personal best (' + scrambleState.sessionLength + ' words): ' + best + ' pts';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function scrambleLetters(word) {
    var letters = word.split('');
    var shuffled = shuffle(letters);
    if (word.length > 2 && shuffled.join('') === word) {
      var tmp = shuffled[0]; shuffled[0] = shuffled[1]; shuffled[1] = tmp;
    }
    return shuffled;
  }

  function startScramble() {
    scrambleState.words = shuffle(allWords.filter(function (w) { return w.word.length >= 4; }))
      .slice(0, scrambleState.sessionLength);
    scrambleState.index = 0;
    scrambleState.sessionScore = 0;
    showScrambleScreen('game');
    showScrambleWord();
  }

  function showScrambleWord() {
    var wordObj = scrambleState.words[scrambleState.index];
    scrambleState.currentWord   = wordObj;
    scrambleState.wordScore     = 200;
    scrambleState.wrongAttempts = 0;
    scrambleState.hintsUsed     = 0;
    scrambleState.hintCount     = 0;

    document.getElementById('scramble-word-counter').textContent =
      'Word ' + (scrambleState.index + 1) + ' of ' + scrambleState.sessionLength;
    document.getElementById('scramble-session-score').textContent = 'Score: ' + scrambleState.sessionScore;
    document.getElementById('scramble-definition-hint').textContent = wordObj.definition;
    document.getElementById('scramble-feedback').textContent = '';
    document.getElementById('scramble-feedback').className = 'quiz-feedback';

    var hint = document.getElementById('scramble-hint-btn');
    hint.disabled = false;
    hint.textContent = '💡 Hint (−50 pts)';
    document.getElementById('scramble-skip-btn').disabled = false;

    var answerRow = document.getElementById('scramble-answer-row');
    var sourceRow = document.getElementById('scramble-source-row');
    answerRow.innerHTML = '';
    sourceRow.innerHTML = '';
    answerRow.className = 'scramble-answer-row';
    scrambleTiles = [];

    var letters = scrambleLetters(wordObj.word);
    letters.forEach(function (letter, i) {
      var tile = document.createElement('button');
      tile.className = 'scramble-tile';
      tile.textContent = letter;
      tile.dataset.tileIndex = i;
      tile.dataset.loc = 'source';
      tile.setAttribute('aria-label', 'Letter ' + letter);
      tile.addEventListener('click', function () { scrambleTileClick(tile); });
      sourceRow.appendChild(tile);
      scrambleTiles.push({ letter: letter, elem: tile, placed: false, hintLocked: false });
    });
  }

  function scrambleTileClick(tile) {
    if (tile.disabled) return;
    var answerRow = document.getElementById('scramble-answer-row');
    var sourceRow = document.getElementById('scramble-source-row');
    var idx = parseInt(tile.dataset.tileIndex, 10);

    if (tile.dataset.loc === 'source') {
      tile.dataset.loc = 'answer';
      tile.classList.add('answer-tile');
      answerRow.appendChild(tile);
      scrambleTiles[idx].placed = true;
      checkScrambleAnswer();
    } else {
      if (scrambleTiles[idx].hintLocked) return;
      tile.dataset.loc = 'source';
      tile.classList.remove('answer-tile');
      sourceRow.appendChild(tile);
      scrambleTiles[idx].placed = false;
    }
  }

  function checkScrambleAnswer() {
    var allPlaced = scrambleTiles.every(function (t) { return t.placed; });
    if (!allPlaced) return;

    var answerRow = document.getElementById('scramble-answer-row');
    var placed = Array.prototype.slice.call(answerRow.children);
    var spelled = placed.map(function (el) { return el.textContent; }).join('');
    var target  = scrambleState.currentWord.word;

    if (spelled.toLowerCase() === target.toLowerCase()) {
      answerRow.classList.add('scramble-correct');
      placed.forEach(function (el) { el.disabled = true; });
      var pts = Math.max(0, scrambleState.wordScore);
      scrambleState.sessionScore += pts;
      var fb = document.getElementById('scramble-feedback');
      fb.textContent = pts > 0 ? '✓ Correct! +' + pts + ' pts' : '✓ Correct!';
      fb.className = 'quiz-feedback visible feedback-correct';
      document.getElementById('scramble-session-score').textContent = 'Score: ' + scrambleState.sessionScore;
      document.getElementById('scramble-hint-btn').disabled = true;
      document.getElementById('scramble-skip-btn').disabled = true;
      setTimeout(scrambleAdvance, 1600);
    } else {
      answerRow.classList.add('scramble-wrong');
      scrambleState.wrongAttempts++;
      scrambleState.wordScore = Math.max(0, scrambleState.wordScore - 25);
      var fb2 = document.getElementById('scramble-feedback');
      fb2.textContent = '✗ Not quite — try rearranging!';
      fb2.className = 'quiz-feedback visible feedback-wrong';
      setTimeout(function () {
        answerRow.classList.remove('scramble-wrong');
        var sourceRow2 = document.getElementById('scramble-source-row');
        var wrongTiles = Array.prototype.slice.call(answerRow.children);
        wrongTiles.forEach(function (el) {
          var idx2 = parseInt(el.dataset.tileIndex, 10);
          if (!scrambleTiles[idx2].hintLocked) {
            el.dataset.loc = 'source';
            el.classList.remove('answer-tile');
            sourceRow2.appendChild(el);
            scrambleTiles[idx2].placed = false;
          }
        });
        var fb3 = document.getElementById('scramble-feedback');
        fb3.textContent = '';
        fb3.className = 'quiz-feedback';
      }, 700);
    }
  }

  function scrambleHint() {
    if (scrambleState.hintsUsed >= 3) return;
    var wordObj = scrambleState.currentWord;
    var word = wordObj.word;
    var answerRow = document.getElementById('scramble-answer-row');
    var placed = Array.prototype.slice.call(answerRow.children);
    var placedCount = placed.length;

    var nextLetterIdx = scrambleState.hintCount;
    if (nextLetterIdx >= word.length) return;

    var correctLetter = word[nextLetterIdx];
    var sourceTile = null;
    var sourceRow = document.getElementById('scramble-source-row');
    var srcChildren = Array.prototype.slice.call(sourceRow.children);
    for (var i = 0; i < srcChildren.length; i++) {
      var el = srcChildren[i];
      var tIdx = parseInt(el.dataset.tileIndex, 10);
      if (!scrambleTiles[tIdx].hintLocked && el.textContent.toLowerCase() === correctLetter.toLowerCase()) {
        sourceTile = el;
        break;
      }
    }

    if (!sourceTile) return;

    var tIdx2 = parseInt(sourceTile.dataset.tileIndex, 10);
    scrambleTiles[tIdx2].hintLocked = true;
    sourceTile.dataset.loc = 'answer';
    sourceTile.classList.add('hint-locked', 'answer-tile');
    answerRow.appendChild(sourceTile);
    scrambleTiles[tIdx2].placed = true;
    scrambleState.hintsUsed++;
    scrambleState.hintCount++;
    scrambleState.wordScore = Math.max(0, scrambleState.wordScore - 50);

    var hintBtn = document.getElementById('scramble-hint-btn');
    hintBtn.textContent = '💡 Hint (−50 pts) [' + (3 - scrambleState.hintsUsed) + ' left]';
    if (scrambleState.hintsUsed >= 3) hintBtn.disabled = true;

    checkScrambleAnswer();
  }

  function scrambleSkip() {
    var fb = document.getElementById('scramble-feedback');
    fb.textContent = 'Skipped! The word was "' + scrambleState.currentWord.word + '"';
    fb.className = 'quiz-feedback visible feedback-wrong';
    document.getElementById('scramble-hint-btn').disabled = true;
    document.getElementById('scramble-skip-btn').disabled = true;
    setTimeout(scrambleAdvance, 1800);
  }

  function scrambleAdvance() {
    scrambleState.index++;
    if (scrambleState.index >= scrambleState.sessionLength) {
      showScrambleEnd();
    } else {
      showScrambleWord();
    }
  }

  function showScrambleEnd() {
    showScrambleScreen('end');
    var score = scrambleState.sessionScore;
    var len   = scrambleState.sessionLength;
    var best  = scrambleState.bests[len] || 0;
    var isNew = score > best;
    if (isNew) {
      scrambleState.bests[len] = score;
      try { localStorage.setItem(SCRAMBLE_BESTS_KEY, JSON.stringify(scrambleState.bests)); } catch (e) {}
    }
    var maxPts = len * 200;
    var pct = score / maxPts;
    document.getElementById('scramble-end-emoji').textContent = pct >= 0.8 ? '🧩' : pct >= 0.5 ? '🔤' : '📝';
    document.getElementById('scramble-end-title').textContent = pct >= 0.8 ? 'Spelling Wizard!' : pct >= 0.5 ? 'Word Wrangler!' : 'Getting Warmed Up!';
    document.getElementById('scramble-end-score').textContent = score + ' pts out of ' + maxPts + ' possible';
    document.getElementById('scramble-end-best').textContent  = isNew ? '⭐ New personal best!' : 'Personal best: ' + (best || 0) + ' pts';
  }

  // ── Flash Blitz Mode ─────────────────────────────────────────────────────────

  var blitzState = {
    words         : [],
    index         : 0,
    flipped       : false,
    scope         : 'all',
    timerSecs     : 15,
    sessionSize   : 10,
    timerInterval : null,
    timerMs       : 0,
    got           : 0,
    nearly        : 0,
    missed        : 0,
    missedWords   : []
  };

  function initFlashBlitz() {
    document.getElementById('blitz-launch-btn').addEventListener('click', openBlitz);
    document.getElementById('blitz-close').addEventListener('click', closeBlitz);
    document.getElementById('blitz-start-btn').addEventListener('click', startBlitz);
    document.getElementById('blitz-exit-btn').addEventListener('click', function () { stopBlitzTimer(); showBlitzScreen('setup'); });
    document.getElementById('blitz-play-again-btn').addEventListener('click', function () { showBlitzScreen('setup'); });
    document.getElementById('blitz-done-btn').addEventListener('click', closeBlitz);
    document.getElementById('blitz-card').addEventListener('click', flipBlitzCard);
    document.getElementById('blitz-card').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flipBlitzCard(); }
    });
    document.getElementById('blitz-got-btn').addEventListener('click', function () { blitzRate('got'); });
    document.getElementById('blitz-nearly-btn').addEventListener('click', function () { blitzRate('nearly'); });
    document.getElementById('blitz-missed-btn').addEventListener('click', function () { blitzRate('missed'); });

    ['data-blitz-size', 'data-blitz-scope', 'data-blitz-timer'].forEach(function (attr) {
      document.querySelectorAll('[' + attr + ']').forEach(function (btn) {
        btn.addEventListener('click', function () {
          document.querySelectorAll('[' + attr + ']').forEach(function (b) {
            b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
          });
          btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
        });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('blitz-overlay');
        if (overlay && !overlay.classList.contains('hidden')) { stopBlitzTimer(); closeBlitz(); }
      }
    });
  }

  function openBlitz() {
    var overlay = document.getElementById('blitz-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    showBlitzScreen('setup');
  }

  function closeBlitz() {
    stopBlitzTimer();
    var overlay = document.getElementById('blitz-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    applyFilters();
  }

  function showBlitzScreen(name) {
    var map = { setup: 'blitz-setup', card: 'blitz-card-screen', end: 'blitz-end-screen' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function startBlitz() {
    var sizeBtn  = document.querySelector('[data-blitz-size].active');
    var scopeBtn = document.querySelector('[data-blitz-scope].active');
    var timerBtn = document.querySelector('[data-blitz-timer].active');

    var rawSize  = sizeBtn  ? sizeBtn.dataset.blitzSize   : '10';
    var scope    = scopeBtn ? scopeBtn.dataset.blitzScope  : 'all';
    var timerSec = timerBtn ? parseInt(timerBtn.dataset.blitzTimer, 10) : 15;

    var pool = scope === '5star'
      ? allWords.filter(function (w) { return w.usefulness_rating === 5; })
      : scope === 'weakest'
        ? buildBlitzWeakPool()
        : allWords.slice();

    pool = shuffle(pool);
    var size = rawSize === 'all' ? pool.length : Math.min(parseInt(rawSize, 10), pool.length);
    if (size < 1) size = pool.length;

    blitzState.words    = pool.slice(0, size);
    blitzState.index    = 0;
    blitzState.flipped  = false;
    blitzState.scope    = scope;
    blitzState.timerSecs = timerSec;
    blitzState.got      = 0;
    blitzState.nearly   = 0;
    blitzState.missed   = 0;
    blitzState.missedWords = [];

    var timerBar = document.getElementById('blitz-timer-bar');
    timerBar.style.display = timerSec > 0 ? 'block' : 'none';

    showBlitzScreen('card');
    showBlitzCard();
  }

  function buildBlitzWeakPool() {
    var withMisses = allWords.filter(function (w) {
      var m = mastery[w.word];
      return m && m.incorrect > 0;
    });
    withMisses.sort(function (a, b) {
      var ma = mastery[a.word] || {};
      var mb = mastery[b.word] || {};
      return (mb.incorrect - mb.correct) - (ma.incorrect - ma.correct);
    });
    var newWords = allWords.filter(function (w) { return getMasteryStatus(w.word) === 'new'; });
    return shuffle(withMisses.concat(newWords));
  }

  function showBlitzCard() {
    var wordObj = blitzState.words[blitzState.index];
    blitzState.flipped = false;

    var card = document.getElementById('blitz-card');
    card.classList.remove('is-flipped');
    card.setAttribute('aria-label', 'Flash card — tap to flip');

    document.getElementById('blitz-progress-label').textContent =
      'Card ' + (blitzState.index + 1) + ' of ' + blitzState.words.length;
    document.getElementById('blitz-word-type').textContent = wordObj.word_type || '';
    document.getElementById('blitz-word').textContent = wordObj.word;
    document.getElementById('blitz-back-word').textContent = wordObj.word;
    document.getElementById('blitz-definition').textContent = wordObj.definition;
    document.getElementById('blitz-sentence').textContent = wordObj.sentence_usage || '';
    var syns = (wordObj.synonyms || []).join(', ');
    var synLabel = document.getElementById('blitz-synonyms-label');
    synLabel.textContent = syns ? 'Synonyms: ' + syns : '';

    document.getElementById('blitz-rate-row').classList.add('hidden');

    if (blitzState.timerSecs > 0) {
      startBlitzTimer();
    } else {
      document.getElementById('blitz-timer-fill').style.width = '0%';
    }
  }

  function startBlitzTimer() {
    stopBlitzTimer();
    blitzState.timerMs = blitzState.timerSecs * 1000;
    var fill = document.getElementById('blitz-timer-fill');
    fill.style.width = '100%';
    fill.classList.remove('blitz-timer-urgent');

    blitzState.timerInterval = setInterval(function () {
      if (blitzState.flipped) { stopBlitzTimer(); return; }
      blitzState.timerMs -= 100;
      var pct = Math.max(0, blitzState.timerMs / (blitzState.timerSecs * 1000));
      fill.style.width = (pct * 100).toFixed(1) + '%';
      if (pct < 0.3) fill.classList.add('blitz-timer-urgent');
      if (blitzState.timerMs <= 0) {
        stopBlitzTimer();
        flipBlitzCard();
      }
    }, 100);
  }

  function stopBlitzTimer() {
    if (blitzState.timerInterval) {
      clearInterval(blitzState.timerInterval);
      blitzState.timerInterval = null;
    }
  }

  function flipBlitzCard() {
    if (blitzState.flipped) return;
    stopBlitzTimer();
    blitzState.flipped = true;
    var card = document.getElementById('blitz-card');
    card.classList.add('is-flipped');
    card.setAttribute('aria-label', 'Flash card — showing definition');
    document.getElementById('blitz-rate-row').classList.remove('hidden');
    document.getElementById('blitz-timer-fill').style.width = '100%';
    document.getElementById('blitz-timer-fill').classList.remove('blitz-timer-urgent');
  }

  function blitzRate(rating) {
    var wordObj = blitzState.words[blitzState.index];
    if (rating === 'got') {
      blitzState.got++;
      recordAnswer(wordObj.word, true);
    } else if (rating === 'missed') {
      blitzState.missed++;
      blitzState.missedWords.push(wordObj);
      recordAnswer(wordObj.word, false);
    } else {
      blitzState.nearly++;
    }
    blitzState.index++;
    if (blitzState.index >= blitzState.words.length) {
      showBlitzEnd();
    } else {
      showBlitzCard();
    }
  }

  function showBlitzEnd() {
    stopBlitzTimer();
    showBlitzScreen('end');
    var total = blitzState.words.length;
    var got   = blitzState.got;
    var pct   = got / total;
    document.getElementById('blitz-end-emoji').textContent = pct >= 0.8 ? '⚡' : pct >= 0.5 ? '🃏' : '📚';
    document.getElementById('blitz-end-title').textContent = pct >= 0.8 ? 'Lightning Round!' : pct >= 0.5 ? 'Solid Session!' : 'Keep Flipping!';
    document.getElementById('blitz-end-score').textContent =
      '✅ Got: ' + blitzState.got + '  🤔 Nearly: ' + blitzState.nearly + '  ❌ Missed: ' + blitzState.missed;

    var reviewEl = document.getElementById('blitz-misses-review');
    var listEl   = document.getElementById('blitz-misses-list');
    listEl.innerHTML = '';
    if (blitzState.missedWords.length) {
      blitzState.missedWords.forEach(function (w) {
        var li = document.createElement('li');
        li.className = 'quiz-review-item';
        var strong = document.createElement('strong');
        strong.textContent = w.word;
        li.appendChild(strong);
        li.appendChild(document.createTextNode(' — ' + w.definition));
        listEl.appendChild(li);
      });
      reviewEl.classList.remove('hidden');
    } else {
      reviewEl.classList.add('hidden');
    }
  }

  // ── Synonym Snap Mode ────────────────────────────────────────────────────────

  var SNAP_BESTS_KEY  = 'vocabVault_snapBests';
  var SNAP_TIMER_SECS = 3;

  var snapState = {
    pairs         : [],
    index         : 0,
    score         : 0,
    streak        : 0,
    bestStreak    : 0,
    pairCount     : 20,
    timerInterval : null,
    timerMs       : 0,
    answered      : false,
    misses        : [],
    bests         : {}
  };

  function initSynonymSnap() {
    try { snapState.bests = JSON.parse(localStorage.getItem(SNAP_BESTS_KEY) || '{}'); } catch (e) { snapState.bests = {}; }

    document.getElementById('snap-launch-btn').addEventListener('click', openSnap);
    document.getElementById('snap-close').addEventListener('click', closeSnap);
    document.getElementById('snap-start-btn').addEventListener('click', startSnap);
    document.getElementById('snap-exit-btn').addEventListener('click', function () { stopSnapTimer(); showSnapScreen('setup'); });
    document.getElementById('snap-play-again-btn').addEventListener('click', function () { showSnapScreen('setup'); });
    document.getElementById('snap-done-btn').addEventListener('click', closeSnap);
    document.getElementById('snap-yes-btn').addEventListener('click', function () { snapAnswer(true); });
    document.getElementById('snap-no-btn').addEventListener('click', function () { snapAnswer(false); });

    document.querySelectorAll('[data-snap-count]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-snap-count]').forEach(function (b) {
          b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
        snapState.pairCount = parseInt(btn.dataset.snapCount, 10);
        updateSnapBestDisplay();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('snap-overlay');
        if (overlay && !overlay.classList.contains('hidden')) { stopSnapTimer(); closeSnap(); }
      }
    });
  }

  function openSnap() {
    var overlay = document.getElementById('snap-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    showSnapScreen('setup');
    updateSnapBestDisplay();
  }

  function closeSnap() {
    stopSnapTimer();
    var overlay = document.getElementById('snap-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showSnapScreen(name) {
    var map = { setup: 'snap-setup', game: 'snap-game-screen', end: 'snap-end-screen' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function updateSnapBestDisplay() {
    var el = document.getElementById('snap-personal-best');
    var best = snapState.bests[snapState.pairCount];
    if (best) {
      el.textContent = 'Personal best (' + snapState.pairCount + ' pairs): ' + best + ' pts';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function generateSnapPairs(count) {
    var eligible = allWords.filter(function (w) {
      return w.synonyms && w.synonyms.length && w.antonyms && w.antonyms.length;
    });
    if (eligible.length < 4) return [];

    var pairs = [];
    var pool = shuffle(eligible);

    for (var i = 0; i < count; i++) {
      var type = i % 4;
      var wordObj = pool[i % pool.length];
      var pair;

      if (type === 0) {
        var syn = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
        pair = { wordA: wordObj.word, wordB: syn, questionType: 'SYNONYMS', isYes: true };
      } else if (type === 1) {
        var ant = wordObj.antonyms[Math.floor(Math.random() * wordObj.antonyms.length)];
        pair = { wordA: wordObj.word, wordB: ant, questionType: 'ANTONYMS', isYes: true };
      } else if (type === 2) {
        var syn2 = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
        pair = { wordA: wordObj.word, wordB: syn2, questionType: 'ANTONYMS', isYes: false };
      } else {
        var other = pool[(i + Math.floor(pool.length / 2)) % pool.length];
        pair = {
          wordA: wordObj.word,
          wordB: other.word,
          questionType: Math.random() < 0.5 ? 'SYNONYMS' : 'ANTONYMS',
          isYes: false
        };
      }
      pairs.push(pair);
    }
    return shuffle(pairs);
  }

  function startSnap() {
    snapState.pairs     = generateSnapPairs(snapState.pairCount);
    snapState.index     = 0;
    snapState.score     = 0;
    snapState.streak    = 0;
    snapState.bestStreak = 0;
    snapState.misses    = [];
    showSnapScreen('game');
    showSnapPair();
  }

  function showSnapPair() {
    var pair = snapState.pairs[snapState.index];
    snapState.answered = false;

    document.getElementById('snap-pair-counter').textContent =
      'Pair ' + (snapState.index + 1) + ' of ' + snapState.pairCount;
    document.getElementById('snap-score-display').textContent = 'Score: ' + snapState.score;

    var streakEl = document.getElementById('snap-streak-display');
    if (snapState.streak >= 2) {
      streakEl.textContent = '🔥 ' + snapState.streak;
    } else {
      streakEl.textContent = '';
    }

    document.getElementById('snap-question-type').textContent = pair.questionType;
    document.getElementById('snap-word-a').textContent = pair.wordA;
    document.getElementById('snap-word-b').textContent = pair.wordB;

    var flashEl = document.getElementById('snap-flash-msg');
    flashEl.textContent = '';
    flashEl.className = 'snap-flash-msg';

    document.getElementById('snap-yes-btn').disabled = false;
    document.getElementById('snap-no-btn').disabled  = false;

    startSnapTimer();
  }

  function startSnapTimer() {
    stopSnapTimer();
    snapState.timerMs = SNAP_TIMER_SECS * 1000;
    var fill = document.getElementById('snap-timer-fill');
    fill.style.width = '100%';
    fill.classList.remove('snap-timer-urgent');

    snapState.timerInterval = setInterval(function () {
      snapState.timerMs -= 50;
      var pct = Math.max(0, snapState.timerMs / (SNAP_TIMER_SECS * 1000));
      fill.style.width = (pct * 100).toFixed(1) + '%';
      if (pct < 0.3) fill.classList.add('snap-timer-urgent');
      if (snapState.timerMs <= 0) {
        stopSnapTimer();
        if (!snapState.answered) snapAnswer(null);
      }
    }, 50);
  }

  function stopSnapTimer() {
    if (snapState.timerInterval) {
      clearInterval(snapState.timerInterval);
      snapState.timerInterval = null;
    }
  }

  function snapAnswer(userYes) {
    if (snapState.answered) return;
    snapState.answered = true;
    stopSnapTimer();

    document.getElementById('snap-yes-btn').disabled = true;
    document.getElementById('snap-no-btn').disabled  = true;

    var pair    = snapState.pairs[snapState.index];
    var correct = (userYes === null) ? false : (userYes === pair.isYes);
    var pts     = 0;
    var flashEl = document.getElementById('snap-flash-msg');

    if (userYes === null) {
      snapState.streak = 0;
      flashEl.textContent = '⏱ Time\'s up! It was ' + (pair.isYes ? 'YES' : 'NO');
      flashEl.className = 'snap-flash-msg snap-wrong';
      snapState.misses.push(pair);
    } else if (correct) {
      snapState.streak++;
      if (snapState.streak > snapState.bestStreak) snapState.bestStreak = snapState.streak;
      var multiplier = snapState.streak >= 10 ? 2 : snapState.streak >= 5 ? 1.5 : 1;
      pts = Math.round(100 * multiplier);
      snapState.score += pts;
      var msg = '✓ Correct! +' + pts;
      if (multiplier > 1) msg += ' (×' + multiplier + ' streak!)';
      flashEl.textContent = msg;
      flashEl.className = 'snap-flash-msg snap-correct';
    } else {
      snapState.streak = 0;
      flashEl.textContent = '✗ Wrong! It was ' + (pair.isYes ? 'YES' : 'NO');
      flashEl.className = 'snap-flash-msg snap-wrong';
      snapState.misses.push(pair);
    }

    document.getElementById('snap-score-display').textContent = 'Score: ' + snapState.score;

    var streakEl = document.getElementById('snap-streak-display');
    streakEl.textContent = snapState.streak >= 2 ? '🔥 ' + snapState.streak : '';

    setTimeout(function () {
      snapState.index++;
      if (snapState.index >= snapState.pairCount) {
        showSnapEnd();
      } else {
        showSnapPair();
      }
    }, 900);
  }

  function showSnapEnd() {
    stopSnapTimer();
    showSnapScreen('end');
    var score = snapState.score;
    var count = snapState.pairCount;
    var best  = snapState.bests[count] || 0;
    var isNew = score > best;
    if (isNew) {
      snapState.bests[count] = score;
      try { localStorage.setItem(SNAP_BESTS_KEY, JSON.stringify(snapState.bests)); } catch (e) {}
    }
    var maxPts = count * 200;
    var pct = score / maxPts;
    document.getElementById('snap-end-emoji').textContent = pct >= 0.7 ? '🎭' : pct >= 0.4 ? '🎲' : '🃏';
    document.getElementById('snap-end-title').textContent = pct >= 0.7 ? 'Snap Champion!' : pct >= 0.4 ? 'Word Matcher!' : 'Keep Snapping!';
    document.getElementById('snap-end-score').textContent =
      score + ' pts · Best streak: 🔥 ' + snapState.bestStreak;
    document.getElementById('snap-end-best').textContent = isNew ? '⭐ New personal best!' : 'Personal best: ' + best + ' pts';

    var reviewEl = document.getElementById('snap-misses-review');
    var listEl   = document.getElementById('snap-misses-list');
    listEl.innerHTML = '';
    if (snapState.misses.length) {
      snapState.misses.forEach(function (pair) {
        var li = document.createElement('li');
        li.className = 'quiz-review-item';
        li.textContent = '"' + pair.wordA + '" vs "' + pair.wordB + '" — '
          + (pair.isYes ? 'These ARE ' : 'These are NOT ') + pair.questionType;
        listEl.appendChild(li);
      });
      reviewEl.classList.remove('hidden');
    } else {
      reviewEl.classList.add('hidden');
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // COMIC MODE — Star-Sloth original comics. Offline, fixed stories.
  // ═══════════════════════════════════════════════════════════════════════════

  var comicLaunchBtn       = document.getElementById('comic-launch-btn');
  var comicOverlay         = document.getElementById('comic-overlay');
  var comicLibraryScreen   = document.getElementById('comic-library-screen');
  var comicViewingScreen   = document.getElementById('comic-viewing-screen');
  var comicCloseBtn        = document.getElementById('comic-close-btn');
  var comicViewerCloseBtn  = document.getElementById('comic-viewer-close-btn');
  var comicBackBtn         = document.getElementById('comic-back-btn');
  var comicPrintBtn        = document.getElementById('comic-print-btn');
  var comicStoryList       = document.getElementById('comic-story-list');
  var comicPanelsContainer = document.getElementById('comic-panels-container');
  var comicGlossaryEl      = document.getElementById('comic-glossary');

  // ── SVG character generators ───────────────────────────────────────────────

  function svgStarSloth(pose) {
    var blink  = pose === 'blink';
    var action = pose === 'action';
    var lidH   = blink ? 7 : 4;
    var pupils = blink ? '' :
      '<circle cx="42" cy="49" r="2.5" fill="#1a1a1a"/>' +
      '<circle cx="58" cy="49" r="2.5" fill="#1a1a1a"/>';
    var speedLines = action
      ? '<line x1="2" y1="30" x2="18" y2="30" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>' +
        '<line x1="1" y1="44" x2="16" y2="44" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>' +
        '<line x1="2" y1="58" x2="17" y2="58" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>' +
        '<line x1="3" y1="72" x2="18" y2="72" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>' +
        '<text x="4" y="14" font-size="5.5" fill="#BBB" font-weight="bold" font-family="Impact,Arial,sans-serif" letter-spacing="1">SWOOOOOSH!</text>'
      : '';
    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      speedLines +
      '<path d="M23,45 Q20,34 27,28 Q22,20 31,22 Q31,14 41,18 Q43,11 50,13 Q57,11 59,18 Q69,14 69,22 Q78,20 73,28 Q80,34 77,45" fill="#D4B880" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<circle cx="50" cy="46" r="26" fill="#C4A870" stroke="#1a1a1a" stroke-width="2.5"/>' +
      '<ellipse cx="50" cy="50" rx="18" ry="16" fill="#DCCA90"/>' +
      '<ellipse cx="42" cy="46" rx="5" ry="4.5" fill="white" stroke="#333" stroke-width="1"/>' +
      '<rect x="37" y="42" width="10" height="' + lidH + '" rx="2" fill="#C4A870"/>' +
      '<ellipse cx="58" cy="46" rx="5" ry="4.5" fill="white" stroke="#333" stroke-width="1"/>' +
      '<rect x="53" y="42" width="10" height="' + lidH + '" rx="2" fill="#C4A870"/>' +
      pupils +
      '<ellipse cx="50" cy="58" rx="8" ry="6" fill="#D0B068"/>' +
      '<ellipse cx="50" cy="57" rx="3.5" ry="2.5" fill="#7A4A20" stroke="#333" stroke-width="1"/>' +
      '<path d="M45,64 Q50,68 55,64" fill="none" stroke="#555" stroke-width="1.5"/>' +
      '<ellipse cx="50" cy="96" rx="19" ry="22" fill="#9AAAB8" stroke="#1a1a1a" stroke-width="2"/>' +
      '<line x1="50" y1="74" x2="50" y2="118" stroke="#7A8A98" stroke-width="1.5"/>' +
      '<circle cx="50" cy="88" r="7" fill="#3A68D0" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<text x="50" y="93" text-anchor="middle" fill="white" font-size="9" font-weight="bold" font-family="Arial,sans-serif">S</text>' +
      '<ellipse cx="34" cy="94" rx="5" ry="9" fill="#7A8A98" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<ellipse cx="66" cy="94" rx="5" ry="9" fill="#7A8A98" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<path d="M31,78 Q20,88 18,104" fill="none" stroke="#C4A870" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M15,106 Q17,113 21,108" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M18,109 Q20,116 24,111" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M21,111 Q23,118 27,113" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M69,78 Q80,88 82,104" fill="none" stroke="#C4A870" stroke-width="7" stroke-linecap="round"/>' +
      '<path d="M85,106 Q83,113 79,108" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M82,109 Q80,116 76,111" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '<path d="M79,111 Q77,118 73,113" fill="none" stroke="#1a1a1a" stroke-width="1.5" stroke-linecap="round"/>' +
      '</svg>';
  }

  function svgJolt(pose) {
    var translating = pose === 'translating';
    var tiltAngle   = translating ? '0' : '-12';
    var ghost = translating ? '' :
      '<ellipse cx="40" cy="64" rx="20" ry="28" fill="rgba(150,150,175,0.18)" transform="translate(-10,0)"/>';
    var magGlass = translating
      ? '<circle cx="74" cy="42" r="8" fill="rgba(200,230,255,0.85)" stroke="#888" stroke-width="2"/>' +
        '<line x1="80" y1="48" x2="87" y2="55" stroke="#888" stroke-width="2.5" stroke-linecap="round"/>'
      : '';
    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      ghost +
      '<g transform="rotate(' + tiltAngle + ', 50, 65)">' +
      '<ellipse cx="50" cy="72" rx="22" ry="28" fill="#C8C8D8" stroke="#1a1a1a" stroke-width="2"/>' +
      '<ellipse cx="50" cy="72" rx="16" ry="22" fill="none" stroke="#9898A8" stroke-width="1"/>' +
      '<circle cx="50" cy="58" r="16" fill="white" stroke="#1a1a1a" stroke-width="2.5"/>' +
      '<circle cx="50" cy="58" r="12" fill="#2A90E8"/>' +
      '<circle cx="50" cy="58" r="8"  fill="#1A60B0"/>' +
      '<circle cx="50" cy="58" r="4"  fill="#0A3070"/>' +
      '<circle cx="50" cy="58" r="1.5" fill="white"/>' +
      '<circle cx="44" cy="52" r="3.5" fill="rgba(255,255,255,0.55)"/>' +
      '<circle cx="50" cy="58" r="14" fill="none" stroke="rgba(160,190,210,0.6)" stroke-width="1" stroke-dasharray="2 3"/>' +
      '<line x1="50" y1="42" x2="50" y2="32" stroke="#1a1a1a" stroke-width="2"/>' +
      '<circle cx="50" cy="30" r="3" fill="#F0B020" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<path d="M28,64 L18,74 L26,74 L16,86" fill="none" stroke="#F0B020" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<path d="M72,64 L82,74 L74,74 L84,86" fill="none" stroke="#F0B020" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<rect x="37" y="98" width="10" height="8" rx="2" fill="#999" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<rect x="53" y="98" width="10" height="8" rx="2" fill="#999" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<path d="M38,106 Q42,118 46,106" fill="#F08020"/>' +
      '<path d="M54,106 Q58,118 62,106" fill="#F08020"/>' +
      '<path d="M40,106 Q42,112 44,106" fill="#FFF080"/>' +
      '<path d="M56,106 Q58,112 60,106" fill="#FFF080"/>' +
      '</g>' +
      magGlass +
      '</svg>';
  }

  function svgAdmiral(pose) {
    var exploding = pose === 'exploding';
    var sweat = '<ellipse cx="27" cy="30" rx="2" ry="3" fill="#A0D0F0" transform="rotate(-20,27,30)"/>' +
      '<ellipse cx="76" cy="26" rx="2" ry="3" fill="#A0D0F0" transform="rotate(20,76,26)"/>' +
      '<ellipse cx="21" cy="52" rx="1.5" ry="2.5" fill="#A0D0F0" transform="rotate(-30,21,52)"/>';
    if (exploding) {
      sweat +=
        '<ellipse cx="14" cy="40" rx="2.5" ry="3.5" fill="#A0D0F0" transform="rotate(-15,14,40)"/>' +
        '<ellipse cx="82" cy="44" rx="2" ry="3" fill="#A0D0F0" transform="rotate(25,82,44)"/>' +
        '<ellipse cx="24" cy="70" rx="2" ry="3" fill="#A0D0F0" transform="rotate(-40,24,70)"/>' +
        '<ellipse cx="80" cy="64" rx="2" ry="3" fill="#A0D0F0" transform="rotate(30,80,64)"/>';
    }
    var mouth = exploding
      ? '<ellipse cx="50" cy="68" rx="8" ry="6" fill="#8B2020"/><ellipse cx="50" cy="68" rx="6" ry="4" fill="#B03030"/>'
      : '<path d="M43,67 Q50,71 57,67" fill="none" stroke="#333" stroke-width="1.5"/>';
    var eyebrows = exploding
      ? '<path d="M36,42 Q42,37 48,42" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>' +
        '<path d="M52,42 Q58,37 64,42" fill="none" stroke="#1a1a1a" stroke-width="2.5"/>'
      : '<path d="M37,43 Q42,40 47,43" fill="none" stroke="#1a1a1a" stroke-width="2"/>' +
        '<path d="M53,43 Q58,40 63,43" fill="none" stroke="#1a1a1a" stroke-width="2"/>';
    var vein = '<path d="M45,32 Q47,28 50,32 Q53,28 55,32" fill="none" stroke="#C03030" stroke-width="1.5"/>';
    if (exploding) vein += '<path d="M38,40 Q40,36 43,40" fill="none" stroke="#C03030" stroke-width="1.5"/>';
    var arms = exploding
      ? '<path d="M27,82 Q14,94 20,108" fill="none" stroke="#1A3A6A" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M73,82 Q86,94 80,108" fill="none" stroke="#1A3A6A" stroke-width="8" stroke-linecap="round"/>'
      : '<path d="M28,84 Q28,96 38,100" fill="none" stroke="#1A3A6A" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M72,84 Q72,96 62,100" fill="none" stroke="#1A3A6A" stroke-width="8" stroke-linecap="round"/>' +
        '<path d="M38,100 Q50,104 62,100" fill="none" stroke="#1A3A6A" stroke-width="8" stroke-linecap="round"/>';
    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      sweat +
      '<rect x="24" y="18" width="52" height="12" rx="4" fill="#1A3A6A" stroke="#1a1a1a" stroke-width="2"/>' +
      '<rect x="19" y="27" width="62" height="6" rx="2" fill="#142D54" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<circle cx="50" cy="23" r="5" fill="#E0C020" stroke="#1a1a1a" stroke-width="1"/>' +
      '<text x="50" y="27" text-anchor="middle" font-size="7" fill="#1a1a1a" font-family="Arial,sans-serif">★</text>' +
      '<circle cx="50" cy="52" r="26" fill="#E04040" stroke="#1a1a1a" stroke-width="2.5"/>' +
      '<ellipse cx="24" cy="52" rx="6" ry="8" fill="#D03030" stroke="#1a1a1a" stroke-width="2"/>' +
      '<ellipse cx="76" cy="52" rx="6" ry="8" fill="#D03030" stroke="#1a1a1a" stroke-width="2"/>' +
      '<ellipse cx="42" cy="48" rx="5" ry="5" fill="white" stroke="#333" stroke-width="1"/>' +
      '<circle cx="42" cy="48" r="3" fill="#1a1a1a"/>' +
      '<circle cx="41" cy="47" r="1" fill="white"/>' +
      '<ellipse cx="58" cy="48" rx="5" ry="5" fill="white" stroke="#333" stroke-width="1"/>' +
      '<circle cx="58" cy="48" r="3" fill="#1a1a1a"/>' +
      '<circle cx="57" cy="47" r="1" fill="white"/>' +
      eyebrows +
      '<path d="M39,61 Q45,65 50,62 Q55,65 61,61" fill="#4A2000" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<path d="M39,61 Q41,69 48,63" fill="#4A2000"/>' +
      '<path d="M61,61 Q59,69 52,63" fill="#4A2000"/>' +
      vein + mouth +
      '<ellipse cx="50" cy="100" rx="23" ry="20" fill="#1A3A6A" stroke="#1a1a1a" stroke-width="2"/>' +
      '<circle cx="40" cy="88" r="4" fill="#E0C020" stroke="#1a1a1a" stroke-width="1"/>' +
      '<circle cx="40" cy="97" r="4" fill="#C0A000" stroke="#1a1a1a" stroke-width="1"/>' +
      '<circle cx="40" cy="106" r="4" fill="#E0C020" stroke="#1a1a1a" stroke-width="1"/>' +
      '<circle cx="54" cy="88" r="2" fill="#8AA0BB" stroke="#1a1a1a" stroke-width="1"/>' +
      '<circle cx="54" cy="96" r="2" fill="#8AA0BB" stroke="#1a1a1a" stroke-width="1"/>' +
      '<circle cx="54" cy="104" r="2" fill="#8AA0BB" stroke="#1a1a1a" stroke-width="1"/>' +
      arms +
      '</svg>';
  }

  function svgOverClock(pose) {
    var meltdown = pose === 'meltdown';
    var liquidY  = meltdown ? 50 : 46;
    var liquidH  = 60 - liquidY;
    var bubbles  = meltdown
      ? '<circle cx="44" cy="' + (liquidY - 8)  + '" r="2"   fill="rgba(255,255,255,0.55)"/>' +
        '<circle cx="54" cy="' + (liquidY - 14) + '" r="1.5" fill="rgba(255,255,255,0.55)"/>' +
        '<circle cx="60" cy="' + (liquidY - 6)  + '" r="2.5" fill="rgba(255,255,255,0.55)"/>'
      : '<circle cx="46" cy="' + (liquidY - 6)  + '" r="1.5" fill="rgba(255,255,255,0.45)"/>' +
        '<circle cx="56" cy="' + (liquidY - 10) + '" r="1"   fill="rgba(255,255,255,0.45)"/>';
    var steam = meltdown
      ? '<path d="M68,16 Q72,10 70,4 Q75,8 73,2" fill="none" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>' +
        '<path d="M74,20 Q79,13 77,7 Q82,11 80,5" fill="none" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>'
      : '<path d="M68,18 Q71,12 69,7" fill="none" stroke="#CCC" stroke-width="1.5" stroke-linecap="round"/>';
    var jitter = meltdown
      ? '<line x1="27" y1="46" x2="21" y2="52" stroke="#888" stroke-width="1" stroke-linecap="round"/>' +
        '<line x1="73" y1="46" x2="79" y2="52" stroke="#888" stroke-width="1" stroke-linecap="round"/>'
      : '';
    var mouth = meltdown
      ? '<path d="M43,58 Q50,52 57,58" fill="none" stroke="#333" stroke-width="2"/>'
      : '<path d="M44,56 Q50,60 56,56" fill="none" stroke="#333" stroke-width="1.5"/>';
    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      steam + jitter +
      '<rect x="28" y="10" width="44" height="52" rx="8" fill="rgba(210,235,255,0.8)" stroke="#1a1a1a" stroke-width="2.5"/>' +
      '<rect x="30" y="' + liquidY + '" width="40" height="' + liquidH + '" fill="#5A2F00" opacity="0.9"/>' +
      '<ellipse cx="50" cy="' + liquidY + '" rx="20" ry="2" fill="#7A4A00"/>' +
      bubbles +
      '<path d="M72,22 Q82,22 82,37 Q82,52 72,52" fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M28,24 Q18,21 15,32" fill="none" stroke="#1a1a1a" stroke-width="3" stroke-linecap="round"/>' +
      '<circle cx="50" cy="30" r="9" fill="rgba(255,255,215,0.85)" stroke="#555" stroke-width="1"/>' +
      '<line x1="50" y1="30" x2="50" y2="24" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="50" y1="30" x2="55" y2="33" stroke="#333" stroke-width="1.5" stroke-linecap="round"/>' +
      mouth +
      '<rect x="42" y="64" width="16" height="40" rx="6" fill="#3A6A30" stroke="#1a1a1a" stroke-width="2"/>' +
      '<rect x="36" y="66" width="12" height="36" rx="4" fill="#E8E8E8" stroke="#BBB" stroke-width="1"/>' +
      '<rect x="52" y="66" width="12" height="36" rx="4" fill="#E8E8E8" stroke="#BBB" stroke-width="1"/>' +
      '<text x="42" y="78" text-anchor="middle" font-size="7" fill="#555" font-family="Arial,sans-serif">⏰</text>' +
      '<text x="58" y="78" text-anchor="middle" font-size="7" fill="#555" font-family="Arial,sans-serif">⏱</text>' +
      '<text x="42" y="92" text-anchor="middle" font-size="7" fill="#555" font-family="Arial,sans-serif">🕐</text>' +
      '<path d="M42,72 Q26,78 22,92" fill="none" stroke="#3A6A30" stroke-width="5" stroke-linecap="round"/>' +
      '<path d="M58,72 Q74,78 78,92" fill="none" stroke="#3A6A30" stroke-width="5" stroke-linecap="round"/>' +
      '<ellipse cx="44" cy="106" rx="7" ry="4" fill="#3A6A30" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '<ellipse cx="56" cy="106" rx="7" ry="4" fill="#3A6A30" stroke="#1a1a1a" stroke-width="1.5"/>' +
      '</svg>';
  }

  // ── Fixed stories ──────────────────────────────────────────────────────────

  var COMIC_STORIES = [

    // Story 1 — Haste Makes Space-Waste
    {
      title: '💥 Haste Makes Space-Waste',
      blurb: 'Jolt destroys the generator trying to fix it. Star-Sloth fixes it with one wire.',
      words: [
        { word: 'haste',    definition: 'Excessive speed that can cause mistakes.' },
        { word: 'reckless', definition: 'Doing dangerous things without thinking.' },
        { word: 'cautious', definition: 'Careful to avoid danger or mistakes.' }
      ],
      panels: [
        { caption: '🚨 RED ALERT!',
          char: 'admiral', pose: 'exploding', fullWidth: true, bg: '#FFF0E0',
          bubble: 'THE OXYGEN GENERATOR IS BROKEN! No time to be cautious — haste is the only option!',
          bubbleType: 'shout', sfx: null },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'Connecting all 50 wires at once is NOT reckless. It is EFFICIENCY. Watch me.',
          bubbleType: 'shout', sfx: 'ZZZAP!' },
        { caption: '0.003 SECONDS LATER...',
          char: 'jolt', pose: 'translating', fullWidth: false, bg: '#EEEEFF',
          bubble: 'I may have been... reckless.',
          bubbleType: 'speech', sfx: 'PFFFFT' },
        { caption: 'OVER-CLOCK WATCHES FROM HIS LAIR AND CACKLES.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'Haste causes mistakes. This is absolutely delightful.',
          bubbleType: 'speech', sfx: null },
        { caption: 'STAR-SLOTH HAS BEEN STUDYING ONE TINY WIRE FOR TWO HOURS.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...cautious... careful to avoid mistakes... yes...',
          bubbleType: 'thought', sfx: null },
        { caption: 'THE ADMIRAL CANNOT TAKE IT ANYMORE.',
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: 'THERE IS STILL SMOKE! WHY IS HE NOT MOVING FASTER?!',
          bubbleType: 'shout', sfx: null },
        { caption: 'STAR-SLOTH CONNECTS THE ONE CORRECT WIRE.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: '...cautious works.',
          bubbleType: 'thought', sfx: 'click.' },
        { caption: 'OXYGEN RESTORED. OVER-CLOCK FURIOUS.',
          char: 'jolt', pose: 'zoom', fullWidth: true, bg: '#E8FFE8',
          bubble: 'Haste caused the disaster. Being cautious FIXED it. Star-Sloth is my hero and Over-Clock is baffled.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 2 — The Late Hero
    {
      title: '⏰ The Late Hero',
      blurb: "Over-Clock's perfect trap detonates itself because Star-Sloth took a six-hour nap.",
      words: [
        { word: 'opportune', definition: 'Happening at a particularly suitable or favourable time.' },
        { word: 'vigilant',  definition: 'Watchful and alert for danger.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'My trap is perfectly opportune — timed to the exact moment Star-Sloth lands! MWAHAHA!',
          bubbleType: 'shout', sfx: null },
        { caption: "STAR-SLOTH'S FLIGHT PLAN: NAP, THEN MINIMUM SPEED.",
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: '...zz...' },
        { caption: 'JOLT IS ALARMED.',
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'WE ARE SIX HOURS LATE! Over-Clock must be getting desperate by now!',
          bubbleType: 'shout', sfx: null },
        { caption: 'HOUR SIX. OVER-CLOCK IS STILL VIGILANT.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'I am being vigilant. He WILL arrive. He must. Any moment now.',
          bubbleType: 'speech', sfx: 'tick tick tick' },
        { caption: 'THE TRAP TIMER RUNS OUT.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'NOOOOO!',
          bubbleType: 'shout', sfx: 'KA-BOOM' },
        { caption: 'STAR-SLOTH FINALLY ARRIVES AND SURVEYS THE CRATER.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: '...interesting...',
          bubbleType: 'thought', sfx: null },
        { caption: 'STAR-SLOTH AMBLES PAST THE SMOKING WRECKAGE.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: null },
        { caption: 'GALAXY SAVED. WITHOUT TRYING.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'His late arrival was opportune! Over-Clock was vigilant for six whole hours for NOTHING. The trap defeated itself.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 3 — The Canvas of the Cosmos
    {
      title: '🎨 The Canvas of the Cosmos',
      blurb: "Over-Clock sends Blur-Bunnies to eat the ship. Star-Sloth paints a tunnel. They run into it.",
      words: [
        { word: 'contemplate', definition: 'To think deeply about something.' },
        { word: 'frantic',     definition: 'Wild with worry, fear, or hurry.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'I have released the Blur-Bunnies onto their hull! They eat everything! MWAHAHA!',
          bubbleType: 'shout', sfx: null },
        { caption: '🐰 BLUR-BUNNIES ON THE HULL! 🐰',
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: "Don't contemplate it — DO something! They are eating through the WALLS!",
          bubbleType: 'shout', sfx: 'MUNCH MUNCH' },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'FRANTIC SWATTING IS DEFINITELY WORKING. IT IS ABSOLUTELY WORKING.',
          bubbleType: 'shout', sfx: 'BOING BOING BOING' },
        { caption: 'STAR-SLOTH GOES TO THE SUPPLY CUPBOARD.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...I will contemplate this...',
          bubbleType: 'thought', sfx: null },
        { caption: 'THREE HOURS LATER. STAR-SLOTH PAINTS.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: null },
        { caption: 'A HYPER-REALISTIC 3D TUNNEL APPEARS ON THE BLAST DOOR.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'WHY ARE THEY RUNNING INTO A WALL?! This was not part of my plan!',
          bubbleType: 'shout', sfx: 'BONK BONK BONK' },
        { caption: 'BUNNIES PILED UP. HULL INTACT. STAR-SLOTH RETURNS TO HIS CHAIR.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...contemplation complete...',
          bubbleType: 'thought', sfx: null },
        { caption: 'HULL SAVED. OVER-CLOCK DEFEATED.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'He stopped to contemplate! We were frantic and achieved nothing. He painted his way to victory against Over-Clock.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 4 — The Fast-Forward Fiasco
    {
      title: '⚡ The Fast-Forward Fiasco',
      blurb: "Over-Clock's Caffeine-Cannon forces Star-Sloth to scurry. The chaos destroys the villain.",
      words: [
        { word: 'scurried',  definition: 'Moved quickly with short, hurried steps.' },
        { word: 'meandered', definition: 'Moved or followed a path with many gentle bends.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'My Caffeine-Cannon will stop Star-Sloth from meandering! He will scurry and DESTROY HIMSELF! ZAP!',
          bubbleType: 'shout', sfx: 'ZAP' },
        { caption: 'STAR-SLOTH IS NOT CALIBRATED FOR SCURRYING.',
          char: 'starSloth', pose: 'action', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'CRASH' },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'HE SCURRIED INTO THAT DOOR! Now that wall! He NEVER scurried before! THIS IS BAD.',
          bubbleType: 'shout', sfx: 'OOF OOF OOF' },
        { caption: 'OVER-CLOCK ADVANCES, EXPECTING EASY VICTORY.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'He always meandered so gracefully! Now he has scurried into MY base! EXCELLENT!',
          bubbleType: 'shout', sfx: null },
        { caption: 'STAR-SLOTH SCURRIED LEFT INSTEAD OF STOPPING.',
          char: 'starSloth', pose: 'action', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'WHOOOOSH' },
        { caption: "A WATER COOLER LANDS ON OVER-CLOCK'S HOVER-BOOTS.",
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'MY BOOTS! AGAIN!',
          bubbleType: 'shout', sfx: 'SPLOSH — FZZZT' },
        { caption: 'CAFFEINE WEARS OFF. STAR-SLOTH MEANDERED BACK TO HIS CHAIR.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...I meandered home...',
          bubbleType: 'thought', sfx: null },
        { caption: 'OVER-CLOCK DEFEATED. ACCIDENTALLY.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'He meandered to victory via accidental scurrying. He always meandered. That was the whole plan. I think.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 5 — The Silent Treatment
    {
      title: '🤫 The Silent Treatment',
      blurb: "Over-Clock's spy won't crack under pressure. Star-Sloth sits silently until the spy begs him to stop.",
      words: [
        { word: 'stealthy',   definition: 'Quiet and careful so nobody notices.' },
        { word: 'scrutinise', definition: 'To examine something very carefully.' }
      ],
      panels: [
        { caption: '🕵️ A SPY HAS BEEN CAPTURED! 🕵️',
          char: 'admiral', pose: 'exploding', fullWidth: true, bg: '#FFF0E0',
          bubble: 'SCRUTINISE HIM! Get the passcode! Use every technique! Be stealthy! Be LOUD! Just GET IT!',
          bubbleType: 'shout', sfx: null },
        { caption: 'OVER-CLOCK MONITORS THE INTERROGATION FROM HIS LAIR.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'The Admiral will never be stealthy enough to scrutinise my agent. Never.',
          bubbleType: 'speech', sfx: null },
        { caption: 'THE ADMIRAL ATTEMPTS TO SCRUTINISE THE SPY.',
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: 'TELL ME THE PASSCODE! I AM BEING VERY STEALTHY RIGHT NOW!',
          bubbleType: 'shout', sfx: null },
        { caption: 'THE ADMIRAL GIVES UP. STAR-SLOTH IS LEFT ALONE WITH THE SPY.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: null },
        { caption: 'ONE HOUR. TWO HOURS. STAR-SLOTH BLINKS ONCE EVERY FIVE MINUTES.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: null },
        { caption: 'OVER-CLOCK WATCHES IN GROWING HORROR.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'WHY IS NOTHING HAPPENING?! SAY SOMETHING! SCRUTINISE HIM! DO ANYTHING!',
          bubbleType: 'shout', sfx: null },
        { caption: 'THREE HOURS OF SILENCE. THE SPY CRACKS.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'FINE! Here is the passcode!' },
        { caption: 'PASSCODE RETRIEVED. GALAXY SAFE. OVER-CLOCK CANNOT BELIEVE IT.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'He was stealthier than any spy! He scrutinised everything by scrutinising nothing. Pure genius.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 6 — The Slow-Cooked Trap
    {
      title: '🍲 The Slow-Cooked Trap',
      blurb: "Over-Clock sends space-pirates. Star-Sloth's four-hour oatmeal floods the corridors and traps them.",
      words: [
        { word: 'lingered', definition: 'Stayed longer than expected.' },
        { word: 'drifted',  definition: 'Moved slowly and lightly.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'I have dispatched pirates to board their ship! They have already drifted through every airlock!',
          bubbleType: 'shout', sfx: null },
        { caption: '6:00 AM. STAR-SLOTH MAKES OATMEAL.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...the aroma lingered... so nicely...',
          bubbleType: 'thought', sfx: null },
        { caption: 'JOLT BURSTS IN.',
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'STAR-SLOTH! PIRATES HAVE DRIFTED THROUGH EVERY AIRLOCK! DO SOMETHING!',
          bubbleType: 'shout', sfx: null },
        { caption: 'STAR-SLOTH STIRS THE OATMEAL.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...it lingers on the heat so well...',
          bubbleType: 'thought', sfx: null },
        { caption: 'JOLT TRIES TO FIGHT THE PIRATES. GETS SWATTED.',
          char: 'jolt', pose: 'translating', fullWidth: false, bg: '#EEEEFF',
          bubble: 'OW.',
          bubbleType: 'speech', sfx: null },
        { caption: '10:00 AM. THE OATMEAL HAS LINGERED ON THE HEAT FAR TOO LONG.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'GLORP GLORP' },
        { caption: 'STICKY PORRIDGE DRIFTED DOWN EVERY CORRIDOR. PIRATES STUCK.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'My pirates drifted into a PORRIDGE TRAP?! What IS this stuff?! MY BOOTS! AGAIN!',
          bubbleType: 'shout', sfx: 'SQUELCH' },
        { caption: 'STAR-SLOTH FINALLY TAKES ONE SPOONFUL.',
          char: 'starSloth', pose: 'zen', fullWidth: true, bg: '#E8FFE8',
          bubble: null, bubbleType: null, sfx: null }
      ]
    },

    // Story 7 — The Password Panic
    {
      title: '🔐 The Password Panic',
      blurb: "Over-Clock triggers the self-destruct. Jolt panics through two wrong guesses. Star-Sloth is resolute.",
      words: [
        { word: 'rational',  definition: 'Based on reason and clear thinking, rather than emotion.' },
        { word: 'resolute',  definition: 'Very determined and sure.' },
        { word: 'agitated',  definition: 'Upset and unable to stay calm.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'I have triggered their self-destruct remotely! 10 minutes! 3 attempts! MWAHAHA!',
          bubbleType: 'shout', sfx: null },
        { caption: '💥 SELF-DESTRUCT INITIATED. 10 MINUTES. 3 ATTEMPTS. 💥',
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: 'Stay rational, everyone! We MUST be rational! BE RATIONAL!',
          bubbleType: 'shout', sfx: null },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: "PASSWORD123! BZZT. 12345678! BZZT. One try left. I am NOT rational. I AM AGITATED.",
          bubbleType: 'shout', sfx: null },
        { caption: 'STAR-SLOTH SLOWLY PUSHES JOLT ASIDE. NINE MINUTES PASS.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: null },
        { caption: 'OVER-CLOCK WATCHES, CERTAIN OF VICTORY.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'He cannot stay resolute with 10 seconds left! No one can! IMPOSSIBLE!',
          bubbleType: 'speech', sfx: 'BEEP BEEP BEEP' },
        { caption: 'ONE CHARACTER. PER SECOND. RESOLUTE.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'click... click... click' },
        { caption: 'DEACTIVATED. OVER-CLOCK SCREAMS INTO THE VOID.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'RESOLUTE?! He was RESOLUTE?! How is a sloth MORE RESOLUTE THAN ME?!',
          bubbleType: 'shout', sfx: null },
        { caption: 'EVERYONE LIVES.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'He was rational when I was agitated. Resolute when I was screaming. Over-Clock is defeated again.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 8 — The Slow and Steady Stroll
    {
      title: '🪨 The Slow and Steady Stroll',
      blurb: "Over-Clock fires everything at the ship. Going 1 mph means the shields absorb every hit.",
      words: [
        { word: 'diligent', definition: 'Hard-working and careful.' },
        { word: 'reckless', definition: 'Doing dangerous things without thinking.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'They must cross the Criss-Cross Asteroid Field! Every reckless pilot who sped through it was destroyed!',
          bubbleType: 'shout', sfx: null },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'We need to be reckless fast! Being diligent wastes time! FULL SPEED AHEAD!',
          bubbleType: 'shout', sfx: 'SCRAPE SCRAPE CRUNCH' },
        { caption: 'STAR-SLOTH TAKES THE WHEEL. DROPS SPEED TO 1 MPH.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...diligent... and careful...',
          bubbleType: 'thought', sfx: null },
        { caption: 'THE ADMIRAL IS APPALLED.',
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: 'WE WILL BE SITTING DUCKS! Over-Clock will fire everything at us!',
          bubbleType: 'shout', sfx: null },
        { caption: 'OVER-CLOCK FIRES EVERYTHING.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'Why. Will. They. Not. HIT?!',
          bubbleType: 'shout', sfx: 'boing boing boing' },
        { caption: 'DILIGENT SLOWNESS. SHIELDS ABSORB EVERY TAP.',
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: 'bonk... bonk... bonk' },
        { caption: "OVER-CLOCK'S AMMUNITION RUNS OUT.",
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'EMPTY?! I wasted EVERYTHING on a diligent sloth going ONE MILE PER HOUR?!',
          bubbleType: 'shout', sfx: 'click click click' },
        { caption: 'THROUGH WITHOUT A SCRATCH.',
          char: 'jolt', pose: 'translating', fullWidth: true, bg: '#E8FFE8',
          bubble: 'Reckless speed would have destroyed us. Diligent slowness meant Over-Clock wasted all his ammunition. Beautiful.',
          bubbleType: 'speech', sfx: null }
      ]
    },

    // Story 9 — The Pre-Emptive Strike
    {
      title: '🎯 The Pre-Emptive Strike',
      blurb: "Over-Clock's laser fires at noon. Star-Sloth's ship drifts into the barrel by accident at 11:59.",
      words: [
        { word: 'drifted',   definition: 'Moved slowly and lightly.' },
        { word: 'opportune', definition: 'Happening at a particularly suitable or favourable time.' },
        { word: 'wandered',  definition: 'Moved around without a clear plan.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR. 6:00 AM.",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: 'My laser fires at NOON — the most opportune moment in galactic history! MWAHAHAHA!',
          bubbleType: 'shout', sfx: null },
        { caption: 'STAR-SLOTH LEANS ON THE LAUNCH LEVER. BY ACCIDENT.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: null, bubbleType: null, sfx: '...zz...' },
        { caption: null,
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'The ship has wandered into a launch sequence! STAR-SLOTH?! STAR-SLOTH?!',
          bubbleType: 'shout', sfx: null },
        { caption: 'THE SHIP DRIFTED. AT 1 MPH. HEADING NOWHERE IN PARTICULAR.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...I have drifted this way before... peaceful...',
          bubbleType: 'thought', sfx: null },
        { caption: '11:58 AM. OVER-CLOCK CHECKS HIS WATCH.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'Two minutes. Nothing can stop me. Not even a sloth who wandered off course.',
          bubbleType: 'speech', sfx: 'tick tick tick' },
        { caption: '11:59. THE SHIP DRIFTED DIRECTLY INTO THE CANNON BARREL.',
          char: 'jolt', pose: 'translating', fullWidth: false, bg: '#EEEEFF',
          bubble: 'We have drifted into the barrel. We have drifted. INTO. THE BARREL.',
          bubbleType: 'shout', sfx: null },
        { caption: 'NOON.',
          char: 'overClock', pose: 'meltdown', fullWidth: false, bg: '#FFE8E8',
          bubble: 'MY OWN BASE! MY OWN OPPORTUNE MOMENT! RUINED BY A WANDERING SLOTH!',
          bubbleType: 'shout', sfx: 'KA-BLOOOM' },
        { caption: 'STAR-SLOTH THOUGHT HE WAS GOING FOR A MORNING DRIVE.',
          char: 'starSloth', pose: 'blink', fullWidth: true, bg: '#E8FFE8',
          bubble: '...I simply wandered and drifted...',
          bubbleType: 'thought', sfx: null }
      ]
    },

    // Story 10 — The Un-Chase Scene
    {
      title: '🏅 The Un-Chase Scene',
      blurb: "Over-Clock's swift thief steals the Admiral's medal. Everyone chases. Star-Sloth waits. The thief runs into his hand.",
      words: [
        { word: 'serene', definition: 'Calm and peaceful.' },
        { word: 'placid', definition: 'Calm and peaceful, without strong movement or emotion.' },
        { word: 'swift',  definition: 'Very fast.' }
      ],
      panels: [
        { caption: "IN OVER-CLOCK'S LAIR...",
          char: 'overClock', pose: 'smug', fullWidth: true, bg: '#FFE8F8',
          bubble: "I have sent my most swift thief to steal the Admiral's medal! He is TOO SWIFT to be caught!",
          bubbleType: 'shout', sfx: null },
        { caption: "THE ADMIRAL'S MEDAL HAS BEEN STOLEN!",
          char: 'admiral', pose: 'exploding', fullWidth: false, bg: '#FFF0E0',
          bubble: 'A swift thief! HE IS TOO SWIFT! ALL UNITS — AFTER HIM!',
          bubbleType: 'shout', sfx: 'ZOOOOOM' },
        { caption: 'JOLT AND THE SPACE-COPS SPRINT LAPS AROUND THE CIRCULAR STATION.',
          char: 'jolt', pose: 'zoom', fullWidth: false, bg: '#EEEEFF',
          bubble: 'OW OW OW.',
          bubbleType: 'speech', sfx: 'SLIP' },
        { caption: 'STAR-SLOTH DOES NOT CHASE. ONE STEP FORWARD. HAND OUTSTRETCHED.',
          char: 'starSloth', pose: 'zen', fullWidth: false, bg: '#FFFDE7',
          bubble: '...serene...',
          bubbleType: 'thought', sfx: null },
        { caption: 'OVER-CLOCK WATCHES, CONFIDENT.',
          char: 'overClock', pose: 'smug', fullWidth: false, bg: '#FFE8F8',
          bubble: 'A serene, placid sloth cannot catch a swift thief. This is mathematically impossible.',
          bubbleType: 'speech', sfx: null },
        { caption: 'LAP 7. EVERYONE EXHAUSTED.',
          char: 'jolt', pose: 'translating', fullWidth: false, bg: '#EEEEFF',
          bubble: 'Star-Sloth is so placid! How can he be so serene while we are all collapsing?!',
          bubbleType: 'shout', sfx: 'wheeze wheeze' },
        { caption: "THE SWIFT THIEF RUNS A FULL CIRCLE AND SPRINTS INTO STAR-SLOTH'S OPEN HAND.",
          char: 'starSloth', pose: 'blink', fullWidth: false, bg: '#FFFDE7',
          bubble: '...I simply stayed serene...',
          bubbleType: 'thought', sfx: 'BONK' },
        { caption: 'MEDAL RETURNED. OVER-CLOCK FURIOUS. NOT A DROP OF SWEAT.',
          char: 'jolt', pose: 'zoom', fullWidth: true, bg: '#E8FFE8',
          bubble: 'Serene. Placid. Correct. The swift thief was stopped by the stillest hero. Over-Clock is baffled again.',
          bubbleType: 'speech', sfx: null }
      ]
    }

  ];


  var COMIC_SVG = {
    starSloth: svgStarSloth,
    jolt:      svgJolt,
    admiral:   svgAdmiral,
    overClock: svgOverClock
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function comicHighlight(text, words) {
    var result = text;
    words.forEach(function (wObj) {
      var esc = wObj.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      var re  = new RegExp('\\b(' + esc + ')\\b', 'gi');
      result  = result.replace(re, '<strong class="comic-vocab-word">$1</strong>');
    });
    return result;
  }

  var PANEL_TILTS = [-0.6, 0.4, -0.3, 0.5, -0.4, 0.35];

  function buildPanelHTML(panelDef, words, idx) {
    var tilt    = panelDef.fullWidth ? 0 : (PANEL_TILTS[idx % PANEL_TILTS.length] || 0);
    var svgFn   = COMIC_SVG[panelDef.char] || svgStarSloth;
    var svgHtml = svgFn(panelDef.pose || 'zen');
    var bubbleText = panelDef.bubble ? comicHighlight(panelDef.bubble, words) : '';
    var captionHtml = panelDef.caption
      ? '<div class="panel-caption">' + panelDef.caption + '</div>'
      : '';
    var bubbleClass = 'comic-bubble bubble-' + (panelDef.bubbleType || 'speech');
    var bubbleHtml  = bubbleText
      ? '<div class="' + bubbleClass + '">' + bubbleText + '</div>'
      : '';
    var sfxHtml = panelDef.sfx
      ? '<div class="panel-sfx">' + panelDef.sfx + '</div>'
      : '';
    return '<div class="comic-panel' + (panelDef.fullWidth ? ' full-width' : '') + '"' +
      ' style="--panel-tilt:' + tilt + 'deg;background:' + (panelDef.bg || '#FFFDE7') + '">' +
      captionHtml +
      '<div class="panel-stage">' +
      '<div class="panel-char-svg">' + svgHtml + '</div>' +
      bubbleHtml +
      '</div>' +
      sfxHtml +
      '</div>';
  }

  function renderComicPanels(panels, words) {
    comicPanelsContainer.innerHTML = '';
    var html = '';
    panels.forEach(function (panel, i) { html += buildPanelHTML(panel, words, i); });
    comicPanelsContainer.innerHTML = html;

    var glossaryItems = words.map(function (w) {
      return '<div class="glossary-item">' +
        '<span class="glossary-word">' + w.word + '</span>' +
        '<span class="glossary-def">' + w.definition + '</span>' +
        '</div>';
    }).join('');
    comicGlossaryEl.innerHTML =
      '<div class="glossary-title">⚡ JOLT\'S VOCAB FILE</div>' +
      '<div class="glossary-items">' + glossaryItems + '</div>';
  }

  // ── Library & display ──────────────────────────────────────────────────────

  function showComicLibrary() {
    comicLibraryScreen.classList.remove('hidden');
    comicViewingScreen.classList.add('hidden');
    comicCloseBtn.focus();
  }

  function showComic(idx) {
    var story = COMIC_STORIES[idx];
    renderComicPanels(story.panels, story.words);
    comicLibraryScreen.classList.add('hidden');
    comicViewingScreen.classList.remove('hidden');
    comicViewingScreen.scrollTop = 0;
    comicBackBtn.focus();
  }

  function renderComicLibrary() {
    comicStoryList.innerHTML = '';
    COMIC_STORIES.forEach(function (story, idx) {
      var card = document.createElement('button');
      card.type = 'button';
      card.className = 'comic-story-card';
      var wordChips = story.words.map(function (w) {
        return '<span class="comic-card-word">' + w.word + '</span>';
      }).join('');
      card.innerHTML =
        '<span class="comic-card-title">' + story.title + '</span>' +
        '<span class="comic-card-blurb">' + story.blurb + '</span>' +
        '<div class="comic-card-words">' + wordChips + '</div>';
      card.addEventListener('click', function () { showComic(idx); });
      comicStoryList.appendChild(card);
    });
  }

  function openComicOverlay() {
    renderComicLibrary();
    showComicLibrary();
    comicOverlay.classList.remove('hidden');
    comicOverlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  }

  function closeComicOverlay() {
    comicOverlay.classList.add('hidden');
    comicOverlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (comicLaunchBtn) comicLaunchBtn.focus();
  }

  function initComicMode() {
    comicLaunchBtn.addEventListener('click', openComicOverlay);
    comicCloseBtn.addEventListener('click', closeComicOverlay);
    comicViewerCloseBtn.addEventListener('click', closeComicOverlay);
    comicBackBtn.addEventListener('click', function () {
      showComicLibrary();
    });
    comicPrintBtn.addEventListener('click', function () {
      document.body.classList.add('comic-printing');
      window.addEventListener('afterprint', function handler() {
        document.body.classList.remove('comic-printing');
        window.removeEventListener('afterprint', handler);
      });
      window.print();
    });
    comicOverlay.addEventListener('click', function (e) {
      if (e.target === comicOverlay) closeComicOverlay();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (comicOverlay.classList.contains('hidden')) return;
      closeComicOverlay();
    });
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
