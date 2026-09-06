import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  AcousticPulse,
  decodedPrefix,
  receivedLevelDb,
  timeOfFlight,
  waveformSample,
} from './acoustics.js';
import { BASIN_RADIUS, WATER_DEPTH, createBasin, createGridLabels, createSky, createWater } from './water.js';
import { createWaveVisual, updateWaveVisual } from './wave.js';
import { createAuv } from './auv.js';
import { connectSealinxLive } from './live.js';

const MAX_NODES = 16;
const DEMO_NODES = [
  { x: 0, y: -80, z: 0 },
  { x: 5000, y: -80, z: 0 },
  { x: 2500, y: -80, z: 4330 },
];

const root = document.getElementById('canvas-root');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setClearColor(0x0b2428, 1);
root.appendChild(renderer.domElement);

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(window.innerWidth, window.innerHeight);
labelRenderer.domElement.className = 'label-layer';
root.appendChild(labelRenderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x8fb8b8, 0.000035);
scene.add(createSky());
const basin = createBasin(scene);
scene.add(createGridLabels());
const water = createWater();
scene.add(water.mesh);

const pickPlane = new THREE.Mesh(
  new THREE.CircleGeometry(BASIN_RADIUS, 40),
  new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
);
pickPlane.rotation.x = -Math.PI / 2;
scene.add(pickPlane);

scene.add(new THREE.HemisphereLight(0xe8f2f4, 0x1a2428, 1.05));
scene.add(new THREE.AmbientLight(0xffffff, 0.28));
const sun = new THREE.DirectionalLight(0xfff3d8, 1.15);
sun.position.set(6000, 12000, 4000);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(46, window.innerWidth / window.innerHeight, 2, 80000);
camera.position.set(2500, 2800, 9200);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(2500, -80, 2165);
controls.minDistance = 40;
controls.maxDistance = 28000;
controls.maxPolarAngle = Math.PI * 0.98;

const nodesGroup = new THREE.Group();
scene.add(nodesGroup);
const waveGroup = new THREE.Group();
scene.add(waveGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const state = {
  nodes: [],
  selectedId: null,
  txId: 1,
  rxId: 3,
  addMode: false,
  simTime: 0,
  pulses: [],
  visuals: [],
  nextId: 1,
  lastRx: null,
};

const ui = {
  add: document.getElementById('btn-add'),
  remove: document.getElementById('btn-remove'),
  tx: document.getElementById('btn-tx'),
  rx: document.getElementById('btn-rx'),
  ping: document.getElementById('btn-ping'),
  demo: document.getElementById('btn-demo'),
  payload: document.getElementById('payload'),
  range: document.getElementById('range'),
  rangeNum: document.getElementById('range-num'),
  sl: document.getElementById('sl'),
  freq: document.getElementById('freq'),
  th: document.getElementById('th'),
  timescale: document.getElementById('timescale'),
  rangeVal: document.getElementById('range-val'),
  slVal: document.getElementById('sl-val'),
  freqVal: document.getElementById('freq-val'),
  thVal: document.getElementById('th-val'),
  scaleVal: document.getElementById('scale-val'),
  hint: document.getElementById('mode-hint'),
  list: document.getElementById('node-list'),
  rxMeta: document.getElementById('rx-meta'),
  decode: document.getElementById('decode-text'),
  physics: document.getElementById('physics'),
  log: document.getElementById('log'),
  scope: document.getElementById('scope').getContext('2d'),
  posX: document.getElementById('pos-x'),
  posY: document.getElementById('pos-y'),
  posZ: document.getElementById('pos-z'),
  applyPos: document.getElementById('btn-apply-pos'),
  surface: document.getElementById('btn-surface'),
  relDist: document.getElementById('rel-dist'),
  applyRel: document.getElementById('btn-rel-dist'),
  addDepth: document.getElementById('add-depth'),
  depthVal: document.getElementById('depth-val'),
  moveEnabled: document.getElementById('move-enabled'),
  moveSpeed: document.getElementById('move-speed'),
  moveHeading: document.getElementById('move-heading'),
  moveVSpeed: document.getElementById('move-vspeed'),
  moveHold: document.getElementById('move-hold'),
  moveApply: document.getElementById('btn-move-apply'),
  moveStop: document.getElementById('btn-move-stop'),
};

bindSliders();
resetDemo();
connectSealinxLive({
  onPacket(msg) {
    const src = getNode(msg.src);
    if (!src) return;
    state.txId = src.id;
    const dst = getNode(msg.dst);
    if (dst) state.rxId = dst.id;
    ui.payload.value = String(msg.payload || `N${msg.src}->N${msg.dst}`).slice(0, 24);
    refreshNodes();
    transmit();
  },
});
window.addEventListener('resize', onResize);
renderer.domElement.addEventListener('pointerdown', onPointerDown);
window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (e.key === 'Escape') setAddMode(false);
  if (e.key === 'Delete') removeSelected();
});

