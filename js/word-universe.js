// Word Universe — 3D map of every word in the corpus.
//
// Positions are precomputed by scripts/build-word-positions.js, so this module
// just renders. Mobile-first: instanced sphere nodes, DOM label overlay for the
// nearest words (sharper and cheaper than sprite text), render loop pauses when
// the overlay is hidden, pixel ratio capped at 2.
//
// Exposes: window.initWordUniverse(words, openWordDetail)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const POS_URL = 'data/word-positions.json';
const SCENE_RADIUS = 80;
const NODE_RADIUS = 1.1;
const NEAR_LABEL_COUNT = 28;
const TAP_PIXEL_THRESHOLD = 10;
const TAP_TIME_THRESHOLD = 500;

const POS_COLORS = {
  noun:        new THREE.Color('#7dd3fc'),
  verb:        new THREE.Color('#fbbf24'),
  adjective:   new THREE.Color('#f472b6'),
  adverb:      new THREE.Color('#a78bfa'),
  preposition: new THREE.Color('#34d399'),
  conjunction: new THREE.Color('#fb923c'),
  pronoun:     new THREE.Color('#94a3b8'),
  default:     new THREE.Color('#e2e8f0'),
};

function posColor(type) {
  const key = String(type || '').toLowerCase().trim();
  return POS_COLORS[key] || POS_COLORS.default;
}

function ratingScale(r) {
  const n = Number(r) || 3;
  return 0.65 + (n - 1) * 0.12;
}

