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
import { connectSealinxLive, disconnectSealinxLive } from './live.js';
import {
  ORIGIN_LABEL,
  ROLE_LABEL,
  STATUS_LABEL,
  escapeHtml,
  applyAcousticFromUi,
  applyProtocolFromUi,
  closeMenu,
  fillInspector,
  fillLinkSelects,
  nodeRole,
  nodeStatus,
  openMenu,
  patchNodeStatus,
  placeMethod,
  queryUi,
  renderDistList,
  renderEventLog,
  renderLinkResult,
  renderNodeList,
  setConsoleCollapsed,
  setConsoleTab,
  setHidden,
  setInspectorTab,
  setModeVisibility,
} from './uiBind.js';

const MAX_NODES = 16;
const DEMO_NODES = [
  { x: -8000, y: -80, z: 0 },
  { x: -4000, y: -80, z: 0 },
  { x: 0, y: -80, z: 0 },
  { x: 4000, y: -80, z: 0 },
  { x: 8000, y: -80, z: 0 },
];
const KNOWN_POSES = {
  1: { x: -8000, y: -80, z: 0 },
  2: { x: -4000, y: -80, z: 0 },
  3: { x: 0, y: -80, z: 0 },
  4: { x: 4000, y: -80, z: 0 },
  5: { x: 8000, y: -80, z: 0 },
};
const STACK_DEFAULTS = {
  1: { slotIndex: 0, destination: 2, nextHop: 2 },
  2: { slotIndex: 1, destination: 3, nextHop: 3 },
  3: { slotIndex: 2, destination: 4, nextHop: 4 },
  4: { slotIndex: 3, destination: 5, nextHop: 5 },
  5: { slotIndex: 4, destination: 5, nextHop: 5 },
};

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
camera.position.set(0, 4200, 14000);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, -80, 0);
controls.minDistance = 40;
controls.maxDistance = 28000;
controls.maxPolarAngle = Math.PI * 0.98;

const nodesGroup = new THREE.Group();
scene.add(nodesGroup);
const waveGroup = new THREE.Group();
scene.add(waveGroup);
const distGroup = new THREE.Group();
scene.add(distGroup);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const clock = new THREE.Clock();

const state = {
  mode: 'local',
  nodes: [],
  selectedId: null,
  txId: 1,
  rxId: 5,
  listenId: null,
  hoveredId: null,
  menuId: null,
  addMode: false,
  pendingAdd: null,
  simTime: 0,
  pulses: [],
  visuals: [],
  events: [],
  nextId: 1,
};

const ui = queryUi();
let filledId = null;
let pointerStart = null;
let focusAnim = null;
let distVisuals = [];
let statusClock = 0;

bindControls();
resetDemo();
setMode('local');
animate();

function ctx() {
  return {
    txId: state.txId,
    rxId: state.rxId,
    listenId: state.listenId,
    selectedId: state.selectedId,
    nodes: state.nodes,
    pulses: state.pulses,
    simTime: state.simTime,
  };
}

function defaultPoseForId(id) {
  if (KNOWN_POSES[id]) return { ...KNOWN_POSES[id] };
  const theta = (id - 1) * (Math.PI / 3);
  return { x: 5000 * Math.cos(theta), y: -80, z: 5000 * Math.sin(theta) };
}

function defaultAcoustic() {
  return { maxRange: 5000, sl: 200, freqKhz: 12, thresholdDb: 90, bandwidthKhz: 4 };
}

function defaultPhy() {
  return { fd: 0, mode: 1, power: -20, guardTime: 150, channel: 0, rate: 24 };
}

function defaultMac() {
  return { slotIndex: 0, slotCount: 3, slotDurationMs: 5000 };
}

function defaultNet() {
  return { destination: 0, nextHop: 0 };
}

function applyStackDefaults(node) {
  const spec = STACK_DEFAULTS[node.id];
  if (!spec) return;
  node.mac.slotIndex = spec.slotIndex;
  node.net.destination = spec.destination;
  node.net.nextHop = spec.nextHop;
}

function stopPulses() {
  state.pulses = [];
  for (const visual of state.visuals) waveGroup.remove(visual.group);
  state.visuals = [];
}

function setMode(mode) {
  const next = mode === 'live' ? 'live' : 'local';
  const prev = state.mode;
  if (prev !== next) stopPulses();
  state.mode = next;
  setAddMode(false);
  closeAddDialog();
  setModeVisibility(ui, next);
  if (next === 'live') {
    if (prev !== 'live') {
      connectSealinxLive({
        onPacket: handleLivePacket,
        onJoin: handleLiveJoin,
      });
    }
  } else {
    disconnectSealinxLive();
    if (ui.liveStatus) ui.liveStatus.textContent = '仿真桥接未连接';
  }
  refreshNodes();
}

