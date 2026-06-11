// 11+ Vocab Builder — main application (native ES module; no build step).
// Loaded via <script type="module">, so it is deferred and module-scoped
// (top-level var/function declarations are NOT globals), exactly as the
// previous IIFE wrapper guaranteed.
'use strict';

import {
  forEachNode,
  closestByClass,
  shuffle,
  pickDistractors,
  getSentenceBlank,
  wordVariants,
} from './dom-utils.js';

import { setWords, findWordByName } from './data.js';
import { viewCounts, mastery } from './store.js';
import {
  loadViewCounts,
  incrementViewCount,
  loadMastery,
  getMasteryStatus,
  recordAnswer,
} from './storage.js';
import { pickDailyWords, buildWeakestPool } from './selection.js';
import { getMeanings, additionalMeanings } from './meanings.js';
import {
  caseInsensitiveSet,
  getThemedQuest,
  getQuestSentenceBlank,
  getThemedRelation,
  hasUsableThemedRelation,
  getQuestionTypesForWord as getQuestionTypesForWordPure,
} from './quiz.js';
import { pickPraise, buildWrongFeedback, getScoreTier, getBlitzTier, getBlitzScore } from './game-feedback.js';
import { celebrateBurst, celebrateToast } from './celebrate.js';
import {
  computeMasteryCounts,
  wordsReadyToMaster,
  summarizeCollection,
  effectiveStreak as effectiveStreakPure,
  bumpDailyStreak,
  buildCtaSuggestions,
} from './progress-stats.js';

  // ── State ──────────────────────────────────────────────────────────────────
  var allWords = [];
  var lastFocusedCard = null;

  // ── TTS preference keys (persisted in localStorage; used by the TTS code) ───
  var TTS_VOICE_KEY   = '11plus-tts-voice';
  var TTS_PITCH_KEY   = '11plus-tts-pitch';
  // viewCounts state + load/save/increment → moved to js/store.js + js/storage.js.

  // ── Mastery + view-count state and persistence ─────────────────────────────
  // mastery state + load/save/getMasteryStatus/recordAnswer
  // → moved to js/store.js + js/storage.js (imported above).

  // recordAnswer + a toast/burst the moment a word's status flips to mastered.
  // All in-app mastery recording goes through this wrapper (hoisted function
  // declaration, so the window bridge below can reference it).
  function recordAnswerCelebrated(wordName, isCorrect) {
    var result = recordAnswer(wordName, isCorrect);
    if (result && result.becameMastered) {
      celebrateToast('🌟', wordName + ' mastered!', 'You really know this word now');
      celebrateBurst(null, { count: 18 });
    }
    return result;
  }

  // Bridge so the Constellation Quest game module (its own file) can feed the
  // shared mastery system when the player captures words.
  window.vaultRecordAnswer = recordAnswerCelebrated;

  // ── Home dashboard (progress at a glance + cross-game daily streak) ─────────
  // Reading modes register here so the dashboard can offer "Continue <mode>"
  // chips and (Phase 4) per-collection badges. The activity streak is separate
  // from the Daily News streak: it means "finished any game today".
  var ACTIVITY_STREAK_KEY = 'vocabVault_activityStreak';
  var activityData = { streak: 0, lastDate: null };
  var homeCollections = [];

  function loadActivityStreak() {
    try {
      var parsed = JSON.parse(localStorage.getItem(ACTIVITY_STREAK_KEY));
      if (parsed && typeof parsed.streak === 'number') {
        activityData = { streak: parsed.streak, lastDate: parsed.lastDate || null };
      }
    } catch (e) {}
  }

  // Called from every game's end screen; only persists once per day.
  function markActivityToday() {
    var r = bumpDailyStreak(activityData, todayKey(), yesterdayKey());
    if (!r.bumped) return;
    activityData = { streak: r.streak, lastDate: r.lastDate };
    try { localStorage.setItem(ACTIVITY_STREAK_KEY, JSON.stringify(activityData)); } catch (e) {}
    renderHomeDashboard();
  }

  function registerHomeCollection(entry) {
    homeCollections.push(entry);
  }

  function findHomeCollection(id) {
    for (var i = 0; i < homeCollections.length; i++) {
      if (homeCollections[i].id === id) return homeCollections[i];
    }
    return null;
  }

  function renderHomeDashboard() {
    var dash = document.getElementById('home-dashboard');
    if (!dash || !allWords.length) return;
    dash.classList.remove('hidden');

    var counts = computeMasteryCounts(allWords, getMasteryStatus);
    document.getElementById('dash-mastered-count').textContent = counts.mastered;
    document.getElementById('dash-learning-count').textContent = counts.learning;
    document.getElementById('dash-progress-fill').style.width = counts.pct + '%';
    document.getElementById('dash-progress-label').textContent =
      counts.mastered + ' of ' + counts.total + ' words mastered';
    var track = document.getElementById('dash-progress-track');
    track.setAttribute('aria-valuemax', counts.total);
    track.setAttribute('aria-valuenow', counts.mastered);

    var streak = effectiveStreakPure(activityData, todayKey(), yesterdayKey());
    document.getElementById('dash-streak').textContent = streak > 0
      ? '🔥 ' + streak + '-day streak'
      : 'Finish any game today to start a streak!';

    var readyCount = wordsReadyToMaster(allWords, mastery).length;
    var collections = homeCollections.map(function (c) {
      var s = c.summarize();
      return {
        id: c.id,
        label: c.label,
        read: s.read,
        total: s.total,
        nextTitle: s.next ? s.next.title : null
      };
    });
    var ctas = buildCtaSuggestions({ collections: collections, readyCount: readyCount });

    var row = document.getElementById('dash-cta-row');
    row.innerHTML = '';
    ctas.forEach(function (cta) {
      var chip = document.createElement('button');
      chip.className = 'dash-cta-chip';
      chip.type = 'button';
      chip.textContent = cta.label;
      if (cta.kind === 'quiz') {
        chip.addEventListener('click', function () {
          // Recompute on click — mastery may have moved since render.
          var ready = shuffle(wordsReadyToMaster(allWords, mastery)).slice(0, 8);
          if (ready.length) startScopedQuiz(ready, {});
        });
      } else {
        chip.addEventListener('click', function () {
          var entry = findHomeCollection(cta.id);
          if (entry) entry.openNext();
        });
      }
      row.appendChild(chip);
    });
    row.classList.toggle('hidden', ctas.length === 0);
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
      w.el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
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

  // forEachNode, closestByClass → moved to js/dom-utils.js (imported above).

  // findWordByName → moved to js/data.js (O(1) Map lookup; imported above).


  function wireWordUniverse(words) {
    var attempts = 0;
    function tryInit() {
      if (typeof window.initWordUniverse === 'function') {
        window.initWordUniverse(words, openModal);
        return;
      }
      if (attempts++ < 80) setTimeout(tryInit, 50);
    }
    tryInit();
  }

  function wireConstellationQuest(words) {
    var attempts = 0;
    function tryInit() {
      if (typeof window.initConstellationQuest === 'function') {
        window.initConstellationQuest(words, openModal);
        return;
      }
      if (attempts++ < 80) setTimeout(tryInit, 50);
    }
    tryInit();
  }

  function wireExplorerExtras(words) {
    if (typeof window.initMoodMap === 'function') {
      window.initMoodMap(words, openModal);
    }
    if (typeof window.initWordPortrait === 'function') {
      window.initWordPortrait(words, openModal);
    }
    if (typeof window.initWordRootsGarden === 'function') {
      window.initWordRootsGarden(words, openModal);
    }
    if (typeof window.initAnimalConstellation === 'function') {
      window.initAnimalConstellation(words, openModal);
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    loadViewCounts();
    loadMastery();
    loadActivityStreak();
    initTapToJump();
    loadWordData();
  }

  // Render a centred status message in the word grid (reuses .empty-state).
  function showGridMessage(emoji, title, message, actionLabel, actionFn) {
    if (!wordGrid) return;
    var div = document.createElement('div');
    div.className = 'empty-state';

    var emojiEl = document.createElement('span');
    emojiEl.className = 'empty-state-emoji';
    emojiEl.textContent = emoji;
    div.appendChild(emojiEl);

    var heading = document.createElement('h3');
    heading.textContent = title;
    div.appendChild(heading);

    var para = document.createElement('p');
    para.textContent = message;
    div.appendChild(para);

    if (actionLabel && actionFn) {
      var btn = document.createElement('button');
      btn.className = 'filter-btn';
      btn.type = 'button';
      btn.textContent = actionLabel;
      btn.addEventListener('click', actionFn);
      div.appendChild(btn);
    }

    wordGrid.innerHTML = '';
    wordGrid.appendChild(div);
  }

  function loadWordData() {
    showGridMessage('📚', 'Loading words…', 'Just a moment while the word list loads.');
    fetch('data/words.json')
      .then(function (res) {
        if (!res.ok) throw new Error('Failed to load words (HTTP ' + res.status + ')');
        return res.json();
      })
      .then(function (data) {
        allWords = data.words;
        setWords(allWords);
        updateWordCountDisplay(allWords.length);
        renderCards(allWords);
        attachEventListeners();
        initGloss();
        initStoryMode();
        initHistoryMode();
        initMoneyMode();
        initAnimalsMode();
        initInsectsMode();
        initSpaceMode();
        initTechMode();
        initForcesMode();
        initStreetSmartsMode();
        initFableMode();
        initProverbsMode();
        initDailyNews();
        initComicMode();
        initQuiz();
        initDetectiveMode();
        initScrambleMode();
        initFlashBlitz();
        initSynonymSnap();
        initWildMode();
        wireWordUniverse(allWords);
        wireConstellationQuest(allWords);
        wireExplorerExtras(allWords);
        renderHomeDashboard();
        var allScopeBtn = document.getElementById('quiz-scope-all-btn');
        if (allScopeBtn) {
          allScopeBtn.textContent = 'All ' + allWords.length + ' words';
        }
      })
      .catch(function () {
        showGridMessage(
          '⚠️',
          'Couldn’t load the words',
          'Please check your internet connection and try again.',
          'Try again',
          loadWordData
        );
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

    var extraMeanings = additionalMeanings(word);
    if (extraMeanings.length > 0) {
      var more = document.createElement('div');
      more.className = 'card-more-meanings';
      extraMeanings.forEach(function (m) {
        var row = document.createElement('p');
        row.className = 'card-more-meaning';
        var pos = document.createElement('span');
        pos.className = 'card-more-pos';
        pos.textContent = m.word_type;
        row.appendChild(pos);
        row.appendChild(document.createTextNode(' ' + m.definition));
        more.appendChild(row);
      });
      article.appendChild(more);
    }

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

  // Build a DOM block for one sense (part-of-speech + definition + example +
  // synonyms/antonyms), used by the modal's "Other meanings" section.
  function buildMeaningBlock(m) {
    var block = document.createElement('div');
    block.className = 'extra-meaning';

    var head = document.createElement('p');
    head.className = 'extra-meaning-head';
    var pos = document.createElement('span');
    pos.className = 'extra-meaning-pos';
    pos.textContent = m.word_type;
    head.appendChild(pos);
    head.appendChild(document.createTextNode(' ' + m.definition));
    block.appendChild(head);

    // Heteronyms (e.g. the noun "abuse") carry their own pronunciation, since the
    // word-level one shown above belongs to the primary sense.
    if (m.pronunciation) {
      var pron = document.createElement('p');
      pron.className = 'extra-meaning-pron';
      pron.textContent = 'Said: ' + m.pronunciation;
      block.appendChild(pron);
    }

    if (m.sentence_usage) {
      var ex = document.createElement('p');
      ex.className = 'extra-meaning-example';
      ex.textContent = m.sentence_usage;
      block.appendChild(ex);
    }

    var rel = [];
    if (m.synonyms && m.synonyms.length) rel.push('Synonyms: ' + m.synonyms.join(', '));
    if (m.antonyms && m.antonyms.length) rel.push('Antonyms: ' + m.antonyms.join(', '));
    if (rel.length) {
      var relEl = document.createElement('p');
      relEl.className = 'extra-meaning-rel';
      relEl.textContent = rel.join('   ·   ');
      block.appendChild(relEl);
    }
    return block;
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
  function updateFilterSummary() {
    var el = document.getElementById('filters-preview');
    if (!el) return;
    var parts = [];
    if (state.query) {
      parts.push('"' + state.query + '"');
    }
    if (state.ratingFilter !== null) {
      var stars = '';
      for (var i = 0; i < state.ratingFilter; i++) stars += '★';
      parts.push(stars);
    }
    if (state.unviewedOnly) parts.push('Not viewed');
    if (state.masteryFilter && state.masteryFilter !== 'all') {
      parts.push(state.masteryFilter.charAt(0).toUpperCase() + state.masteryFilter.slice(1));
    }
    el.textContent = parts.length ? parts.join(' · ') : 'All words';
  }

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

    updateFilterSummary();

    renderCards(results);

    // Every overlay-close path funnels through here, so the dashboard's
    // mastery numbers stay fresh after any game or reading session.
    renderHomeDashboard();
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

    // "Other meanings": the senses beyond the primary (which is shown above).
    var extraSection = document.getElementById('modal-extra-meanings');
    var extraList = document.getElementById('modal-extra-meanings-list');
    if (extraSection && extraList) {
      extraList.innerHTML = '';
      var extra = additionalMeanings(wordObj);
      extra.forEach(function (m) { extraList.appendChild(buildMeaningBlock(m)); });
      extraSection.classList.toggle('hidden', extra.length === 0);
    }

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
  // As a module this script is deferred, so DOMContentLoaded may already have
  // fired by the time we reach this line. Run init() now if the DOM is ready,
  // otherwise wait for the event.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

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
    onComplete   : null,
    answered     : false
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
  var quizFeedbackText   = document.getElementById('quiz-feedback-text');
  var quizFeedbackDetail = document.getElementById('quiz-feedback-detail');
  var quizNextBtn        = document.getElementById('quiz-next-btn');

  var quizEndScreen      = document.getElementById('quiz-end-screen');
  var quizEndEmoji       = document.getElementById('quiz-end-emoji');
  var quizEndTitle       = document.getElementById('quiz-end-title');
  var quizEndScore       = document.getElementById('quiz-end-score');
  var quizEndBest        = document.getElementById('quiz-end-best');
  var quizReview         = document.getElementById('quiz-review');
  var quizReviewList     = document.getElementById('quiz-review-list');
  var quizPlayAgainBtn   = document.getElementById('quiz-play-again-btn');
  var quizBackBtn        = document.getElementById('quiz-back-btn');

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
    } else if (returnTo === 'proverbs') {
      reopenProverbsReading();
    } else if (readingReturnHandlers[returnTo]) {
      readingReturnHandlers[returnTo]();
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
  // shuffle, pickDistractors, getSentenceBlank → moved to js/dom-utils.js.

  // Theme-aware sentences generated per word (see TOKEN_COST_ESTIMATE.md).
  // Question-eligibility helpers (getThemedQuest, getQuestSentenceBlank,
  // getThemedRelation, hasUsableThemedRelation, caseInsensitiveSet, and the pure
  // getQuestionTypesForWord) → moved to js/quiz.js (pure + unit-tested). This
  // wrapper threads the live quest-mode flag into the pure version.
  function getQuestionTypesForWord(wordObj) {
    return getQuestionTypesForWordPure(wordObj, quizState.isQuestMode);
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

  // buildWeakestPool → moved to js/selection.js (pure + unit-tested). It is
  // called below as buildWeakestPool(allWords, mastery, getMasteryStatus,
  // quizState.length, shuffle).

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
      ? buildWeakestPool(allWords, mastery, getMasteryStatus, quizState.length, shuffle)
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

    // Answer buttons — numbered so the 1-4 keys (and spoken guidance) map to a
    // visible badge on each choice.
    quizAnswersGrid.innerHTML = '';
    q.choices.forEach(function (choice, i) {
      var btn = document.createElement('button');
      btn.className    = 'quiz-answer-btn';
      btn.dataset.idx  = i;
      btn.setAttribute('aria-pressed', 'false');
      var num = document.createElement('span');
      num.className = 'quiz-answer-num';
      num.setAttribute('aria-hidden', 'true');
      num.textContent = String(i + 1);
      var label = document.createElement('span');
      label.className = 'quiz-answer-label';
      label.textContent = choice;
      btn.appendChild(num);
      btn.appendChild(label);
      quizAnswersGrid.appendChild(btn);
    });

    // Clear feedback; the child answers at their own pace, so hide Next until
    // an answer is in.
    quizState.answered = false;
    quizFeedback.className = 'quiz-feedback';
    quizFeedbackText.textContent = '';
    quizFeedbackDetail.textContent = '';
    quizNextBtn.classList.add('hidden');

    // Move focus away from the answer grid after each re-render so the
    // previously chosen answer position does not look preselected.
    if (quizQuestionScreen) {
      quizQuestionScreen.setAttribute('tabindex', '-1');
      quizQuestionScreen.focus({ preventScroll: true });
    }
  }

  // ── Answer handling ────────────────────────────────────────────────────────
  // Praise/wrong-feedback phrasing → moved to js/game-feedback.js (pure + tested).

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
    recordAnswerCelebrated(q.questionWord.word, isCorrect);

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
      quizFeedbackText.textContent = pickPraise(quizState.streak);
      quizFeedbackDetail.textContent = '';
    } else {
      var wrong = buildWrongFeedback(q.type, q.questionWord, q.choices[q.correctIndex]);
      quizFeedbackText.textContent = wrong.headline;
      quizFeedbackDetail.textContent = wrong.detail;
    }

    // The child advances at their own pace: Next button, Enter/Space/→, the
    // 1-4 keys answered, or a tap anywhere on the question screen.
    quizState.answered = true;
    var isLast = quizState.currentIndex >= quizState.questions.length - 1;
    quizNextBtn.textContent = isLast ? 'See results →' : 'Next →';
    quizNextBtn.classList.remove('hidden');
    quizNextBtn.focus({ preventScroll: true });
  }

  function advanceQuiz() {
    if (!quizState.answered) return;
    quizState.answered = false;
    quizState.currentIndex++;
    if (quizState.currentIndex >= quizState.questions.length) {
      showEndScreen();
    } else {
      renderQuestion(quizState.currentIndex);
    }
  }

  // ── End screen ─────────────────────────────────────────────────────────────
  function showEndScreen() {
    markActivityToday();
    quizProgressFill.style.width = '100%';
    var score = quizState.score;
    var total = quizState.questions.length;

    var tier = getScoreTier(score, total);

    quizEndEmoji.textContent = tier.emoji;
    quizEndTitle.textContent = tier.title;
    quizEndScore.textContent = score + ' / ' + total + ' correct';

    var shouldBurst = total > 0 && score === total;

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
      shouldBurst = shouldBurst || isNewBest;
      // applyQuestRewards appends to the line above, so it must run after it.
      if (quizState.isQuestMode) {
        applyQuestRewards(score, total);
      }
    }

    renderQuizReview();
    showQuizScreen(quizEndScreen);
    revealEndScreen(quizEndScreen);
    if (shouldBurst) celebrateBurst(quizEndEmoji);
    quizPlayAgainBtn.focus();
  }

  // Re-trigger the staggered tier-reveal animation each time an end screen is
  // shown (CSS no-ops it under prefers-reduced-motion).
  function revealEndScreen(screenEl) {
    var inner = screenEl.querySelector('.quiz-end-inner');
    if (!inner) return;
    inner.classList.remove('quiz-end-reveal');
    void inner.offsetWidth; // restart the CSS animations
    inner.classList.add('quiz-end-reveal');
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
        celebrateToast('🗺️', 'Quest complete!', '+' + gainedXp + ' XP · +' + bonusCoins + ' coins');
        celebrateBurst();
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

    quizNextBtn.addEventListener('click', advanceQuiz);

    // After answering, a tap anywhere on the question screen also advances.
    // Buttons are excluded: Next/Exit keep their own behaviour, and the
    // answering click itself bubbles here from a .quiz-answer-btn after
    // handleAnswer has already set quizState.answered.
    quizQuestionScreen.addEventListener('click', function (e) {
      if (!quizState.answered) return;
      if (closestByClass(e.target, 'quiz-next-btn')) return;
      if (closestByClass(e.target, 'quiz-exit-btn')) return;
      if (closestByClass(e.target, 'quiz-answer-btn')) return;
      advanceQuiz();
    });

    // Escape closes quiz overlay (separate guard from word-detail modal);
    // 1-4 answer the current question; Enter/Space/→ advance once answered.
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && !quizOverlay.classList.contains('hidden')) {
        closeQuizOverlay();
      }
      if (e.key === 'Escape' && !questOverlay.classList.contains('hidden')) {
        closeQuestOverlay();
      }

      if (quizOverlay.classList.contains('hidden')) return;
      if (quizQuestionScreen.classList.contains('hidden')) return;
      var tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;

      if (!quizState.answered && e.key >= '1' && e.key <= '4') {
        var btns = quizAnswersGrid.querySelectorAll('.quiz-answer-btn');
        var idx = parseInt(e.key, 10) - 1;
        if (btns[idx] && !btns[idx].disabled) handleAnswer(idx);
        return;
      }

      if (quizState.answered) {
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          advanceQuiz();
        } else if ((e.key === 'Enter' || e.key === ' ') && tag !== 'BUTTON') {
          // Focused buttons (Next, Exit) handle Enter/Space natively.
          e.preventDefault();
          advanceQuiz();
        }
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
  // wordVariants → moved to js/dom-utils.js.

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

  // Shared scroll behaviour for every reading panel:
  // • hides the vocab gloss  • updates the right-side progress fill
  // • collapses/restores the article title in the sticky header
  function initReadingScrollBehaviour(scrollEl, fillEl, panelEl) {
    scrollEl.setAttribute('tabindex', '0');
    scrollEl.addEventListener('scroll', function () {
      hideGloss();
      var max = scrollEl.scrollHeight - scrollEl.clientHeight;
      fillEl.style.height = (max > 0 ? (scrollEl.scrollTop / max * 100) : 0) + '%';
      var head = panelEl.querySelector('.reading-sticky-head');
      if (head) {
        if (scrollEl.scrollTop > 40) head.classList.add('compact');
        else if (scrollEl.scrollTop < 10) head.classList.remove('compact');
      }
    });
  }

  function resetReadingScroll(scrollEl, fillEl, panelEl) {
    scrollEl.scrollTop = 0;
    fillEl.style.height = '0%';
    var head = panelEl.querySelector('.reading-sticky-head');
    if (head) head.classList.remove('compact');
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
  var storyLibraryScroll = 0;  // remember story list scroll while reading a story

  var storyLaunchBtn     = document.getElementById('story-launch-btn');
  var storyOverlay       = document.getElementById('story-overlay');
  var storyLibraryScreen = document.getElementById('story-library-screen');
  var storyReadingScreen = document.getElementById('story-reading-screen');
  var storyCloseBtn      = document.getElementById('story-close-btn');
  var storyBackBtn       = document.getElementById('story-back-btn');
  var storyPrevBtn       = document.getElementById('story-prev-btn');
  var storyNextBtn       = document.getElementById('story-next-btn');
  var storyList          = document.getElementById('story-list');
  var storyReadingEmoji  = document.getElementById('story-reading-emoji');
  var storyReadingTitle  = document.getElementById('story-reading-title');
  var storyReadingBody   = document.getElementById('story-reading-body');
  var storyQuizBtn       = document.getElementById('story-quiz-btn');
  var storyScrollContent = document.getElementById('story-scroll-content');
  var storyScrollFill    = document.getElementById('story-scroll-fill');
  var storyReadingImageFigure  = document.getElementById('story-reading-image-figure');
  var storyReadingImage        = document.getElementById('story-reading-image');
  var storyReadingImageCaption = document.getElementById('story-reading-image-caption');

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

  function updateStoryNavBtns() {
    var idx = stories.indexOf(currentStory);
    storyPrevBtn.disabled = (idx <= 0);
    storyNextBtn.disabled = (idx < 0 || idx >= stories.length - 1);
  }

  function openStory(story) {
    currentStory = story;
    var prog = storyProgress[story.id] || {};
    prog.read = true;
    storyProgress[story.id] = prog;
    saveStoryProgress();

    storyReadingEmoji.textContent = story.emoji;
    storyReadingTitle.textContent = story.title;
    if (story.image) {
      storyReadingImageFigure.classList.remove('article-image--broken');
      storyReadingImage.onerror = function () { storyReadingImageFigure.classList.add('article-image--broken'); };
      storyReadingImage.src = story.image.url;
      storyReadingImage.alt = story.image.caption;
      storyReadingImageCaption.textContent = story.image.caption + ' — ' + story.image.credit;
      storyReadingImageFigure.classList.remove('hidden');
    } else {
      storyReadingImage.onerror = null;
      storyReadingImage.src = '';
      storyReadingImage.alt = '';
      storyReadingImageCaption.textContent = '';
      storyReadingImageFigure.classList.remove('article-image--broken');
      storyReadingImageFigure.classList.add('hidden');
    }
    renderReadingBody(storyReadingBody, story.paragraphs, storyWordObjects(story), storyTTSBar);
    storyLibraryScroll = storyLibraryScreen.scrollTop;
    showStoryScreen(storyReadingScreen);
    resetReadingScroll(storyScrollContent, storyScrollFill, storyReadingScreen);
    updateStoryNavBtns();
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

    // Bespoke twin of the factory's dashboard registration.
    registerHomeCollection({
      id: 'story',
      label: 'Stories',
      launchBtn: storyLaunchBtn,
      summarize: function () { return summarizeCollection(stories, storyProgress); },
      openNext: function () {
        var s = summarizeCollection(stories, storyProgress);
        openStoryOverlay();
        if (s.next) openStory(s.next);
      }
    });

    storyLaunchBtn.addEventListener('click', openStoryOverlay);
    storyCloseBtn.addEventListener('click', closeStoryOverlay);

    storyBackBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderStoryLibrary();
      showStoryScreen(storyLibraryScreen);
      storyLibraryScreen.scrollTop = storyLibraryScroll;
      storyCloseBtn.focus({ preventScroll: true });
    });

    storyPrevBtn.addEventListener('click', function () {
      var idx = stories.indexOf(currentStory);
      if (idx > 0) { ttsStop(); openStory(stories[idx - 1]); }
    });

    storyNextBtn.addEventListener('click', function () {
      var idx = stories.indexOf(currentStory);
      if (idx >= 0 && idx < stories.length - 1) { ttsStop(); openStory(stories[idx + 1]); }
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

    initReadingScrollBehaviour(storyScrollContent, storyScrollFill, storyReadingScreen);

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
        renderHomeDashboard(); // collection totals just became known
      })
      .catch(function () { stories = []; });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // READING MODES — History · Animals · Insects · Fable
  // These four share one two-screen flow (library → reading → scoped quiz);
  // createReadingMode() builds each from a small config. Per-mode quirks are
  // just config fields: subtitleField (the card/reading subtitle — history='era',
  // animals/insects='habitat') and moralField (fable's "Moral: …" footer).
  // Proverbs Mode is deliberately NOT folded in here — it has a culture-picker
  // layer, a third screen, and native-script proverb cards.
  // ═══════════════════════════════════════════════════════════════════════════

  // returnTo id -> a fn that reopens that mode's reading view, so the quiz can
  // send the reader back where they launched it from (see closeQuizOverlay).
  var readingReturnHandlers = {};

  function createReadingMode(config) {
    var prefix    = config.prefix;
    var itemNoun  = config.itemNoun;                 // 'article' | 'fable'
    var itemTitle = itemNoun.charAt(0).toUpperCase() + itemNoun.slice(1);

    var items    = [];
    var progress = {};
    var current  = null;
    var ttsBar   = null;
    var libraryScroll = 0;  // remember list scroll position while reading an item

    function el(suffix) { return document.getElementById(prefix + '-' + suffix); }

    var launchBtn     = el('launch-btn');
    var overlay       = el('overlay');
    var libraryScreen = el('library-screen');
    var readingScreen = el('reading-screen');
    var closeBtn      = el('close-btn');
    var backBtn       = el('back-btn');
    var prevBtn       = el('prev-btn');
    var nextBtn       = el('next-btn');
    var listEl        = el('list');
    var readingEmoji  = el('reading-emoji');
    var readingTitle  = el('reading-title');
    var readingBody   = el('reading-body');
    var quizBtn       = el('quiz-btn');
    var scrollContent = el('scroll-content');
    var scrollFill    = el('scroll-fill');
    var imageFigure   = el('reading-image-figure');
    var image         = el('reading-image');
    var imageCaption  = el('reading-image-caption');
    var subtitleEl    = config.subtitleField ? el('reading-' + config.subtitleField) : null;
    var moralEl       = config.moralField ? el('reading-' + config.moralField) : null;

    function loadProgress() {
      try {
        var raw = localStorage.getItem(config.progressKey);
        progress = raw ? JSON.parse(raw) : {};
      } catch (e) {
        progress = {};
      }
    }

    function saveProgress() {
      try { localStorage.setItem(config.progressKey, JSON.stringify(progress)); } catch (e) {}
    }

    function wordObjects(item) {
      var out = [];
      (item.words || []).forEach(function (name) {
        var w = findWordByName(name);
        if (w) out.push(w);
      });
      return out;
    }

    function renderLibrary() {
      listEl.innerHTML = '';
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'story-card-blurb';
        empty.textContent = config.loadingMessage;
        listEl.appendChild(empty);
        return;
      }
      items.forEach(function (item) {
        var card = document.createElement('button');
        card.className = 'story-card';
        card.type = 'button';

        var title = document.createElement('span');
        title.className = 'story-card-title';
        title.textContent = item.emoji + ' ' + item.title;

        var blurb = document.createElement('span');
        blurb.className = 'story-card-blurb';
        blurb.textContent = item.blurb;

        var meta = document.createElement('span');
        meta.className = 'story-card-meta';

        if (config.subtitleField) {
          var sub = document.createElement('span');
          sub.className = 'history-card-era';
          sub.textContent = item[config.subtitleField];
          meta.appendChild(sub);
        }

        var wordsTag = document.createElement('span');
        wordsTag.className = 'story-card-tag';
        wordsTag.textContent = wordObjects(item).length + ' words';
        meta.appendChild(wordsTag);

        var prog = progress[item.id];
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
        card.addEventListener('click', function () { openItem(item); });
        listEl.appendChild(card);
      });
    }

    function showScreen(screenEl) {
      [libraryScreen, readingScreen].forEach(function (s) { s.classList.add('hidden'); });
      screenEl.classList.remove('hidden');
    }

    function updateNavBtns() {
      var idx = items.indexOf(current);
      prevBtn.disabled = (idx <= 0);
      nextBtn.disabled = (idx < 0 || idx >= items.length - 1);
    }

    function openItem(item) {
      current = item;
      var prog = progress[item.id] || {};
      prog.read = true;
      progress[item.id] = prog;
      saveProgress();

      readingEmoji.textContent = item.emoji;
      readingTitle.textContent = item.title;
      if (subtitleEl) subtitleEl.textContent = item[config.subtitleField];

      if (item.image) {
        imageFigure.classList.remove('article-image--broken');
        image.onerror = function () { imageFigure.classList.add('article-image--broken'); };
        image.src = item.image.url;
        image.alt = item.image.caption;
        imageCaption.textContent = item.image.caption + ' — ' + item.image.credit;
        imageFigure.classList.remove('hidden');
      } else {
        image.onerror = null;
        image.src = '';
        image.alt = '';
        imageCaption.textContent = '';
        imageFigure.classList.remove('article-image--broken');
        imageFigure.classList.add('hidden');
      }

      renderReadingBody(readingBody, item.paragraphs, wordObjects(item), ttsBar);

      if (moralEl) {
        if (item[config.moralField]) {
          moralEl.textContent = 'Moral: ' + item[config.moralField];
          moralEl.classList.remove('hidden');
        } else {
          moralEl.textContent = '';
          moralEl.classList.add('hidden');
        }
      }

      libraryScroll = libraryScreen.scrollTop;
      showScreen(readingScreen);
      resetReadingScroll(scrollContent, scrollFill, readingScreen);
      updateNavBtns();
      backBtn.focus();
    }

    function openOverlay() {
      renderLibrary();
      showScreen(libraryScreen);
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      closeBtn.focus();
    }

    function closeOverlay() {
      ttsStop();
      hideGloss();
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      current = null;
      launchBtn.focus();
    }

    function reopenReading() {
      if (!current) { closeOverlay(); return; }
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      document.body.style.overflow = 'hidden';
      showScreen(readingScreen);
      quizBtn.focus();
    }

    function recordResult(item, score, total) {
      var prog = progress[item.id] || {};
      prog.read = true;
      if (typeof prog.bestScore !== 'number' || score > prog.bestScore) {
        prog.bestScore = score;
        prog.total = total;
      }
      progress[item.id] = prog;
      saveProgress();
      if (score === total) return itemTitle + ' complete — perfect score! 🎉';
      return 'Best for this ' + itemNoun + ': ' + prog.bestScore + ' / ' + prog.total;
    }

    loadProgress();
    readingReturnHandlers[config.returnTo] = reopenReading;

    // Home-dashboard registration: summaries recompute from the live
    // items/progress closures, and openNext jumps straight to the first
    // unread item ("Continue History: …" chip).
    registerHomeCollection({
      id: prefix,
      label: config.label,
      launchBtn: launchBtn,
      summarize: function () { return summarizeCollection(items, progress); },
      openNext: function () {
        var s = summarizeCollection(items, progress);
        openOverlay();
        if (s.next) openItem(s.next);
      }
    });

    launchBtn.addEventListener('click', openOverlay);
    closeBtn.addEventListener('click', closeOverlay);

    backBtn.addEventListener('click', function () {
      ttsStop();
      hideGloss();
      renderLibrary();
      showScreen(libraryScreen);
      libraryScreen.scrollTop = libraryScroll;
      closeBtn.focus({ preventScroll: true });
    });

    prevBtn.addEventListener('click', function () {
      var idx = items.indexOf(current);
      if (idx > 0) { ttsStop(); openItem(items[idx - 1]); }
    });

    nextBtn.addEventListener('click', function () {
      var idx = items.indexOf(current);
      if (idx >= 0 && idx < items.length - 1) { ttsStop(); openItem(items[idx + 1]); }
    });

    quizBtn.addEventListener('click', function () {
      if (!current) return;
      var words = wordObjects(current);
      if (!words.length) return;
      var item = current;
      ttsStop();
      hideGloss();
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      startScopedQuiz(words, {
        returnTo: config.returnTo,
        onComplete: function (score, total) {
          return recordResult(item, score, total);
        }
      });
    });

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) closeOverlay();
    });

    initReadingScrollBehaviour(scrollContent, scrollFill, readingScreen);

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (overlay.classList.contains('hidden')) return;
      if (glossIsOpen()) { hideGloss(); return; }
      closeOverlay();
    });

    ttsBar = initTTSBar(
      el('tts-read-btn'),
      el('tts-controls'),
      el('tts-playpause'),
      el('tts-stop'),
      document.querySelectorAll('#' + prefix + '-tts-controls .tts-speed-btn'),
      el('tts-voice'),
      document.querySelectorAll('#' + prefix + '-tts-controls .tts-pitch-btn')
    );

    fetch(config.dataFile)
      .then(function (res) { return res.json(); })
      .then(function (data) {
        items = (data && data[config.dataKey]) || [];
        if (!overlay.classList.contains('hidden') &&
            !libraryScreen.classList.contains('hidden')) {
          renderLibrary();
        }
        renderHomeDashboard(); // collection totals just became known
      })
      .catch(function () { items = []; });
  }

  function initHistoryMode() {
    createReadingMode({
      prefix: 'history', label: 'History', progressKey: 'vocabVault_historyProgress',
      dataFile: 'data/history.json', dataKey: 'articles',
      returnTo: 'history', itemNoun: 'article', subtitleField: 'era',
      loadingMessage: 'History articles are still loading — try again in a moment.'
    });
  }

  function initMoneyMode() {
    createReadingMode({
      prefix: 'money', label: 'Money', progressKey: 'vocabVault_moneyProgress',
      dataFile: 'data/money.json', dataKey: 'money',
      returnTo: 'money', itemNoun: 'article', subtitleField: 'era',
      loadingMessage: 'Money articles are still loading — try again in a moment.'
    });
  }

  function initAnimalsMode() {
    createReadingMode({
      prefix: 'animals', label: 'Animals', progressKey: 'vocabVault_animalsProgress',
      dataFile: 'data/animals.json', dataKey: 'animals',
      returnTo: 'animals', itemNoun: 'article', subtitleField: 'habitat',
      loadingMessage: 'Animal articles are still loading — try again in a moment.'
    });
  }

  function initInsectsMode() {
    createReadingMode({
      prefix: 'insects', label: 'Insects', progressKey: 'vocabVault_insectsProgress',
      dataFile: 'data/insects.json', dataKey: 'insects',
      returnTo: 'insects', itemNoun: 'article', subtitleField: 'habitat',
      loadingMessage: 'Insect articles are still loading — try again in a moment.'
    });
  }

  function initSpaceMode() {
    createReadingMode({
      prefix: 'space', label: 'Space', progressKey: 'vocabVault_spaceProgress',
      dataFile: 'data/space.json', dataKey: 'space',
      returnTo: 'space', itemNoun: 'article', subtitleField: 'region',
      loadingMessage: 'Space articles are still loading — try again in a moment.'
    });
  }

  function initTechMode() {
    createReadingMode({
      prefix: 'tech', label: 'Inventions', progressKey: 'vocabVault_technologyProgress',
      dataFile: 'data/technology.json', dataKey: 'technology',
      returnTo: 'tech', itemNoun: 'article', subtitleField: 'era',
      loadingMessage: 'Inventions are still loading — try again in a moment.'
    });
  }

  function initForcesMode() {
    createReadingMode({
      prefix: 'forces', label: 'Forces of Nature', progressKey: 'vocabVault_forcesProgress',
      dataFile: 'data/forces.json', dataKey: 'forces',
      returnTo: 'forces', itemNoun: 'article', subtitleField: 'element',
      loadingMessage: 'Forces of nature are still loading — try again in a moment.'
    });
  }

  function initStreetSmartsMode() {
    createReadingMode({
      prefix: 'street', label: 'Street Smarts', progressKey: 'vocabVault_streetSmartsProgress',
      dataFile: 'data/street-smarts.json', dataKey: 'streetSmarts',
      returnTo: 'street', itemNoun: 'article', subtitleField: 'topic',
      loadingMessage: 'Street Smarts articles are still loading — try again in a moment.'
    });
  }

  function initFableMode() {
    createReadingMode({
      prefix: 'fable', label: 'Fables', progressKey: 'vocabVault_fableProgress',
      dataFile: 'data/fables.json', dataKey: 'fables',
      returnTo: 'fable', itemNoun: 'fable', moralField: 'moral',
      loadingMessage: 'Fables are still loading — try again in a moment.'
    });
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
  var proverbsLibraryScroll = 0;  // remember proverbs list scroll while reading a collection
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
  var proverbsScrollContent    = document.getElementById('proverbs-scroll-content');
  var proverbsScrollFill       = document.getElementById('proverbs-scroll-fill');

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
    proverbsLibraryScroll = proverbsLibraryScreen.scrollTop;
    showProverbsScreen(proverbsReadingScreen);
    resetReadingScroll(proverbsScrollContent, proverbsScrollFill, proverbsReadingScreen);
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
      proverbsLibraryScreen.scrollTop = proverbsLibraryScroll;
      proverbsLibraryBackBtn.focus({ preventScroll: true });
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

    initReadingScrollBehaviour(proverbsScrollContent, proverbsScrollFill, proverbsReadingScreen);

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
  var newsScrollContent  = document.getElementById('news-scroll-content');
  var newsScrollFill     = document.getElementById('news-scroll-fill');

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

  // hashString, seededRandom, pickDailyWords → moved to js/selection.js (pure +
  // unit-tested). pickDailyWords is called below as
  // pickDailyWords(allWords, getMasteryStatus, todayKey(), wordCount).

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
    var picked = pickDailyWords(allWords, getMasteryStatus, todayKey(), newsData.wordCount);
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
      resetReadingScroll(newsScrollContent, newsScrollFill, newsReadingScreen);
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

    initReadingScrollBehaviour(newsScrollContent, newsScrollFill, newsReadingScreen);

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
    bests         : {},
    wrongChoices  : [],
    questionEpoch : 0
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
    return [
      { label: 'Word type',    value: wordObj.word_type },
      { label: 'A synonym is', value: wordObj.synonyms[0] },
      { label: 'An antonym is', value: wordObj.antonyms[0] },
      { label: 'Definition',   value: wordObj.definition }
    ];
  }

  function showDetectiveQuestion() {
    var wordObj = detectiveState.words[detectiveState.index];
    detectiveState.clueStep = 0;
    detectiveState.answered = false;
    detectiveState.wrongChoices = [];
    detectiveState.questionEpoch++;

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
      var hintSpan = document.createElement('span');
      hintSpan.className = 'detective-clue-reveal-hint';
      hintSpan.textContent = 'Tap to reveal · −100 pts';
      card.appendChild(numSpan);
      card.appendChild(labelSpan);
      card.appendChild(valSpan);
      card.appendChild(hintSpan);
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
      cards[step].classList.remove('detective-clue-next', 'detective-clue-hidden');
      cards[step].classList.add('detective-clue-revealed');
      cards[step].onclick = null;
      cards[step].style.cursor = '';
      detectiveState.clueStep++;
    }
    var pts = DETECTIVE_POINTS[detectiveState.clueStep - 1] || 100;
    document.getElementById('detective-choices-hint').textContent = 'Guess now for ' + pts + ' points';
    renderDetectiveChoices();
    setupNextClueCard();
  }

  function setupNextClueCard() {
    if (detectiveState.answered) return;
    var cards = document.querySelectorAll('#detective-clue-stack .detective-clue-card');
    var nextStep = detectiveState.clueStep;
    if (nextStep >= cards.length) return;
    var nextCard = cards[nextStep];
    nextCard.classList.remove('detective-clue-hidden');
    nextCard.classList.add('detective-clue-next');
    nextCard.style.cursor = 'pointer';
    nextCard.onclick = function () {
      if (detectiveState.answered) return;
      detectiveState.score = Math.max(0, detectiveState.score - 100);
      document.getElementById('detective-score-display').textContent = 'Score: ' + detectiveState.score;
      nextCard.classList.remove('detective-clue-next');
      nextCard.classList.add('detective-clue-revealed');
      nextCard.onclick = null;
      nextCard.style.cursor = '';
      detectiveState.clueStep++;
      var pts = DETECTIVE_POINTS[detectiveState.clueStep - 1] || 100;
      document.getElementById('detective-choices-hint').textContent = 'Guess now for ' + pts + ' points';
      renderDetectiveChoices();
      setupNextClueCard();
    };
  }

  function renderDetectiveChoices() {
    var grid = document.getElementById('detective-choices');
    grid.innerHTML = '';
    detectiveState.choices.forEach(function (wordObj, i) {
      var btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.textContent = wordObj.word;
      if (detectiveState.wrongChoices.indexOf(i) !== -1) {
        btn.disabled = true;
        btn.classList.add('wrong');
      } else {
        btn.addEventListener('click', function () { detectiveGuess(i); });
      }
      grid.appendChild(btn);
    });
  }

  function detectiveGuess(choiceIndex) {
    if (detectiveState.answered) return;

    var correct = detectiveState.choices[choiceIndex] === detectiveState.correctChoice;

    if (correct) {
      detectiveState.answered = true;
      var pts = DETECTIVE_POINTS[detectiveState.clueStep - 1] || 100;

      var buttons = document.querySelectorAll('#detective-choices .quiz-answer-btn');
      buttons.forEach(function (btn, i) {
        btn.disabled = true;
        if (detectiveState.choices[i] === detectiveState.correctChoice) btn.classList.add('correct');
      });

      var allCards = document.querySelectorAll('#detective-clue-stack .detective-clue-card');
      allCards.forEach(function (card) {
        card.classList.remove('detective-clue-hidden', 'detective-clue-next');
        card.classList.add('detective-clue-revealed');
        card.onclick = null;
        card.style.cursor = '';
      });

      document.getElementById('detective-choices-hint').textContent = '';
      detectiveState.score += pts;
      document.getElementById('detective-score-display').textContent = 'Score: ' + detectiveState.score;
      var fb = document.getElementById('detective-feedback');
      fb.textContent = pts === 500 ? '⭐ First clue — genius! +500 pts' : '✓ Correct! +' + pts + ' points';
      fb.className = 'quiz-feedback visible feedback-correct';

      var correctEpoch = detectiveState.questionEpoch;
      setTimeout(function () {
        if (detectiveState.questionEpoch !== correctEpoch) return;
        detectiveState.index++;
        if (detectiveState.index >= detectiveState.sessionLength) showDetectiveEnd();
        else showDetectiveQuestion();
      }, 2200);

    } else {
      detectiveState.wrongChoices.push(choiceIndex);
      var buttons = document.querySelectorAll('#detective-choices .quiz-answer-btn');
      buttons[choiceIndex].disabled = true;
      buttons[choiceIndex].classList.add('wrong');

      var fb = document.getElementById('detective-feedback');
      var cards = document.querySelectorAll('#detective-clue-stack .detective-clue-card');

      if (detectiveState.clueStep < cards.length) {
        var epoch = detectiveState.questionEpoch;
        fb.textContent = 'Not quite — here\'s another clue!';
        fb.className = 'quiz-feedback visible feedback-wrong';
        setTimeout(function () {
          if (detectiveState.questionEpoch !== epoch) return;
          fb.textContent = '';
          fb.className = 'quiz-feedback';
          revealDetectiveClue();
        }, 700);
      } else {
        detectiveState.answered = true;
        buttons.forEach(function (btn, i) {
          btn.disabled = true;
          if (detectiveState.choices[i] === detectiveState.correctChoice) btn.classList.add('correct');
        });
        document.getElementById('detective-choices-hint').textContent = '';
        fb.textContent = '✗ It was "' + detectiveState.correctChoice.word + '" — keep going!';
        fb.className = 'quiz-feedback visible feedback-wrong';
        var wrongEpoch = detectiveState.questionEpoch;
        setTimeout(function () {
          if (detectiveState.questionEpoch !== wrongEpoch) return;
          detectiveState.index++;
          if (detectiveState.index >= detectiveState.sessionLength) showDetectiveEnd();
          else showDetectiveQuestion();
        }, 2200);
      }
    }
  }

  function showDetectiveEnd() {
    markActivityToday();
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
    revealEndScreen(document.getElementById('detective-end-screen'));
    if (isNew && score > 0) celebrateBurst(document.getElementById('detective-end-emoji'));
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
    markActivityToday();
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
    revealEndScreen(document.getElementById('scramble-end-screen'));
    if (isNew && score > 0) celebrateBurst(document.getElementById('scramble-end-emoji'));
  }

  // ── Flash Blitz Mode ─────────────────────────────────────────────────────────

  var BLITZ_BESTS_KEY = 'vocabVault_blitzBests';

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
    blitzState.sessionSize = rawSize;
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
    var blitzDef = document.getElementById('blitz-definition');
    blitzDef.textContent = wordObj.definition;
    additionalMeanings(wordObj).forEach(function (m) {
      blitzDef.appendChild(document.createElement('br'));
      var span = document.createElement('span');
      span.className = 'blitz-extra-meaning';
      span.textContent = '(' + m.word_type + ') ' + m.definition;
      blitzDef.appendChild(span);
    });
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
      recordAnswerCelebrated(wordObj.word, true);
    } else if (rating === 'missed') {
      blitzState.missed++;
      blitzState.missedWords.push(wordObj);
      recordAnswerCelebrated(wordObj.word, false);
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
    markActivityToday();
    stopBlitzTimer();
    showBlitzScreen('end');
    var tier  = getBlitzTier(blitzState.got, blitzState.nearly, blitzState.missed);
    var score = getBlitzScore(blitzState.got, blitzState.nearly);
    document.getElementById('blitz-end-emoji').textContent = tier.emoji;
    document.getElementById('blitz-end-title').textContent = tier.title;
    document.getElementById('blitz-end-score').textContent =
      '✅ Got: ' + blitzState.got + '  🤔 Nearly: ' + blitzState.nearly + '  ❌ Missed: ' + blitzState.missed +
      '  ·  ' + score + ' pts';

    // Per-options personal best (mirrors vocabVault_snapBests).
    var bests = {};
    try { bests = JSON.parse(localStorage.getItem(BLITZ_BESTS_KEY)) || {}; } catch (e) { bests = {}; }
    var bestKey = [blitzState.sessionSize, blitzState.scope, blitzState.timerSecs].join(':');
    var best = bests[bestKey] || 0;
    var isNew = score > best;
    if (isNew) {
      bests[bestKey] = score;
      try { localStorage.setItem(BLITZ_BESTS_KEY, JSON.stringify(bests)); } catch (e) {}
    }
    document.getElementById('blitz-end-best').textContent =
      isNew ? '⭐ New personal best!' : (best > 0 ? 'Personal best: ' + best + ' pts' : '');
    revealEndScreen(document.getElementById('blitz-end-screen'));
    if (isNew && score > 0) celebrateBurst(document.getElementById('blitz-end-emoji'));

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

  var SNAP_BESTS_KEY = 'vocabVault_snapBests';

  var snapState = {
    pairs         : [],
    index         : 0,
    score         : 0,
    streak        : 0,
    bestStreak    : 0,
    pairCount     : 20,
    timerSecs     : 10,
    snapMode      : 'mixed',
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

    ['snap-word-a', 'snap-word-b'].forEach(function (id) {
      var pill = document.getElementById(id);
      pill.addEventListener('click', function () {
        if (pill.style.cursor === 'default') return;
        pill.classList.toggle('flipped');
        pill.setAttribute('aria-pressed', pill.classList.contains('flipped') ? 'true' : 'false');
      });
      pill.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (pill.style.cursor !== 'default') {
            pill.classList.toggle('flipped');
            pill.setAttribute('aria-pressed', pill.classList.contains('flipped') ? 'true' : 'false');
          }
        }
      });
    });

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

    document.querySelectorAll('[data-snap-timer]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-snap-timer]').forEach(function (b) {
          b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
        snapState.timerSecs = parseInt(btn.dataset.snapTimer, 10);
      });
    });

    document.querySelectorAll('[data-snap-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-snap-mode]').forEach(function (b) {
          b.classList.remove('active'); b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active'); btn.setAttribute('aria-pressed', 'true');
        snapState.snapMode = btn.dataset.snapMode;
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
    var key = snapState.pairCount + '_' + snapState.snapMode + '_' + snapState.timerSecs;
    var best = snapState.bests[key];
    if (best) {
      var modeLabel = snapState.snapMode === 'synonyms' ? 'synonyms' : snapState.snapMode === 'antonyms' ? 'antonyms' : 'mixed';
      el.textContent = 'Personal best (' + snapState.pairCount + ' pairs, ' + modeLabel + ', ' + snapState.timerSecs + 's): ' + best + ' pts';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function findSnapWordDef(wordStr) {
    var lower = wordStr.toLowerCase();
    for (var i = 0; i < allWords.length; i++) {
      if (allWords[i].word.toLowerCase() === lower) return allWords[i];
    }
    return null;
  }

  function generateSnapPairs(count) {
    var eligible = allWords.filter(function (w) {
      return w.synonyms && w.synonyms.length && w.antonyms && w.antonyms.length;
    });
    if (eligible.length < 4) return [];

    var mode = snapState.snapMode;
    var pairs = [];
    var pool = shuffle(eligible);

    for (var i = 0; i < count; i++) {
      var wordObj = pool[i % pool.length];
      var other = pool[(i + Math.floor(pool.length / 2)) % pool.length];
      var pair;

      if (mode === 'synonyms') {
        if (i % 2 === 0) {
          var syn = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
          pair = { wordA: wordObj.word, wordB: syn, questionType: 'SYNONYMS', isYes: true };
        } else if (i % 4 === 1) {
          var ant = wordObj.antonyms[Math.floor(Math.random() * wordObj.antonyms.length)];
          pair = { wordA: wordObj.word, wordB: ant, questionType: 'SYNONYMS', isYes: false };
        } else {
          pair = { wordA: wordObj.word, wordB: other.word, questionType: 'SYNONYMS', isYes: false };
        }
      } else if (mode === 'antonyms') {
        if (i % 2 === 0) {
          var ant2 = wordObj.antonyms[Math.floor(Math.random() * wordObj.antonyms.length)];
          pair = { wordA: wordObj.word, wordB: ant2, questionType: 'ANTONYMS', isYes: true };
        } else if (i % 4 === 1) {
          var syn2 = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
          pair = { wordA: wordObj.word, wordB: syn2, questionType: 'ANTONYMS', isYes: false };
        } else {
          pair = { wordA: wordObj.word, wordB: other.word, questionType: 'ANTONYMS', isYes: false };
        }
      } else {
        var type = i % 4;
        if (type === 0) {
          var syn3 = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
          pair = { wordA: wordObj.word, wordB: syn3, questionType: 'SYNONYMS', isYes: true };
        } else if (type === 1) {
          var ant3 = wordObj.antonyms[Math.floor(Math.random() * wordObj.antonyms.length)];
          pair = { wordA: wordObj.word, wordB: ant3, questionType: 'ANTONYMS', isYes: true };
        } else if (type === 2) {
          var syn4 = wordObj.synonyms[Math.floor(Math.random() * wordObj.synonyms.length)];
          pair = { wordA: wordObj.word, wordB: syn4, questionType: 'ANTONYMS', isYes: false };
        } else {
          pair = {
            wordA: wordObj.word,
            wordB: other.word,
            questionType: Math.random() < 0.5 ? 'SYNONYMS' : 'ANTONYMS',
            isYes: false
          };
        }
      }
      pair.defA = wordObj.definition;
      pair.typeA = wordObj.word_type || '';
      var wbObj = findSnapWordDef(pair.wordB);
      pair.defB = wbObj ? wbObj.definition : null;
      pair.typeB = wbObj ? (wbObj.word_type || '') : '';
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

    var pillA = document.getElementById('snap-word-a');
    pillA.classList.remove('flipped');
    pillA.querySelector('.snap-pill-word').textContent = pair.wordA;
    pillA.querySelector('.snap-pill-def').textContent =
      (pair.typeA ? '(' + pair.typeA + ')  ' : '') + pair.defA;
    pillA.querySelector('.snap-pill-hint').style.display = '';

    var pillB = document.getElementById('snap-word-b');
    pillB.classList.remove('flipped');
    pillB.querySelector('.snap-pill-word').textContent = pair.wordB;
    if (pair.defB) {
      pillB.querySelector('.snap-pill-def').textContent =
        (pair.typeB ? '(' + pair.typeB + ')  ' : '') + pair.defB;
      pillB.querySelector('.snap-pill-hint').style.display = '';
      pillB.style.cursor = '';
    } else {
      pillB.querySelector('.snap-pill-def').textContent = '';
      pillB.querySelector('.snap-pill-hint').style.display = 'none';
      pillB.style.cursor = 'default';
    }

    var flashEl = document.getElementById('snap-flash-msg');
    flashEl.textContent = '';
    flashEl.className = 'snap-flash-msg';

    document.getElementById('snap-yes-btn').disabled = false;
    document.getElementById('snap-no-btn').disabled  = false;

    startSnapTimer();
  }

  function startSnapTimer() {
    stopSnapTimer();
    var totalMs = snapState.timerSecs * 1000;
    snapState.timerMs = totalMs;
    var fill = document.getElementById('snap-timer-fill');
    fill.style.width = '100%';
    fill.classList.remove('snap-timer-urgent');

    snapState.timerInterval = setInterval(function () {
      snapState.timerMs -= 50;
      var pct = Math.max(0, snapState.timerMs / totalMs);
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
    markActivityToday();
    stopSnapTimer();
    showSnapScreen('end');
    var score = snapState.score;
    var count = snapState.pairCount;
    var key   = count + '_' + snapState.snapMode + '_' + snapState.timerSecs;
    var best  = snapState.bests[key] || 0;
    var isNew = score > best;
    if (isNew) {
      snapState.bests[key] = score;
      try { localStorage.setItem(SNAP_BESTS_KEY, JSON.stringify(snapState.bests)); } catch (e) {}
    }
    var maxPts = count * 200;
    var pct = score / maxPts;
    document.getElementById('snap-end-emoji').textContent = pct >= 0.7 ? '🎭' : pct >= 0.4 ? '🎲' : '🃏';
    document.getElementById('snap-end-title').textContent = pct >= 0.7 ? 'Snap Champion!' : pct >= 0.4 ? 'Word Matcher!' : 'Keep Snapping!';
    document.getElementById('snap-end-score').textContent =
      score + ' pts · Best streak: 🔥 ' + snapState.bestStreak;
    document.getElementById('snap-end-best').textContent = isNew ? '⭐ New personal best!' : 'Personal best: ' + best + ' pts';
    revealEndScreen(document.getElementById('snap-end-screen'));
    if (isNew && score > 0) celebrateBurst(document.getElementById('snap-end-emoji'));

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
  // WORD IN THE WILD MODE — Inductive learning: Spot It → Use It → Define It
  // ═══════════════════════════════════════════════════════════════════════════

  var WILD_BESTS_KEY = 'vocabVault_wildBests';

  var wildState = {
    words         : [],
    index         : 0,
    score         : 0,
    sessionLength : 5,
    phase         : 1,
    phase2Penalty : 0,
    answered      : false,
    bests         : {}
  };

  function initWildMode() {
    try { wildState.bests = JSON.parse(localStorage.getItem(WILD_BESTS_KEY) || '{}'); } catch (e) { wildState.bests = {}; }

    document.getElementById('wild-launch-btn').addEventListener('click', openWild);
    document.getElementById('wild-close').addEventListener('click', closeWild);
    document.getElementById('wild-start-btn').addEventListener('click', startWild);
    document.getElementById('wild-exit-btn').addEventListener('click', function () { showWildScreen('setup'); });
    document.getElementById('wild-got-it-btn').addEventListener('click', function () {
      showWildPhase2(wildState.words[wildState.index]);
    });
    document.getElementById('wild-next-btn').addEventListener('click', wildAdvance);
    document.getElementById('wild-phase2-next-btn').addEventListener('click', function () {
      showWildPhase3(wildState.words[wildState.index]);
    });
    document.getElementById('wild-play-again-btn').addEventListener('click', function () { showWildScreen('setup'); });
    document.getElementById('wild-done-btn').addEventListener('click', closeWild);

    document.querySelectorAll('[data-wild-length]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('[data-wild-length]').forEach(function (b) {
          b.classList.remove('active');
          b.setAttribute('aria-pressed', 'false');
        });
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
        wildState.sessionLength = parseInt(btn.dataset.wildLength, 10);
        updateWildBestDisplay();
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var overlay = document.getElementById('wild-overlay');
        if (overlay && !overlay.classList.contains('hidden')) closeWild();
      }
    });
  }

  function openWild() {
    var overlay = document.getElementById('wild-overlay');
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    showWildScreen('setup');
    updateWildBestDisplay();
  }

  function closeWild() {
    var overlay = document.getElementById('wild-overlay');
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
  }

  function showWildScreen(name) {
    var map = { setup: 'wild-setup', game: 'wild-game-screen', end: 'wild-end-screen' };
    Object.keys(map).forEach(function (k) {
      var el = document.getElementById(map[k]);
      if (el) el.classList.toggle('hidden', k !== name);
    });
  }

  function updateWildBestDisplay() {
    var el   = document.getElementById('wild-personal-best');
    var best = wildState.bests[wildState.sessionLength];
    if (best) {
      el.textContent = 'Personal best (' + wildState.sessionLength + ' words): ' + best + ' pts';
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  function startWild() {
    wildState.words = shuffle(allWords).slice(0, wildState.sessionLength);
    wildState.index = 0;
    wildState.score = 0;
    showWildScreen('game');
    showWildPhase1();
  }

  function buildHighlightedSentence(sentence, word) {
    var p = document.createElement('p');
    p.className = 'wild-sentence';
    var escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var re = new RegExp('\\b(' + escaped + ')\\b', 'gi');
    var lastIndex = 0;
    var match;
    re.lastIndex = 0;
    while ((match = re.exec(sentence)) !== null) {
      if (match.index > lastIndex) {
        p.appendChild(document.createTextNode(sentence.slice(lastIndex, match.index)));
      }
      var mark = document.createElement('mark');
      mark.className = 'wild-word-highlight';
      mark.textContent = match[0];
      p.appendChild(mark);
      lastIndex = re.lastIndex;
    }
    if (lastIndex < sentence.length) {
      p.appendChild(document.createTextNode(sentence.slice(lastIndex)));
    }
    return p;
  }

  function showWildPhase1() {
    var wordObj = wildState.words[wildState.index];
    wildState.phase    = 1;
    wildState.answered = false;

    document.getElementById('wild-word-label').textContent =
      'Word ' + (wildState.index + 1) + ' of ' + wildState.sessionLength;
    document.getElementById('wild-score-display').textContent = 'Score: ' + wildState.score;
    document.getElementById('wild-phase-label').textContent  = 'Phase 1 of 3 — Spot It 👀';
    document.getElementById('wild-word-heading').textContent = wordObj.word;
    document.getElementById('wild-word-type').textContent    = wordObj.word_type;

    var container = document.getElementById('wild-sentences');
    container.innerHTML = '';
    var sent1 = wordObj.sentence_usage;
    var sent2 = (wordObj.themed_quest && wordObj.themed_quest.word) || '';
    var sentences = (sent1 === sent2 || !sent2) ? [sent1] : [sent1, sent2];
    sentences.forEach(function (s) {
      container.appendChild(buildHighlightedSentence(s, wordObj.word));
    });

    document.getElementById('wild-phase1-card').classList.remove('hidden');
    document.getElementById('wild-phase2-card').classList.add('hidden');
    document.getElementById('wild-phase3-card').classList.add('hidden');
    var fb = document.getElementById('wild-feedback');
    fb.textContent = '';
    fb.className = 'quiz-feedback';
  }

  function showWildPhase2(wordObj) {
    wildState.phase        = 2;
    wildState.phase2Penalty = 0;
    wildState.answered     = false;

    document.getElementById('wild-phase-label').textContent = 'Phase 2 of 3 — Use It ✏️';
    document.getElementById('wild-phase2-word').textContent = wordObj.word;

    var correctSentence = (wordObj.themed_quest && wordObj.themed_quest.sentence)
      || getSentenceBlank(wordObj);
    if (!correctSentence) {
      showWildPhase3(wordObj);
      return;
    }

    var distractors = pickDistractors(wordObj, allWords, 3);
    var sentencePairs = shuffle([{ sentence: correctSentence, correct: true }].concat(
      distractors.map(function (d) {
        return {
          sentence: (d.themed_quest && d.themed_quest.sentence) || getSentenceBlank(d) || d.sentence_usage,
          correct: false
        };
      })
    ));

    var grid = document.getElementById('wild-phase2-choices');
    grid.innerHTML = '';
    sentencePairs.forEach(function (pair) {
      var btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.type = 'button';
      btn.textContent = pair.sentence;
      if (pair.correct) btn.dataset.correct = 'true';
      (function (p, b) {
        b.addEventListener('click', function () { wildPhase2Answer(p.correct, b, wordObj); });
      }(pair, btn));
      grid.appendChild(btn);
    });

    document.getElementById('wild-phase2-next-wrap').classList.add('hidden');
    document.getElementById('wild-phase1-card').classList.add('hidden');
    document.getElementById('wild-phase2-card').classList.remove('hidden');
    document.getElementById('wild-phase3-card').classList.add('hidden');
    var fb = document.getElementById('wild-feedback');
    fb.textContent = '';
    fb.className = 'quiz-feedback';
  }

  function wildPhase2Answer(isCorrect, btn, wordObj) {
    if (wildState.answered) return;

    var allBtns = document.querySelectorAll('#wild-phase2-choices .quiz-answer-btn');
    var fb = document.getElementById('wild-feedback');

    if (isCorrect) {
      wildState.answered = true;
      var pts = Math.max(100, 300 - wildState.phase2Penalty * 100);
      wildState.score += pts;
      document.getElementById('wild-score-display').textContent = 'Score: ' + wildState.score;
      allBtns.forEach(function (b) { b.disabled = true; });
      btn.classList.add('correct');
      fb.textContent = '✓ Correct! +' + pts + ' pts';
      fb.className = 'quiz-feedback visible feedback-correct';
      setTimeout(function () { showWildPhase3(wordObj); }, 1600);
    } else {
      wildState.phase2Penalty++;
      btn.disabled = true;
      btn.classList.add('wrong');
      if (wildState.phase2Penalty >= 2) {
        wildState.answered = true;
        allBtns.forEach(function (b) {
          b.disabled = true;
          if (b.dataset.correct === 'true') b.classList.add('correct');
        });
        fb.textContent = '✗ See the highlighted sentence above';
        fb.className = 'quiz-feedback visible feedback-wrong';
        document.getElementById('wild-phase2-next-wrap').classList.remove('hidden');
      } else {
        fb.textContent = 'Not quite — try again!';
        fb.className = 'quiz-feedback visible feedback-wrong';
        setTimeout(function () {
          fb.textContent = '';
          fb.className = 'quiz-feedback';
        }, 800);
      }
    }
  }

  function showWildPhase3(wordObj) {
    wildState.phase    = 3;
    wildState.answered = false;

    document.getElementById('wild-phase-label').textContent  = 'Phase 3 of 3 — Define It 📚';
    document.getElementById('wild-phase3-word').textContent  = wordObj.word;

    var isLast = wildState.index === wildState.sessionLength - 1;
    document.getElementById('wild-next-btn').textContent = isLast ? 'See results →' : 'Next word →';

    var grid = document.getElementById('wild-phase3-choices');
    grid.innerHTML = '';
    var distractors3 = pickDistractors(wordObj, allWords, 3);
    var defs = shuffle([wordObj.definition].concat(distractors3.map(function (d) { return d.definition; })));
    defs.forEach(function (def) {
      var btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.type = 'button';
      btn.textContent = def;
      (function (d, b) {
        b.addEventListener('click', function () { wildPhase3Answer(d === wordObj.definition, b, wordObj); });
      }(def, btn));
      grid.appendChild(btn);
    });

    document.getElementById('wild-definition-reveal').classList.add('hidden');
    document.getElementById('wild-next-wrap').classList.add('hidden');
    document.getElementById('wild-phase1-card').classList.add('hidden');
    document.getElementById('wild-phase2-card').classList.add('hidden');
    document.getElementById('wild-phase3-card').classList.remove('hidden');
    var fb = document.getElementById('wild-feedback');
    fb.textContent = '';
    fb.className = 'quiz-feedback';
  }

  function wildPhase3Answer(isCorrect, btn, wordObj) {
    if (wildState.answered) return;
    wildState.answered = true;

    var allBtns = document.querySelectorAll('#wild-phase3-choices .quiz-answer-btn');
    var fb = document.getElementById('wild-feedback');

    allBtns.forEach(function (b) {
      b.disabled = true;
      if (b.textContent === wordObj.definition) b.classList.add('correct');
    });
    if (!isCorrect) { btn.classList.add('wrong'); }

    if (isCorrect) {
      wildState.score += 200;
      document.getElementById('wild-score-display').textContent = 'Score: ' + wildState.score;
      fb.textContent = '✓ Correct! +200 pts';
      fb.className = 'quiz-feedback visible feedback-correct';
    } else {
      fb.textContent = '✗ Not quite!';
      fb.className = 'quiz-feedback visible feedback-wrong';
    }

    recordAnswerCelebrated(wordObj.word, isCorrect);

    var revealEl = document.getElementById('wild-definition-reveal');
    revealEl.textContent = 'Definition: ' + wordObj.definition;
    revealEl.classList.remove('hidden');
    document.getElementById('wild-next-wrap').classList.remove('hidden');
  }

  function wildAdvance() {
    wildState.index++;
    if (wildState.index >= wildState.sessionLength) {
      showWildEnd();
    } else {
      showWildPhase1();
    }
  }

  function showWildEnd() {
    markActivityToday();
    showWildScreen('end');
    var score  = wildState.score;
    var len    = wildState.sessionLength;
    var best   = wildState.bests[len] || 0;
    var isNew  = score > best;
    if (isNew) {
      wildState.bests[len] = score;
      try { localStorage.setItem(WILD_BESTS_KEY, JSON.stringify(wildState.bests)); } catch (e) {}
    }
    var maxPts = len * 500;
    var pct    = score / maxPts;
    document.getElementById('wild-end-emoji').textContent =
      pct >= 0.8 ? '🌿' : pct >= 0.5 ? '🌱' : '🪴';
    document.getElementById('wild-end-title').textContent =
      pct >= 0.8 ? 'Word Explorer!' : pct >= 0.5 ? 'Nature Spotter!' : 'Keep Growing!';
    document.getElementById('wild-end-score').textContent =
      score + ' pts out of ' + maxPts + ' possible';
    document.getElementById('wild-end-best').textContent =
      isNew ? '⭐ New personal best!' : 'Personal best: ' + best + ' pts';
    revealEndScreen(document.getElementById('wild-end-screen'));
    if (isNew && score > 0) celebrateBurst(document.getElementById('wild-end-emoji'));
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
  var comicPrevBtn         = document.getElementById('comic-prev-btn');
  var comicNextBtn         = document.getElementById('comic-next-btn');
  var comicScrollContent   = document.getElementById('comic-scroll-content');
  var comicScrollFill      = document.getElementById('comic-scroll-fill');
  var comicStoryList       = document.getElementById('comic-story-list');
  var comicPanelsContainer = document.getElementById('comic-panels-container');
  var comicGlossaryEl      = document.getElementById('comic-glossary');
  var currentComicIdx      = -1;

  // ── SVG character generators ───────────────────────────────────────────────

  // ── Dog Man-style character SVGs ──────────────────────────────────────────
  // Each function returns an <svg> string. Poses are listed in comments.

  var INK = '#1a1a1a';

  function svgStarSloth(pose) {
    // Poses: zen (default), blink, action, shock, victory, sleepy, closeup
    var isBlink   = pose === 'blink';
    var isAction  = pose === 'action';
    var isShock   = pose === 'shock';
    var isVictory = pose === 'victory';
    var isSleepy  = pose === 'sleepy';
    var isCloseup = pose === 'closeup';

    if (isCloseup) {
      return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<path d="M14,52 Q9,30 22,18 Q14,4 30,8 Q32,-2 46,4 Q50,-3 58,4 Q72,-2 74,12 Q88,8 82,24 Q92,32 86,52 Q88,72 70,84 Q60,94 50,92 Q40,94 30,84 Q12,72 14,52 Z" fill="#D4B880" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<ellipse cx="50" cy="56" rx="28" ry="24" fill="#E8D4A0"/>' +
        '<ellipse cx="36" cy="50" rx="11" ry="9" fill="#8A6840"/>' +
        '<ellipse cx="64" cy="50" rx="11" ry="9" fill="#8A6840"/>' +
        '<circle cx="38" cy="50" r="7" fill="white" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="62" cy="50" r="7" fill="white" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="39" cy="51" r="3.5" fill="' + INK + '"/>' +
        '<circle cx="63" cy="51" r="3.5" fill="' + INK + '"/>' +
        '<circle cx="40.5" cy="49.5" r="1.4" fill="white"/>' +
        '<circle cx="64.5" cy="49.5" r="1.4" fill="white"/>' +
        '<ellipse cx="50" cy="64" rx="5" ry="3.5" fill="#5A3010" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<path d="M40,72 Q50,79 60,72" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>' +
        '</svg>';
    }

    var lidsClosed = isBlink || isSleepy || isVictory;
    var eyeY = isShock ? 47 : 49;
    var eyeR = isShock ? 6.5 : 4.5;
    var pupilR = isShock ? 2 : 2.8;

    var eyes = lidsClosed
      ? '<path d="M36,47 Q42,51 48,47" fill="none" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/>' +
        '<path d="M52,47 Q58,51 64,47" fill="none" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/>'
      : '<ellipse cx="42" cy="' + eyeY + '" rx="' + eyeR + '" ry="' + (eyeR + 0.5) + '" fill="white" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<ellipse cx="58" cy="' + eyeY + '" rx="' + eyeR + '" ry="' + (eyeR + 0.5) + '" fill="white" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<circle cx="42" cy="' + (eyeY + 0.5) + '" r="' + pupilR + '" fill="' + INK + '"/>' +
        '<circle cx="58" cy="' + (eyeY + 0.5) + '" r="' + pupilR + '" fill="' + INK + '"/>' +
        '<circle cx="43" cy="' + (eyeY - 0.5) + '" r="1" fill="white"/>' +
        '<circle cx="59" cy="' + (eyeY - 0.5) + '" r="1" fill="white"/>';

    var mouth = isShock
      ? '<ellipse cx="50" cy="66" rx="5" ry="6" fill="#3A1500" stroke="' + INK + '" stroke-width="1.5"/>'
      : isVictory
        ? '<path d="M40,64 Q50,73 60,64" fill="#4A2000" stroke="' + INK + '" stroke-width="1.8"/>'
        : '<path d="M45,64 Q50,68 55,64" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>';

    var zMarks = isSleepy
      ? '<text x="74" y="22" font-size="11" font-family="Bangers,Impact,sans-serif" fill="#6C63FF" stroke="' + INK + '" stroke-width="0.6">Z</text>' +
        '<text x="84" y="12" font-size="7" font-family="Bangers,Impact,sans-serif" fill="#6C63FF" stroke="' + INK + '" stroke-width="0.4">z</text>'
      : '';

    var speedLines = isAction
      ? '<path d="M2,30 Q10,29 18,30" fill="none" stroke="#9090A0" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M1,44 Q9,43 16,44" fill="none" stroke="#9090A0" stroke-width="1.8" stroke-linecap="round"/>' +
        '<path d="M3,72 Q11,71 18,72" fill="none" stroke="#9090A0" stroke-width="1.8" stroke-linecap="round"/>'
      : '';

    var shockBurst = isShock
      ? '<path d="M50,4 L52,12 L60,8 L56,16 L66,18 L58,22 L66,30 L56,28 L60,38 L52,32 L50,42 L48,32 L40,38 L44,28 L34,30 L42,22 L34,18 L44,16 L40,8 L48,12 Z" fill="none" stroke="#FFC000" stroke-width="1.5"/>'
      : '';

    var victoryArms = isVictory
      ? '<path d="M30,80 Q18,68 12,52" fill="none" stroke="#C4A870" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M70,80 Q82,68 88,52" fill="none" stroke="#C4A870" stroke-width="9" stroke-linecap="round"/>' +
        '<circle cx="12" cy="50" r="6" fill="#C4A870" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="88" cy="50" r="6" fill="#C4A870" stroke="' + INK + '" stroke-width="2"/>'
      : '';

    var actionClaw = isAction
      ? '<path d="M50,72 Q52,52 60,40" fill="none" stroke="#C4A870" stroke-width="9" stroke-linecap="round"/>' +
        '<circle cx="60" cy="40" r="5" fill="#C4A870" stroke="' + INK + '" stroke-width="2"/>' +
        '<path d="M57,36 L59,32 M60,35 L62,31 M63,36 L65,32" stroke="' + INK + '" stroke-width="1.5" stroke-linecap="round"/>'
      : '';

    var defaultArms = (isVictory || isAction)
      ? ''
      : '<path d="M30,80 Q22,90 22,108" fill="none" stroke="#C4A870" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M70,80 Q78,90 78,108" fill="none" stroke="#C4A870" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M19,108 Q22,116 26,110" fill="none" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<path d="M75,110 Q78,118 82,112" fill="none" stroke="' + INK + '" stroke-width="1.5"/>';

    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      speedLines + shockBurst + zMarks +
      '<path d="M22,46 Q18,32 28,26 Q22,16 32,20 Q30,10 42,16 Q44,8 50,12 Q56,8 58,16 Q70,10 68,20 Q78,16 72,26 Q82,32 78,46 Q82,58 70,66 Q60,72 50,70 Q40,72 30,66 Q18,58 22,46 Z" fill="#D4B880" stroke="' + INK + '" stroke-width="3"/>' +
      '<ellipse cx="50" cy="50" rx="20" ry="18" fill="#E8D4A0"/>' +
      '<ellipse cx="42" cy="50" rx="8" ry="6.5" fill="#8A6840"/>' +
      '<ellipse cx="58" cy="50" rx="8" ry="6.5" fill="#8A6840"/>' +
      eyes +
      '<ellipse cx="50" cy="60" rx="4" ry="3" fill="#5A3010" stroke="' + INK + '" stroke-width="1.5"/>' +
      mouth +
      '<path d="M30,76 Q26,98 32,116 Q50,122 68,116 Q74,98 70,76 Q60,82 50,82 Q40,82 30,76 Z" fill="#9AAAB8" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<circle cx="50" cy="92" r="9" fill="#3A68D0" stroke="' + INK + '" stroke-width="2"/>' +
      '<text x="50" y="97" text-anchor="middle" fill="white" font-size="11" font-weight="900" font-family="Arial Black,Arial,sans-serif">S</text>' +
      defaultArms + victoryArms + actionClaw +
      '</svg>';
  }

  function svgJolt(pose) {
    // Poses: zoom (default), translating, panic, smug, exhausted, closeup
    var isTrans    = pose === 'translating';
    var isPanic    = pose === 'panic';
    var isSmug     = pose === 'smug';
    var isExhaust  = pose === 'exhausted';
    var isCloseup  = pose === 'closeup';

    if (isCloseup) {
      return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        '<circle cx="50" cy="52" r="38" fill="white" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<circle cx="50" cy="52" r="30" fill="#2A90E8"/>' +
        '<circle cx="50" cy="52" r="22" fill="#1A60B0"/>' +
        '<circle cx="50" cy="52" r="13" fill="#0A3070"/>' +
        '<circle cx="50" cy="52" r="5" fill="white"/>' +
        '<circle cx="38" cy="40" r="8" fill="rgba(255,255,255,0.55)"/>' +
        '<line x1="50" y1="14" x2="50" y2="2" stroke="' + INK + '" stroke-width="3"/>' +
        '<circle cx="50" cy="2" r="4" fill="#F0B020" stroke="' + INK + '" stroke-width="2"/>' +
        // Lightning bolts radiating
        '<path d="M10,30 L20,40 L14,42 L24,52" fill="none" stroke="#F0B020" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M90,30 L80,40 L86,42 L76,52" fill="none" stroke="#F0B020" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    }

    var tilt = isTrans ? 0 : (isPanic ? 8 : (isSmug ? -4 : (isExhaust ? 18 : -12)));
    var ghost = (isTrans || isExhaust) ? '' :
      '<ellipse cx="40" cy="64" rx="20" ry="28" fill="rgba(150,150,175,0.22)" transform="translate(-8,0)"/>';

    var magGlass = isTrans
      ? '<circle cx="76" cy="40" r="9" fill="rgba(200,230,255,0.85)" stroke="#666" stroke-width="2.5"/>' +
        '<line x1="82" y1="46" x2="90" y2="54" stroke="#666" stroke-width="3" stroke-linecap="round"/>'
      : '';

    // Inner screen content: default = focused dot, panic = !!!, smug = ★, exhausted = X X
    var screenInner;
    if (isPanic) {
      screenInner =
        '<text x="50" y="63" text-anchor="middle" fill="white" font-size="16" font-weight="900" font-family="Bangers,Impact,sans-serif">!!!</text>';
    } else if (isSmug) {
      screenInner =
        '<text x="50" y="64" text-anchor="middle" fill="#FFD700" font-size="18" font-family="Arial,sans-serif">★</text>';
    } else if (isExhaust) {
      screenInner =
        '<path d="M44,54 L52,62 M52,54 L44,62" stroke="white" stroke-width="2.2" stroke-linecap="round"/>' +
        '<path d="M48,54 L56,62 M56,54 L48,62" stroke="white" stroke-width="2.2" stroke-linecap="round"/>';
    } else {
      screenInner =
        '<circle cx="50" cy="58" r="4" fill="#0A3070"/>' +
        '<circle cx="50" cy="58" r="1.5" fill="white"/>';
    }

    // Arms: panic up, smug crossed, exhausted slack, default zigzag
    var arms;
    if (isPanic) {
      arms = '<path d="M28,68 Q14,52 8,38" fill="none" stroke="#F0B020" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M72,68 Q86,52 92,38" fill="none" stroke="#F0B020" stroke-width="4" stroke-linecap="round"/>';
    } else if (isSmug) {
      arms = '<path d="M30,68 Q42,76 50,70 Q58,76 70,68" fill="none" stroke="#F0B020" stroke-width="4" stroke-linecap="round"/>';
    } else if (isExhaust) {
      arms = '<path d="M28,72 Q22,96 28,108" fill="none" stroke="#F0B020" stroke-width="4" stroke-linecap="round"/>' +
        '<path d="M72,72 Q78,96 72,108" fill="none" stroke="#F0B020" stroke-width="4" stroke-linecap="round"/>';
    } else {
      arms = '<path d="M28,64 L18,74 L26,74 L16,86" fill="none" stroke="#F0B020" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>' +
        '<path d="M72,64 L82,74 L74,74 L84,86" fill="none" stroke="#F0B020" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>';
    }

    var sweatDrop = isPanic
      ? '<ellipse cx="22" cy="42" rx="2" ry="3.5" fill="#A0D0F0" stroke="' + INK + '" stroke-width="0.8"/>'
      : '';

    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      ghost + sweatDrop +
      '<g transform="rotate(' + tilt + ', 50, 65)">' +
      '<ellipse cx="50" cy="72" rx="24" ry="30" fill="#C8C8D8" stroke="' + INK + '" stroke-width="3"/>' +
      '<ellipse cx="50" cy="72" rx="17" ry="23" fill="none" stroke="#8888A0" stroke-width="1.5"/>' +
      '<circle cx="50" cy="58" r="17" fill="white" stroke="' + INK + '" stroke-width="3"/>' +
      '<circle cx="50" cy="58" r="13" fill="#2A90E8"/>' +
      '<circle cx="50" cy="58" r="9"  fill="#1A60B0"/>' +
      screenInner +
      '<circle cx="44" cy="52" r="3.5" fill="rgba(255,255,255,0.55)"/>' +
      '<line x1="50" y1="41" x2="50" y2="31" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<circle cx="50" cy="29" r="3.5" fill="#F0B020" stroke="' + INK + '" stroke-width="1.8"/>' +
      arms +
      '<rect x="37" y="100" width="10" height="9" rx="2" fill="#999" stroke="' + INK + '" stroke-width="1.8"/>' +
      '<rect x="53" y="100" width="10" height="9" rx="2" fill="#999" stroke="' + INK + '" stroke-width="1.8"/>' +
      '<path d="M38,109 Q42,120 46,109" fill="#F08020"/>' +
      '<path d="M54,109 Q58,120 62,109" fill="#F08020"/>' +
      '</g>' +
      magGlass +
      '</svg>';
  }

  function svgAdmiral(pose) {
    // Poses: calm (default), exploding, salute, weeping, closeup
    var isExp     = pose === 'exploding';
    var isSalute  = pose === 'salute';
    var isWeep    = pose === 'weeping';
    var isCloseup = pose === 'closeup';
    var skin      = isExp ? '#E04040' : (isWeep ? '#FFB8B0' : '#F4C2A0');
    var skinDk    = isExp ? '#B02020' : (isWeep ? '#E89890' : '#D49878');

    if (isCloseup) {
      return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        // Hat
        '<rect x="14" y="6" width="72" height="16" rx="5" fill="#1A3A6A" stroke="' + INK + '" stroke-width="3"/>' +
        '<rect x="8" y="20" width="84" height="9" rx="3" fill="#142D54" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<circle cx="50" cy="14" r="6" fill="#E0C020" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<text x="50" y="18" text-anchor="middle" font-size="8" fill="' + INK + '">★</text>' +
        // Face
        '<circle cx="50" cy="58" r="36" fill="' + skin + '" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<ellipse cx="18" cy="58" rx="7" ry="10" fill="' + skinDk + '" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<ellipse cx="82" cy="58" rx="7" ry="10" fill="' + skinDk + '" stroke="' + INK + '" stroke-width="2.5"/>' +
        // Eyes
        '<ellipse cx="38" cy="54" rx="7" ry="7" fill="white" stroke="' + INK + '" stroke-width="2"/>' +
        '<ellipse cx="62" cy="54" rx="7" ry="7" fill="white" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="38" cy="55" r="4" fill="' + INK + '"/>' +
        '<circle cx="62" cy="55" r="4" fill="' + INK + '"/>' +
        '<circle cx="39.5" cy="53" r="1.5" fill="white"/>' +
        '<circle cx="63.5" cy="53" r="1.5" fill="white"/>' +
        // Eyebrows
        '<path d="M30,44 Q38,38 46,44" fill="none" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/>' +
        '<path d="M54,44 Q62,38 70,44" fill="none" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/>' +
        // Beard
        '<path d="M28,68 Q40,82 50,80 Q60,82 72,68 Q70,80 60,86 Q50,90 40,86 Q30,80 28,68 Z" fill="#4A2000" stroke="' + INK + '" stroke-width="1.8"/>' +
        // Mouth
        (isExp
          ? '<ellipse cx="50" cy="76" rx="9" ry="7" fill="#3A0000"/><ellipse cx="50" cy="76" rx="7" ry="5" fill="#B03030"/>'
          : '<path d="M42,76 Q50,82 58,76" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>') +
        '</svg>';
    }

    // Sweat (always some when stressed; lots when exploding)
    var sweat = '<ellipse cx="27" cy="30" rx="2.2" ry="3.2" fill="#A0D0F0" stroke="' + INK + '" stroke-width="0.8" transform="rotate(-20,27,30)"/>' +
      '<ellipse cx="76" cy="26" rx="2.2" ry="3.2" fill="#A0D0F0" stroke="' + INK + '" stroke-width="0.8" transform="rotate(20,76,26)"/>';
    if (isExp) {
      sweat +=
        '<ellipse cx="14" cy="40" rx="2.5" ry="3.6" fill="#A0D0F0" stroke="' + INK + '" stroke-width="0.8" transform="rotate(-15,14,40)"/>' +
        '<ellipse cx="84" cy="44" rx="2.5" ry="3.6" fill="#A0D0F0" stroke="' + INK + '" stroke-width="0.8" transform="rotate(25,84,44)"/>';
    }

    // Tears for weeping
    var tears = isWeep
      ? '<path d="M40,52 Q38,72 36,90" fill="none" stroke="#5AB0E8" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M60,52 Q62,72 64,90" fill="none" stroke="#5AB0E8" stroke-width="3" stroke-linecap="round"/>' +
        '<ellipse cx="36" cy="92" rx="3" ry="4" fill="#5AB0E8"/>' +
        '<ellipse cx="64" cy="92" rx="3" ry="4" fill="#5AB0E8"/>'
      : '';

    var mouth = isExp
      ? '<ellipse cx="50" cy="68" rx="9" ry="7" fill="#3A0000" stroke="' + INK + '" stroke-width="1.5"/><ellipse cx="50" cy="68" rx="7" ry="5" fill="#B03030"/>'
      : isWeep
        ? '<path d="M42,70 Q50,64 58,70" fill="none" stroke="' + INK + '" stroke-width="2"/>'
        : '<path d="M43,67 Q50,72 57,67" fill="none" stroke="' + INK + '" stroke-width="1.8" stroke-linecap="round"/>';

    var eyebrows = isExp
      ? '<path d="M34,42 Q42,36 48,42" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>' +
        '<path d="M52,42 Q58,36 66,42" fill="none" stroke="' + INK + '" stroke-width="3" stroke-linecap="round"/>'
      : isWeep
        ? '<path d="M36,42 Q42,46 47,42" fill="none" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/>' +
          '<path d="M53,42 Q58,46 64,42" fill="none" stroke="' + INK + '" stroke-width="2.5" stroke-linecap="round"/>'
        : '<path d="M37,43 Q42,40 47,43" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>' +
          '<path d="M53,43 Q58,40 63,43" fill="none" stroke="' + INK + '" stroke-width="2.2" stroke-linecap="round"/>';

    var vein = isExp
      ? '<path d="M45,32 Q47,28 50,32 Q53,28 55,32" fill="none" stroke="#C03030" stroke-width="1.8"/>' +
        '<path d="M38,40 Q40,36 43,40" fill="none" stroke="#C03030" stroke-width="1.5"/>'
      : '';

    var arms;
    if (isSalute) {
      arms = '<path d="M27,82 Q34,52 44,42" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M73,82 Q73,96 63,100" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<circle cx="44" cy="40" r="5" fill="' + skin + '" stroke="' + INK + '" stroke-width="2"/>';
    } else if (isExp) {
      arms = '<path d="M27,82 Q12,92 18,108" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M73,82 Q88,92 82,108" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>';
    } else if (isWeep) {
      arms = '<path d="M28,84 Q24,98 32,108" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M72,84 Q76,98 68,108" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>';
    } else {
      arms = '<path d="M28,84 Q28,96 38,100" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M72,84 Q72,96 62,100" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>' +
        '<path d="M38,100 Q50,104 62,100" fill="none" stroke="#1A3A6A" stroke-width="9" stroke-linecap="round"/>';
    }

    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      sweat + tears +
      '<rect x="24" y="18" width="52" height="13" rx="4" fill="#1A3A6A" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<rect x="18" y="28" width="64" height="7" rx="2" fill="#142D54" stroke="' + INK + '" stroke-width="2"/>' +
      '<circle cx="50" cy="23" r="5.5" fill="#E0C020" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<text x="50" y="27" text-anchor="middle" font-size="8" fill="' + INK + '">★</text>' +
      '<circle cx="50" cy="54" r="27" fill="' + skin + '" stroke="' + INK + '" stroke-width="3"/>' +
      '<ellipse cx="22" cy="54" rx="6" ry="8" fill="' + skinDk + '" stroke="' + INK + '" stroke-width="2"/>' +
      '<ellipse cx="78" cy="54" rx="6" ry="8" fill="' + skinDk + '" stroke="' + INK + '" stroke-width="2"/>' +
      '<ellipse cx="42" cy="50" rx="5.5" ry="5.5" fill="white" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<circle cx="42" cy="50" r="3.2" fill="' + INK + '"/>' +
      '<circle cx="43" cy="49" r="1.2" fill="white"/>' +
      '<ellipse cx="58" cy="50" rx="5.5" ry="5.5" fill="white" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<circle cx="58" cy="50" r="3.2" fill="' + INK + '"/>' +
      '<circle cx="59" cy="49" r="1.2" fill="white"/>' +
      eyebrows + vein +
      '<path d="M39,62 Q45,66 50,63 Q55,66 61,62 Q63,72 58,76 Q50,78 42,76 Q37,72 39,62 Z" fill="#4A2000" stroke="' + INK + '" stroke-width="1.5"/>' +
      mouth +
      '<path d="M28,82 Q22,104 30,118 Q50,124 70,118 Q78,104 72,82 Q60,88 50,88 Q40,88 28,82 Z" fill="#1A3A6A" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<circle cx="40" cy="92" r="3.5" fill="#E0C020" stroke="' + INK + '" stroke-width="1"/>' +
      '<circle cx="40" cy="102" r="3.5" fill="#E0C020" stroke="' + INK + '" stroke-width="1"/>' +
      '<circle cx="40" cy="112" r="3.5" fill="#E0C020" stroke="' + INK + '" stroke-width="1"/>' +
      arms +
      '</svg>';
  }

  function svgOverClock(pose) {
    // Poses: smug (default), meltdown, scheming, gloating, deflated, closeup
    var isMelt    = pose === 'meltdown';
    var isScheme  = pose === 'scheming';
    var isGloat   = pose === 'gloating';
    var isDeflate = pose === 'deflated';
    var isCloseup = pose === 'closeup';

    if (isCloseup) {
      return '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
        // Coffee-jar head with steam
        '<path d="M30,80 Q72,80 75,4 Q80,12 76,8 Q82,4 78,0" fill="none" stroke="#AAA" stroke-width="1.5" stroke-linecap="round"/>' +
        '<rect x="14" y="14" width="72" height="76" rx="10" fill="rgba(210,235,255,0.88)" stroke="' + INK + '" stroke-width="3.5"/>' +
        '<rect x="18" y="48" width="64" height="38" fill="#5A2F00" opacity="0.92"/>' +
        '<ellipse cx="50" cy="48" rx="32" ry="3" fill="#7A4A00"/>' +
        '<circle cx="36" cy="56" r="2.5" fill="rgba(255,255,255,0.55)"/>' +
        '<circle cx="60" cy="64" r="3" fill="rgba(255,255,255,0.55)"/>' +
        '<circle cx="50" cy="72" r="2" fill="rgba(255,255,255,0.55)"/>' +
        // Goggle eye
        '<circle cx="50" cy="42" r="14" fill="rgba(255,255,215,0.9)" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<circle cx="50" cy="42" r="6" fill="' + INK + '"/>' +
        '<circle cx="52" cy="40" r="2" fill="white"/>' +
        // Sinister grin
        '<path d="M30,72 Q50,82 70,72" fill="#3A1500" stroke="' + INK + '" stroke-width="2.5"/>' +
        '<path d="M34,72 L38,76 M42,73 L42,77 M50,74 L50,78 M58,73 L58,77 M62,72 L66,76" stroke="white" stroke-width="1.5"/>' +
        '</svg>';
    }

    var liquidY = isMelt ? 50 : (isDeflate ? 56 : 46);
    var liquidH = 60 - liquidY;

    var bubbles = isMelt
      ? '<circle cx="44" cy="' + (liquidY - 8)  + '" r="2.2" fill="rgba(255,255,255,0.6)"/>' +
        '<circle cx="54" cy="' + (liquidY - 14) + '" r="1.8" fill="rgba(255,255,255,0.6)"/>' +
        '<circle cx="60" cy="' + (liquidY - 6)  + '" r="2.5" fill="rgba(255,255,255,0.6)"/>'
      : '<circle cx="46" cy="' + (liquidY - 6) + '" r="1.5" fill="rgba(255,255,255,0.45)"/>';

    var steam;
    if (isMelt) {
      steam = '<path d="M66,18 Q70,10 68,4 Q73,8 71,2" fill="none" stroke="#CCC" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M72,22 Q77,14 75,8 Q80,12 78,6" fill="none" stroke="#CCC" stroke-width="2" stroke-linecap="round"/>' +
        '<path d="M78,18 Q82,11 80,5" fill="none" stroke="#CCC" stroke-width="2" stroke-linecap="round"/>';
    } else if (isDeflate) {
      steam = '';
    } else {
      steam = '<path d="M68,18 Q71,12 69,7" fill="none" stroke="#CCC" stroke-width="1.8" stroke-linecap="round"/>';
    }

    // Eye expression
    var eye;
    if (isMelt) {
      eye = '<circle cx="50" cy="30" r="10" fill="rgba(255,255,215,0.9)" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<circle cx="50" cy="30" r="3" fill="' + INK + '"/>' +
        '<path d="M40,22 Q45,18 52,22" fill="none" stroke="#C03030" stroke-width="2" stroke-linecap="round"/>';
    } else if (isScheme) {
      eye = '<circle cx="50" cy="30" r="10" fill="rgba(255,255,215,0.9)" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<ellipse cx="50" cy="32" rx="5" ry="2" fill="' + INK + '"/>';
    } else if (isDeflate) {
      eye = '<circle cx="50" cy="30" r="9" fill="rgba(255,255,215,0.7)" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<path d="M44,28 L52,32 M52,28 L44,32" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    } else {
      eye = '<circle cx="50" cy="30" r="9" fill="rgba(255,255,215,0.9)" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<circle cx="50" cy="30" r="4" fill="' + INK + '"/>' +
        '<circle cx="51.5" cy="28.5" r="1.5" fill="white"/>';
    }

    var mouth;
    if (isMelt) {
      mouth = '<ellipse cx="50" cy="58" rx="7" ry="4.5" fill="#3A0000" stroke="' + INK + '" stroke-width="1.5"/>';
    } else if (isGloat) {
      mouth = '<path d="M40,54 Q50,68 60,54" fill="#3A1500" stroke="' + INK + '" stroke-width="2.2"/>' +
        '<path d="M40,54 Q50,60 60,54" fill="none" stroke="white" stroke-width="1"/>';
    } else if (isDeflate) {
      mouth = '<path d="M44,60 Q50,55 56,60" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    } else {
      mouth = '<path d="M42,55 Q50,62 58,55" fill="none" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>';
    }

    var jitter = isMelt
      ? '<line x1="27" y1="46" x2="21" y2="52" stroke="#888" stroke-width="1.2" stroke-linecap="round"/>' +
        '<line x1="73" y1="46" x2="79" y2="52" stroke="#888" stroke-width="1.2" stroke-linecap="round"/>'
      : '';

    var arms;
    if (isScheme) {
      arms = '<path d="M28,72 Q38,76 44,72" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M72,72 Q62,76 56,72" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>' +
        '<circle cx="44" cy="72" r="4" fill="#3A6A30" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<circle cx="56" cy="72" r="4" fill="#3A6A30" stroke="' + INK + '" stroke-width="1.5"/>';
    } else if (isGloat) {
      arms = '<path d="M42,72 Q24,60 14,72" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M58,72 Q76,60 86,72" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>';
    } else if (isDeflate) {
      arms = '<path d="M42,76 Q34,98 32,108" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M58,76 Q66,98 68,108" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>';
    } else {
      arms = '<path d="M42,72 Q26,78 22,92" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>' +
        '<path d="M58,72 Q74,78 78,92" fill="none" stroke="#3A6A30" stroke-width="6" stroke-linecap="round"/>';
    }

    return '<svg viewBox="0 0 100 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
      steam + jitter +
      // Coffee jar head
      '<rect x="26" y="8" width="48" height="56" rx="9" fill="rgba(210,235,255,0.8)" stroke="' + INK + '" stroke-width="3"/>' +
      '<rect x="28" y="' + liquidY + '" width="44" height="' + liquidH + '" fill="#5A2F00" opacity="0.92"/>' +
      '<ellipse cx="50" cy="' + liquidY + '" rx="22" ry="2.2" fill="#7A4A00"/>' +
      bubbles +
      // Handles
      '<path d="M74,20 Q86,20 86,38 Q86,56 74,56" fill="none" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/>' +
      '<path d="M26,22 Q14,18 12,32" fill="none" stroke="' + INK + '" stroke-width="3.5" stroke-linecap="round"/>' +
      eye + mouth +
      // Body — green coat with clock pockets
      '<path d="M40,64 Q36,98 38,116 Q50,120 62,116 Q64,98 60,64 Z" fill="#3A6A30" stroke="' + INK + '" stroke-width="2.5"/>' +
      '<circle cx="50" cy="82" r="6" fill="#E8E8E8" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<line x1="50" y1="78" x2="50" y2="82" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<line x1="50" y1="82" x2="53" y2="83" stroke="' + INK + '" stroke-width="1.5"/>' +
      '<circle cx="50" cy="100" r="4" fill="#E8E8E8" stroke="' + INK + '" stroke-width="1.2"/>' +
      arms +
      '<ellipse cx="44" cy="116" rx="7" ry="4" fill="#3A6A30" stroke="' + INK + '" stroke-width="2"/>' +
      '<ellipse cx="56" cy="116" rx="7" ry="4" fill="#3A6A30" stroke="' + INK + '" stroke-width="2"/>' +
      '</svg>';
  }

  // ── Comic scripts ────────────────────────────────────────────────────────
  // The authored stories live in data/comics.json (loaded in initComicMode).
  // enhanceComicStory() below derives each panel's visual treatment.
  var COMIC_STORIES = [];
  var comicLibraryScroll = 0;  // remember comic list scroll while viewing a comic

  function enhanceComicStory(story) {
    var hasPatience = story.words.some(function (w) { return String(w.word).toLowerCase() === 'patience'; });
    if (!hasPatience) {
      story.words.push({ word: 'patience', definition: 'The capacity to stay calm while waiting without complaining.' });
    }

    story.blurb = story.blurb + ' Slapstick chaos meets patient heroics.';

    var ironyPanel = {
      caption: 'IRONY ALERT: EVERYONE PANICS. THE SLOTH WINS BY TAKING HIS TIME.',
      char: 'jolt', pose: 'exhausted', size: 'splash', bg: '#E8FFE8',
      bubble: 'Fast plans exploded. Patience worked. Again. I need less coffee and more contemplation.',
      bubbleType: 'speech', sfx: 'BONK!',
      props: ['dustCloud', 'sparks']
    };

    var panels = story.panels || [];
    if (panels.length > 0) {
      panels.push(ironyPanel);
    }

    // Opportunistically tag each existing panel with Dog Man visual fields.
    panels.forEach(function (p) {
      if (!p) return;
      var sfx = p.sfx || '';
      var loud = /KA-?BOO?M|KA-?BLOOO?M|BOOM|BLAST|CRASH|SLAM|WHAM|CRUNCH|SPLAT|POW|KAPOW|THUD|BONK|CLANG/i.test(sfx);
      var zappy = /ZAP|ZZZ|FZZ|BUZZ|CRACKLE|SPARK|FZZT/i.test(sfx);

      // Splash for huge climactic moments
      if (loud && p.bubbleType === 'shout' && !p.size && !p.fullWidth) {
        p.size = 'wide';
      }

      // Action lines on rage / zoom / loud
      if (!('actionLines' in p)) {
        if (p.bubbleType === 'rage' || (loud && p.bubbleType === 'shout') ||
            (p.char === 'jolt' && p.pose === 'zoom')) {
          p.actionLines = true;
        }
      }

      // Closeup for emotionally heavy admiral/over-clock shouts
      if (!p.shot) {
        if ((p.char === 'admiral' && p.bubbleType === 'shout') ||
            (p.char === 'overClock' && p.bubbleType === 'rage')) {
          p.shot = 'closeup';
        }
      }

      // Props
      if (!p.props) {
        var props = [];
        if (loud) props.push('dustCloud', 'sparks');
        if (zappy) props.push('lightning');
        if (p.char === 'jolt' && p.pose === 'zoom') props.push('motionSwoosh');
        if (p.char === 'starSloth') props.push('stars');
        if (p.char === 'overClock') props.push('cog');
        if (p.caption && /BRIDGE|ENGINE|CONTROL|RED ALERT/i.test(p.caption)) props.push('controlPanel');
        if (props.length) p.props = props;
      }
    });

    return story;
  }

  // ── end COMIC_STORIES ──


  var COMIC_SVG = {
    starSloth: svgStarSloth,
    jolt:      svgJolt,
    admiral:   svgAdmiral,
    overClock: svgOverClock
  };

  // ── Prop SVG library (rendered behind characters) ─────────────────────────

  var PROP_SVG = {
    sparks: '<svg viewBox="0 0 100 100" style="left:-4%;top:-6%;width:108%;height:114%;opacity:0.85"><g fill="none" stroke="#FFC000" stroke-width="2.5" stroke-linecap="round">' +
      '<path d="M10,18 L18,26 M22,12 L26,22 M30,8 L30,18 M82,16 L74,24 M90,30 L80,32 M88,46 L78,46"/>' +
      '<path d="M14,72 L22,68 M28,86 L30,76 M70,78 L78,72 M86,82 L78,86"/>' +
      '<circle cx="48" cy="14" r="2" fill="#FFE000" stroke="' + INK + '" stroke-width="1"/>' +
      '<circle cx="86" cy="60" r="1.5" fill="#FFE000" stroke="' + INK + '" stroke-width="0.8"/>' +
      '<circle cx="12" cy="50" r="1.5" fill="#FFE000" stroke="' + INK + '" stroke-width="0.8"/>' +
      '</g></svg>',
    lightning: '<svg viewBox="0 0 100 100" style="left:0;top:0;width:100%;height:100%;opacity:0.7"><g fill="#FFD000" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round">' +
      '<path d="M14,8 L20,28 L14,30 L26,52 L20,52 L34,76"/>' +
      '<path d="M86,12 L78,30 L84,32 L74,50 L80,52 L70,72"/>' +
      '</g></svg>',
    motionSwoosh: '<svg viewBox="0 0 100 100" style="left:-2%;top:30%;width:104%;height:50%;opacity:0.55"><g fill="none" stroke="#6080C0" stroke-width="2.5" stroke-linecap="round">' +
      '<path d="M2,30 Q40,28 70,40"/>' +
      '<path d="M2,46 Q40,44 78,52"/>' +
      '<path d="M2,62 Q40,60 70,68"/>' +
      '<path d="M2,78 Q40,76 64,82"/>' +
      '</g></svg>',
    dustCloud: '<svg viewBox="0 0 100 100" style="left:-6%;bottom:-4%;top:auto;width:112%;height:38%;opacity:0.7"><g fill="#D4D0C8" stroke="' + INK + '" stroke-width="1.8">' +
      '<ellipse cx="20" cy="70" rx="14" ry="9"/>' +
      '<ellipse cx="40" cy="62" rx="16" ry="10"/>' +
      '<ellipse cx="62" cy="68" rx="14" ry="9"/>' +
      '<ellipse cx="80" cy="74" rx="12" ry="8"/>' +
      '</g></svg>',
    stars: '<svg viewBox="0 0 100 100" style="left:0;top:0;width:100%;height:100%;opacity:0.85"><g fill="#FFE000" stroke="' + INK + '" stroke-width="0.8">' +
      '<path d="M16,18 L18,22 L22,22 L19,25 L20,29 L16,27 L12,29 L13,25 L10,22 L14,22 Z"/>' +
      '<path d="M82,14 L84,18 L88,18 L85,21 L86,25 L82,23 L78,25 L79,21 L76,18 L80,18 Z"/>' +
      '<path d="M12,82 L13,84 L15,84 L13.5,86 L14,88 L12,87 L10,88 L10.5,86 L9,84 L11,84 Z"/>' +
      '<path d="M88,86 L89,88 L91,88 L89.5,90 L90,92 L88,91 L86,92 L86.5,90 L85,88 L87,88 Z"/>' +
      '</g></svg>',
    cog: '<svg viewBox="0 0 100 100" style="right:4%;top:6%;left:auto;width:34%;height:34%;opacity:0.35"><g fill="#888" stroke="' + INK + '" stroke-width="1.5">' +
      '<path d="M50,8 L56,14 L64,12 L66,20 L74,22 L72,30 L78,36 L74,42 L78,50 L70,52 L68,60 L60,60 L56,68 L48,64 L40,68 L36,60 L28,60 L26,52 L18,50 L22,42 L18,36 L24,30 L22,22 L30,20 L32,12 L40,14 Z"/>' +
      '<circle cx="50" cy="40" r="8" fill="#EEE"/>' +
      '</g></svg>',
    controlPanel: '<svg viewBox="0 0 100 100" style="left:6%;bottom:6%;top:auto;width:88%;height:22%;opacity:0.45"><g stroke="' + INK + '" stroke-width="1.5">' +
      '<rect x="4" y="4" width="92" height="40" fill="#2A4A6A"/>' +
      '<circle cx="14" cy="16" r="3" fill="#E04040"/>' +
      '<circle cx="26" cy="16" r="3" fill="#E0C020"/>' +
      '<circle cx="38" cy="16" r="3" fill="#40E040"/>' +
      '<rect x="50" y="10" width="40" height="6" fill="#102030"/>' +
      '<rect x="50" y="22" width="40" height="6" fill="#102030"/>' +
      '<rect x="6" y="30" width="20" height="10" fill="#444"/>' +
      '<rect x="30" y="30" width="20" height="10" fill="#444"/>' +
      '</g></svg>'
  };

  // ── SFX burst — jagged star polygon with Bangers text ─────────────────────

  function svgSfx(text, kind) {
    if (!text) return '';
    var palette = {
      boom:     { fill: '#FFD000', edge: '#C03030', text: '#7B0000' },
      zap:      { fill: '#80E0FF', edge: '#1060C0', text: '#0A2050' },
      sinister: { fill: '#C040E0', edge: '#5A0080', text: '#FFF' },
      soft:     { fill: '#FFE082', edge: '#A07000', text: '#5A3000' }
    };
    var c = palette[kind] || palette.boom;
    // Jagged star burst path
    var burst = 'M50,2 L58,16 L74,8 L70,24 L88,22 L78,36 L96,42 L80,52 L94,64 L76,66 L86,82 L68,78 L72,96 L58,84 L50,98 L42,84 L28,96 L32,78 L14,82 L24,66 L6,64 L20,52 L4,42 L22,36 L12,22 L30,24 L26,8 L42,16 Z';
    // Truncate very long sfx text
    var shown = String(text).length > 14 ? String(text).slice(0, 12) + '..' : String(text);
    return '<svg viewBox="0 0 100 100" aria-hidden="true">' +
      '<path d="' + burst + '" fill="' + c.fill + '" stroke="' + c.edge + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="' + burst + '" fill="none" stroke="' + INK + '" stroke-width="1.5" stroke-linejoin="round" transform="translate(1.5,1.5) scale(0.97)"/>' +
      '<text x="50" y="58" text-anchor="middle" font-family="Bangers,Impact,sans-serif" font-size="' + (shown.length > 8 ? 14 : 20) + '" font-weight="900" fill="' + c.text + '" stroke="' + INK + '" stroke-width="0.6" style="letter-spacing:0.04em">' + shown + '</text>' +
      '</svg>';
  }

  // ── Radial action lines overlay ───────────────────────────────────────────

  function svgActionLines(color) {
    var col = color || '#1a1a1a';
    var lines = '';
    for (var i = 0; i < 18; i++) {
      var a = (i / 18) * Math.PI * 2;
      var x1 = 50 + Math.cos(a) * 60;
      var y1 = 50 + Math.sin(a) * 60;
      var x2 = 50 + Math.cos(a) * 38;
      var y2 = 50 + Math.sin(a) * 38;
      lines += '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '" stroke="' + col + '" stroke-width="1.5" stroke-linecap="round"/>';
    }
    return '<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">' + lines + '</svg>';
  }

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

  var PANEL_TILTS = [-1.2, 0.8, -0.6, 1.1, -0.9, 0.7, -0.4, 1.0];

  var SCENE_CLASS_MAP = {
    overClock: 'panel-scene-overclock',
    jolt:      'panel-scene-jolt',
    admiral:   'panel-scene-admiral',
    starSloth: 'panel-scene-starsloth'
  };

  // Choose a soft SFX kind from the sfx string
  function detectSfxKind(sfx, bubbleType) {
    if (!sfx) return null;
    var s = String(sfx);
    if (/KA-?BOOM|KA-?BLOOO?M|BOOM|BLAST|CRASH|SLAM|BANG|WHAM|CRUNCH|SPLAT|POW|KAPOW|THUD|BONK/i.test(s)) return 'boom';
    if (/ZAP|ZZZ|FZZ|BUZZ|CRACKLE|SPARK|FZZT/i.test(s)) return 'zap';
    if (/MWAHA|MWEHE|MWEH|sigh|drip|tick|tock|click|fzzt|\.\.\.|zz/i.test(s) && s.length < 20) return 'soft';
    if (s === s.toUpperCase() && s.length > 2) return 'boom';
    return 'soft';
  }

  function buildPanelHTML(panelDef, words, idx) {
    var isSplash  = panelDef.fullWidth || panelDef.size === 'splash' || panelDef.size === 'wide';
    var tilt      = isSplash ? 0 : (PANEL_TILTS[idx % PANEL_TILTS.length] || 0);
    var svgFn     = COMIC_SVG[panelDef.char] || svgStarSloth;
    var svgHtml   = svgFn(panelDef.pose || 'zen');
    var bubbleText = panelDef.bubble ? comicHighlight(panelDef.bubble, words) : '';
    var captionHtml = panelDef.caption
      ? '<div class="panel-caption">' + panelDef.caption + '</div>'
      : '';
    var bubbleClass = 'comic-bubble bubble-' + (panelDef.bubbleType || 'speech');
    var bubbleHtml  = bubbleText
      ? '<div class="' + bubbleClass + '">' + bubbleText + '</div>'
      : '';

    // Size class
    var sizeClass = '';
    if (panelDef.fullWidth) sizeClass = ' full-width';
    else if (panelDef.size === 'wide')   sizeClass = ' size-wide';
    else if (panelDef.size === 'tall')   sizeClass = ' size-tall';
    else if (panelDef.size === 'splash') sizeClass = ' size-splash';

    // Shot class (character zoom)
    var shotClass = '';
    if (panelDef.shot === 'closeup') shotClass = ' shot-closeup';
    else if (panelDef.shot === 'wide') shotClass = ' shot-wide';

    // Props layer
    var propsHtml = '';
    if (panelDef.props && panelDef.props.length) {
      var inner = '';
      panelDef.props.forEach(function (p) {
        if (PROP_SVG[p]) inner += PROP_SVG[p];
      });
      if (inner) propsHtml = '<div class="panel-props">' + inner + '</div>';
    }

    // Action lines overlay
    var actionHtml = '';
    if (panelDef.actionLines) {
      var col = (panelDef.bubbleType === 'rage') ? '#8B0000' : '#1a1a1a';
      actionHtml = '<div class="panel-action-lines">' + svgActionLines(col) + '</div>';
    }

    // SFX — burst (for loud) or plain text (for soft)
    var sfxHtml = '';
    if (panelDef.sfx) {
      var kind = panelDef.sfxKind || detectSfxKind(panelDef.sfx, panelDef.bubbleType);
      if (kind === 'soft') {
        sfxHtml = '<div class="panel-sfx">' + panelDef.sfx + '</div>';
      } else {
        var corner = (isSplash || idx % 2 !== 0) ? ' sfx-left' : '';
        var rot = ((idx * 37) % 30) - 15;
        sfxHtml = '<div class="panel-sfx-burst' + corner + '" style="--sfx-rotate:' + rot + 'deg">' +
          svgSfx(panelDef.sfx, kind) + '</div>';
      }
    }

    var sceneClass = SCENE_CLASS_MAP[panelDef.char] || 'panel-scene-starsloth';
    return '<div class="comic-panel' + sizeClass + shotClass + ' ' + sceneClass + '"' +
      ' style="--panel-tilt:' + tilt + 'deg;background-color:' + (panelDef.bg || '#FFFDE7') + '">' +
      captionHtml +
      propsHtml +
      actionHtml +
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

  function updateComicNavBtns() {
    comicPrevBtn.disabled = (currentComicIdx <= 0);
    comicNextBtn.disabled = (currentComicIdx < 0 || currentComicIdx >= COMIC_STORIES.length - 1);
  }

  function showComic(idx) {
    var story = COMIC_STORIES[idx];
    currentComicIdx = idx;
    renderComicPanels(story.panels, story.words);
    comicLibraryScroll = comicLibraryScreen.scrollTop;
    comicLibraryScreen.classList.add('hidden');
    comicViewingScreen.classList.remove('hidden');
    comicScrollContent.scrollTop = 0;
    comicScrollFill.style.height = '0%';
    updateComicNavBtns();
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
      comicLibraryScreen.scrollTop = comicLibraryScroll;
    });
    comicPrevBtn.addEventListener('click', function () {
      if (currentComicIdx > 0) showComic(currentComicIdx - 1);
    });
    comicNextBtn.addEventListener('click', function () {
      if (currentComicIdx < COMIC_STORIES.length - 1) showComic(currentComicIdx + 1);
    });
    comicScrollContent.addEventListener('scroll', function () {
      var max = comicScrollContent.scrollHeight - comicScrollContent.clientHeight;
      var pct = max > 0 ? comicScrollContent.scrollTop / max : 0;
      comicScrollFill.style.height = (pct * 100) + '%';
    });
    comicOverlay.addEventListener('click', function (e) {
      if (e.target === comicOverlay) closeComicOverlay();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      if (comicOverlay.classList.contains('hidden')) return;
      closeComicOverlay();
    });

    fetch('data/comics.json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        COMIC_STORIES = ((data && data.comics) || []).map(enhanceComicStory);
        if (!comicOverlay.classList.contains('hidden') &&
            !comicLibraryScreen.classList.contains('hidden')) {
          renderComicLibrary();
        }
      })
      .catch(function () { COMIC_STORIES = []; });
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

  // ── Collapsible section toggles ───────────────────────────────────────────
  var LAUNCH_GROUP_KEY = 'launchGroupOpen';

  function loadLaunchGroupState() {
    try {
      return JSON.parse(localStorage.getItem(LAUNCH_GROUP_KEY)) || {};
    } catch (e) {
      return {};
    }
  }

  function saveLaunchGroupState(s) {
    try {
      localStorage.setItem(LAUNCH_GROUP_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  (function restoreLaunchGroupState() {
    var saved = loadLaunchGroupState();
    // Reading Tools and Games — the child-primary groups — default OPEN;
    // Filters and Word Explorer stay opt-in. An explicit saved choice
    // (true or false) always wins over the default.
    var defaultOpen = { 'reading-body': true, 'games-body': true };
    document.querySelectorAll('.launch-group-toggle').forEach(function (toggle) {
      var key = toggle.getAttribute('aria-controls');
      var open = saved[key] === true ||
                 (saved[key] === undefined && defaultOpen[key] === true);
      if (open) {
        toggle.setAttribute('aria-expanded', 'true');
        var body = document.getElementById(key);
        if (body) body.classList.remove('collapsed');
      }
    });
  }());

  document.querySelectorAll('.launch-group-toggle').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var expanded = this.getAttribute('aria-expanded') === 'true';
      this.setAttribute('aria-expanded', String(!expanded));
      var key = this.getAttribute('aria-controls');
      var body = document.getElementById(key);
      if (body) body.classList.toggle('collapsed', expanded);
      var saved = loadLaunchGroupState();
      saved[key] = !expanded;
      saveLaunchGroupState(saved);
    });
  });
