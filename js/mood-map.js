// Mood Map — 2D scatter of every word on two axes:
//   X = formality (0 casual ↔ 1 formal)
//   Y = valence   (-1 negative ↔ +1 positive)
//
// Data lives in data/word-explorer.json under the `mood` key (heuristic-baked
// by scripts/build-mood.js for every word). Dot colour = part of speech, dot
// size = usefulness rating. Tap a dot → open the existing word-detail modal.
// Canvas 2D so it's cheap on phones; ~411 dots redraw at 60fps trivially.
//
// Exposes: window.initMoodMap(words, openWordDetail)

(function () {
  'use strict';

  var EXPLORER_URL = 'data/word-explorer.json';
  var POS_COLORS = {
    noun:        '#7dd3fc',
    verb:        '#fbbf24',
    adjective:   '#f472b6',
    adverb:      '#a78bfa',
    preposition: '#34d399',
    conjunction: '#fb923c',
    pronoun:     '#94a3b8',
    'default':   '#e2e8f0',
  };

  function posColor(type) {
    var k = String(type || '').toLowerCase().trim();
    return POS_COLORS[k] || POS_COLORS['default'];
  }

  function radius(rating) {
    var n = Number(rating) || 3;
    return 3 + (n - 1) * 1.4;
  }

  window.initMoodMap = function (allWords, openWordDetail) {
    var overlay = document.getElementById('moodmap-overlay');
    var canvas = document.getElementById('moodmap-canvas');
    var launchBtn = document.getElementById('moodmap-launch-btn');
    var closeBtn = document.getElementById('moodmap-close');
    var clearBtn = document.getElementById('moodmap-clear');
    var searchInput = document.getElementById('moodmap-search');
    var legendEl = document.getElementById('moodmap-legend');
    var tooltipEl = document.getElementById('moodmap-tooltip');
    if (!overlay || !canvas || !launchBtn) return;

    var ctx = canvas.getContext('2d');
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var moodData = null;
    var dots = []; // { word, x, y, formality, valence, color, r }
    var filterTerm = '';
    var active = false;
    var loaded = false;

    function buildLegend() {
      if (!legendEl) return;
      legendEl.innerHTML = '';
      ['noun','verb','adjective','adverb'].forEach(function (k) {
        var item = document.createElement('span');
        item.className = 'explorer-legend-item';
        var swatch = document.createElement('span');
        swatch.className = 'explorer-legend-swatch';
        swatch.style.background = POS_COLORS[k];
        var label = document.createElement('span');
        label.textContent = k;
        item.appendChild(swatch);
        item.appendChild(label);
        legendEl.appendChild(item);
      });
    }

    function ensureData() {
      if (loaded) return Promise.resolve(true);
      return fetch(EXPLORER_URL).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (data) {
        moodData = data.mood || {};
        loaded = true;
        return true;
      }).catch(function () { return false; });
    }

    function rebuildDots() {
      dots = [];
      allWords.forEach(function (w) {
        var m = moodData[w.word];
        if (!m) return;
        dots.push({
          word: w,
          formality: Math.max(0, Math.min(1, Number(m.formality) || 0.5)),
          valence:   Math.max(-1, Math.min(1, Number(m.valence) || 0)),
          color: posColor(w.word_type),
          r: radius(w.usefulness_rating),
        });
      });
    }

    function projectAll(rect) {
      var pad = 28;
      var w = rect.width - pad * 2;
      var h = rect.height - pad * 2;
      dots.forEach(function (d) {
        d.x = pad + d.formality * w;
        // Valence: +1 (positive) at top, -1 (negative) at bottom
        d.y = pad + (1 - (d.valence + 1) / 2) * h;
      });
    }

    function draw() {
      var rect = canvas.getBoundingClientRect();
      // Quadrant background tint
      var halfW = rect.width / 2;
      var halfH = rect.height / 2;
      ctx.clearRect(0, 0, rect.width, rect.height);
      var grads = [
        { x: halfW, y: 0,     w: halfW, h: halfH, fill: 'rgba(74, 222, 128, 0.05)' }, // formal+positive
        { x: 0,     y: 0,     w: halfW, h: halfH, fill: 'rgba(96, 165, 250, 0.05)' }, // casual+positive
        { x: halfW, y: halfH, w: halfW, h: halfH, fill: 'rgba(248, 113, 113, 0.05)' }, // formal+negative
        { x: 0,     y: halfH, w: halfW, h: halfH, fill: 'rgba(167, 139, 250, 0.05)' }, // casual+negative
      ];
      grads.forEach(function (g) { ctx.fillStyle = g.fill; ctx.fillRect(g.x, g.y, g.w, g.h); });

      // Centre cross
      ctx.strokeStyle = 'rgba(140, 150, 220, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(halfW, 8); ctx.lineTo(halfW, rect.height - 8);
      ctx.moveTo(8, halfH); ctx.lineTo(rect.width - 8, halfH);
      ctx.stroke();

      // Dots
      var term = filterTerm;
      dots.forEach(function (d) {
        var matches = !term || d.word.word.toLowerCase().indexOf(term) !== -1;
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        if (matches) {
          ctx.fillStyle = d.color;
          ctx.globalAlpha = 0.92;
        } else {
          ctx.fillStyle = '#2a2f4a';
          ctx.globalAlpha = 0.7;
        }
        ctx.fill();
        if (matches && term) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#fde68a';
          ctx.stroke();
        }
      });
      ctx.globalAlpha = 1;
    }

    function fit() {
      var rect = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(rect.width * dpr));
      canvas.height = Math.max(1, Math.floor(rect.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      projectAll(rect);
      draw();
    }

    function hitTest(clientX, clientY) {
      var rect = canvas.getBoundingClientRect();
      var x = clientX - rect.left;
      var y = clientY - rect.top;
      var best = null;
      var bestD2 = 14 * 14; // 14px tap radius
      for (var i = 0; i < dots.length; i++) {
        var d = dots[i];
        var dx = d.x - x, dy = d.y - y;
        var d2 = dx * dx + dy * dy;
        var hit = (d.r + 8) * (d.r + 8);
        if (d2 < hit && d2 < bestD2) { best = d; bestD2 = d2; }
      }
      return best;
    }

    function showTooltip(d, clientX, clientY) {
      if (!tooltipEl) return;
      tooltipEl.textContent = d.word.word;
      tooltipEl.style.display = 'block';
      var rect = canvas.getBoundingClientRect();
      tooltipEl.style.left = (clientX - rect.left) + 'px';
      tooltipEl.style.top  = (clientY - rect.top - 24) + 'px';
    }
    function hideTooltip() { if (tooltipEl) tooltipEl.style.display = 'none'; }

    function bindPointer() {
      var downX = 0, downY = 0, downT = 0, downId = -1;
      canvas.addEventListener('pointerdown', function (ev) {
        downX = ev.clientX; downY = ev.clientY; downT = Date.now(); downId = ev.pointerId;
      });
      canvas.addEventListener('pointermove', function (ev) {
        if (ev.pointerType !== 'mouse') return;
        var d = hitTest(ev.clientX, ev.clientY);
        if (d) showTooltip(d, ev.clientX, ev.clientY); else hideTooltip();
      });
      canvas.addEventListener('pointerleave', hideTooltip);
      canvas.addEventListener('pointerup', function (ev) {
        if (ev.pointerId !== downId) return;
        var dx = ev.clientX - downX, dy = ev.clientY - downY;
        if (Math.sqrt(dx * dx + dy * dy) > 10 || Date.now() - downT > 500) return;
        var d = hitTest(ev.clientX, ev.clientY);
        if (d && typeof openWordDetail === 'function') openWordDetail(d.word);
      });
    }

    function updateClearVisibility() {
      if (!clearBtn) return;
      clearBtn.hidden = !filterTerm;
    }

    function onSearch() {
      filterTerm = (searchInput.value || '').trim().toLowerCase();
      draw();
      updateClearVisibility();
    }

    function onClear() {
      if (searchInput) searchInput.value = '';
      filterTerm = '';
      draw();
      updateClearVisibility();
    }

    function open() {
      ensureData().then(function (ok) {
        if (!ok) return;
        rebuildDots();
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        active = true;
        requestAnimationFrame(fit);
      });
    }
    function close() {
      active = false;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
      hideTooltip();
    }

    buildLegend();
    bindPointer();
    launchBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    if (clearBtn) clearBtn.addEventListener('click', onClear);
    searchInput.addEventListener('input', onSearch);
    window.addEventListener('resize', function () { if (active) fit(); });
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape' || !active) return;
      var detail = document.getElementById('modal-overlay');
      if (detail && !detail.classList.contains('hidden')) return;
      close();
    });
  };
})();
