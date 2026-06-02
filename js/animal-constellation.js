// Animal Constellation — the animal kingdom drawn as a night sky.
//
// Each star is an animal; each constellation is an evolutionary "superpower"
// (speed, hunting, stealth, camouflage, venom, brute strength, cunning, group
// living, endurance, heightened senses). Unrelated animals that solved the same
// survival problem the same way are grouped together — a cheetah beside a
// sailfish under Speed, a shark beside a lion under Hunting. Neighbouring
// constellations share kindred traits (Stealth sits between Hunting and
// Camouflage and Venom), so the whole sky is a map of the patterns evolution
// keeps reinventing.
//
// Tap a star to discover its animal and answer a quick vocabulary puzzle drawn
// from a word that captures that animal's trait. Answer both of an animal's
// words and its star lights up gold.
//
// Canvas 2D so it's cheap on phones; pan/zoom over a fixed web of 50 stars.
//
// Exposes: window.initAnimalConstellation(allWords, openWordDetail)

(function () {
  'use strict';

  var DATA_URL = 'data/animal-constellations.json';
  var SAVE_KEY = 'vocabVault_beastConstellation';
  var TAP_PIXEL_THRESHOLD = 12;
  var TAP_TIME_THRESHOLD = 600;
  var START_NOTE = 'Uncover animals in the same group — tap a star to play!';
  var START_NOTE_MS = 6000;   // how long the opening note lingers before fading

  // World coordinate space (the layout is computed once in these units and a
  // fit transform maps it onto the canvas).
  var WORLD_W = 1700;
  var WORLD_H = 1150;
  var RING_RX = 600;
  var RING_RY = 400;
  var CLUSTER_R = 150;     // radius of an animal cluster around its segment centre
  var STAR_R = 9;          // base star radius in world units

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // Cheap deterministic hash → 0..1, so jitter and background stars are stable.
  function hash01(str, salt) {
    var h = 2166136261 ^ (salt || 0);
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h = (h >>> 0);
    return (h % 100000) / 100000;
  }

  function shuffle(arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  // Mirrors app.js / Constellation Quest: prefer same part of speech, top up
  // with anything else from the corpus.
  function pickDistractors(correct, pool, count) {
    var candidates = pool.filter(function (w) {
      return (w.word || '').toLowerCase() !== (correct.word || '').toLowerCase();
    });
    var sameType = correct.word_type
      ? candidates.filter(function (w) { return w.word_type === correct.word_type; })
      : [];
    var picks = [];
    shuffle(sameType).forEach(function (w) { if (picks.length < count) picks.push(w); });
    if (picks.length < count) {
      var others = candidates.filter(function (w) { return picks.indexOf(w) === -1; });
      shuffle(others).forEach(function (w) { if (picks.length < count) picks.push(w); });
    }
    return picks;
  }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { captured: {} };
      var d = JSON.parse(raw);
      return { captured: d.captured || {} };
    } catch (e) { return { captured: {} }; }
  }

  window.initAnimalConstellation = function (allWords, openWordDetail) {
    var overlay = document.getElementById('beast-overlay');
    var canvas = document.getElementById('beast-canvas');
    var launchBtn = document.getElementById('beast-launch-btn');
    if (!overlay || !canvas || !launchBtn) return;

    var closeBtn = document.getElementById('beast-close');
    var recenterBtn = document.getElementById('beast-recenter');
    var legendEl = document.getElementById('beast-legend');
    var statusEl = document.getElementById('beast-status');
    var progressEl = document.getElementById('beast-progress');

    var quizCard = document.getElementById('beast-quiz');
    var quizClose = document.getElementById('beast-quiz-close');
    var quizEmoji = document.getElementById('beast-quiz-emoji');
    var quizName = document.getElementById('beast-quiz-name');
    var quizNote = document.getElementById('beast-quiz-note');
    var quizPrompt = document.getElementById('beast-quiz-prompt');
    var quizAnswers = document.getElementById('beast-quiz-answers');
    var quizFeedback = document.getElementById('beast-quiz-feedback');
    var quizLearn = document.getElementById('beast-quiz-learn');
    var quizNext = document.getElementById('beast-quiz-next');

    var ctx = canvas.getContext('2d');
    var dpr = 1;

    var data = null;          // raw json
    var segments = [];        // [{...segment, cx, cy}]
    var stars = [];           // [{animal, segment, x, y, wordKeys[]}]
    var bgStars = [];         // ambient background dots
    var corpusIndex = {};     // lowercase word -> corpus word object
    var active = false;
    var loaded = false;

    var save = loadSave();
    var focusedSegId = null;  // when a legend chip is selected
    var hoverStar = null;
    var rafId = 0;
    var noteTimer = 0;        // auto-dismiss timer for the opening note

    // view transform: screen = world * scale + offset
    var view = { scale: 1, x: 0, y: 0 };

    // ── Data ────────────────────────────────────────────────────────────────
    function ensureData() {
      if (loaded) return Promise.resolve();
      allWords.forEach(function (w) { corpusIndex[(w.word || '').toLowerCase()] = w; });
      return fetch(DATA_URL)
        .then(function (r) { return r.json(); })
        .then(function (json) {
          data = json;
          buildLayout();
          loaded = true;
        });
    }

    function buildLayout() {
      segments = [];
      stars = [];
      var segs = data.segments;
      var n = segs.length;
      var cx0 = WORLD_W / 2;
      var cy0 = WORLD_H / 2;
      segs.forEach(function (seg, si) {
        // Even spacing around an ellipse; start at top and go clockwise.
        var ang = -Math.PI / 2 + (si / n) * Math.PI * 2;
        var seg2 = Object.assign({}, seg);
        seg2.cx = cx0 + Math.cos(ang) * RING_RX;
        seg2.cy = cy0 + Math.sin(ang) * RING_RY;
        seg2.starRefs = [];
        segments.push(seg2);

        var m = seg.animals.length;
        seg.animals.forEach(function (animal, ai) {
          var a2 = -Math.PI / 2 + (ai / m) * Math.PI * 2;
          // small organic wobble, stable per animal
          var jr = 0.78 + hash01(animal.name, 1) * 0.34;
          var ja = (hash01(animal.name, 2) - 0.5) * 0.5;
          var r = CLUSTER_R * jr;
          var star = {
            animal: animal,
            segment: seg2,
            x: seg2.cx + Math.cos(a2 + ja) * r,
            y: seg2.cy + Math.sin(a2 + ja) * r * 0.92,
            wordKeys: animal.words.map(function (w) { return w.word; }),
            twinkle: hash01(animal.name, 3) * Math.PI * 2,
          };
          stars.push(star);
          seg2.starRefs.push(star);
        });
      });

      // ambient background stars
      bgStars = [];
      for (var i = 0; i < 220; i++) {
        bgStars.push({
          x: hash01('bg' + i, 7) * WORLD_W,
          y: hash01('bg' + i, 11) * WORLD_H,
          r: 0.5 + hash01('bg' + i, 13) * 1.3,
          tw: hash01('bg' + i, 17) * Math.PI * 2,
        });
      }
    }

    // ── Capture / progress ────────────────────────────────────────────────
    function isWordCaptured(word) { return !!save.captured[word]; }
    function captureWord(word) {
      if (save.captured[word]) return;
      save.captured[word] = true;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify({ captured: save.captured })); } catch (e) {}
    }
    function isAnimalDiscovered(star) {
      return star.wordKeys.every(isWordCaptured);
    }
    function counts() {
      var animalsDone = 0, wordsDone = 0, totalWords = 0;
      stars.forEach(function (s) {
        if (isAnimalDiscovered(s)) animalsDone++;
        s.wordKeys.forEach(function (w) { totalWords++; if (isWordCaptured(w)) wordsDone++; });
      });
      return { animalsDone: animalsDone, totalAnimals: stars.length, wordsDone: wordsDone, totalWords: totalWords };
    }
    function updateProgress() {
      var c = counts();
      if (progressEl) {
        progressEl.textContent = '🌟 ' + c.animalsDone + '/' + c.totalAnimals + ' animals · ✦ ' + c.wordsDone + '/' + c.totalWords + ' words';
      }
    }

    // ── Transform helpers ───────────────────────────────────────────────────
    function worldToScreen(x, y) {
      return { x: x * view.scale + view.x, y: y * view.scale + view.y };
    }
    function screenToWorld(x, y) {
      return { x: (x - view.x) / view.scale, y: (y - view.y) / view.scale };
    }
    function fitToView() {
      var w = canvas.clientWidth || canvas.width;
      var h = canvas.clientHeight || canvas.height;
      var margin = 70;
      var sx = (w - margin * 2) / WORLD_W;
      var sy = (h - margin * 2) / WORLD_H;
      view.scale = Math.min(sx, sy);
      view.x = (w - WORLD_W * view.scale) / 2;
      view.y = (h - WORLD_H * view.scale) / 2;
    }

    // ── Rendering ─────────────────────────────────────────────────────────
    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      var w = canvas.clientWidth;
      var h = canvas.clientHeight;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
    }

    function segDimmed(seg) {
      return focusedSegId && seg.id !== focusedSegId;
    }

    function draw(now) {
      var w = canvas.width, h = canvas.height;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      var cw = w / dpr, ch = h / dpr;

      // space background
      var g = ctx.createLinearGradient(0, 0, 0, ch);
      g.addColorStop(0, '#070a1b');
      g.addColorStop(1, '#0b0420');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, ch);

      var t = now || 0;

      // ambient stars
      ctx.save();
      bgStars.forEach(function (s) {
        var p = worldToScreen(s.x, s.y);
        if (p.x < -10 || p.x > cw + 10 || p.y < -10 || p.y > ch + 10) return;
        var a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 900 + s.tw));
        ctx.globalAlpha = a;
        ctx.fillStyle = '#cdd6ff';
        ctx.beginPath();
        ctx.arc(p.x, p.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();

      // neighbour links between constellations (drawn once per pair)
      ctx.save();
      ctx.lineWidth = 1;
      var seen = {};
      segments.forEach(function (seg) {
        var pa = worldToScreen(seg.cx, seg.cy);
        (seg.neighbors || []).forEach(function (nid) {
          var key = [seg.id, nid].sort().join('|');
          if (seen[key]) return;
          seen[key] = true;
          var nb = segments.filter(function (s) { return s.id === nid; })[0];
          if (!nb) return;
          var pb = worldToScreen(nb.cx, nb.cy);
          var dim = segDimmed(seg) && segDimmed(nb);
          ctx.strokeStyle = dim ? 'rgba(120,130,170,0.06)' : 'rgba(150,165,220,0.16)';
          ctx.setLineDash([4, 6]);
          ctx.beginPath();
          ctx.moveTo(pa.x, pa.y);
          ctx.lineTo(pb.x, pb.y);
          ctx.stroke();
        });
      });
      ctx.setLineDash([]);
      ctx.restore();

      // within-constellation lines + stars
      segments.forEach(function (seg) {
        var dim = segDimmed(seg);
        var refs = seg.starRefs;
        // constellation outline
        ctx.save();
        ctx.strokeStyle = seg.hue;
        ctx.globalAlpha = dim ? 0.12 : 0.5;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        refs.forEach(function (s, i) {
          var p = worldToScreen(s.x, s.y);
          if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        });
        if (refs.length > 2) {
          var p0 = worldToScreen(refs[0].x, refs[0].y);
          ctx.lineTo(p0.x, p0.y);
        }
        ctx.stroke();
        ctx.restore();

        // segment name label near the centroid
        var pc = worldToScreen(seg.cx, seg.cy);
        ctx.save();
        ctx.globalAlpha = dim ? 0.3 : (focusedSegId === seg.id ? 1 : 0.85);
        ctx.fillStyle = seg.hue;
        ctx.font = '700 ' + (13) + 'px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(seg.emoji + '  ' + seg.name, pc.x, pc.y - (CLUSTER_R * view.scale) - 6);
        ctx.restore();

        // stars
        refs.forEach(function (s) {
          drawStar(s, seg, t, dim);
        });
      });

      if (active) rafId = requestAnimationFrame(draw);
    }

    function drawStar(s, seg, t, dim) {
      var p = worldToScreen(s.x, s.y);
      var discovered = isAnimalDiscovered(s);
      var partial = !discovered && s.wordKeys.some(isWordCaptured);
      var baseR = STAR_R * view.scale;
      var tw = 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(t / 700 + s.twinkle));
      var alpha = dim ? 0.22 : 1;

      // glow
      ctx.save();
      ctx.globalAlpha = alpha * (discovered ? 0.9 : 0.6) * tw;
      var glowR = baseR * (discovered ? 4.2 : 3);
      var grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
      var core = discovered ? '#fff3c4' : seg.hue;
      grad.addColorStop(0, core);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, glowR, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // emoji
      ctx.save();
      ctx.globalAlpha = dim ? 0.35 : 1;
      var emojiSize = clamp(baseR * 2.2, 16, 40);
      ctx.font = emojiSize + 'px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.animal.emoji, p.x, p.y);
      ctx.restore();

      // ring for discovered / hover
      if (discovered || hoverStar === s || partial) {
        ctx.save();
        ctx.globalAlpha = dim ? 0.4 : 1;
        ctx.lineWidth = 2;
        ctx.strokeStyle = discovered ? '#ffd86b' : (partial ? seg.hue : 'rgba(255,255,255,0.7)');
        ctx.beginPath();
        ctx.arc(p.x, p.y, emojiSize * 0.75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      // name label (always for discovered, on hover otherwise)
      if (!dim && (discovered || hoverStar === s)) {
        ctx.save();
        ctx.font = '700 11px Nunito, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        var label = s.animal.name;
        var tw2 = ctx.measureText(label).width;
        var ly = p.y + emojiSize * 0.7;
        ctx.fillStyle = 'rgba(8,10,25,0.78)';
        ctx.fillRect(p.x - tw2 / 2 - 5, ly, tw2 + 10, 16);
        ctx.fillStyle = discovered ? '#ffe79e' : '#e9edff';
        ctx.fillText(label, p.x, ly + 2);
        ctx.restore();
      }
    }

    // ── Hit testing ─────────────────────────────────────────────────────────
    function starAt(sx, sy) {
      var best = null, bestD = Infinity;
      var hitR = clamp(STAR_R * view.scale * 2.4, 18, 44);
      stars.forEach(function (s) {
        if (segDimmed(s.segment)) return;
        var p = worldToScreen(s.x, s.y);
        var d = Math.hypot(p.x - sx, p.y - sy);
        if (d < hitR && d < bestD) { bestD = d; best = s; }
      });
      return best;
    }

    // Returns the nearest segment whose cluster area contains the screen point.
    function segmentAt(sx, sy) {
      var world = screenToWorld(sx, sy);
      var best = null, bestD = Infinity;
      var hitR = CLUSTER_R * 1.3;
      segments.forEach(function (seg) {
        var d = Math.hypot(world.x - seg.cx, world.y - seg.cy);
        if (d < hitR && d < bestD) { bestD = d; best = seg; }
      });
      return best;
    }

    // Pan the view so seg is centred on the canvas (only when zoomed in).
    function bringSegmentIntoView(seg) {
      var w = canvas.clientWidth || canvas.width / dpr;
      var h = canvas.clientHeight || canvas.height / dpr;
      var margin = 70;
      var fitScale = Math.min((w - margin * 2) / WORLD_W, (h - margin * 2) / WORLD_H);
      if (view.scale <= fitScale * 1.15) return;
      var p = worldToScreen(seg.cx, seg.cy);
      if (Math.abs(p.x - w / 2) < w * 0.25 && Math.abs(p.y - h / 2) < h * 0.25) return;
      view.x = w / 2 - seg.cx * view.scale;
      view.y = h / 2 - seg.cy * view.scale;
    }

    // ── Legend ───────────────────────────────────────────────────────────
    function renderLegend() {
      legendEl.innerHTML = '';
      segments.forEach(function (seg) {
        var chip = el('button', 'beast-chip');
        chip.type = 'button';
        chip.style.setProperty('--chip-hue', seg.hue);
        chip.setAttribute('aria-pressed', focusedSegId === seg.id ? 'true' : 'false');
        if (focusedSegId === seg.id) chip.classList.add('active');
        chip.appendChild(el('span', 'beast-chip-emoji', seg.emoji));
        chip.appendChild(el('span', 'beast-chip-label', seg.trait));
        chip.addEventListener('click', function () {
          toggleFocus(seg.id);
          if (focusedSegId === seg.id) bringSegmentIntoView(seg);
        });
        legendEl.appendChild(chip);
      });
    }

    function toggleFocus(id) {
      focusedSegId = (focusedSegId === id) ? null : id;
      var seg = segments.filter(function (s) { return s.id === id; })[0];
      if (focusedSegId && seg) {
        setStatus(seg.emoji + ' ' + seg.name + ' — ' + seg.pattern);
      } else {
        setStatus('');
      }
      renderLegend();
    }

    // Setting any deliberate status cancels a pending opening note so it can't
    // wipe a segment pattern or discovery message out from under the player.
    function setStatus(text) {
      clearTimeout(noteTimer);
      if (statusEl) statusEl.textContent = text;
    }

    // A brief note that appears, lingers, then clears itself (used on open).
    function showStartNote() {
      if (statusEl) statusEl.textContent = START_NOTE;
      clearTimeout(noteTimer);
      noteTimer = setTimeout(function () {
        if (active && !focusedSegId && statusEl && statusEl.textContent === START_NOTE) {
          statusEl.textContent = '';
        }
      }, START_NOTE_MS);
    }

    // ── Quiz ─────────────────────────────────────────────────────────────
    var quizCtx = null; // { star, seg, order:[wordObj...], idx, answering }

    function openQuiz(star) {
      var seg = star.segment;
      quizCtx = { star: star, seg: seg, order: chooseWordOrder(star), idx: 0, answering: false };
      quizEmoji.textContent = star.animal.emoji;
      quizName.textContent = star.animal.name;
      quizNote.textContent = star.animal.note;
      quizCard.style.setProperty('--seg-hue', seg.hue);
      quizCard.classList.remove('hidden');
      quizCard.setAttribute('aria-hidden', 'false');
      renderQuestion();
    }

    // Quiz the uncaptured words first; if all are done, review in order.
    function chooseWordOrder(star) {
      var words = star.animal.words.slice();
      var todo = words.filter(function (w) { return !isWordCaptured(w.word); });
      return todo.length ? todo : words;
    }

    function resolveWord(wordObj) {
      // Use embedded definition; borrow corpus object for distractors/linking.
      var corpus = corpusIndex[(wordObj.word || '').toLowerCase()];
      return {
        word: wordObj.word,
        definition: wordObj.definition || (corpus && corpus.definition) || '',
        word_type: wordObj.word_type || (corpus && corpus.word_type) || '',
        corpus: corpus || null,
      };
    }

    function buildQuestion(resolved, type) {
      var distractors = pickDistractors(resolved, allWords, 3);
      var opts = shuffle([resolved].concat(distractors));
      var correctIndex = opts.indexOf(resolved);
      if (type === 1) {
        return {
          word: resolved,
          prompt: 'What does the word “' + resolved.word + '” mean?',
          options: opts.map(function (w) { return w.definition || '—'; }),
          correctIndex: correctIndex,
        };
      }
      return {
        word: resolved,
        prompt: resolved.definition || ('Which word fits “' + resolved.word + '”?'),
        options: opts.map(function (w) { return w.word; }),
        correctIndex: correctIndex,
      };
    }

    function renderQuestion() {
      if (!quizCtx) return;
      var wordObj = quizCtx.order[quizCtx.idx];
      var resolved = resolveWord(wordObj);
      var type = quizCtx.idx % 2; // alternate definition→word and word→definition
      var q = buildQuestion(resolved, type);
      quizCtx.current = q;
      quizCtx.answering = true;

      quizFeedback.textContent = '';
      quizFeedback.className = 'quiz-feedback beast-quiz-feedback';
      quizLearn.classList.add('hidden');
      quizNext.classList.add('hidden');
      quizPrompt.textContent = q.prompt;
      quizAnswers.innerHTML = '';
      q.options.forEach(function (text, idx) {
        var btn = el('button', 'quiz-answer-btn');
        btn.type = 'button';
        btn.textContent = text;
        btn.addEventListener('click', function () { answer(q, idx, btn); });
        quizAnswers.appendChild(btn);
      });
    }

    function answer(q, idx, btn) {
      if (!quizCtx || !quizCtx.answering) return;
      quizCtx.answering = false;
      var correct = idx === q.correctIndex;
      var buttons = quizAnswers.querySelectorAll('.quiz-answer-btn');
      buttons.forEach(function (b, i) {
        b.disabled = true;
        if (i === q.correctIndex) b.classList.add('correct');
      });
      if (typeof window.vaultRecordAnswer === 'function') {
        window.vaultRecordAnswer(q.word.word, correct);
      }
      if (correct) {
        captureWord(q.word.word);
        quizFeedback.textContent = '⭐ Correct! “' + q.word.word + '” — ' + q.word.definition;
        quizFeedback.className = 'quiz-feedback beast-quiz-feedback visible feedback-correct';
      } else {
        btn.classList.add('wrong');
        quizFeedback.textContent = '✦ Not quite. “' + q.word.word + '” means: ' + q.word.definition;
        quizFeedback.className = 'quiz-feedback beast-quiz-feedback visible feedback-wrong';
      }

      // "Learn this word" links into the main word card when in our corpus.
      if (q.word.corpus && typeof openWordDetail === 'function') {
        var corpus = q.word.corpus;
        quizLearn.classList.remove('hidden');
        quizLearn.onclick = function () { openWordDetail(corpus); };
      }

      updateProgress();

      // Advance or finish.
      var hasNext = quizCtx.idx < quizCtx.order.length - 1;
      if (hasNext) {
        quizNext.textContent = 'Next word ▸';
        quizNext.classList.remove('hidden');
        quizNext.onclick = function () { quizCtx.idx++; renderQuestion(); };
      } else {
        if (isAnimalDiscovered(quizCtx.star)) {
          quizNext.textContent = '✨ Discovered — back to the sky';
          // celebratory note about the pattern this animal belongs to
          setStatus('✨ ' + quizCtx.star.animal.name + ' discovered! ' + quizCtx.seg.emoji + ' ' + quizCtx.seg.name + ' — ' + quizCtx.seg.pattern);
        } else {
          quizNext.textContent = 'Done';
        }
        quizNext.classList.remove('hidden');
        quizNext.onclick = closeQuiz;
      }
    }

    function closeQuiz() {
      quizCtx = null;
      quizCard.classList.add('hidden');
      quizCard.setAttribute('aria-hidden', 'true');
      updateProgress();
    }

    // ── Pointer / pan / zoom ──────────────────────────────────────────────
    var pointers = {};
    var dragMoved = false;
    var downAt = 0;
    var downPos = null;
    var pinchDist = 0;

    function localPos(ev) {
      var rect = canvas.getBoundingClientRect();
      return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
    }

    function onDown(ev) {
      canvas.setPointerCapture && canvas.setPointerCapture(ev.pointerId);
      pointers[ev.pointerId] = localPos(ev);
      dragMoved = false;
      downAt = Date.now();
      downPos = localPos(ev);
      if (Object.keys(pointers).length === 2) {
        var pts = Object.keys(pointers).map(function (k) { return pointers[k]; });
        pinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    }

    function onMove(ev) {
      var p = localPos(ev);
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pointers[ev.pointerId]) {
        pointers[ev.pointerId] = p;
        var pts = ids.map(function (k) { return pointers[k]; });
        var dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (pinchDist > 0) {
          var mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
          zoomAt(mid.x, mid.y, dist / pinchDist);
        }
        pinchDist = dist;
        dragMoved = true;
        return;
      }
      if (pointers[ev.pointerId]) {
        var prev = pointers[ev.pointerId];
        var dx = p.x - prev.x, dy = p.y - prev.y;
        if (Math.abs(p.x - downPos.x) > TAP_PIXEL_THRESHOLD || Math.abs(p.y - downPos.y) > TAP_PIXEL_THRESHOLD) dragMoved = true;
        view.x += dx; view.y += dy;
        pointers[ev.pointerId] = p;
      } else {
        // hover
        var s = starAt(p.x, p.y);
        if (s !== hoverStar) {
          hoverStar = s;
          canvas.style.cursor = s ? 'pointer' : 'grab';
        }
      }
    }

    function onUp(ev) {
      var p = localPos(ev);
      var wasTap = !dragMoved && (Date.now() - downAt) < TAP_TIME_THRESHOLD;
      delete pointers[ev.pointerId];
      if (Object.keys(pointers).length < 2) pinchDist = 0;
      if (wasTap) {
        var s = starAt(p.x, p.y);
        if (s) {
          openQuiz(s);
        } else {
          var seg = segmentAt(p.x, p.y);
          if (seg) {
            toggleFocus(seg.id);
          } else if (focusedSegId) {
            // tapping empty space clears focus
            toggleFocus(focusedSegId);
          }
        }
      }
    }

    function zoomAt(cx, cy, factor) {
      var newScale = clamp(view.scale * factor, 0.3, 4);
      var f = newScale / view.scale;
      view.x = cx - (cx - view.x) * f;
      view.y = cy - (cy - view.y) * f;
      view.scale = newScale;
    }

    function onWheel(ev) {
      ev.preventDefault();
      var p = localPos(ev);
      var factor = ev.deltaY < 0 ? 1.1 : 0.9;
      zoomAt(p.x, p.y, factor);
    }

    // ── Open / close ──────────────────────────────────────────────────────
    function open() {
      ensureData().then(function () {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        active = true;
        focusedSegId = null;
        closeQuiz();
        renderLegend();
        updateProgress();
        showStartNote();
        resize();
        fitToView();
        cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(draw);
      });
    }

    function close() {
      active = false;
      clearTimeout(noteTimer);
      cancelAnimationFrame(rafId);
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    // ── Wiring ──────────────────────────────────────────────────────────────
    launchBtn.addEventListener('click', open);
    if (closeBtn) closeBtn.addEventListener('click', close);
    if (recenterBtn) recenterBtn.addEventListener('click', function () { focusedSegId = null; renderLegend(); setStatus(''); fitToView(); });
    if (quizClose) quizClose.addEventListener('click', closeQuiz);

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('resize', function () {
      if (!active) return;
      resize();
      fitToView();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !active) return;
      var detail = document.getElementById('modal-overlay');
      if (detail && !detail.classList.contains('hidden')) return; // let the word card close first
      if (quizCtx) { closeQuiz(); return; }
      close();
    });
  };
})();
