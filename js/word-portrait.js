// Word Portrait — focused single-word view with three tabs:
//   Roots   — etymology entry from data/word-explorer.json
//   History — popularity sparkline + kid note
//   Family  — radial map of this word's synonyms (close-by) and antonyms (far)
//
// Roots/History fall back to a friendly "not mapped yet" message when there's
// no data for that word; Family always works (uses words.json directly).
//
// Exposes: window.initWordPortrait(words, openWordDetail)

(function () {
  'use strict';

  var EXPLORER_URL = 'data/word-explorer.json';
  var ORIGIN_COLORS = {
    'Latin':       '#fbbf24',
    'Greek':       '#a78bfa',
    'Old English': '#34d399',
    'Old Norse':   '#60a5fa',
    'French':      '#f472b6',
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;' })[c];
    });
  }

  // ── Sparkline path (peaked curve around peakDecade) ─────────────────────
  function popularityPath(peakDecade, trend, w, h) {
    // Synthesise a curve over 1800..2020. Gaussian peak at peakDecade with
    // an extra rising/declining slope based on `trend` for the modern era.
    var x0 = 1800, x1 = 2020;
    var width = w - 4;
    var sigma = 35; // decades of spread
    var samples = 60;
    var pts = [];
    var maxVal = 0;
    for (var i = 0; i < samples; i++) {
      var year = x0 + (i / (samples - 1)) * (x1 - x0);
      var z = (year - peakDecade) / sigma;
      var v = Math.exp(-z * z * 0.5);
      // Recent trend modifier (last 50 years)
      if (year > 1970) {
        var t = (year - 1970) / 50;
        if (trend === 'rising') v *= 1 + t * 0.8;
        if (trend === 'declining') v *= 1 - t * 0.5;
      }
      pts.push({ year: year, v: v });
      if (v > maxVal) maxVal = v;
    }
    var path = '';
    pts.forEach(function (p, i) {
      var x = 2 + ((p.year - x0) / (x1 - x0)) * width;
      var y = h - 4 - (p.v / (maxVal || 1)) * (h - 8);
      path += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    });
    return { path: path, samples: pts };
  }

  function renderRoots(panel, word, etymology) {
    panel.innerHTML = '';
    if (!etymology) {
      panel.appendChild(notMappedMessage(
        'We haven\'t mapped the roots of "' + word.word + '" yet.',
        'Try one of the 30 starter words listed in the dropdown above, or run scripts/build-explorer-prompts.js to expand the dataset.'
      ));
      return;
    }
    var badge = el('div', 'portrait-origin-badge');
    badge.style.background = originColor(etymology.origin);
    badge.textContent = etymology.origin;
    panel.appendChild(badge);

    var rootRow = el('div', 'portrait-root-row');
    var rootName = el('span', 'portrait-root-name', etymology.root);
    var rootSep = el('span', 'portrait-root-sep', '→');
    var rootMean = el('span', 'portrait-root-mean', '"' + etymology.rootMeaning + '"');
    rootRow.appendChild(rootName);
    rootRow.appendChild(rootSep);
    rootRow.appendChild(rootMean);
    panel.appendChild(rootRow);

    var explain = el('p', 'portrait-explain', etymology.kidExplanation);
    panel.appendChild(explain);

    if (etymology.cousins && etymology.cousins.length) {
      var family = el('div', 'portrait-cousins');
      family.appendChild(el('span', 'portrait-section-label', 'English cousins'));
      var pillRow = el('div', 'portrait-pill-row');
      etymology.cousins.forEach(function (c) {
        var pill = el('span', 'portrait-pill', c);
        pillRow.appendChild(pill);
      });
      family.appendChild(pillRow);
      panel.appendChild(family);
    }

    if (etymology.approxYear) {
      var year = el('p', 'portrait-approx-year', 'First used in English ~' + etymology.approxYear);
      panel.appendChild(year);
    }
  }

  function renderHistory(panel, word, popularity) {
    panel.innerHTML = '';
    if (!popularity) {
      panel.appendChild(notMappedMessage(
        'We haven\'t charted the history of "' + word.word + '" yet.',
        'The 30 starter words have history charts. Add more by running the prompt batches.'
      ));
      return;
    }
    var W = 320, H = 90;
    var info = popularityPath(popularity.peakDecade, popularity.trend, W, H);
    var trendArrow = popularity.trend === 'rising' ? '▲' : popularity.trend === 'declining' ? '▼' : '▬';
    var trendColor = popularity.trend === 'rising' ? '#34d399' : popularity.trend === 'declining' ? '#f87171' : '#94a3b8';

    var head = el('div', 'portrait-history-head');
    head.innerHTML =
      '<div class="portrait-history-stat"><span class="portrait-stat-label">Peak</span><span class="portrait-stat-value">' + popularity.peakDecade + 's</span></div>' +
      '<div class="portrait-history-stat"><span class="portrait-stat-label">Trend</span><span class="portrait-stat-value" style="color:' + trendColor + '">' + trendArrow + ' ' + popularity.trend + '</span></div>' +
      '<div class="portrait-history-stat"><span class="portrait-stat-label">Rarity</span><span class="portrait-stat-value">' + '★'.repeat(popularity.rarity) + '<span class="portrait-rarity-dim">' + '★'.repeat(5 - popularity.rarity) + '</span></span></div>';
    panel.appendChild(head);

    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'portrait-spark');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'none');
    // Axis baseline
    var base = document.createElementNS(svgNS, 'line');
    base.setAttribute('x1', '2'); base.setAttribute('y1', H - 4);
    base.setAttribute('x2', W - 2); base.setAttribute('y2', H - 4);
    base.setAttribute('stroke', 'rgba(140,150,220,0.25)');
    base.setAttribute('stroke-width', '1');
    svg.appendChild(base);
    // Peak marker
    var peakX = 2 + ((popularity.peakDecade - 1800) / (2020 - 1800)) * (W - 4);
    var peak = document.createElementNS(svgNS, 'line');
    peak.setAttribute('x1', peakX); peak.setAttribute('y1', 4);
    peak.setAttribute('x2', peakX); peak.setAttribute('y2', H - 4);
    peak.setAttribute('stroke', 'rgba(253, 230, 138, 0.4)');
    peak.setAttribute('stroke-dasharray', '3 3');
    svg.appendChild(peak);
    // Fill area
    var area = document.createElementNS(svgNS, 'path');
    area.setAttribute('d', info.path + ' L' + (W - 2) + ',' + (H - 4) + ' L2,' + (H - 4) + ' Z');
    area.setAttribute('fill', 'rgba(167, 139, 250, 0.25)');
    svg.appendChild(area);
    // Stroke line
    var line = document.createElementNS(svgNS, 'path');
    line.setAttribute('d', info.path);
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', '#c4b5fd');
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(line);
    panel.appendChild(svg);

    var axis = el('div', 'portrait-history-axis');
    axis.innerHTML = '<span>1800</span><span>1900</span><span>2020</span>';
    panel.appendChild(axis);

    var note = el('p', 'portrait-history-note', popularity.kidNote);
    panel.appendChild(note);
  }

  function renderFamily(panel, word) {
    panel.innerHTML = '';
    var synonyms = (word.synonyms || []).slice(0, 8);
    var antonyms = (word.antonyms || []).slice(0, 6);
    if (!synonyms.length && !antonyms.length) {
      panel.appendChild(notMappedMessage(
        'This word has no synonyms or antonyms listed.',
        'Add them to data/words.json to see the family map.'
      ));
      return;
    }
    var W = 320, H = 280;
    var cx = W / 2, cy = H / 2;
    var svgNS = 'http://www.w3.org/2000/svg';
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'portrait-family');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    // Connecting lines first (so dots sit on top)
    function ringPoint(angle, r) { return { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r }; }

    function drawNode(text, x, y, color, isCenter) {
      var g = document.createElementNS(svgNS, 'g');
      var c = document.createElementNS(svgNS, 'circle');
      c.setAttribute('cx', x); c.setAttribute('cy', y);
      c.setAttribute('r', isCenter ? 22 : 14);
      c.setAttribute('fill', color);
      c.setAttribute('stroke', isCenter ? '#fde68a' : 'rgba(255,255,255,0.4)');
      c.setAttribute('stroke-width', isCenter ? 2 : 1);
      g.appendChild(c);
      var t = document.createElementNS(svgNS, 'text');
      t.setAttribute('x', x); t.setAttribute('y', y + 28);
      t.setAttribute('text-anchor', 'middle');
      t.setAttribute('fill', '#e6e9f5');
      t.setAttribute('font-size', isCenter ? 14 : 11);
      t.setAttribute('font-weight', isCenter ? '700' : '500');
      t.textContent = text;
      g.appendChild(t);
      svg.appendChild(g);
    }

    // Syns on the upper half, ants on the lower half
    var synRadius = 95;
    var antRadius = 110;
    synonyms.forEach(function (s, i) {
      var step = Math.PI / Math.max(1, synonyms.length + 1);
      var angle = -Math.PI + step * (i + 1); // upper arc (negative y)
      var p = ringPoint(angle, synRadius);
      var line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
      line.setAttribute('stroke', 'rgba(74, 222, 128, 0.4)');
      line.setAttribute('stroke-width', '1.5');
      svg.appendChild(line);
    });
    antonyms.forEach(function (a, i) {
      var step = Math.PI / Math.max(1, antonyms.length + 1);
      var angle = step * (i + 1); // lower arc
      var p = ringPoint(angle, antRadius);
      var line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', cx); line.setAttribute('y1', cy);
      line.setAttribute('x2', p.x); line.setAttribute('y2', p.y);
      line.setAttribute('stroke', 'rgba(248, 113, 113, 0.4)');
      line.setAttribute('stroke-width', '1.5');
      line.setAttribute('stroke-dasharray', '3 3');
      svg.appendChild(line);
    });

    // Nodes
    synonyms.forEach(function (s, i) {
      var step = Math.PI / Math.max(1, synonyms.length + 1);
      var angle = -Math.PI + step * (i + 1);
      var p = ringPoint(angle, synRadius);
      drawNode(s, p.x, p.y, '#22c55e', false);
    });
    antonyms.forEach(function (a, i) {
      var step = Math.PI / Math.max(1, antonyms.length + 1);
      var angle = step * (i + 1);
      var p = ringPoint(angle, antRadius);
      drawNode(a, p.x, p.y, '#ef4444', false);
    });
    drawNode(word.word, cx, cy, '#a78bfa', true);

    panel.appendChild(svg);

    var legend = el('p', 'portrait-family-legend',
      'Green = means the same · red dashed = means the opposite');
    panel.appendChild(legend);
  }

  function notMappedMessage(title, body) {
    var box = el('div', 'portrait-empty');
    box.appendChild(el('h4', 'portrait-empty-title', title));
    box.appendChild(el('p', 'portrait-empty-body', body));
    return box;
  }

  window.initWordPortrait = function (allWords, openWordDetail) {
    var overlay = document.getElementById('portrait-overlay');
    var launchBtn = document.getElementById('portrait-launch-btn');
    var closeBtn = document.getElementById('portrait-close');
    var searchInput = document.getElementById('portrait-search');
    var suggestEl = document.getElementById('portrait-suggest');
    var titleEl = document.getElementById('portrait-word');
    var metaEl = document.getElementById('portrait-meta');
    var tabBtns = overlay ? overlay.querySelectorAll('.portrait-tab') : [];
    var panels = {
      roots:   document.getElementById('portrait-roots'),
      history: document.getElementById('portrait-history'),
      family:  document.getElementById('portrait-family'),
    };
    if (!overlay || !launchBtn) return;

    var explorerData = null;
    var loaded = false;
    var current = null;
    var activeTab = 'roots';
    var active = false;

    function ensureData() {
      if (loaded) return Promise.resolve(true);
      return fetch(EXPLORER_URL).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (d) {
        explorerData = d;
        loaded = true;
        return true;
      }).catch(function () {
        explorerData = { etymology: {}, popularity: {}, mood: {} };
        loaded = true;
        return true;
      });
    }

    function setActiveTab(name) {
      activeTab = name;
      tabBtns.forEach(function (btn) {
        var on = btn.getAttribute('data-tab') === name;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      Object.keys(panels).forEach(function (k) {
        var on = k === name;
        panels[k].hidden = !on;
        panels[k].classList.toggle('active', on);
      });
      renderCurrent();
    }

    function renderCurrent() {
      if (!current) {
        titleEl.textContent = 'Pick a word above';
        metaEl.textContent = '';
        panels.roots.innerHTML = '';
        panels.history.innerHTML = '';
        panels.family.innerHTML = '';
        return;
      }
      titleEl.textContent = current.word;
      metaEl.textContent = (current.word_type || '') + (current.pronunciation ? ' · ' + current.pronunciation : '');
      if (activeTab === 'roots')   renderRoots(panels.roots, current, (explorerData.etymology || {})[current.word]);
      if (activeTab === 'history') renderHistory(panels.history, current, (explorerData.popularity || {})[current.word]);
      if (activeTab === 'family')  renderFamily(panels.family, current);
    }

    function pick(wordObj) {
      current = wordObj;
      searchInput.value = wordObj.word;
      suggestEl.innerHTML = '';
      suggestEl.style.display = 'none';
      renderCurrent();
    }

    function showSuggestions(q) {
      suggestEl.innerHTML = '';
      var term = q.trim().toLowerCase();
      if (!term) {
        // Featured: words that DO have curated etymology + popularity
        var featured = Object.keys(explorerData.etymology || {}).slice(0, 12);
        featured.forEach(function (name) {
          var w = allWords.find(function (x) { return x.word === name; });
          if (w) suggestEl.appendChild(buildSuggest(w, true));
        });
      } else {
        var matches = allWords.filter(function (w) {
          return w.word.toLowerCase().indexOf(term) !== -1;
        }).slice(0, 12);
        matches.forEach(function (w) {
          suggestEl.appendChild(buildSuggest(w, !!(explorerData.etymology || {})[w.word]));
        });
      }
      suggestEl.style.display = suggestEl.children.length ? 'flex' : 'none';
    }

    function buildSuggest(wordObj, curated) {
      var btn = el('button', 'portrait-suggest-item' + (curated ? ' is-curated' : ''));
      btn.type = 'button';
      btn.textContent = wordObj.word;
      btn.title = curated ? 'Full portrait available' : 'Family view only';
      btn.addEventListener('click', function () { pick(wordObj); });
      return btn;
    }

    function open() {
      ensureData().then(function () {
        overlay.classList.remove('hidden');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        active = true;
        if (!current) showSuggestions('');
      });
    }
    function close() {
      active = false;
      overlay.classList.add('hidden');
      overlay.setAttribute('aria-hidden', 'true');
      document.body.style.overflow = '';
    }

    launchBtn.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    searchInput.addEventListener('input', function () { showSuggestions(searchInput.value); });
    searchInput.addEventListener('focus', function () { showSuggestions(searchInput.value); });
    tabBtns.forEach(function (b) {
      b.addEventListener('click', function () { setActiveTab(b.getAttribute('data-tab')); });
    });
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && active) close();
    });
  };
})();