ui.add.addEventListener('click', () => setAddMode(!state.addMode));
ui.remove.addEventListener('click', removeSelected);
ui.tx.addEventListener('click', () => {
  if (state.selectedId != null) {
    state.txId = state.selectedId;
    refreshNodes();
  }
});
ui.rx.addEventListener('click', () => {
  if (state.selectedId != null) {
    state.rxId = state.selectedId;
    state.lastRx = null;
    ui.decode.textContent = '—';
    refreshNodes();
  }
});
ui.ping.addEventListener('click', transmit);
ui.demo.addEventListener('click', resetDemo);
ui.applyPos.addEventListener('click', applySelectedPose);
ui.surface.addEventListener('click', () => {
  ui.posY.value = '0';
  applySelectedPose();
});
ui.applyRel.addEventListener('click', placeByDistance);
ui.addDepth.addEventListener('input', () => {
  ui.depthVal.textContent = formatDepth(Number(ui.addDepth.value));
});
ui.moveApply.addEventListener('click', applySelectedMotion);
ui.moveStop.addEventListener('click', () => {
  ui.moveEnabled.checked = false;
  applySelectedMotion();
});
for (const el of [ui.moveEnabled, ui.moveSpeed, ui.moveHeading, ui.moveVSpeed, ui.moveHold]) {
  el.addEventListener('change', applySelectedMotion);
}

animate();

function resetDemo() {
  clearSceneNodes();
  DEMO_NODES.forEach((p) => addNode(p.x, p.z, p.y));
  state.selectedId = 1;
  state.txId = 1;
  state.rxId = 3;
  state.simTime = 0;
  state.lastRx = null;
  ui.payload.value = 'PING-OK';
  ui.range.value = '8000';
  ui.rangeNum.value = '8000';
  ui.timescale.value = '0.40';
  ui.range.dispatchEvent(new Event('input'));
  ui.timescale.dispatchEvent(new Event('input'));
  ui.log.innerHTML = '';
  ui.decode.textContent = '—';
  setAddMode(false);
  refreshNodes();
  pushLog('三节点相距 5 km：N1→N2、N2→N3、N3→N1，等待仿真包。');
}

function clearSceneNodes() {
  [...state.nodes].forEach((n) => removeNode(n.id, true));
  state.nodes = [];
  state.nextId = 1;
  state.pulses = [];
  state.visuals.forEach((v) => waveGroup.remove(v.group));
  state.visuals = [];
}

function addNode(x, z, y = 0) {
  if (state.nodes.length >= MAX_NODES) {
    ui.hint.textContent = `最多 ${MAX_NODES} 个节点。`;
    return null;
  }
  const pose = clampPose(x, y, z);
  if (!pose) {
    ui.hint.textContent = '节点必须放在水域范围内。';
    return null;
  }
  const id = state.nextId++;
  const group = buildNodeMesh(id);
  group.position.set(pose.x, pose.y, pose.z);
  nodesGroup.add(group);
  const label = document.createElement('div');
  label.className = 'node-label';
  const css = new CSS2DObject(label);
  css.position.set(0, 22, 0);
  group.add(css);
  const axes = new THREE.AxesHelper(18);
  axes.position.y = 8;
  group.add(axes);
  const node = {
    id,
    group,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    glow: group.userData.glow,
    tether: group.userData.tether,
    marker: group.userData.marker,
    model: group.userData.model,
    propeller: group.userData.propeller,
    label,
    labelObj: css,
    axes,
    hitFlash: 0,
    float: null,
    moveEnabled: false,
    speed: 8,
    heading: 90,
    vSpeed: 0,
    holdDepth: true,
    badgeTimer: 0,
  };
  node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
  syncNodeVisual(node);
  state.nodes.push(node);
  state.selectedId = id;
  refreshNodes();
  return node;
}

