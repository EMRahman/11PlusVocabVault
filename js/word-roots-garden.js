// Word Roots Garden — plant a word and watch its etymology grow into a tree.
//
// Each of the curated etymology entries in data/word-explorer.json becomes a
// seed. Planting one grows an animated tree: the trunk is the ancient root
// (e.g. Latin "abhorrere" — to shrink back), and the canopy blossoms are the
// English "cousins" that sprang from it (abhor, horror, horrendous, horrid).
// Tap a blossom to make it bloom — and, if the word is in our corpus, open its
// word card. Calm, no-timer self-exploration: discover roots, watch the garden
// fill in, and feel how words are related.
//
// Canvas 2D so it's cheap on phones; one tree on screen at a time.
//
// Exposes: window.initWordRootsGarden(words, openWordDetail)

(function () {
  'use strict';

  var EXPLORER_URL = 'data/word-explorer.json';
  var SAVE_KEY = 'vocabVault_rootsGarden';
  var GROW_MS = 1500;            // length of the grow-in animation
  var MAX_COUSINS = 7;           // blossoms besides the head word
  var TAP_PIXEL_THRESHOLD = 12;  // drag tolerance before a tap is ignored
  var TAP_TIME_THRESHOLD = 600;

  // Shared origin palette (matches Word Portrait / Mood Map).
  var ORIGIN_COLORS = {
    'Latin':       '#fbbf24',
    'Greek':       '#a78bfa',
    'Old English': '#34d399',
    'Old Norse':   '#60a5fa',
    'French':      '#f472b6',
    'Old French':  '#fb7185',
    'Italian':     '#22d3ee',
    'Arabic':      '#fb923c',
    'Germanic':    '#94a3b8',
    'Other':       '#cbd5e1',
  };
  function originColor(o) { return ORIGIN_COLORS[o] || ORIGIN_COLORS.Other; }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function easeOutBack(t) {
    var c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  function loadSave() {
    try {
      var raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return { grown: {}, bloomed: {} };
      var d = JSON.parse(raw);
      return { grown: d.grown || {}, bloomed: d.bloomed || {} };
    } catch (e) { return { grown: {}, bloomed: {} }; }
  }

  window.initWordRootsGarden = function (allWords, openWordDetail) {
    var overlay = document.getElementById('rootsgarden-overlay');
    var launchBtn = document.getElementById('rootsgarden-launch-btn');
    if (!overlay || !launchBtn) return;

    var closeBtn = document.getElementById('rootsgarden-close');
    var surpriseBtn = document.getElementById('rootsgarden-surprise');
    var searchInput = document.getElementById('rootsgarden-search');
    var trayEl = document.getElementById('rootsgarden-tray');
    var stage = overlay.querySelector('.rootsgarden-stage');
    var canvas = document.getElementById('rootsgarden-canvas');
    var captionEl = document.getElementById('rootsgarden-caption');
    var tooltipEl = document.getElementById('rootsgarden-tooltip');
    var emptyEl = document.getElementById('rootsgarden-empty');
    var legendEl = document.getElementById('rootsgarden-legend');
    var progressEl = document.getElementById('rootsgarden-progress');
    var ctx = canvas.getContext('2d');

    // Case-insensitive lookup from cousin string → corpus word object.
    var corpusByLower = {};
    allWords.forEach(function (w) { corpusByLower[w.word.toLowerCase()] = w; });

    var explorerData = null;
    var loaded = false;
    var active = false;
    var save = loadSave();

    var seeds = [];          // [{ word, etymology }]
    var tree = null;         // current planted tree
    var W = 0, H = 0, dpr = 1;
    var rafId = null;

    function persist() {
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {}
    }

    function ensureData() {
      if (loaded) return Promise.resolve();
      return fetch(EXPLORER_URL, { cache: 'no-store' })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (d) { explorerData = d; loaded = true; buildSeeds(); })
        .catch(function () { explorerData = { etymology: {} }; loaded = true; buildSeeds(); });
    }

    function buildSeeds() {
      var ety = (explorerData && explorerData.etymology) || {};
      seeds = Object.keys(ety).map(function (name) {
        var w = corpusByLower[name.toLowerCase()] || { word: name };
        return { word: w.word, corpus: corpusByLower[name.toLowerCase()] || null, etymology: ety[name] };
      }).sort(function (a, b) { return a.word.localeCompare(b.word); });
    }

    // ── Seed tray ─────────────────────────────────────────────────────────
    function renderTray(filter) {
      trayEl.innerHTML = '';
      var term = (filter || '').trim().toLowerCase();
      var shown = seeds.filter(function (s) {
        return !term || s.word.toLowerCase().indexOf(term) !== -1;
      });
      if (!shown.length) {
        trayEl.appendChild(el('span', 'rootsgarden-tray-empty', 'No seeds match that search'));
        return;
      }
      shown.forEach(function (s) {
        var chip = el('button', 'rootsgarden-seed');
        chip.type = 'button';
        chip.style.setProperty('--seed-color', originColor(s.etymology.origin));
        if (save.grown[s.word]) chip.classList.add('is-grown');
        if (tree && tree.word === s.word) chip.classList.add('is-active');
        chip.innerHTML = '<span class="rootsgarden-seed-dot" aria-hidden="true"></span>' +
          '<span class="rootsgarden-seed-name"></span>';
        chip.querySelector('.rootsgarden-seed-name').textContent = s.word;
        chip.title = s.etymology.origin + ' root';
        chip.addEventListener('click', function () { plant(s); });
        trayEl.appendChild(chip);
      });
    }

    function renderLegend() {
      legendEl.innerHTML = '';
      var present = {};
      seeds.forEach(function (s) { present[s.etymology.origin] = true; });
      Object.keys(ORIGIN_COLORS).forEach(function (origin) {
        if (!present[origin]) return;
        var item = el('span', 'explorer-legend-item');
        var sw = el('span', 'explorer-legend-swatch');
        sw.style.background = originColor(origin);
        item.appendChild(sw);
        item.appendChild(document.createTextNode(origin));
        legendEl.appendChild(item);
      });
    }

    function renderProgress() {
      var grownCount = Object.keys(save.grown).length;
      var bloomCount = Object.keys(save.bloomed).length;
      progressEl.textContent = '🌱 ' + grownCount + '/' + seeds.length + ' roots grown · 🌸 ' + bloomCount + ' blossoms';
    }

    // ── Plant a tree ──────────────────────────────────────────────────────
    function plant(seed) {
      var ety = seed.etymology;
      var cousins = (ety.cousins || []).slice(0, MAX_COUSINS);
      // Head blossom = the word itself; cousins fan around it.
      var blossoms = [];
      blossoms.push(makeBlossom(seed.word, seed.corpus, true, seed.word));
      cousins.forEach(function (c) {
        var corpus = corpusByLower[String(c).toLowerCase()] || null;
        blossoms.push(makeBlossom(c, corpus, false, seed.word));
      });
      assignLayout(blossoms);

      tree = {
        word: seed.word,
        origin: ety.origin,
        color: originColor(ety.origin),
        root: ety.root,
        rootMeaning: ety.rootMeaning,
        kidExplanation: ety.kidExplanation,
        approxYear: ety.approxYear,
        blossoms: blossoms,
        plantedAt: performance.now(),
      };
      // The head word is what you searched — it blooms for free.
      if (!save.bloomed[blossoms[0].bloomKey]) {
        save.bloomed[blossoms[0].bloomKey] = true;
        blossoms[0].justBloomed = true;
      }
      blossoms[0].bloomed = true;
      blossoms.forEach(function (b, i) { if (i) b.bloomed = !!save.bloomed[b.bloomKey]; });

      save.grown[seed.word] = true;
      persist();

      hideTooltip();
      emptyEl.classList.add('hidden');
      renderCaption();
      renderTray(searchInput.value);
      renderProgress();
      startLoop();
    }

    function makeBlossom(label, corpus, isHead, headWord) {
      return {
        label: String(label),
        corpus: corpus,
        isHead: isHead,
        bloomed: false,
        justBloomed: false,
        bloomKey: headWord + '::' + String(label).toLowerCase(),
        angle: 0, radiusFactor: 0, popSeed: Math.random() * Math.PI * 2,
      };
    }

    // Fan the blossoms across an upward arc; head sits at the crown.
    function assignLayout(blossoms) {
      var n = blossoms.length;
      blossoms[0].angle = Math.PI / 2;            // straight up (math coords, y-up)
      blossoms[0].radiusFactor = 1.0;
      var cousins = n - 1;
      for (var i = 1; i < n; i++) {
        var frac = cousins === 1 ? 0.5 : (i - 1) / (cousins - 1);
        // Spread 150°→30°, but nudge away from the crown so labels don't collide.
        var deg = 152 - frac * 124;
        blossoms[i].angle = deg * Math.PI / 180;
        blossoms[i].radiusFactor = 0.78 + ((i % 2) ? 0.06 : -0.02);
      }
    }

    function renderCaption() {
      if (!tree) { captionEl.setAttribute('aria-hidden', 'true'); captionEl.innerHTML = ''; return; }
      var yearBit = tree.approxYear ? ' · first seen in English ~' + tree.approxYear : '';
      captionEl.innerHTML =
        '<span class="rootsgarden-cap-origin" style="background:' + tree.color + '">' + escapeHtml(tree.origin) + '</span>' +
        '<span class="rootsgarden-cap-root"><strong>' + escapeHtml(tree.root) + '</strong> → “' + escapeHtml(tree.rootMeaning) + '”' + yearBit + '</span>' +
        (tree.kidExplanation ? '<span class="rootsgarden-cap-note">' + escapeHtml(tree.kidExplanation) + '</span>' : '');
      captionEl.setAttribute('aria-hidden', 'false');
    }

    function escapeHtml(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c];
      });
    }

    // ── Geometry ──────────────────────────────────────────────────────────
    function blossomScreenPos(b, swayPhase) {
      var groundY = H - 42;
      var canopyX = W / 2;
      var canopyY = H * 0.46;
      var reach = Math.min(W * 0.42, H * 0.40);
      var sway = Math.sin(swayPhase + b.popSeed) * 0.03;       // gentle breeze
      var a = b.angle + sway;
      var r = reach * b.radiusFactor;
      return {
        x: canopyX + Math.cos(a) * r,
        y: canopyY - Math.sin(a) * r,
        canopyX: canopyX, canopyY: canopyY, groundY: groundY,
      };
    }

    // ── Drawing ───────────────────────────────────────────────────────────
    function draw(now) {
      ctx.clearRect(0, 0, W, H);
      drawBackground();
      if (!tree) return;

      var elapsed = now - tree.plantedAt;
      var p = clamp(elapsed / GROW_MS, 0, 1);
      var swayPhase = now * 0.0011;

      var groundY = H - 42;
      var canopyX = W / 2;
      var canopyY = H * 0.46;

      // Ground line with a soft mound.
      ctx.save();
      var grd = ctx.createLinearGradient(0, groundY - 6, 0, H);
      grd.addColorStop(0, 'rgba(52, 211, 153, 0.16)');
      grd.addColorStop(1, 'rgba(5, 6, 15, 0)');
      ctx.fillStyle = grd;
      ctx.fillRect(0, groundY - 6, W, H - groundY + 6);
      ctx.strokeStyle = 'rgba(120, 200, 160, 0.35)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, groundY);
      ctx.quadraticCurveTo(canopyX, groundY - 10, W, groundY);
      ctx.stroke();
      ctx.restore();

      // Trunk grows first.
      var trunkP = easeInOut(clamp(p / 0.34, 0, 1));
      var trunkTopX = canopyX, trunkTopY = canopyY;
      ctx.save();
      ctx.strokeStyle = 'rgba(150, 110, 78, 0.95)';
      ctx.lineCap = 'round';
      var baseW = Math.max(6, W * 0.012);
      ctx.lineWidth = baseW;
      ctx.beginPath();
      ctx.moveTo(canopyX, groundY);
      var midX = canopyX + Math.sin(swayPhase) * 4;
      var topX = trunkTopX + Math.sin(swayPhase) * 7;
      var topY = groundY - (groundY - trunkTopY) * trunkP;
      ctx.quadraticCurveTo(midX, (groundY + trunkTopY) / 2, topX, topY);
      ctx.stroke();
      ctx.restore();
      trunkTopX = topX;

      // Branches + blossoms.
      var n = tree.blossoms.length;
      tree.blossoms.forEach(function (b, i) {
        var pos = blossomScreenPos(b, swayPhase);
        var branchP = easeInOut(clamp((p - 0.30 - i * 0.035) / 0.5, 0, 1));
        if (branchP <= 0) return;

        // Branch: a gentle curve from the canopy top to the blossom.
        var ex = trunkTopX + (pos.x - trunkTopX) * branchP;
        var ey = trunkTopY + (pos.y - trunkTopY) * branchP;
        var cx = (trunkTopX + pos.x) / 2 + (pos.y - trunkTopY) * 0.10;
        var cy = (trunkTopY + pos.y) / 2 - (pos.x - trunkTopX) * 0.10;
        ctx.save();
        ctx.strokeStyle = 'rgba(150, 110, 78, 0.8)';
        ctx.lineCap = 'round';
        ctx.lineWidth = b.isHead ? Math.max(4, baseW * 0.6) : Math.max(2.5, baseW * 0.42);
        ctx.beginPath();
        ctx.moveTo(trunkTopX, trunkTopY);
        ctx.quadraticCurveTo(cx * branchP + trunkTopX * (1 - branchP), cy * branchP + trunkTopY * (1 - branchP), ex, ey);
        ctx.stroke();
        ctx.restore();

        var popP = easeOutBack(clamp((p - 0.55 - i * 0.035) / 0.4, 0, 1));
        if (popP <= 0) return;
        drawBlossom(pos.x, pos.y, b, popP, swayPhase);
        b._hit = { x: pos.x, y: pos.y, r: (b.isHead ? 26 : 20) + 8 };
      });
    }

    function drawBlossom(x, y, b, popP, swayPhase) {
      var baseR = b.isHead ? 16 : 12;
      var r = baseR * clamp(popP, 0, 1.15);
      ctx.save();
      ctx.translate(x, y);

      if (b.bloomed) {
        // Flower: soft glow + petals + bright centre.
        ctx.shadowColor = tree.color;
        ctx.shadowBlur = b.justBloomed ? 24 : 14;
        var petals = 6;
        ctx.fillStyle = tree.color;
        ctx.globalAlpha = 0.92;
        for (var k = 0; k < petals; k++) {
          var pa = (k / petals) * Math.PI * 2 + swayPhase * 0.4;
          var px = Math.cos(pa) * r * 0.82;
          var py = Math.sin(pa) * r * 0.82;
          ctx.beginPath();
          ctx.arc(px, py, r * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        ctx.fillStyle = b.isHead ? '#fff7cc' : '#fffbe8';
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        if (b.isHead) {
          ctx.strokeStyle = '#fde68a';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.92, 0, Math.PI * 2);
          ctx.stroke();
        }
      } else {
        // Unbloomed bud: a closed green teardrop inviting a tap.
        ctx.fillStyle = 'rgba(74, 222, 128, 0.9)';
        ctx.strokeStyle = 'rgba(187, 247, 208, 0.7)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      // Label under the blossom (fades in late so it doesn't pop early).
      if (popP > 0.55) {
        ctx.save();
        ctx.globalAlpha = clamp((popP - 0.55) / 0.4, 0, 1);
        ctx.font = (b.isHead ? '700 14px' : '500 12px') + ' system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(5, 6, 15, 0.85)';
        ctx.strokeText(b.label, x, y + baseR + 6);
        ctx.fillStyle = b.bloomed ? '#f4f7ff' : '#bbf7d0';
        ctx.fillText(b.label, x, y + baseR + 6);
        ctx.restore();
      }
    }

    function drawBackground() {
      var g = ctx.createLinearGradient(0, 0, 0, H);
      if (tree) {
        g.addColorStop(0, 'rgba(20, 26, 52, 1)');
        g.addColorStop(1, 'rgba(5, 6, 15, 1)');
      } else {
        g.addColorStop(0, '#0a0d20');
        g.addColorStop(1, '#05060f');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // ── Animation loop ────────────────────────────────────────────────────
    function frame(now) {
      draw(now);
      // Keep animating while growing or while bloomed flowers sway.
      rafId = requestAnimationFrame(frame);
    }
    function startLoop() {
      if (rafId == null) rafId = requestAnimationFrame(frame);
    }
    function stopLoop() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
    }

    // ── Interaction ───────────────────────────────────────────────────────
    function blossomAt(px, py) {
      if (!tree) return null;
      var hit = null, best = Infinity;
      tree.blossoms.forEach(function (b) {
        if (!b._hit) return;
        var dx = px - b._hit.x, dy = py - b._hit.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d <= b._hit.r && d < best) { best = d; hit = b; }
      });
      return hit;
    }

    function handleTapBlossom(b) {
      if (!b.bloomed) {
        b.bloomed = true;
        b.justBloomed = true;
        save.bloomed[b.bloomKey] = true;
        persist();
        renderProgress();
        setTimeout(function () { b.justBloomed = false; }, 700);
      }
      showTooltipFor(b);
    }

    function showTooltipFor(b) {
      var pos = b._hit;
      if (!pos) return;
      tooltipEl.innerHTML = '';
      var name = el('span', 'rootsgarden-tip-word', b.label);
      tooltipEl.appendChild(name);
      var note = el('span', 'rootsgarden-tip-note',
        b.isHead ? 'the word you planted' : 'cousin of “' + tree.word + '”');
      tooltipEl.appendChild(note);
      if (b.corpus && typeof openWordDetail === 'function') {
        var btn = el('button', 'rootsgarden-tip-btn', '📇 Word card');
        btn.type = 'button';
        btn.addEventListener('click', function (ev) {
          ev.stopPropagation();
          openWordDetail(b.corpus);
        });
        tooltipEl.appendChild(btn);
      } else {
        tooltipEl.appendChild(el('span', 'rootsgarden-tip-dim', 'not in our word list'));
      }
      var rect = stage.getBoundingClientRect();
      var tx = clamp(pos.x, 70, rect.width - 70);
      var ty = clamp(pos.y - 70, 8, rect.height - 90);
      tooltipEl.style.left = tx + 'px';
      tooltipEl.style.top = ty + 'px';
      tooltipEl.classList.add('visible');
      tooltipEl.setAttribute('aria-hidden', 'false');
    }
    function hideTooltip() {
      tooltipEl.classList.remove('visible');
      tooltipEl.setAttribute('aria-hidden', 'true');
    }

    // Pointer (tap vs drag) tracking.
    var down = null;
    canvas.addEventListener('pointerdown', function (ev) {
      down = { x: ev.clientX, y: ev.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', function (ev) {
      if (!down) return;
      var moved = Math.hypot(ev.clientX - down.x, ev.clientY - down.y);
      var dt = performance.now() - down.t;
      down = null;
      if (moved > TAP_PIXEL_THRESHOLD || dt > TAP_TIME_THRESHOLD) return;
      var rect = canvas.getBoundingClientRect();
      var b = blossomAt(ev.clientX - rect.left, ev.clientY - rect.top);
      if (b) handleTapBlossom(b);
      else hideTooltip();
    });

    // ── Sizing ────────────────────────────────────────────────────────────
    function resize() {
      var rect = stage.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = rect.width + 'px';
      canvas.style.height = rect.height + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = rect.width; H = rect.height;
    }
    window.addEventListener('resize', function () { if (active) { resize(); } });

    function plantRandom() {
      if (!seeds.length) return;
      var ungrown = seeds.filter(function (s) { return !save.grown[s.word]; });
      var pool = ungrown.length ? ungrown : seeds;
      plant(pool[Math.floor(Math.random() * pool.length)]);
    }

    // ── Open / close ──────────────────────────────────────────────────────
    function open() {
      ensureData().then(function () {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        active = true;
        renderTray(searchInput.value);
        renderLegend();
        renderProgress();
        resize();
        if (tree) { tree.plantedAt = performance.now(); emptyEl.classList.add('hidden'); startLoop(); }
        else { emptyEl.classList.remove('hidden'); draw(performance.now()); }
      });
    }
    function close() {
      active = false;
      stopLoop();
      hideTooltip();
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    launchBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    surpriseBtn.addEventListener('click', plantRandom);
    searchInput.addEventListener('input', function () { renderTray(searchInput.value); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !active) return;
      var detail = document.getElementById('modal-overlay');
      if (detail && !detail.classList.contains('hidden')) return;
      close();
    });
  };
})();
