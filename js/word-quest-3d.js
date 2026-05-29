// Constellation Quest — a 3D game built on the Word Universe layout.
//
// The corpus is split into ~12 clusters (constellations) precomputed by
// scripts/build-word-positions.js. The player flies their camera to an unlocked
// cluster's beacon, then captures every word in it by answering a quick
// multiple-choice question. Clearing a cluster unlocks its neighbours; clear
// them all to win. Relaxed: no timer, no lives — a wrong answer just requeues
// the word to retry.
//
// Exposes: window.initConstellationQuest(allWords, openWordDetail)

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const POS_URL = 'data/word-positions.json';
const SCENE_RADIUS = 80;
const NODE_RADIUS = 1.1;
const TAP_PIXEL_THRESHOLD = 10;
const TAP_TIME_THRESHOLD = 500;
const FLY_DURATION = 900;          // ms for the hop between constellations
const FEEDBACK_DELAY = 950;        // ms to show answer feedback before advancing
const SAVE_KEY = 'vocabVault_constellationQuest';
const WORDS_PER_CLUSTER = 3;       // questions per cluster visit (nearby words only)

// One bright hue per constellation so clusters read as distinct groups.
const CLUSTER_HUES = [
  '#7dd3fc', '#fbbf24', '#f472b6', '#a78bfa', '#34d399', '#fb923c',
  '#60a5fa', '#f87171', '#c084fc', '#4ade80', '#22d3ee', '#fb7185',
  '#a3e635', '#e879f9', '#facc15', '#2dd4bf',
];
const CAPTURED_COLOR = new THREE.Color('#fff7cc');
const DIM_COLOR = new THREE.Color('#1c2138');