function buildNodeMesh(id) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xd8c07a,
    metalness: 0.42,
    roughness: 0.38,
    emissive: 0x2a220c,
    emissiveIntensity: 0.12,
  });
  const model = createAuv(bodyMat);
  const glow = model.userData.glow;
  const marker = new THREE.Mesh(
    new THREE.TorusGeometry(14, 1.2, 8, 28),
    new THREE.MeshBasicMaterial({ color: 0xb7b1a4, transparent: true, opacity: 0.7 })
  );
  marker.rotation.x = Math.PI / 2;
  const tether = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)]),
    new THREE.LineDashedMaterial({ color: 0x9aa6a2, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.55 })
  );
  group.add(model, marker, tether);
  group.traverse((obj) => {
    if (obj.isMesh) {
      obj.renderOrder = 20;
      obj.frustumCulled = false;
    }
  });
  glow.renderOrder = 21;
  group.userData = {
    kind: 'node',
    id,
    glow,
    bodyMat,
    tether,
    marker,
    model,
    propeller: model.userData.propeller,
  };
  return group;
}

function nodeScale(y) {
  return y < -0.4 ? 3.4 : 1.2;
}

function syncNodeVisual(node) {
  const s = nodeScale(node.y);
  node.model.scale.setScalar(s);
  node.axes.scale.setScalar(s);
  node.axes.position.y = 8 * s;
  if (node.labelObj) node.labelObj.position.y = 14 * s;
  updateTether(node);
}

function updateTether(node) {
  const { tether, marker } = node;
  const toSurface = -node.y;
  const s = nodeScale(node.y);
  marker.position.set(0, toSurface, 0);
  marker.scale.setScalar(Math.max(1, s * 0.55));
  marker.visible = true;
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 8 * s, 0),
    new THREE.Vector3(0, toSurface, 0),
  ]);
  tether.geometry.dispose();
  tether.geometry = geo;
  tether.computeLineDistances();
  tether.visible = true;
}

function clampPose(x, y, z) {
  if (Math.hypot(x, z) > BASIN_RADIUS - 80) return null;
  return {
    x,
    z,
    y: THREE.MathUtils.clamp(y, -(WATER_DEPTH - 20), 2),
  };
}

function applySelectedPose() {
  const node = getNode(state.selectedId);
  if (!node) return;
  const pose = clampPose(Number(ui.posX.value), Number(ui.posY.value), Number(ui.posZ.value));
  if (!pose) {
    ui.hint.textContent = '坐标超出水域：水平距离需 < 9.9 km，深度 0 到 -3980 m。';
    return;
  }
  node.x = pose.x;
  node.y = pose.y;
  node.z = pose.z;
  node.group.position.set(pose.x, pose.y, pose.z);
  syncNodeVisual(node);
  refreshNodes();
}

function placeByDistance() {
  const node = getNode(state.selectedId);
  const tx = getNode(state.txId);
  if (!node || !tx || node.id === tx.id) {
    ui.hint.textContent = '请先选中一个非发射节点。';
    return;
  }
  const dist = Number(ui.relDist.value);
  if (!(dist > 0)) return;
  let dir = new THREE.Vector3(node.x - tx.x, node.y - tx.y, node.z - tx.z);
  if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
  dir.normalize().multiplyScalar(dist);
  ui.posX.value = (tx.x + dir.x).toFixed(1);
  ui.posY.value = (tx.y + dir.y).toFixed(1);
  ui.posZ.value = (tx.z + dir.z).toFixed(1);
  applySelectedPose();
}