function handleLiveJoin(msg) {
  const id = Number(msg.node);
  if (!Number.isFinite(id) || id <= 0) return;
  upsertNode(id, { origin: 'live' });
  refreshNodes();
}

function handleLivePacket(msg) {
  const src = upsertNode(msg.src, { origin: 'live' });
  const dst = upsertNode(msg.dst, { origin: 'live' });
  if (!src || !dst) return;
  mergePhy(src, msg.phy || msg);
  state.txId = src.id;
  state.rxId = dst.id;
  const payload = String(msg.payload || `N${msg.src}->N${msg.dst}`).slice(0, 24);
  transmitDirected(src, dst, payload);
  refreshNodes();
}

function mergePhy(node, phy) {
  if (!node || !phy) return;
  if (phy.fd != null) node.phy.fd = Number(phy.fd);
  if (phy.mode != null) node.phy.mode = Number(phy.mode);
  if (phy.power != null) node.phy.power = Number(phy.power);
  if (phy.guardTime != null) node.phy.guardTime = Number(phy.guardTime);
  else if (phy.guard != null) node.phy.guardTime = Number(phy.guard);
}

function requireLocal() {
  if (state.mode !== 'local') {
    if (ui.hint) ui.hint.textContent = '实时仿真模式下不可编辑节点布局';
    return false;
  }
  return true;
}

function bindControls() {
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown, true);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerleave', () => {
    if (state.hoveredId != null) {
      state.hoveredId = null;
      for (const node of state.nodes) updateNodeBadges(node);
    }
    if (!state.addMode) renderer.domElement.style.cursor = 'default';
  });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (e.key === 'Escape') {
      if (!ui.addDialog.classList.contains('hidden')) {
        closeAddDialog();
        return;
      }
      if (!ui.nodeMenu.classList.contains('hidden')) {
        closeMenu(ui);
        return;
      }
      setAddMode(false);
      return;
    }
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.key === 'Delete' && state.mode === 'local') removeSelected();
  });
  window.addEventListener('pointerdown', (e) => {
    if (!ui.nodeMenu.classList.contains('hidden') && !ui.nodeMenu.contains(e.target) && !e.target.closest('.node-more')) {
      closeMenu(ui);
    }
  });

  ui.modeLocal.addEventListener('click', () => setMode('local'));
  ui.modeLive.addEventListener('click', () => setMode('live'));
  ui.add.addEventListener('click', openAddDialog);
  ui.addCancel.addEventListener('click', closeAddDialog);
  ui.addConfirm.addEventListener('click', confirmAdd);
  ui.addDialog.addEventListener('click', (e) => {
    if (e.target === ui.addDialog) closeAddDialog();
  });
  document.querySelectorAll('input[name="place-method"]').forEach((el) => {
    el.addEventListener('change', () => {
      const coords = placeMethod() === 'coords';
      setHidden(ui.addCoords, !coords);
      ui.addConfirm.textContent = coords ? '添加节点' : '开始放置';
    });
  });

  ui.ping.addEventListener('click', transmit);
  ui.demo.addEventListener('click', resetDemo);
  ui.resetWave.addEventListener('click', resetPropagation);
  ui.applyPos.addEventListener('click', applySelectedPose);
  ui.surface.addEventListener('click', () => {
    ui.posY.value = '0';
    if (ui.posDepth) ui.posDepth.value = '0';
    applySelectedPose();
  });
  ui.applyRel.addEventListener('click', placeByDistance);
  ui.focus.addEventListener('click', () => locateNode(state.selectedId));
  ui.moveApply.addEventListener('click', applySelectedMotion);
  ui.moveStop.addEventListener('click', () => {
    ui.moveEnabled.checked = false;
    applySelectedMotion();
  });
  for (const el of [ui.moveEnabled, ui.moveSpeed, ui.moveHeading, ui.moveVSpeed, ui.moveHold]) {
    el.addEventListener('change', applySelectedMotion);
  }

  ui.tx.addEventListener('click', () => assignRole(state.selectedId, 'tx'));
  ui.rx.addEventListener('click', () => assignRole(state.selectedId, 'rx'));
  ui.listen.addEventListener('click', () => assignRole(state.selectedId, 'listen'));
  ui.roleNormal.addEventListener('click', () => assignRole(state.selectedId, 'normal'));

  ui.txSelect.addEventListener('change', () => {
    const id = Number(ui.txSelect.value);
    state.txId = id || null;
    refreshNodes();
  });
  ui.rxSelect.addEventListener('change', () => {
    const id = Number(ui.rxSelect.value);
    state.rxId = id || null;
    const node = getNode(state.rxId);
    if (node) node.lastRx = null;
    ui.decode.textContent = '—';
    refreshNodes();
  });

  ui.nodeSearch.addEventListener('input', () => refreshNodes());
  ui.showAllDist.addEventListener('change', () => updateDistanceOverlays());
  ui.inspTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tab]');
    if (btn) setInspectorTab(ui, btn.dataset.tab);
  });
  ui.consoleTabs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-console]');
    if (btn) setConsoleTab(ui, btn.dataset.console);
  });
  ui.consoleToggle.addEventListener('click', () => setConsoleCollapsed(ui, !ui.consoleCollapsed));
  ui.logClear.addEventListener('click', () => {
    state.events = [];
    renderEventLog(ui, state.events);
  });

  ui.nName.addEventListener('change', () => {
    const node = getNode(state.selectedId);
    if (!node || ui.syncing) return;
    node.name = ui.nName.value.trim() || `N${node.id}`;
    refreshNodes();
  });
  ui.nOrigin.addEventListener('change', () => {
    const node = getNode(state.selectedId);
    if (!node || ui.syncing) return;
    node.origin = ui.nOrigin.value;
    refreshNodes();
  });
  ui.posDepth.addEventListener('change', () => {
    const d = Number(ui.posDepth.value) || 0;
    ui.posY.value = (-Math.abs(d)).toFixed(1);
  });
  ui.posY.addEventListener('change', () => {
    ui.posDepth.value = Math.max(0, -Number(ui.posY.value) || 0).toFixed(1);
  });

  for (const el of [ui.nRange, ui.nSl, ui.nFreq, ui.nTh, ui.nBw]) {
    el.addEventListener('input', () => {
      if (ui.syncing) return;
      applyAcousticFromUi(ui, getNode(state.selectedId));
      updateLinkPanel(true);
    });
  }
  for (const el of [ui.nFd, ui.nPhyMode, ui.nPower, ui.nGuard, ui.nSlotIndex, ui.nSlotCount, ui.nSlotMs, ui.nChannel, ui.nRate, ui.nNetDst, ui.nNetHop]) {
    el.addEventListener('change', () => {
      if (ui.syncing) return;
      applyProtocolFromUi(ui, getNode(state.selectedId));
    });
  }

  ui.nodeMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = state.menuId;
    const act = btn.dataset.act;
    closeMenu(ui);
    if (id == null) return;
    if (act === 'edit') {
      state.selectedId = id;
      setInspectorTab(ui, 'basic');
      refreshNodes();
      ui.nName?.focus();
    } else if (act === 'tx') assignRole(id, 'tx');
    else if (act === 'rx') assignRole(id, 'rx');
    else if (act === 'listen') assignRole(id, 'listen');
    else if (act === 'focus') {
      state.selectedId = id;
      refreshNodes();
      locateNode(id);
    } else if (act === 'copy') duplicateNode(id);
    else if (act === 'delete') {
      if (!requireLocal()) return;
      removeNode(id);
    }
  });

  setInspectorTab(ui, 'basic');
  setConsoleTab(ui, 'sim');
  setConsoleCollapsed(ui, false);
}