window.initWordUniverse = function (allWords, openWordDetail) {
  const overlay = document.getElementById('universe-overlay');
  const canvas = document.getElementById('universe-canvas');
  const labelLayer = document.getElementById('universe-labels');
  const searchInput = document.getElementById('universe-search');
  const resetBtn = document.getElementById('universe-reset');
  const closeBtn = document.getElementById('universe-close');
  const launchBtn = document.getElementById('universe-launch-btn');
  const legendEl = document.getElementById('universe-legend');
  const statusEl = document.getElementById('universe-status');

  if (!overlay || !canvas || !launchBtn) return;

  let three = null;
  let positions = null;
  let neighborMap = null;
  let active = false;

  function buildLegend() {
    if (!legendEl) return;
    legendEl.innerHTML = '';
    const order = ['noun', 'verb', 'adjective', 'adverb'];
    order.forEach(function (k) {
      const item = document.createElement('span');
      item.className = 'universe-legend-item';
      const swatch = document.createElement('span');
      swatch.className = 'universe-legend-swatch';
      swatch.style.background = '#' + POS_COLORS[k].getHexString();
      const label = document.createElement('span');
      label.textContent = k;
      item.appendChild(swatch);
      item.appendChild(label);
      legendEl.appendChild(item);
    });
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  async function ensureData() {
    if (positions) return true;
    setStatus('Loading universe…');
    try {
      const res = await fetch(POS_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      positions = data.positions;
      neighborMap = data.neighbors || {};
      setStatus('');
      return true;
    } catch (err) {
      setStatus('Could not load word positions. Try refreshing.');
      return false;
    }
  }

  function buildScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05060f');
    scene.fog = new THREE.Fog('#05060f', SCENE_RADIUS * 1.6, SCENE_RADIUS * 3.2);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, SCENE_RADIUS * 6);
    camera.position.set(0, 0, SCENE_RADIUS * 2.2);

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.6;
    controls.enablePan = true;
    controls.minDistance = SCENE_RADIUS * 0.4;
    controls.maxDistance = SCENE_RADIUS * 4.5;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.6);
    dir.position.set(1, 1, 1);
    scene.add(dir);

    // Subtle starfield backdrop
    const starGeo = new THREE.BufferGeometry();
    const starCount = 600;
    const starPos = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = SCENE_RADIUS * (3 + Math.random());
      const t = Math.acos(2 * Math.random() - 1);
      const p = 2 * Math.PI * Math.random();
      starPos[i * 3]     = r * Math.sin(t) * Math.cos(p);
      starPos[i * 3 + 1] = r * Math.sin(t) * Math.sin(p);
      starPos[i * 3 + 2] = r * Math.cos(t);
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
      color: 0x9aa6ff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.55,
    }));
    scene.add(stars);

    // Nodes (instanced spheres)
    const placed = allWords.filter(function (w) { return positions[w.word]; });
    const n = placed.length;
    const sphereGeo = new THREE.SphereGeometry(NODE_RADIUS, 14, 12);
    const nodeMat = new THREE.MeshLambertMaterial({ vertexColors: false });
    const nodes = new THREE.InstancedMesh(sphereGeo, nodeMat, n);
    nodes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);

    const baseColors = new Float32Array(n * 3);
    const tmpObj = new THREE.Object3D();
    const wordToIndex = new Map();
    const worldPos = new Array(n);

    placed.forEach(function (w, i) {
      const p = positions[w.word];
      const x = p[0] * SCENE_RADIUS;
      const y = p[1] * SCENE_RADIUS;
      const z = p[2] * SCENE_RADIUS;
      worldPos[i] = new THREE.Vector3(x, y, z);
      tmpObj.position.set(x, y, z);
      const s = ratingScale(w.usefulness_rating);
      tmpObj.scale.set(s, s, s);
      tmpObj.updateMatrix();
      nodes.setMatrixAt(i, tmpObj.matrix);
      const c = posColor(w.word_type);
      nodes.setColorAt(i, c);
      baseColors[i * 3] = c.r;
      baseColors[i * 3 + 1] = c.g;
      baseColors[i * 3 + 2] = c.b;
      wordToIndex.set(w.word, i);
    });
    nodes.instanceMatrix.needsUpdate = true;
    if (nodes.instanceColor) nodes.instanceColor.needsUpdate = true;
    scene.add(nodes);

    // Edges (synonym lines from neighbor map — symmetric, dedup)
    const seen = new Set();
    const linePoints = [];
    Object.keys(neighborMap).forEach(function (w) {
      const i = wordToIndex.get(w);
      if (i === undefined) return;
      neighborMap[w].forEach(function (other) {
        const j = wordToIndex.get(other);
        if (j === undefined || i === j) return;
        const key = Math.min(i, j) + ':' + Math.max(i, j);
        if (seen.has(key)) return;
        seen.add(key);
        linePoints.push(worldPos[i].x, worldPos[i].y, worldPos[i].z);
        linePoints.push(worldPos[j].x, worldPos[j].y, worldPos[j].z);
      });
    });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linePoints), 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0x4f5b8a, transparent: true, opacity: 0.32 });
    const lines = new THREE.LineSegments(lineGeo, lineMat);
    scene.add(lines);

    return {
      scene: scene,
      camera: camera,
      renderer: renderer,
      controls: controls,
      nodes: nodes,
      lines: lines,
      placed: placed,
      worldPos: worldPos,
      wordToIndex: wordToIndex,
      baseColors: baseColors,
      raycaster: new THREE.Raycaster(),
      ndcVec: new THREE.Vector2(),
      labelEls: [],
      highlightWord: null,
      filterTerm: '',
      rafHandle: 0,
      running: false,
    };
  }

  function fitCanvas() {
    if (!three) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    three.renderer.setSize(w, h, false);
    three.camera.aspect = w / h;
    three.camera.updateProjectionMatrix();
  }

  function recycleLabels(needed) {
    while (three.labelEls.length < needed) {
      const el = document.createElement('div');
      el.className = 'universe-label';
      labelLayer.appendChild(el);
      three.labelEls.push(el);
    }
    for (let i = needed; i < three.labelEls.length; i++) {
      three.labelEls[i].style.display = 'none';
    }
  }

  function updateLabels() {
    if (!three) return;
    const cam = three.camera;
    cam.updateMatrixWorld();
    const camPos = cam.position;
    const rect = canvas.getBoundingClientRect();
    const halfW = rect.width / 2;
    const halfH = rect.height / 2;

    // Pick nearest-to-camera that are in front of the camera
    const candidates = [];
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    for (let i = 0; i < three.placed.length; i++) {
      const p = three.worldPos[i];
      const dx = p.x - camPos.x;
      const dy = p.y - camPos.y;
      const dz = p.z - camPos.z;
      // Behind camera? skip
      if (dx * camDir.x + dy * camDir.y + dz * camDir.z <= 0) continue;
      const d2 = dx * dx + dy * dy + dz * dz;
      candidates.push({ i: i, d2: d2 });
    }
    candidates.sort(function (a, b) { return a.d2 - b.d2; });

    // Always show the highlighted word's label if any
    const forced = three.highlightWord ? three.wordToIndex.get(three.highlightWord) : undefined;
    const visibleIndices = [];
    if (forced !== undefined) visibleIndices.push(forced);
    for (let k = 0; k < candidates.length && visibleIndices.length < NEAR_LABEL_COUNT; k++) {
      if (candidates[k].i !== forced) visibleIndices.push(candidates[k].i);
    }

    recycleLabels(visibleIndices.length);
    const tmp = new THREE.Vector3();
    for (let k = 0; k < visibleIndices.length; k++) {
      const idx = visibleIndices[k];
      tmp.copy(three.worldPos[idx]).project(cam);
      const x = tmp.x * halfW + halfW;
      const y = -tmp.y * halfH + halfH;
      const el = three.labelEls[k];
      const word = three.placed[idx].word;
      if (el.textContent !== word) el.textContent = word;
      el.style.display = 'block';
      el.style.transform = 'translate(-50%, -120%) translate(' + x + 'px, ' + y + 'px)';
      el.classList.toggle('is-highlight', word === three.highlightWord);
    }
  }

  function applyHighlight() {
    if (!three) return;
    const colorAttr = three.nodes.instanceColor;
    const dim = new THREE.Color('#1f2640');
    const hot = new THREE.Color('#ffffff');
    const term = three.filterTerm;
    for (let i = 0; i < three.placed.length; i++) {
      const word = three.placed[i].word;
      const wLower = word.toLowerCase();
      const matches = term === '' || wLower.indexOf(term) !== -1;
      const isHighlight = word === three.highlightWord;
      let c;
      if (isHighlight) {
        c = hot;
      } else if (matches) {
        c = new THREE.Color(
          three.baseColors[i * 3],
          three.baseColors[i * 3 + 1],
          three.baseColors[i * 3 + 2]
        );
      } else {
        c = dim;
      }
      colorAttr.setXYZ(i, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  }

  function flyTo(wordIndex) {
    if (!three) return;
    const target = three.worldPos[wordIndex];
    three.controls.target.copy(target);
    // Pull the camera closer along the current view axis
    const dir = new THREE.Vector3().subVectors(three.camera.position, target).normalize();
    const newPos = target.clone().add(dir.multiplyScalar(SCENE_RADIUS * 0.55));
    three.camera.position.copy(newPos);
    three.controls.update();
  }

  function handleTap(clientX, clientY) {
    if (!three) return;
    const rect = canvas.getBoundingClientRect();
    three.ndcVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    three.ndcVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    three.raycaster.setFromCamera(three.ndcVec, three.camera);
    // Inflated threshold for finger taps
    three.raycaster.params.Points = three.raycaster.params.Points || {};
    const hits = three.raycaster.intersectObject(three.nodes, false);
    if (hits.length === 0) return;
    const idx = hits[0].instanceId;
    if (idx === undefined) return;
    const wordObj = three.placed[idx];
    three.highlightWord = wordObj.word;
    applyHighlight();
    flyTo(idx);
    if (typeof openWordDetail === 'function') {
      openWordDetail(wordObj);
    }
  }

  function startLoop() {
    if (!three || three.running) return;
    three.running = true;
    const loop = function () {
      if (!three || !three.running) return;
      three.controls.update();
      three.renderer.render(three.scene, three.camera);
      updateLabels();
      three.rafHandle = requestAnimationFrame(loop);
    };
    three.rafHandle = requestAnimationFrame(loop);
  }

  function stopLoop() {
    if (!three) return;
    three.running = false;
    if (three.rafHandle) cancelAnimationFrame(three.rafHandle);
    three.rafHandle = 0;
  }

  function attachPointerHandlers() {
    let downX = 0, downY = 0, downT = 0, downId = -1;
    canvas.addEventListener('pointerdown', function (ev) {
      downX = ev.clientX; downY = ev.clientY; downT = Date.now(); downId = ev.pointerId;
    });
    canvas.addEventListener('pointerup', function (ev) {
      if (ev.pointerId !== downId) return;
      const dx = ev.clientX - downX;
      const dy = ev.clientY - downY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Date.now() - downT;
      if (dist <= TAP_PIXEL_THRESHOLD && dt <= TAP_TIME_THRESHOLD) {
        handleTap(ev.clientX, ev.clientY);
      }
    });
  }

  function onResize() { fitCanvas(); }

  function onSearchInput() {
    if (!three) return;
    three.filterTerm = searchInput.value.trim().toLowerCase();
    three.highlightWord = null;
    applyHighlight();
  }

  function onReset() {
    if (!three) return;
    three.controls.target.set(0, 0, 0);
    three.camera.position.set(0, 0, SCENE_RADIUS * 2.2);
    three.highlightWord = null;
    three.filterTerm = '';
    if (searchInput) searchInput.value = '';
    applyHighlight();
    three.controls.update();
  }

  async function open() {
    if (!(await ensureData())) return;
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    if (!three) {
      buildLegend();
      three = buildScene();
      attachPointerHandlers();
    }
    active = true;
    // Wait a frame so the overlay is laid out before we size the canvas
    requestAnimationFrame(function () {
      fitCanvas();
      applyHighlight();
      startLoop();
    });
  }

  function close() {
    active = false;
    overlay.classList.add('hidden');
    overlay.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    stopLoop();
  }

  launchBtn.addEventListener('click', open);
  if (closeBtn) closeBtn.addEventListener('click', close);
  if (resetBtn) resetBtn.addEventListener('click', onReset);
  if (searchInput) searchInput.addEventListener('input', onSearchInput);
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', function () {
    if (!active) return;
    if (document.hidden) stopLoop(); else startLoop();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && active) close();
  });
};