function removeSelected() {
  if (state.selectedId == null) return;
  removeNode(state.selectedId);
}

function removeNode(id, silent = false) {
  const idx = state.nodes.findIndex((n) => n.id === id);
  if (idx < 0) return;
  const node = state.nodes[idx];
  nodesGroup.remove(node.group);
  state.nodes.splice(idx, 1);
  if (state.selectedId === id) state.selectedId = state.nodes[0]?.id ?? null;
  if (state.txId === id) state.txId = state.nodes[0]?.id ?? null;
  if (state.rxId === id) state.rxId = state.nodes[1]?.id ?? state.nodes[0]?.id ?? null;
  if (!silent) refreshNodes();
}

function setAddMode(on) {
  state.addMode = on;
  ui.add.classList.toggle('active', on);
  ui.hint.textContent = on
    ? `投放模式：单击水面位置。当前深度 ${formatDepth(Number(ui.addDepth.value))}。Esc 退出。`
    : '当前：浏览。点选节点后可改坐标 / 深度，或设发射 / 监听。';
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const nodeHits = raycaster.intersectObjects(nodesGroup.children, true);
  const node = nodeHits[0] ? findNode(nodeHits[0].object) : null;
  if (node) {
    state.selectedId = node.userData.id;
    setAddMode(false);
    refreshNodes();
    return;
  }
  if (!state.addMode) return;
  const waterHits = raycaster.intersectObject(pickPlane);
  if (waterHits[0]) {
    addNode(waterHits[0].point.x, waterHits[0].point.z, Number(ui.addDepth.value));
  }
}

function findNode(obj) {
  while (obj) {
    if (obj.userData?.kind === 'node') return obj;
    obj = obj.parent;
  }
  return null;
}

function transmit() {
  const tx = getNode(state.txId);
  if (!tx) {
    ui.hint.textContent = '请先设置发射节点。';
    return;
  }
  const payload = ui.payload.value.trim() || 'PING';
  const pulse = new AcousticPulse({
    sourceId: tx.id,
    origin: new THREE.Vector3(tx.x, tx.y, tx.z),
    payload,
    maxRange: Number(ui.range.value),
    freqKhz: Number(ui.freq.value),
    sourceLevelDb: Number(ui.sl.value),
    thresholdDb: Number(ui.th.value),
    startSimTime: state.simTime,
  });
  state.pulses.push(pulse);
  const rx = getNode(state.rxId);
  const dest = rx ? new THREE.Vector3(rx.x, rx.y, rx.z) : null;
  const visual = createWaveVisual(pulse, dest);
  waveGroup.add(visual.group);
  state.visuals.push(visual);
  pingSound();
  pushLog(`N${tx.id} 发射「${payload}」  max=${pulse.maxRange}m  f=${pulse.freqKhz}kHz`);
}

function updateVisuals() {
  for (let i = state.visuals.length - 1; i >= 0; i--) {
    const visual = state.visuals[i];
    updateWaveVisual(visual, state.simTime);
    if (visual.pulse.finished(state.simTime)) {
      waveGroup.remove(visual.group);
      state.visuals.splice(i, 1);
      state.pulses.splice(state.pulses.indexOf(visual.pulse), 1);
    }
  }
}

function updatePhysicsHits() {
  for (const pulse of state.pulses) {
    for (const node of state.nodes) {
      if (node.id === pulse.sourceId || pulse.hits.has(node.id)) continue;
      const hit = pulse.evaluateNode(node);
      const arrived = hit.inRange
        ? pulse.travelTime(state.simTime) + 1e-4 >= hit.tof
        : pulse.radius(state.simTime) >= pulse.maxRange - 1e-3;
      if (arrived) {
        pulse.hits.set(node.id, hit);
        node.hitFlash = hit.success ? 1 : 0.45;
        onArrival(node, pulse, hit);
      }
    }
  }
}