function resetDemo() {
  filledId = null;
  clearSceneNodes();
  DEMO_NODES.forEach((p) => addNode(p.x, p.z, p.y, { origin: 'local' }));
  for (const node of state.nodes) node.acoustic.maxRange = 8000;
  state.selectedId = 1;
  state.txId = 1;
  state.rxId = 5;
  state.listenId = null;
  state.simTime = 0;
  state.events = [];
  ui.payload.value = 'PING-OK';
  ui.timescale.value = '0.40';
  ui.decode.textContent = '—';
  setAddMode(false);
  const n1 = getNode(1);
  if (n1) pushNodeLog(n1, '演示：5 节点链 N1→N2→N3→N4→N5，间距 4 km。');
  refreshNodes();
}

function resetPropagation() {
  stopPulses();
  for (const node of state.nodes) {
    node.lastRx = null;
    node.hitFlash = 0;
    if (node.float) {
      node.group.remove(node.float);
      node.float = null;
    }
  }
  ui.decode.textContent = '—';
  updateLinkPanel(true);
}

function clearSceneNodes() {
  [...state.nodes].forEach((n) => removeNode(n.id, true));
  state.nodes = [];
  state.nextId = 1;
  stopPulses();
  disposeDistVisuals();
}

function addNode(x, z, y = 0, opts = {}) {
  if (opts.id == null && state.nodes.length >= MAX_NODES) {
    if (ui.hint) ui.hint.textContent = `最多 ${MAX_NODES} 个节点。`;
    return null;
  }
  const pose = clampPose(x, y, z);
  if (!pose) {
    if (ui.hint) ui.hint.textContent = '节点必须放在水域范围内。';
    return null;
  }
  const id = opts.id != null ? Number(opts.id) : state.nextId;
  if (!Number.isFinite(id) || id <= 0) return null;
  const existing = getNode(id);
  if (existing) return existing;
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
  axes.visible = false;
  group.add(axes);
  const node = {
    id,
    name: opts.name || `N${id}`,
    origin: opts.origin || 'local',
    online: true,
    group,
    x: pose.x,
    y: pose.y,
    z: pose.z,
    glow: group.userData.glow,
    tether: group.userData.tether,
    marker: group.userData.marker,
    model: group.userData.model,
    propeller: group.userData.propeller,
    selectRing: group.userData.selectRing,
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
    acoustic: defaultAcoustic(),
    phy: defaultPhy(),
    mac: defaultMac(),
    net: defaultNet(),
    logs: [],
    lastRx: null,
  };
  mergePhy(node, opts.phy);
  applyStackDefaults(node);
  node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
  syncNodeVisual(node);
  state.nodes.push(node);
  state.nodes.sort((a, b) => a.id - b.id);
  state.nextId = Math.max(state.nextId, id + 1);
  if (opts.select !== false) state.selectedId = id;
  else if (state.selectedId == null) state.selectedId = id;
  if (!opts.silent) refreshNodes();
  return node;
}

