// celebrate.js — visual celebration layer: confetti bursts and toast cards.
//
// The particle maths (buildParticleSpecs) is pure and unit-tested; the two DOM
// functions keep ALL document/window access inside their bodies so Node can
// import this module under node --test without a DOM. No sound, by design.
'use strict';

// App palette: primary purple, star amber, reading green, red, explorer teal.
export const CELEBRATE_COLORS = ['#6C63FF', '#F59E0B', '#16A34A', '#EF4444', '#0E7490'];

export const PARTICLE_SHAPES = ['square', 'circle', 'strip'];

// Build `count` particle specs. Each spec drives one CSS-animated particle:
// dx/dy = final translation in px (outward and downward, like falling
// confetti), rotation in deg, scale, colorIndex into CELEBRATE_COLORS,
// delayMs stagger, shape from PARTICLE_SHAPES. `rng` defaults to Math.random
// (inject a seeded rng for deterministic tests). Draw order per particle:
// dx, dy, rotation, scale, colorIndex, delayMs, shape.
export function buildParticleSpecs(count, rng) {
  rng = rng || Math.random;
  var specs = [];
  for (var i = 0; i < count; i++) {
    specs.push({
      dx        : Math.round((rng() * 2 - 1) * 220),
      dy        : Math.round(120 + rng() * 260),
      rotation  : Math.round((rng() * 2 - 1) * 540),
      scale     : Math.round((0.6 + rng() * 0.9) * 100) / 100,
      colorIndex: Math.floor(rng() * CELEBRATE_COLORS.length),
      delayMs   : Math.round(rng() * 180),
      shape     : PARTICLE_SHAPES[Math.floor(rng() * PARTICLE_SHAPES.length)],
    });
  }
  return specs;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Fire a confetti burst from the centre of `originEl` (or the upper-middle of
// the viewport). Purely decorative: aria-hidden, pointer-events none, removed
// when the last particle finishes (with a safety timeout). No-op under
// prefers-reduced-motion.
export function celebrateBurst(originEl, opts) {
  if (typeof document === 'undefined') return;
  if (prefersReducedMotion()) return;
  opts = opts || {};
  var count = opts.count || 24;

  var x = window.innerWidth / 2;
  var y = window.innerHeight * 0.35;
  if (originEl && originEl.getBoundingClientRect) {
    var rect = originEl.getBoundingClientRect();
    x = rect.left + rect.width / 2;
    y = rect.top + rect.height / 2;
  }

  var layer = document.createElement('div');
  layer.className = 'confetti-layer';
  layer.setAttribute('aria-hidden', 'true');

  var specs = buildParticleSpecs(count, opts.rng);
  specs.forEach(function (s) {
    var p = document.createElement('div');
    p.className = 'confetti-particle confetti-' + s.shape;
    p.style.left = x + 'px';
    p.style.top = y + 'px';
    p.style.background = CELEBRATE_COLORS[s.colorIndex];
    p.style.setProperty('--dx', s.dx + 'px');
    p.style.setProperty('--dy', s.dy + 'px');
    p.style.setProperty('--rot', s.rotation + 'deg');
    p.style.setProperty('--scale', s.scale);
    p.style.animationDelay = s.delayMs + 'ms';
    layer.appendChild(p);
  });

  document.body.appendChild(layer);

  var removed = false;
  var remove = function () {
    if (removed) return;
    removed = true;
    if (layer.parentNode) layer.parentNode.removeChild(layer);
  };
  var remaining = specs.length;
  layer.addEventListener('animationend', function () {
    remaining--;
    if (remaining <= 0) remove();
  });
  setTimeout(remove, 2400); // animation 1.2s + max delay + margin

  return layer;
}

var activeToast = null;

// Slide-in toast card ("🌟 Volatile mastered!"). One at a time — a new toast
// replaces the current one. pointer-events: none (set in CSS) and no focus
// stealing, so it can fire mid-question or over the 3D games without blocking
// play. Under prefers-reduced-motion it fades via opacity only.
export function celebrateToast(emoji, title, sub) {
  if (typeof document === 'undefined') return;

  if (activeToast && activeToast.parentNode) {
    activeToast.parentNode.removeChild(activeToast);
  }

  var toast = document.createElement('div');
  toast.className = 'celebrate-toast' +
    (prefersReducedMotion() ? ' celebrate-toast--still' : '');
  toast.setAttribute('role', 'status');

  var emojiEl = document.createElement('span');
  emojiEl.className = 'celebrate-toast-emoji';
  emojiEl.setAttribute('aria-hidden', 'true');
  emojiEl.textContent = emoji;

  var body = document.createElement('div');
  body.className = 'celebrate-toast-body';
  var titleEl = document.createElement('strong');
  titleEl.className = 'celebrate-toast-title';
  titleEl.textContent = title;
  body.appendChild(titleEl);
  if (sub) {
    var subEl = document.createElement('small');
    subEl.className = 'celebrate-toast-sub';
    subEl.textContent = sub;
    body.appendChild(subEl);
  }

  toast.appendChild(emojiEl);
  toast.appendChild(body);
  document.body.appendChild(toast);
  activeToast = toast;

  setTimeout(function () {
    toast.classList.add('celebrate-toast--out');
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
      if (activeToast === toast) activeToast = null;
    }, 450);
  }, 2500);

  return toast;
}