function onArrival(node, pulse, hit) {
  const delayMs = hit.tof * 1000;
  if (!hit.inRange) {
    pushLog(`N${node.id} 未收到：超出最大作用距离 ${hit.distance.toFixed(1)}m > ${pulse.maxRange}m`, 'fail');
    spawnFloat(node, 'OUT OF RANGE', false);
    if (node.id === state.rxId) state.lastRx = { pulse, hit };
    return;
  }
  if (!hit.detectable) {
    pushLog(
      `N${node.id} 未解调：RL ${hit.receivedLevel.toFixed(1)} dB < 门限 ${pulse.thresholdDb} dB`,
      'fail'
    );
    spawnFloat(node, 'BELOW THRESHOLD', false);
    if (node.id === state.rxId) state.lastRx = { pulse, hit };
    return;
  }
  pushLog(
    `N${node.id} 收到「${pulse.payload}」  d=${hit.distance.toFixed(1)}m  τ=${delayMs.toFixed(1)}ms  RL=${hit.receivedLevel.toFixed(1)}dB`,
    'ok'
  );
  spawnFloat(node, pulse.payload, true);
  if (node.id === state.rxId) state.lastRx = { pulse, hit };
}

function spawnFloat(node, text, ok) {
  if (node.float) node.group.remove(node.float);
  const el = document.createElement('div');
  el.className = 'rx-float';
  el.style.color = ok ? '#e7b56a' : '#e27a66';
  el.textContent = text;
  const obj = new CSS2DObject(el);
  obj.position.set(0, 38, 0);
  node.group.add(obj);
  node.float = obj;
  setTimeout(() => {
    if (node.float === obj) {
      node.group.remove(obj);
      node.float = null;
    }
  }, 2600);
}

function refreshNodes() {
  ui.list.innerHTML = '';
  for (const node of state.nodes) {
    const tags = [];
    if (node.id === state.txId) tags.push('发射');
    if (node.id === state.rxId) tags.push('监听');
    tags.push(node.y >= -0.2 ? '水面' : `水下 ${Math.abs(node.y).toFixed(0)}m`);
    if (node.moveEnabled) tags.push('巡航');
    const item = document.createElement('div');
    item.className = `node-item${node.id === state.selectedId ? ' selected' : ''}`;
    item.innerHTML = `<span>N${node.id}  X ${node.x.toFixed(0)}  Y ${node.y.toFixed(0)}  Z ${node.z.toFixed(0)}</span><span class="tag">${tags.join(' · ')}</span>`;
    item.addEventListener('click', () => {
      state.selectedId = node.id;
      refreshNodes();
    });
    ui.list.appendChild(item);

    const mat = node.group.userData.bodyMat;
    if (node.id === state.txId) mat.color.set('#d2a45c');
    else if (node.id === state.rxId) mat.color.set('#7f9aa3');
    else mat.color.set('#d8c07a');
    updateNodeBadges(node);
  }
  const selected = getNode(state.selectedId);
  if (selected) {
    ui.posX.value = selected.x.toFixed(1);
    ui.posY.value = selected.y.toFixed(1);
    ui.posZ.value = selected.z.toFixed(1);
    ui.moveEnabled.checked = !!selected.moveEnabled;
    ui.moveSpeed.value = selected.speed;
    ui.moveHeading.value = selected.heading;
    ui.moveVSpeed.value = selected.vSpeed;
    ui.moveHold.checked = selected.holdDepth !== false;
  }
  updateRangeRing();
  updateRxPanel(true);
}

function updateRangeRing() {}

function updateNodeBadges(node) {
  node.label.classList.toggle('selected', node.id === state.selectedId);
  node.label.innerHTML = `<span class="nid">N${node.id}</span><span class="xyz">${fmtCoord(node.x)}, ${fmtCoord(node.y)}, ${fmtCoord(node.z)}</span>`;
}

function fmtCoord(n) {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
}