function upsertNode(id, opts = {}) {
  id = Number(id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const existing = getNode(id);
  if (existing) {
    if (opts.origin) existing.origin = opts.origin;
    mergePhy(existing, opts.phy);
    return existing;
  }
  const pose = opts.x != null ? { x: opts.x, y: opts.y ?? -80, z: opts.z ?? 0 } : defaultPoseForId(id);
  return addNode(pose.x, pose.z, pose.y, {
    id,
    origin: opts.origin || 'local',
    phy: opts.phy,
    select: false,
    silent: true,
  });
}

function buildNodeMesh(id) {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xc5c0b5,
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
  const selectRing = new THREE.Mesh(
    new THREE.TorusGeometry(18, 1.15, 8, 36),
    new THREE.MeshBasicMaterial({ color: 0xf0d36a, transparent: true, opacity: 0.95 })
  );
  selectRing.rotation.x = Math.PI / 2;
  selectRing.position.y = 0.4;
  selectRing.visible = false;
  group.add(model, marker, tether, selectRing);
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
    selectRing,
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
  if (node.selectRing) node.selectRing.scale.setScalar(Math.max(1, s * 0.7));
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
  if (document.activeElement === ui.posDepth) {
    ui.posY.value = (-Math.abs(Number(ui.posDepth.value) || 0)).toFixed(1);
  }
  applyProtocolFromUi(ui, node);
  const pose = clampPose(Number(ui.posX.value), Number(ui.posY.value), Number(ui.posZ.value));
  if (!pose) {
    if (ui.hint) ui.hint.textContent = '坐标超出水域：水平距离需 < 9.9 km，深度 0 到 -3980 m。';
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
    if (ui.hint) ui.hint.textContent = '请先选中一个非发射节点。';
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
  if (ui.posDepth) ui.posDepth.value = Math.max(0, -(tx.y + dir.y)).toFixed(1);
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
  const next = state.nodes[idx] || state.nodes[idx - 1] || null;
  if (state.selectedId === id) state.selectedId = next?.id ?? null;
  if (state.txId === id) state.txId = null;
  if (state.rxId === id) state.rxId = null;
  if (state.listenId === id) state.listenId = null;
  if (state.hoveredId === id) state.hoveredId = null;
  if (state.menuId === id) state.menuId = null;
  if (!silent) refreshNodes();
}

function duplicateNode(id) {
  if (!requireLocal()) return;
  const src = getNode(id);
  if (!src) return;
  const node = addNode(src.x + 400, src.z, src.y, {
    origin: src.origin,
    name: nextCopyName(src),
  });
  if (!node) return;
  Object.assign(node.acoustic, { ...src.acoustic });
  Object.assign(node.phy, { ...src.phy });
  Object.assign(node.mac, { ...src.mac });
  Object.assign(node.net, { ...src.net });
  node.speed = src.speed;
  node.heading = src.heading;
  node.vSpeed = src.vSpeed;
  node.holdDepth = src.holdDepth;
  node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
  refreshNodes();
}

function nextCopyName(src) {
  const base = (src.name || `N${src.id}`).replace(/\s副本\d*$/, '');
  let n = 2;
  const names = new Set(state.nodes.map((node) => node.name));
  let name = `${base} 副本`;
  while (names.has(name)) name = `${base} 副本${n++}`;
  return name;
}

function assignRole(id, role) {
  if (id == null) return;
  if (role === 'tx') {
    if (state.rxId === id) state.rxId = null;
    if (state.listenId === id) state.listenId = null;
    state.txId = id;
  } else if (role === 'rx') {
    if (state.txId === id) state.txId = null;
    if (state.listenId === id) state.listenId = null;
    state.rxId = id;
    const node = getNode(id);
    if (node) node.lastRx = null;
    ui.decode.textContent = '—';
  } else if (role === 'listen') {
    if (state.txId === id) state.txId = null;
    if (state.rxId === id) state.rxId = null;
    state.listenId = id;
  } else {
    if (state.txId === id) state.txId = null;
    if (state.rxId === id) state.rxId = null;
    if (state.listenId === id) state.listenId = null;
  }
  refreshNodes();
}

function openAddDialog() {
  if (!requireLocal()) return;
  setAddMode(false);
  ui.addName.value = `N${state.nextId}`;
  ui.addDepth.value = '80';
  ui.addX.value = '0';
  ui.addZ.value = '0';
  const click = document.querySelector('input[name="place-method"][value="click"]');
  if (click) click.checked = true;
  setHidden(ui.addCoords, true);
  ui.addConfirm.textContent = '开始放置';
  setHidden(ui.addDialog, false);
  ui.addName.focus();
}

function closeAddDialog() {
  setHidden(ui.addDialog, true);
}

function confirmAdd() {
  if (!requireLocal()) return;
  const name = ui.addName.value.trim() || `N${state.nextId}`;
  const depth = Number(ui.addDepth.value) || 0;
  if (placeMethod() === 'coords') {
    closeAddDialog();
    addNode(Number(ui.addX.value) || 0, Number(ui.addZ.value) || 0, -Math.abs(depth), { origin: 'local', name });
    return;
  }
  state.pendingAdd = { name, depth };
  closeAddDialog();
  setAddMode(true);
}

function setAddMode(on) {
  state.addMode = on && state.mode === 'local';
  setHidden(ui.placeBanner, !state.addMode);
  renderer.domElement.style.cursor = state.addMode ? 'crosshair' : 'default';
  controls.enableRotate = !state.addMode;
  controls.enablePan = !state.addMode;
  if (!state.addMode) state.pendingAdd = null;
}

function pickFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

function pickNode() {
  const nodeHits = raycaster.intersectObjects(nodesGroup.children, true);
  return nodeHits[0] ? findNode(nodeHits[0].object) : null;
}

function onPointerDown(event) {
  if (event.button !== 0) return;
  if (!ui.addDialog.classList.contains('hidden')) return;
  pickFromEvent(event);
  const node = pickNode();
  pointerStart = { x: event.clientX, y: event.clientY, node };
  if (node || state.addMode) event.stopPropagation();
}

function onPointerUp(event) {
  if (!pointerStart) return;
  const click = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 6;
  const nodeObj = pointerStart.node;
  pointerStart = null;
  if (!click) return;
  if (nodeObj) {
    state.selectedId = nodeObj.userData.id;
    if (state.addMode) setAddMode(false);
    refreshNodes();
    return;
  }
  if (!state.addMode || state.mode !== 'local') return;
  pickFromEvent(event);
  const waterHits = raycaster.intersectObject(pickPlane);
  if (waterHits[0]) {
    const depth = state.pendingAdd?.depth ?? 80;
    const name = state.pendingAdd?.name;
    addNode(waterHits[0].point.x, waterHits[0].point.z, -Math.abs(depth), { origin: 'local', name });
    setAddMode(false);
  }
}

function onPointerMove(event) {
  if (state.addMode) {
    renderer.domElement.style.cursor = 'crosshair';
    return;
  }
  pickFromEvent(event);
  const node = pickNode();
  const id = node?.userData.id ?? null;
  renderer.domElement.style.cursor = node ? 'pointer' : 'default';
  if (id !== state.hoveredId) {
    state.hoveredId = id;
    for (const item of state.nodes) updateNodeBadges(item);
  }
}

function findNode(obj) {
  while (obj) {
    if (obj.userData?.kind === 'node') return obj;
    obj = obj.parent;
  }
  return null;
}

function locateNode(id) {
  const node = getNode(id);
  if (!node) return;
  focusAnim = {
    t: 0,
    dur: 0.65,
    fromPos: camera.position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: new THREE.Vector3(node.x, node.y, node.z),
    toPos: new THREE.Vector3(node.x + 720, node.y + 980, node.z + 1680),
  };
}

function updateFocus(dt) {
  if (!focusAnim) return;
  focusAnim.t += dt;
  const u = Math.min(1, focusAnim.t / focusAnim.dur);
  const s = u * u * (3 - 2 * u);
  camera.position.lerpVectors(focusAnim.fromPos, focusAnim.toPos, s);
  controls.target.lerpVectors(focusAnim.fromTarget, focusAnim.toTarget, s);
  if (u >= 1) focusAnim = null;
}

function makePulse(tx, payload, extra = {}) {
  const pulse = new AcousticPulse({
    sourceId: tx.id,
    origin: new THREE.Vector3(tx.x, tx.y, tx.z),
    payload,
    maxRange: tx.acoustic.maxRange,
    freqKhz: tx.acoustic.freqKhz,
    sourceLevelDb: tx.acoustic.sl,
    thresholdDb: tx.acoustic.thresholdDb,
    startSimTime: state.simTime,
  });
  pulse.directedDst = extra.directedDst ?? null;
  pulse.seq = extra.seq;
  pulse.macSeq = extra.macSeq;
  pulse.appSeq = extra.appSeq;
  return pulse;
}

function spawnPulseVisual(pulse, destNode) {
  const dest = destNode ? new THREE.Vector3(destNode.x, destNode.y, destNode.z) : null;
  const visual = createWaveVisual(pulse, dest);
  waveGroup.add(visual.group);
  state.pulses.push(pulse);
  state.visuals.push(visual);
  pingSound();
}

function transmit() {
  const tx = getNode(state.txId);
  if (!tx) {
    if (ui.hint) ui.hint.textContent = '请先设置发射节点。';
    return;
  }
  const payload = ui.payload.value.trim() || 'PING';
  const rx = getNode(state.rxId);
  const pulse = makePulse(tx, payload, { directedDst: null });
  spawnPulseVisual(pulse, rx);
  pushNodeLog(tx, `N${tx.id} 开始发送「${payload}」  max=${pulse.maxRange}m  f=${pulse.freqKhz}kHz`, '', 'tx');
}

function transmitDirected(src, dst, payload, extra = {}) {
  if (!src || !dst) return;
  const pulse = makePulse(src, payload, { ...extra, directedDst: dst.id });
  spawnPulseVisual(pulse, dst);
  pushNodeLog(src, `N${src.id} → N${dst.id} 发射「${payload}」  max=${pulse.maxRange}m  f=${pulse.freqKhz}kHz`, '', 'tx');
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
      if (pulse.directedDst != null && node.id !== pulse.directedDst) continue;
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
  node.lastRx = { pulse, hit };
  if (!hit.inRange) {
    pushNodeLog(node, `声波到达 N${node.id}：超出最大作用距离 ${hit.distance.toFixed(1)}m > ${pulse.maxRange}m`, 'fail', 'rx');
    spawnFloat(node, 'OUT OF RANGE', false);
    return;
  }
  if (!hit.detectable) {
    pushNodeLog(
      node,
      `N${node.id} 未解调：RL ${hit.receivedLevel.toFixed(1)} dB < 门限 ${pulse.thresholdDb} dB`,
      'fail',
      'rx'
    );
    spawnFloat(node, 'BELOW THRESHOLD', false);
    return;
  }
  pushNodeLog(
    node,
    `N${node.id} 接收到数据「${pulse.payload}」  d=${hit.distance.toFixed(1)}m  τ=${delayMs.toFixed(1)}ms  RL=${hit.receivedLevel.toFixed(1)}dB`,
    'ok',
    'rx'
  );
  spawnFloat(node, pulse.payload, true);
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
  renderNodeList(ui, state.nodes, ctx(), {
    onSelect: (id) => {
      state.selectedId = id;
      closeMenu(ui);
      refreshNodes();
    },
    onMenu: (id, anchor) => {
      state.menuId = id;
      openMenu(ui, anchor);
    },
  });
  fillLinkSelects(ui, state.nodes, state);
  for (const node of state.nodes) {
    const role = nodeRole(node, state);
    const mat = node.group.userData.bodyMat;
    if (role === 'tx') mat.color.set('#e09a4a');
    else if (role === 'rx') mat.color.set('#7eb0d4');
    else if (role === 'listen') mat.color.set('#5ad4d0');
    else mat.color.set('#c5c0b5');
    if (node.selectRing) node.selectRing.visible = node.id === state.selectedId;
    if (node.axes) node.axes.visible = node.id === state.selectedId;
    updateNodeBadges(node);
  }
  const selected = getNode(state.selectedId);
  const editing = ui.inspBody?.contains(document.activeElement);
  if (!editing || filledId !== state.selectedId) {
    filledId = state.selectedId;
    fillInspector(ui, selected, ctx());
  } else if (selected) {
    const role = nodeRole(selected, state);
    const status = nodeStatus(selected, ctx());
    if (ui.inspOrigin) {
      ui.inspOrigin.className = `pill type-${selected.origin || 'local'}`;
      ui.inspOrigin.textContent = ORIGIN_LABEL[selected.origin] || ORIGIN_LABEL.local;
    }
    if (ui.inspRole) {
      ui.inspRole.className = `pill role-${role}`;
      ui.inspRole.textContent = ROLE_LABEL[role];
    }
    if (ui.inspStatus) {
      ui.inspStatus.className = `status ${status}`;
      ui.inspStatus.innerHTML = `<i></i>${STATUS_LABEL[status]}`;
    }
    if (ui.nRoleText) ui.nRoleText.textContent = ROLE_LABEL[role];
    if (ui.nStatusText) ui.nStatusText.textContent = STATUS_LABEL[status];
    renderDistList(ui, selected, state.nodes);
  } else {
    fillInspector(ui, null, ctx());
  }
  updateDistanceOverlays();
  updateLinkPanel(true);
}

function updateNodeBadges(node) {
  const selected = node.id === state.selectedId;
  const hovered = node.id === state.hoveredId;
  const role = nodeRole(node, state);
  node.label.className = `node-label${selected ? ' selected' : ''} role-${role}`;
  const name = escapeHtml(node.name || `N${node.id}`);
  if (selected) {
    node.label.innerHTML = `<span class="nid">${name}</span><span class="role-tag">${ROLE_LABEL[role]}</span><span class="xyz">${fmtCoord(node.x)}, ${fmtCoord(node.y)}, ${fmtCoord(node.z)}</span>`;
  } else if (hovered) {
    node.label.innerHTML = `<span class="nid">${name}</span><span class="xyz">位置：${fmtCoord(node.x)}, ${fmtCoord(node.y)}, ${fmtCoord(node.z)}</span><span class="xyz">深度：${Math.abs(Math.min(node.y, 0)).toFixed(0)} m</span>`;
  } else {
    node.label.innerHTML = `<span class="nid">${name}</span>`;
  }
}

function fmtCoord(n) {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(1);
}

function updateLinkPanel(metaOnly = false) {
  const tx = getNode(state.txId);
  const rx = getNode(state.rxId);
  if (!tx || !rx || tx.id === rx.id) {
    renderLinkResult(ui, tx, rx, null);
    return;
  }
  if (rx.lastRx && rx.lastRx.pulse.sourceId === tx.id) {
    if (metaOnly) renderLinkResult(ui, tx, rx, rx.lastRx.hit);
    return;
  }
  const distance = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
  const tof = timeOfFlight(distance);
  const levels = receivedLevelDb({
    distance,
    sourceLevelDb: tx.acoustic.sl,
    freqKhz: tx.acoustic.freqKhz,
  });
  const hit = {
    distance,
    tof,
    ...levels,
    inRange: distance <= tx.acoustic.maxRange,
    success: distance <= tx.acoustic.maxRange && levels.receivedLevel >= tx.acoustic.thresholdDb,
  };
  if (metaOnly) renderLinkResult(ui, tx, rx, hit);
}

function drawScope() {
  const ctx2d = ui.scope;
  const w = ctx2d.canvas.width;
  const h = ctx2d.canvas.height;
  ctx2d.fillStyle = '#071418';
  ctx2d.fillRect(0, 0, w, h);
  ctx2d.strokeStyle = 'rgba(126,231,208,0.12)';
  ctx2d.beginPath();
  ctx2d.moveTo(0, h / 2);
  ctx2d.lineTo(w, h / 2);
  ctx2d.stroke();
  const rx = getNode(state.rxId);
  const rec = rx?.lastRx;
  if (!rec) {
    ui.decode.textContent = '—';
    return;
  }
  const { pulse, hit } = rec;
  ctx2d.beginPath();
  ctx2d.lineWidth = 2;
  ctx2d.strokeStyle = hit.success ? '#e7b56a' : '#e27a66';
  const localMax = state.simTime - (pulse.startSimTime + hit.tof);
  for (let i = 0; i < w; i++) {
    const local = (i / (w - 1)) * Math.max(pulse.packetDuration, 0.08);
    const sample = local <= localMax ? waveformSample(pulse, hit, pulse.startSimTime + hit.tof + local) : 0;
    const py = h / 2 - sample * h * 0.42;
    if (i === 0) ctx2d.moveTo(i, py);
    else ctx2d.lineTo(i, py);
  }
  ctx2d.stroke();
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
    if (ui.hint) ui.hint.textContent = '请先选中一个节点再配置移动。';
    return;
  }
  node.moveEnabled = ui.moveEnabled.checked;
  node.speed = Math.max(0, Number(ui.moveSpeed.value) || 0);
  node.heading = ((Number(ui.moveHeading.value) || 0) % 360 + 360) % 360;
  node.vSpeed = Number(ui.moveVSpeed.value) || 0;
  node.holdDepth = ui.moveHold.checked;
  node.model.rotation.y = THREE.MathUtils.degToRad(node.heading);
  if (ui.hint) {
    ui.hint.textContent = node.moveEnabled
      ? `N${node.id} 巡航中：${node.speed} m/s，航向 ${node.heading.toFixed(0)}°`
      : `N${node.id} 已停止`;
  }
  refreshNodes();
}

function updateNodeMotion(dt) {
  let moved = false;
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
    moved = true;
    if (node.id === state.selectedId) selectedMoved = true;
  }
  if (selectedMoved) {
    const selected = getNode(state.selectedId);
    if (selected && !ui.inspBody?.contains(document.activeElement)) {
      ui.posX.value = selected.x.toFixed(1);
      ui.posY.value = selected.y.toFixed(1);
      ui.posZ.value = selected.z.toFixed(1);
      if (ui.posDepth) ui.posDepth.value = Math.max(0, -selected.y).toFixed(1);
      renderDistList(ui, selected, state.nodes);
    }
  }
  if (moved) updateDistanceOverlays();
}

