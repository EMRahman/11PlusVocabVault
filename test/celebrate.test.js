// Tests for js/celebrate.js. The particle maths is pure and deterministic
// under an injected rng; the DOM functions must be import-safe and no-op
// gracefully under Node (no document).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELEBRATE_COLORS,
  PARTICLE_SHAPES,
  buildParticleSpecs,
  celebrateBurst,
  celebrateToast,
} from '../js/celebrate.js';

// Tiny LCG so spec generation is reproducible in tests.
const seededRng = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
};

test('buildParticleSpecs is deterministic for a given rng', () => {
  const a = buildParticleSpecs(8, seededRng(42));
  const b = buildParticleSpecs(8, seededRng(42));
  assert.deepEqual(a, b);
  const c = buildParticleSpecs(8, seededRng(7));
  assert.notDeepEqual(a, c);
});

test('buildParticleSpecs returns count specs within the documented bounds', () => {
  const specs = buildParticleSpecs(50, seededRng(1));
  assert.equal(specs.length, 50);
  for (const s of specs) {
    assert.ok(s.dx >= -220 && s.dx <= 220, `dx ${s.dx} out of range`);
    assert.ok(s.dy >= 120 && s.dy <= 380, `dy ${s.dy} out of range (must fall downward)`);
    assert.ok(s.rotation >= -540 && s.rotation <= 540, `rotation ${s.rotation} out of range`);
    assert.ok(s.scale >= 0.6 && s.scale <= 1.5, `scale ${s.scale} out of range`);
    assert.ok(Number.isInteger(s.colorIndex), 'colorIndex must be an integer');
    assert.ok(s.colorIndex >= 0 && s.colorIndex < CELEBRATE_COLORS.length);
    assert.ok(s.delayMs >= 0 && s.delayMs <= 180, `delay ${s.delayMs} out of range`);
    assert.ok(PARTICLE_SHAPES.includes(s.shape), `unknown shape ${s.shape}`);
  }
});

test('buildParticleSpecs handles a zero count', () => {
  assert.deepEqual(buildParticleSpecs(0, seededRng(1)), []);
});

test('palette stays on the app colours', () => {
  assert.deepEqual(CELEBRATE_COLORS, ['#6C63FF', '#F59E0B', '#16A34A', '#EF4444', '#0E7490']);
  assert.deepEqual(PARTICLE_SHAPES, ['square', 'circle', 'strip']);
});

test('DOM entry points are no-ops without a document (Node import safety)', () => {
  // Must not throw when imported/called under node --test.
  assert.equal(celebrateBurst(null), undefined);
  assert.equal(celebrateToast('🌟', 'Word mastered!'), undefined);
});