function updateRxPanel(metaOnly = false) {
  const rx = getNode(state.rxId);
  const tx = getNode(state.txId);
  if (!rx) {
    ui.rxMeta.textContent = '尚未选择监听节点';
    return;
  }
  if (!tx) {
    ui.rxMeta.textContent = `监听 N${rx.id}`;
    return;
  }
  const distance = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
  const tof = timeOfFlight(distance);
  const levels = receivedLevelDb({
    distance,
    sourceLevelDb: Number(ui.sl.value),
    freqKhz: Number(ui.freq.value),
  });
  ui.rxMeta.textContent = `监听 N${rx.id} ← 发射 N${tx.id}　三维距离 ${distance.toFixed(1)} m　时延 ${(tof * 1000).toFixed(1)} ms`;
  if (metaOnly && !state.lastRx) {
    renderPhysics({
      distance,
      tof,
      ...levels,
      inRange: distance <= Number(ui.range.value),
      success: distance <= Number(ui.range.value) && levels.receivedLevel >= Number(ui.th.value),
    });
  }
}

function renderPhysics(hit) {
  const rows = [
    ['三维距离', `${hit.distance.toFixed(2)} m`],
    ['时延 d/c', `${(hit.tof * 1000).toFixed(2)} ms`],
    ['球面扩展 20log₁₀r', `${hit.spreading.toFixed(2)} dB`],
    ['Thorp 吸收', `${hit.absorption.toFixed(3)} dB`],
    ['接收级 RL', `${hit.receivedLevel.toFixed(2)} dB`],
    ['判定', hit.success ? '可解调' : hit.inRange ? '低于门限' : '超出作用距离'],
  ];
  ui.physics.innerHTML = rows.map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`).join('');
}

function drawScope() {
  const ctx = ui.scope;
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = '#071418';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(126,231,208,0.12)';
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  const rec = state.lastRx;
  if (!rec) {
    ui.decode.textContent = '—';
    return;
  }
  const { pulse, hit } = rec;
  renderPhysics(hit);
  ctx.beginPath();
  ctx.lineWidth = 2;
  ctx.strokeStyle = hit.success ? '#e7b56a' : '#e27a66';
  const localMax = state.simTime - (pulse.startSimTime + hit.tof);
  for (let i = 0; i < w; i++) {
    const local = (i / (w - 1)) * Math.max(pulse.packetDuration, 0.08);
    const sample = local <= localMax ? waveformSample(pulse, hit, pulse.startSimTime + hit.tof + local) : 0;
    const py = h / 2 - sample * h * 0.42;
    if (i === 0) ctx.moveTo(i, py);
    else ctx.lineTo(i, py);
  }
  ctx.stroke();
  if (hit.success) {
    const text = decodedPrefix(pulse, hit, state.simTime);
    ui.decode.textContent = text.padEnd(pulse.payload.length, '·');
  } else {
    ui.decode.textContent = hit.inRange ? '信号过弱' : '距离截断';
  }
}


function applySelectedMotion() {
  const node = getNode(state.selectedId);
  if (!node) {
    ui.hint.textContent = '请先选中一个节点再配置移动。';
    return;
  }
  node.moveEnabled = ui.moveEnabled.checked;
  node.speed = Math.max(0, Number(ui.moveSpeed.value) || 0);
  node.heading = ((Number(ui.moveHeading.value) || 0) % 360 + 360) % 360;
  node.vSpeed = Number(ui.moveVSpeed.value) || 0;
  node.holdDepth = ui.moveHold.checked;
  node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
  ui.hint.textContent = node.moveEnabled
    ? `N${node.id} 巡航中：${node.speed} m/s，航向 ${node.heading.toFixed(0)}°。`
    : `N${node.id} 已停止。`;
  refreshNodes();
}

function updateNodeMotion(dt) {
  let selectedMoved = false;
  for (const node of state.nodes) {
    if (!node.moveEnabled || node.speed <= 0) continue;
    const yaw = THREE.MathUtils.degToRad(node.heading);
    const nx = node.x + Math.sin(yaw) * node.speed * dt;
    const nz = node.z + Math.cos(yaw) * node.speed * dt;
    const ny = node.holdDepth ? node.y : node.y + node.vSpeed * dt;
    const pose = clampPose(nx, ny, nz);
    if (!pose || Math.hypot(pose.x, pose.z) > BASIN_RADIUS - 140) {
      node.heading = (node.heading + 180) % 360;
      node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
      if (node.id === state.selectedId) ui.moveHeading.value = node.heading.toFixed(0);
      continue;
    }
    node.x = pose.x;
    node.y = pose.y;
    node.z = pose.z;
    node.group.position.set(pose.x, pose.y, pose.z);
    node.model.rotation.y = yaw;
    syncNodeVisual(node);
    node.badgeTimer += dt;
    if (node.badgeTimer > 0.2) {
      node.badgeTimer = 0;
      updateNodeBadges(node);
    }
    if (node.id === state.selectedId) selectedMoved = true;
  }
  if (selectedMoved) {
    const selected = getNode(state.selectedId);
    if (selected) {
      ui.posX.value = selected.x.toFixed(1);
      ui.posY.value = selected.y.toFixed(1);
      ui.posZ.value = selected.z.toFixed(1);
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  state.simTime += dt * Number(ui.timescale.value);
  water.material.uniforms.uTime.value = clock.elapsedTime;
  basin.bottomMat.uniforms.uTime.value = clock.elapsedTime;
  if (camera.position.y < 0) {
    scene.fog.color.set('#0a3038');
    scene.fog.density = 0.00005;
  } else {
    scene.fog.color.set('#8fb8b8');
    scene.fog.density = 0.000035;
  }
  updateNodeMotion(dt);
  updatePhysicsHits();
  updateVisuals();
  updateRxPanel();
  drawScope();
  for (const node of state.nodes) {
    node.hitFlash *= 0.965;
    node.glow.material.opacity = node.hitFlash;
    node.glow.material.color.set(node.id === state.rxId ? 0xffe08a : 0x7ee7d0);
    node.glow.scale.setScalar(1 + node.hitFlash * 1.6);
    const spin = node.moveEnabled ? 1.2 + node.speed * 0.22 : node.y < -0.4 ? 2.2 : 0.8;
    if (node.propeller) node.propeller.rotation.z += dt * spin;
  }
  controls.update();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}

function bindSliders() {
  const map = [
    [ui.sl, ui.slVal, (v) => `${v} dB`],
    [ui.freq, ui.freqVal, (v) => `${v} kHz`],
    [ui.th, ui.thVal, (v) => `${v} dB`],
    [ui.timescale, ui.scaleVal, (v) => `${Number(v).toFixed(2)}×`],
  ];
  for (const [input, label, fmt] of map) {
    const sync = () => {
      label.textContent = fmt(input.value);
      updateRangeRing();
      updateRxPanel(true);
    };
    input.addEventListener('input', sync);
    sync();
  }
  const syncRange = (fromNum) => {
    const v = fromNum ? ui.rangeNum.value : ui.range.value;
    ui.range.value = v;
    ui.rangeNum.value = v;
    ui.rangeVal.textContent = `${v} m`;
    updateRangeRing();
    updateRxPanel(true);
  };
  ui.range.addEventListener('input', () => syncRange(false));
  ui.rangeNum.addEventListener('input', () => syncRange(true));
  syncRange(false);
  ui.depthVal.textContent = formatDepth(Number(ui.addDepth.value));
}

function getNode(id) {
  return state.nodes.find((n) => n.id === id) ?? null;
}

function formatDepth(y) {
  if (y >= -0.2) return '水面 0 m';
  return `水下 ${Math.abs(y).toFixed(0)} m`;
}

function pushLog(text, kind = '') {
  const line = document.createElement('div');
  if (kind) line.className = kind;
  line.textContent = text;
  ui.log.prepend(line);
}

function pingSound() {
  const ctx = pingSound.ctx || (pingSound.ctx = new (window.AudioContext || window.webkitAudioContext)());
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.setValueAtTime(540, ctx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.42);
  gain.gain.setValueAtTime(0.06, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.46);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