function disposeDistVisuals() {
  for (const vis of distVisuals) {
    distGroup.remove(vis.group);
    vis.group.traverse((obj) => {
      obj.geometry?.dispose?.();
      if (obj.element?.parentNode) obj.element.remove();
    });
  }
  distVisuals = [];
}

function makeDistLine(from, to, color, text) {
  const group = new THREE.Group();
  const p0 = new THREE.Vector3(from.x, from.y, from.z);
  const p1 = new THREE.Vector3(to.x, to.y, to.z);
  const geo = new THREE.BufferGeometry().setFromPoints([p0, p1]);
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
    color,
    dashSize: 40,
    gapSize: 24,
    transparent: true,
    opacity: 0.45,
  }));
  line.computeLineDistances();
  group.add(line);
  const el = document.createElement('div');
  el.className = 'dist-label';
  el.textContent = text;
  const css = new CSS2DObject(el);
  css.position.copy(p0).lerp(p1, 0.5);
  group.add(css);
  distGroup.add(group);
  distVisuals.push({ group, fromId: from.id, toId: to.id });
}

function updateDistanceOverlays() {
  disposeDistVisuals();
  const tx = getNode(state.txId);
  const rx = getNode(state.rxId);
  if (tx && rx && tx.id !== rx.id) {
    const d = Math.hypot(rx.x - tx.x, rx.y - tx.y, rx.z - tx.z);
    makeDistLine(tx, rx, 0xe7b56a, `${d.toFixed(0)} m`);
  }
  if (ui.showAllDist?.checked) {
    const selected = getNode(state.selectedId);
    if (selected) {
      for (const other of state.nodes) {
        if (other.id === selected.id) continue;
        if (tx && rx && ((selected.id === tx.id && other.id === rx.id) || (selected.id === rx.id && other.id === tx.id))) continue;
        const d = Math.hypot(other.x - selected.x, other.y - selected.y, other.z - selected.z);
        makeDistLine(selected, other, 0x7ee7d0, `${d.toFixed(0)} m`);
      }
    }
  }
}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (state.mode === 'live') {
    state.simTime += dt;
  } else {
    state.simTime += dt * Number(ui.timescale.value);
  }
  water.material.uniforms.uTime.value = clock.elapsedTime;
  basin.bottomMat.uniforms.uTime.value = clock.elapsedTime;
  if (camera.position.y < 0) {
    scene.fog.color.set('#0a3038');
    scene.fog.density = 0.00005;
  } else {
    scene.fog.color.set('#8fb8b8');
    scene.fog.density = 0.000035;
  }
  updateFocus(dt);
  updateNodeMotion(dt);
  updatePhysicsHits();
  updateVisuals();
  updateLinkPanel(true);
  drawScope();
  statusClock += dt;
  if (statusClock > 0.25) {
    statusClock = 0;
    patchNodeStatus(ui, state.nodes, ctx());
    const selected = getNode(state.selectedId);
    if (selected && ui.nStatusText && !ui.inspBody?.contains(document.activeElement)) {
      ui.nStatusText.textContent = STATUS_LABEL[nodeStatus(selected, ctx())];
    }
  }
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

function getNode(id) {
  return state.nodes.find((n) => n.id === Number(id)) ?? null;
}

function pushNodeLog(node, text, kind = '', dir = '') {
  const entry = { t: state.simTime, text, kind, dir, nodeId: node?.id };
  if (node) {
    node.logs.unshift(entry);
    if (node.logs.length > 80) node.logs.length = 80;
  }
  state.events.push(entry);
  if (state.events.length > 200) state.events.splice(0, state.events.length - 200);
  renderEventLog(ui, state.events);
}

function pingSound() {
  const audioCtx = pingSound.ctx || (pingSound.ctx = new (window.AudioContext || window.webkitAudioContext)());
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.frequency.setValueAtTime(540, audioCtx.currentTime);
  osc.frequency.exponentialRampToValueAtTime(140, audioCtx.currentTime + 0.42);
  gain.gain.setValueAtTime(0.06, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start();
  osc.stop(audioCtx.currentTime + 0.46);
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