function ratingScale(r) {
  const n = Number(r) || 3;
  return 0.65 + (n - 1) * 0.12;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// Mirrors app.js pickDistractors: prefer same part of speech, top up with any.
function pickDistractors(correctWord, pool, count) {
  const candidates = pool.filter(function (w) { return w.word !== correctWord.word; });
  const sameType = correctWord.word_type
    ? candidates.filter(function (w) { return w.word_type === correctWord.word_type; })
    : [];
  const picks = [];
  shuffle(sameType).forEach(function (w) { if (picks.length < count) picks.push(w); });
  if (picks.length < count) {
    const others = candidates.filter(function (w) { return picks.indexOf(w) === -1; });
    shuffle(others).forEach(function (w) { if (picks.length < count) picks.push(w); });
  }
  return picks;
}

function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

window.initConstellationQuest = function (allWords, openWordDetail) {
  const overlay = document.getElementById('quest3d-overlay');
  const canvas = document.getElementById('quest3d-canvas');
  const labelLayer = document.getElementById('quest3d-labels');
  const launchBtn = document.getElementById('quest3d-launch-btn');
  const closeBtn = document.getElementById('quest3d-close');
  const beginBtn = document.getElementById('quest3d-begin');
  const replayBtn = document.getElementById('quest3d-replay');
  const retreatBtn = document.getElementById('quest3d-retreat');
  const statusEl = document.getElementById('quest3d-status');

  const setupScreen = document.getElementById('quest3d-setup');
  const flightScreen = document.getElementById('quest3d-flight');
  const endScreen = document.getElementById('quest3d-end');
  const captureCard = document.getElementById('quest3d-capture');

  const bestLine = document.getElementById('quest3d-best');
  const scoreEl = document.getElementById('quest3d-score');
  const clearedEl = document.getElementById('quest3d-cleared');
  const totalEl = document.getElementById('quest3d-total');
  const clusterNameEl = document.getElementById('quest3d-cluster-name');
  const progressTextEl = document.getElementById('quest3d-progress-text');
  const progressFillEl = document.getElementById('quest3d-progress-fill');
  const promptEl = document.getElementById('quest3d-prompt');
  const answersEl = document.getElementById('quest3d-answers');
  const feedbackEl = document.getElementById('quest3d-feedback');
  const endEmojiEl = document.getElementById('quest3d-end-emoji');
  const endTitleEl = document.getElementById('quest3d-end-title');
  const endScoreEl = document.getElementById('quest3d-end-score');
  const endBestEl = document.getElementById('quest3d-end-best');

  if (!overlay || !canvas || !launchBtn) return;

  let three = null;
  let positions = null;
  let clusters = null;       // [{id,name,centroid,words[],neighbors[]}]
  let wordCluster = null;    // Map word -> cluster id
  let neighborMap = null;    // word -> [synonym words] from precomputed graph
  let active = false;

  const state = {
    best: { bestScore: 0, bestClustersCleared: 0, lastRun: null },
    capturedWords: {},       // word -> true
    clusterProgress: {},     // id -> count captured
    beaconState: {},         // id -> 'locked' | 'unlocked' | 'cleared'
    score: 0,
    streak: 0,
    clearedCount: 0,
    activeClusterId: null,
    activeClusterWordList: [], // the 3 nearby words chosen for the current capture
    nextQuestionTimer: 0,
    questionQueue: [],
    questionType: 0,         // alternates question style
    wrongInCluster: 0,
    answering: false,
    // fly tween
    flying: false,
    pendingClusterId: null,
    flyT: 0,
    flyLast: 0,
    flyFrom: new THREE.Vector3(),
    flyTo: new THREE.Vector3(),
    lookFrom: new THREE.Vector3(),
    lookTo: new THREE.Vector3(),
  };

  // ── Persistence ────────────────────────────────────────────────────────────
  function loadSave() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const d = JSON.parse(raw);
        state.best.bestScore = d.bestScore || 0;
        state.best.bestClustersCleared = d.bestClustersCleared || 0;
        state.best.lastRun = d.lastRun || null;
      }
    } catch (e) { /* ignore */ }
  }

  function persist() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        bestScore: state.best.bestScore,
        bestClustersCleared: state.best.bestClustersCleared,
        lastRun: state.best.lastRun,
      }));
    } catch (e) { /* ignore */ }
  }

  function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg || '';
  }

  async function ensureData() {
    if (positions && clusters) return true;
    setStatus('Charting the stars…');
    try {
      const res = await fetch(POS_URL);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      positions = data.positions;
      clusters = data.clusters || [];
      neighborMap = data.neighbors || {};
      if (!clusters.length) throw new Error('no clusters');
      wordCluster = new Map();
      clusters.forEach(function (cl) {
        cl.words.forEach(function (w) { wordCluster.set(w, cl.id); });
      });
      setStatus('');
      return true;
    } catch (err) {
      setStatus('Could not load the galaxy. Try refreshing.');
      return false;
    }
  }

  // ── Scene ────────────────────────────────────────────────────────────────────
  function buildScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#05060f');
    scene.fog = new THREE.Fog('#05060f', SCENE_RADIUS * 1.7, SCENE_RADIUS * 3.4);

    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, SCENE_RADIUS * 6);
    camera.position.set(0, 0, SCENE_RADIUS * 2.4);

    const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.6;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.6;
    controls.enablePan = true;
    controls.minDistance = SCENE_RADIUS * 0.3;
    controls.maxDistance = SCENE_RADIUS * 4.5;
    controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };

    // On macOS, trackpad pinch arrives as ctrlKey+wheel with tiny deltaY values
    // that OrbitControls barely registers. Intercept and handle zoom directly.
    canvas.addEventListener('wheel', function(e) {
      if (!e.ctrlKey || !controls.enabled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const offset = camera.position.clone().sub(controls.target);
      const dist = offset.length();
      const scale = 1.0 + e.deltaY * 0.025;
      const newDist = Math.max(controls.minDistance, Math.min(controls.maxDistance, dist * scale));
      camera.position.copy(controls.target).add(offset.multiplyScalar(newDist / dist));
      controls.update();
    }, { passive: false, capture: true });

    scene.add(new THREE.AmbientLight(0xffffff, 0.85));
    const dir = new THREE.DirectionalLight(0xffffff, 0.55);
    dir.position.set(1, 1, 1);
    scene.add(dir);

    // Starfield backdrop
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
      color: 0x9aa6ff, size: 0.6, sizeAttenuation: true, transparent: true, opacity: 0.5,
    }));
    scene.add(stars);

    // Word nodes (instanced spheres), one per positioned word.
    const placed = allWords.filter(function (w) { return positions[w.word] && wordCluster.has(w.word); });
    const n = placed.length;
    const sphereGeo = new THREE.SphereGeometry(NODE_RADIUS, 14, 12);
    const nodeMat = new THREE.MeshLambertMaterial();
    const nodes = new THREE.InstancedMesh(sphereGeo, nodeMat, n);
    nodes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);

    const tmpObj = new THREE.Object3D();
    const wordToIndex = new Map();
    const worldPos = new Array(n);
    const nodeCluster = new Int32Array(n);

    placed.forEach(function (w, i) {
      const p = positions[w.word];
      const x = p[0] * SCENE_RADIUS, y = p[1] * SCENE_RADIUS, z = p[2] * SCENE_RADIUS;
      worldPos[i] = new THREE.Vector3(x, y, z);
      tmpObj.position.set(x, y, z);
      const s = ratingScale(w.usefulness_rating);
      tmpObj.scale.set(s, s, s);
      tmpObj.updateMatrix();
      nodes.setMatrixAt(i, tmpObj.matrix);
      nodeCluster[i] = wordCluster.get(w.word);
      wordToIndex.set(w.word, i);
    });
    nodes.instanceMatrix.needsUpdate = true;
    scene.add(nodes);

    // Beacons — one glowing marker per cluster at its centroid.
    const beacons = new THREE.Group();
    const beaconPos = new Array(clusters.length);
    const beaconMeshes = new Array(clusters.length);
    const beaconGeo = new THREE.SphereGeometry(3.4, 20, 16);
    clusters.forEach(function (cl, c) {
      const wp = new THREE.Vector3(
        cl.centroid[0] * SCENE_RADIUS,
        cl.centroid[1] * SCENE_RADIUS,
        cl.centroid[2] * SCENE_RADIUS
      );
      beaconPos[c] = wp;
      const mat = new THREE.MeshBasicMaterial({ color: clusterColor(c), transparent: true, opacity: 0.85 });
      const mesh = new THREE.Mesh(beaconGeo, mat);
      mesh.position.copy(wp);
      mesh.userData.clusterId = c;
      beacons.add(mesh);
      beaconMeshes[c] = mesh;
    });
    scene.add(beacons);

    return {
      scene: scene, camera: camera, renderer: renderer, controls: controls,
      nodes: nodes, placed: placed, worldPos: worldPos, wordToIndex: wordToIndex,
      nodeCluster: nodeCluster, beacons: beacons, beaconPos: beaconPos,
      beaconMeshes: beaconMeshes, baseCamPos: camera.position.clone(),
      raycaster: new THREE.Raycaster(), ndcVec: new THREE.Vector2(),
      labelEls: [], rafHandle: 0, running: false,
    };
  }

  function clusterColor(c) {
    return new THREE.Color(CLUSTER_HUES[c % CLUSTER_HUES.length]);
  }

  // ── Visuals reflecting game state ────────────────────────────────────────────
  function applyNodeColors() {
    if (!three) return;
    const attr = three.nodes.instanceColor;
    for (let i = 0; i < three.placed.length; i++) {
      const word = three.placed[i].word;
      const c = three.nodeCluster[i];
      let col;
      if (state.capturedWords[word]) {
        col = CAPTURED_COLOR;
      } else {
        col = clusterColor(c);
        if (state.beaconState[c] === 'locked') col.lerp(DIM_COLOR, 0.8);
      }
      attr.setXYZ(i, col.r, col.g, col.b);
    }
    attr.needsUpdate = true;
  }

  function updateBeaconVisuals() {
    if (!three) return;
    clusters.forEach(function (cl, c) {
      const mat = three.beaconMeshes[c].material;
      const st = state.beaconState[c];
      if (st === 'cleared') {
        mat.color.set('#fde68a');
        mat.opacity = 0.95;
      } else if (st === 'unlocked') {
        mat.color.copy(clusterColor(c));
        mat.opacity = 0.9;
      } else {
        mat.color.set('#3a4365');
        mat.opacity = 0.5;
      }
    });
  }

  function recycleLabels(needed) {
    while (three.labelEls.length < needed) {
      const el = document.createElement('div');
      el.className = 'quest3d-label';
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
    const camDir = new THREE.Vector3();
    cam.getWorldDirection(camDir);
    const rect = canvas.getBoundingClientRect();
    const halfW = rect.width / 2, halfH = rect.height / 2;
    recycleLabels(clusters.length);
    const tmp = new THREE.Vector3();
    for (let c = 0; c < clusters.length; c++) {
      const wp = three.beaconPos[c];
      const el = three.labelEls[c];
      const dx = wp.x - cam.position.x, dy = wp.y - cam.position.y, dz = wp.z - cam.position.z;
      if (dx * camDir.x + dy * camDir.y + dz * camDir.z <= 0) { el.style.display = 'none'; continue; }
      tmp.copy(wp).project(cam);
      const x = tmp.x * halfW + halfW;
      const y = -tmp.y * halfH + halfH;
      const st = state.beaconState[c];
      const tot = clusters[c].words.length;
      const prog = state.clusterProgress[c] || 0;
      let txt;
      if (st === 'cleared') txt = '✓ ' + clusters[c].name;
      else if (st === 'locked') txt = '🔒 ' + clusters[c].name;
      else txt = clusters[c].name + ' · ' + prog + '/' + tot;
      if (el.textContent !== txt) el.textContent = txt;
      el.className = 'quest3d-label quest3d-label--' + st;
      el.style.display = 'block';
      el.style.transform = 'translate(-50%, -150%) translate(' + x + 'px, ' + y + 'px)';
    }
  }

  // ── Fly between constellations ───────────────────────────────────────────────
  function flyToCluster(clusterId) {
    if (!three || state.flying) return;
    const target = three.beaconPos[clusterId];
    const dir = new THREE.Vector3().subVectors(three.camera.position, target).normalize();
    state.flyFrom.copy(three.camera.position);
    state.flyTo.copy(target.clone().add(dir.multiplyScalar(SCENE_RADIUS * 0.5)));
    state.lookFrom.copy(three.controls.target);
    state.lookTo.copy(target);
    state.flyT = 0;
    state.flyLast = performance.now();
    state.flying = true;
    state.pendingClusterId = clusterId;
    three.controls.enabled = false;
    setStatus('Travelling to ' + clusters[clusterId].name + '…');
  }

  function onFlyArrive() {
    three.controls.enabled = true;
    three.controls.update();
    const id = state.pendingClusterId;
    state.pendingClusterId = null;
    setStatus('');
    if (id !== null && id !== undefined) startCapture(id);
  }

  function pulseBeacons(now) {
    if (!three) return;
    const s = 1 + Math.sin(now * 0.004) * 0.12;
    for (let c = 0; c < clusters.length; c++) {
      const sc = state.beaconState[c] === 'unlocked' ? s : 1;
      three.beaconMeshes[c].scale.setScalar(sc);
    }
  }

  // ── Capture flow ─────────────────────────────────────────────────────────────

  // BFS from the cluster's hub word up to 2 hops within the cluster, then
  // falls back to closest 3D neighbours so we always return WORDS_PER_CLUSTER
  // uncaptured words (or fewer if the cluster is nearly exhausted).
  function pickNearbyWords(clusterId) {
    const cl = clusters[clusterId];
    const hub = cl.name;
    const clusterWordSet = new Set(cl.words);
    const visited = new Set();
    const selected = [];

    function tryAdd(w) {
      if (selected.length >= WORDS_PER_CLUSTER) return;
      if (visited.has(w) || state.capturedWords[w]) return;
      visited.add(w);
      selected.push(w);
    }

    // Layer 0 — hub word itself
    visited.add(hub);
    if (!state.capturedWords[hub] && clusterWordSet.has(hub)) selected.push(hub);

    // Layer 1 — direct graph neighbours of hub that live in this cluster
    const hop1 = shuffle((neighborMap[hub] || []).filter(function (w) { return clusterWordSet.has(w); }));
    hop1.forEach(tryAdd);

    // Layer 2 — neighbours of layer-1 words, still within cluster
    if (selected.length < WORDS_PER_CLUSTER) {
      hop1.forEach(function (w1) {
        shuffle((neighborMap[w1] || []).filter(function (w) { return clusterWordSet.has(w); })).forEach(tryAdd);
      });
    }

    // Fallback — pick by 3D proximity to hub when graph edges are sparse
    if (selected.length < WORDS_PER_CLUSTER && positions[hub]) {
      const hubPos = positions[hub];
      const byDist = cl.words
        .filter(function (w) { return !visited.has(w) && !state.capturedWords[w] && positions[w]; })
        .sort(function (a, b) {
          const pa = positions[a], pb = positions[b];
          const da = (pa[0]-hubPos[0])**2 + (pa[1]-hubPos[1])**2 + (pa[2]-hubPos[2])**2;
          const db = (pb[0]-hubPos[0])**2 + (pb[1]-hubPos[1])**2 + (pb[2]-hubPos[2])**2;
          return da - db;
        });
      byDist.forEach(tryAdd);
    }

    return selected;
  }

  function startCapture(clusterId) {
    const cl = clusters[clusterId];
    const nearby = pickNearbyWords(clusterId);
    if (nearby.length === 0) { finishCluster(clusterId); return; }
    state.activeClusterId = clusterId;
    state.activeClusterWordList = nearby;
    state.questionQueue = shuffle(nearby);
    state.wrongInCluster = 0;
    clusterNameEl.textContent = cl.name + ' constellation';
    captureCard.classList.remove('hidden');
    three.controls.enabled = false;
    updateProgress();
    nextQuestion();
  }

  function updateProgress() {
    const id = state.activeClusterId;
    if (id === null) return;
    const tot = state.activeClusterWordList.length;
    const prog = state.activeClusterWordList.filter(function (w) { return state.capturedWords[w]; }).length;
    progressTextEl.textContent = prog + ' / ' + tot + ' captured';
    progressFillEl.style.width = (tot > 0 ? Math.round((prog / tot) * 100) : 0) + '%';
  }

  function wordByName(name) {
    const i = three.wordToIndex.get(name);
    return i !== undefined ? three.placed[i] : null;
  }

  function buildQuestion(wordObj, type) {
    const distractors = pickDistractors(wordObj, allWords, 3);
    const opts = shuffle([wordObj].concat(distractors));
    const correctIndex = opts.indexOf(wordObj);
    if (type === 1) {
      return {
        word: wordObj,
        prompt: 'What does “' + wordObj.word + '” mean?',
        options: opts.map(function (w) { return w.definition || '—'; }),
        correctIndex: correctIndex,
      };
    }
    return {
      word: wordObj,
      prompt: wordObj.definition || ('Which word is “' + wordObj.word + '”?'),
      options: opts.map(function (w) { return w.word; }),
      correctIndex: correctIndex,
    };
  }

  function nextQuestion() {
    if (state.activeClusterId === null) return;
    feedbackEl.textContent = '';
    feedbackEl.className = 'quiz-feedback quest3d-feedback';
    if (state.questionQueue.length === 0) { finishCluster(state.activeClusterId); return; }
    const name = state.questionQueue[0];
    const wordObj = wordByName(name);
    if (!wordObj) { state.questionQueue.shift(); nextQuestion(); return; }
    const type = state.questionType % 2;
    state.questionType++;
    const q = buildQuestion(wordObj, type);
    promptEl.textContent = q.prompt;
    answersEl.innerHTML = '';
    state.answering = true;
    q.options.forEach(function (text, idx) {
      const btn = document.createElement('button');
      btn.className = 'quiz-answer-btn';
      btn.type = 'button';
      btn.textContent = text;
      btn.addEventListener('click', function () { handleAnswer(q, idx, btn); });
      answersEl.appendChild(btn);
    });
  }

  function handleAnswer(q, idx, btn) {
    if (!state.answering) return;
    state.answering = false;
    const correct = idx === q.correctIndex;
    const buttons = answersEl.querySelectorAll('.quiz-answer-btn');
    buttons.forEach(function (b, i) {
      b.disabled = true;
      if (i === q.correctIndex) b.classList.add('correct');
    });
    if (typeof window.vaultRecordAnswer === 'function') {
      window.vaultRecordAnswer(q.word.word, correct);
    }
    if (correct) {
      state.streak++;
      const bonus = Math.min(state.streak - 1, 5) * 20;
      addScore(100 + bonus);
      feedbackEl.textContent = bonus > 0 ? '⭐ Captured! +' + (100 + bonus) + ' (streak ×' + state.streak + ')' : '⭐ Captured! +100';
      feedbackEl.className = 'quiz-feedback quest3d-feedback visible feedback-correct';
      markCaptured(q.word.word);
      state.questionQueue.shift();
    } else {
      btn.classList.add('wrong');
      state.streak = 0;
      state.wrongInCluster++;
      feedbackEl.textContent = '✦ Not quite — “' + q.word.word + '” drifts back. Try again soon.';
      feedbackEl.className = 'quiz-feedback quest3d-feedback visible feedback-wrong';
      // Requeue to the back so the player must still capture it (no penalty).
      const missed = state.questionQueue.shift();
      state.questionQueue.push(missed);
    }
    updateProgress();
    state.nextQuestionTimer = setTimeout(nextQuestion, FEEDBACK_DELAY);
  }

  function markCaptured(word) {
    if (state.capturedWords[word]) return;
    state.capturedWords[word] = true;
    const id = wordCluster.get(word);
    state.clusterProgress[id] = (state.clusterProgress[id] || 0) + 1;
    applyNodeColors();
  }

  function addScore(pts) {
    state.score += pts;
    updateHud();
  }

  function finishCluster(clusterId) {
    if (state.beaconState[clusterId] === 'cleared') { backToFlight(); return; }
    state.beaconState[clusterId] = 'cleared';
    state.clearedCount++;
    const size = state.activeClusterWordList.length || WORDS_PER_CLUSTER;
    let bonus = 300 + size * 50;
    let perfect = state.wrongInCluster === 0;
    if (perfect) bonus += 200;
    addScore(bonus);
    unlockNeighbors(clusterId);
    updateBeaconVisuals();
    applyNodeColors();
    persistBest();
    captureCard.classList.add('hidden');
    state.activeClusterId = null;
    state.activeClusterWordList = [];
    three.controls.enabled = true;
    setStatus('✨ ' + clusters[clusterId].name + ' cleared! +' + bonus + (perfect ? ' (perfect!)' : ''));
    if (state.clearedCount >= clusters.length) {
      showEnd(true);
    }
  }

  function unlockNeighbors(clusterId) {
    (clusters[clusterId].neighbors || []).forEach(function (nid) {
      if (state.beaconState[nid] === 'locked') state.beaconState[nid] = 'unlocked';
    });
  }

  function backToFlight() {
    clearTimeout(state.nextQuestionTimer);
    state.nextQuestionTimer = 0;
    captureCard.classList.add('hidden');
    state.activeClusterId = null;
    state.activeClusterWordList = [];
    if (three) three.controls.enabled = true;
  }

  function retreat() {
    setStatus('Retreated — come back any time to finish the constellation.');
    backToFlight();
  }

  // ── HUD / screens ────────────────────────────────────────────────────────────
  function updateHud() {
    if (scoreEl) scoreEl.textContent = state.score;
    if (clearedEl) clearedEl.textContent = state.clearedCount;
    if (totalEl) totalEl.textContent = clusters ? clusters.length : 0;
  }

  function showScreen(name) {
    [setupScreen, flightScreen, endScreen].forEach(function (el) {
      if (el) el.classList.add('hidden');
    });
    const map = { setup: setupScreen, flight: flightScreen, end: endScreen };
    if (map[name]) map[name].classList.remove('hidden');
  }

  function nearestClusterToOrigin() {
    let best = 0, bestD = Infinity;
    clusters.forEach(function (cl, c) {
      const d = cl.centroid[0] * cl.centroid[0] + cl.centroid[1] * cl.centroid[1] + cl.centroid[2] * cl.centroid[2];
      if (d < bestD) { bestD = d; best = c; }
    });
    return best;
  }

  function resetRun() {
    state.capturedWords = {};
    state.clusterProgress = {};
    state.beaconState = {};
    clusters.forEach(function (cl, c) { state.beaconState[c] = 'locked'; });
    state.beaconState[nearestClusterToOrigin()] = 'unlocked';
    state.score = 0;
    state.streak = 0;
    state.clearedCount = 0;
    state.activeClusterId = null;
    state.questionQueue = [];
    state.questionType = 0;
    state.flying = false;
    state.pendingClusterId = null;
  }

  function persistBest() {
    state.best.bestScore = Math.max(state.best.bestScore, state.score);
    state.best.bestClustersCleared = Math.max(state.best.bestClustersCleared, state.clearedCount);
    state.best.lastRun = { clearedIds: Object.keys(state.beaconState).filter(function (c) { return state.beaconState[c] === 'cleared'; }).map(Number), score: state.score };
    persist();
  }

  function updateBestLine() {
    if (!bestLine) return;
    if (state.best.bestScore > 0) {
      bestLine.textContent = 'Best: ' + state.best.bestScore + ' pts · ' + state.best.bestClustersCleared + ' constellations cleared';
    } else {
      bestLine.textContent = '';
    }
  }

  function showEnd(won) {
    persistBest();
    captureCard.classList.add('hidden');
    if (endEmojiEl) endEmojiEl.textContent = won ? '🏆' : '🚀';
    if (endTitleEl) endTitleEl.textContent = won ? 'Galaxy complete!' : 'Journey paused';
    if (endScoreEl) endScoreEl.textContent = state.score + ' points · ' + state.clearedCount + '/' + clusters.length + ' constellations';
    if (endBestEl) endBestEl.textContent = 'Best: ' + state.best.bestScore + ' pts';
    showScreen('end');
    stopLoop();
  }

  // ── Render loop ──────────────────────────────────────────────────────────────
  function fitCanvas() {
    if (!three) return;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    three.renderer.setSize(w, h, false);
    three.camera.aspect = w / h;
    three.camera.updateProjectionMatrix();
  }

  function startLoop() {
    if (!three || three.running) return;
    three.running = true;
    const loop = function () {
      if (!three || !three.running) return;
      const now = performance.now();
      if (state.flying) {
        const dt = now - state.flyLast;
        state.flyT += dt / FLY_DURATION;
        if (state.flyT >= 1) state.flyT = 1;
        const t = easeInOut(state.flyT);
        three.camera.position.lerpVectors(state.flyFrom, state.flyTo, t);
        three.controls.target.lerpVectors(state.lookFrom, state.lookTo, t);
        three.camera.lookAt(three.controls.target);
        if (state.flyT >= 1) { state.flying = false; onFlyArrive(); }
      } else {
        three.controls.update();
      }
      state.flyLast = now;
      pulseBeacons(now);
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

  // ── Pointer handling ─────────────────────────────────────────────────────────
  function handleTap(clientX, clientY) {
    if (!three || state.flying || state.activeClusterId !== null) return;
    const rect = canvas.getBoundingClientRect();
    three.ndcVec.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    three.ndcVec.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    three.raycaster.setFromCamera(three.ndcVec, three.camera);
    const hits = three.raycaster.intersectObjects(three.beacons.children, false);
    if (hits.length === 0) return;
    const id = hits[0].object.userData.clusterId;
    if (id === undefined) return;
    const st = state.beaconState[id];
    if (st === 'locked') {
      setStatus('🔒 Clear an adjacent constellation first.');
      return;
    }
    flyToCluster(id);
  }

  function attachPointerHandlers() {
    let downX = 0, downY = 0, downT = 0, downId = -1;
    canvas.addEventListener('pointerdown', function (ev) {
      downX = ev.clientX; downY = ev.clientY; downT = Date.now(); downId = ev.pointerId;
    });
    canvas.addEventListener('pointerup', function (ev) {
      if (ev.pointerId !== downId) return;
      const dx = ev.clientX - downX, dy = ev.clientY - downY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const dt = Date.now() - downT;
      if (dist <= TAP_PIXEL_THRESHOLD && dt <= TAP_TIME_THRESHOLD) handleTap(ev.clientX, ev.clientY);
    });
  }

  // ── Game start / open / close ────────────────────────────────────────────────
  function beginGame() {
    resetRun();
    showScreen('flight');
    if (!three) {
      three = buildScene();
      attachPointerHandlers();
    } else {
      three.camera.position.copy(three.baseCamPos);
      three.controls.target.set(0, 0, 0);
      three.controls.enabled = true;
    }
    updateBeaconVisuals();
    applyNodeColors();
    updateHud();
    setStatus('Tap the glowing beacon to begin your journey.');
    requestAnimationFrame(function () {
      fitCanvas();
      startLoop();
    });
  }

  async function open() {
    if (!(await ensureData())) {
      overlay.classList.remove('hidden');
      overlay.setAttribute('aria-hidden', 'false');
      return;
    }
    overlay.classList.remove('hidden');
    overlay.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    active = true;
    if (totalEl) totalEl.textContent = clusters.length;
    updateBestLine();
    showScreen('setup');
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
  if (beginBtn) beginBtn.addEventListener('click', beginGame);
  if (replayBtn) replayBtn.addEventListener('click', beginGame);
  if (retreatBtn) retreatBtn.addEventListener('click', retreat);
  window.addEventListener('resize', function () { if (active) fitCanvas(); });
  document.addEventListener('visibilitychange', function () {
    if (!active || !three) return;
    if (document.hidden) stopLoop();
    else if (!endScreen.classList.contains('hidden')) { /* stay paused on end screen */ }
    else if (!flightScreen.classList.contains('hidden')) startLoop();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Escape' || !active) return;
    const detail = document.getElementById('modal-overlay');
    if (detail && !detail.classList.contains('hidden')) return;
    if (!captureCard.classList.contains('hidden')) { retreat(); return; }
    close();
  });

  loadSave();
};
