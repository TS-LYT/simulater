export const ORIGIN_LABEL = {
  local: '本机节点',
  live: '仿真节点',
  real: '真实节点',
};

export const ROLE_LABEL = {
  tx: 'TX',
  rx: 'RX',
  listen: '监听',
  normal: '普通',
  observer: '观察',
};

export const STATUS_LABEL = {
  online: '在线',
  offline: '离线',
  txing: '发送中',
  rxing: '接收中',
  listening: '监听中',
};

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

const MODE_HINT = {
  local: '本地模拟',
  live: '实时仿真',
};

export function queryUi() {
  const byId = (id) => document.getElementById(id);
  return {
    add: byId('btn-add'),
    tx: byId('btn-tx'),
    rx: byId('btn-rx'),
    listen: byId('btn-listen'),
    roleNormal: byId('btn-role-normal'),
    ping: byId('btn-ping'),
    demo: byId('btn-demo'),
    resetWave: byId('btn-reset-wave'),
    payload: byId('payload'),
    timescale: byId('timescale'),
    hint: byId('mode-hint'),
    list: byId('node-list'),
    nodeEmpty: byId('node-empty'),
    nodeCount: byId('node-count'),
    nodeSearch: byId('node-search'),
    rxMeta: byId('rx-meta'),
    decode: byId('decode-text'),
    physics: byId('physics'),
    log: byId('log'),
    scope: byId('scope').getContext('2d'),
    posX: byId('pos-x'),
    posY: byId('pos-y'),
    posZ: byId('pos-z'),
    posDepth: byId('pos-depth'),
    applyPos: byId('btn-apply-pos'),
    surface: byId('btn-surface'),
    relDist: byId('rel-dist'),
    applyRel: byId('btn-rel-dist'),
    focus: byId('btn-focus'),
    moveEnabled: byId('move-enabled'),
    moveSpeed: byId('move-speed'),
    moveHeading: byId('move-heading'),
    moveVSpeed: byId('move-vspeed'),
    moveHold: byId('move-hold'),
    moveApply: byId('btn-move-apply'),
    moveStop: byId('btn-move-stop'),
    inspEmpty: byId('insp-empty'),
    inspBody: byId('insp-body'),
    inspId: byId('insp-id'),
    inspOrigin: byId('insp-origin'),
    inspRole: byId('insp-role'),
    inspStatus: byId('insp-status'),
    inspTabs: byId('insp-tabs'),
    nId: byId('n-id'),
    nName: byId('n-name'),
    nOrigin: byId('n-origin'),
    nRoleText: byId('n-role-text'),
    nStatusText: byId('n-status-text'),
    distList: byId('dist-list'),
    nRange: byId('n-range'),
    nSl: byId('n-sl'),
    nFreq: byId('n-freq'),
    nBw: byId('n-bw'),
    nTh: byId('n-th'),
    nFd: byId('n-fd'),
    nPhyMode: byId('n-phy-mode'),
    nPower: byId('n-power'),
    nGuard: byId('n-guard'),
    nSlotIndex: byId('n-slot-index'),
    nSlotCount: byId('n-slot-count'),
    nSlotMs: byId('n-slot-ms'),
    nChannel: byId('n-channel'),
    nRate: byId('n-rate'),
    nAddr: byId('n-addr'),
    nNetDst: byId('n-net-dst'),
    nNetHop: byId('n-net-hop'),
    localTx: byId('local-tx'),
    liveControls: byId('live-controls'),
    liveStatus: byId('live-status'),
    modeLocal: byId('mode-local'),
    modeLive: byId('mode-live'),
    txSelect: byId('tx-select'),
    rxSelect: byId('rx-select'),
    showAllDist: byId('show-all-dist'),
    consoleEl: byId('console'),
    consoleTabs: byId('console-tabs'),
    consoleSim: byId('console-sim'),
    consoleLog: byId('console-log'),
    consoleToggle: byId('btn-console-toggle'),
    logFollow: byId('log-follow'),
    logClear: byId('btn-log-clear'),
    addDialog: byId('add-dialog'),
    addName: byId('add-name'),
    addDepth: byId('add-depth'),
    addX: byId('add-x'),
    addZ: byId('add-z'),
    addCoords: byId('add-coords'),
    addCancel: byId('btn-add-cancel'),
    addConfirm: byId('btn-add-confirm'),
    placeBanner: byId('place-banner'),
    nodeMenu: byId('node-menu'),
    syncing: false,
    inspectorTab: 'basic',
    consoleTab: 'sim',
    consoleCollapsed: false,
  };
}

export function setHidden(el, hidden) {
  if (!el) return;
  el.hidden = hidden;
  el.classList.toggle('hidden', hidden);
}

export function setModeVisibility(ui, mode) {
  setHidden(ui.localTx, mode !== 'local');
  setHidden(ui.liveControls, mode !== 'live');
  setHidden(ui.add, mode !== 'local');
  ui.modeLocal?.classList.toggle('active', mode === 'local');
  ui.modeLive?.classList.toggle('active', mode === 'live');
  if (ui.hint) ui.hint.textContent = MODE_HINT[mode] || MODE_HINT.local;
}

export function nodeRole(node, { txId, rxId, listenId, sendMode, mode }) {
  if (!node) return 'normal';
  if (node.id === txId) return 'tx';
  if (node.id === rxId) return sendMode === 'broadcast' && mode !== 'live' ? 'observer' : 'rx';
  if (node.id === listenId) return 'listen';
  return 'normal';
}

export function nodeStatus(node, ctx) {
  if (!node) return 'offline';
  if (node.online === false) return 'offline';
  const pulses = ctx.pulses || [];
  const simTime = ctx.simTime || 0;
  const active = pulses.filter((p) => !p.finished(simTime));
  if (active.some((p) => p.sourceId === node.id)) return 'txing';
  if (active.some((p) => p.hits.get(node.id)?.success && !p.hits.get(node.id)?.overheard
    && simTime <= p.hits.get(node.id).arrivedAt + p.packetDuration)) {
    return 'rxing';
  }
  if (node.id === ctx.listenId) return 'listening';
  return 'online';
}

export function inspectorFields(ui) {
  return [
    ui.posX, ui.posY, ui.posZ, ui.posDepth, ui.relDist,
    ui.nName, ui.nOrigin, ui.nRange, ui.nSl, ui.nFreq, ui.nBw, ui.nTh,
    ui.nFd, ui.nPhyMode, ui.nPower, ui.nGuard,
    ui.nSlotIndex, ui.nSlotCount, ui.nSlotMs, ui.nChannel, ui.nRate,
    ui.nNetDst, ui.nNetHop,
    ui.moveEnabled, ui.moveSpeed, ui.moveHeading, ui.moveVSpeed, ui.moveHold,
    ui.applyPos, ui.surface, ui.applyRel, ui.moveApply, ui.moveStop, ui.focus,
    ui.tx, ui.rx, ui.listen, ui.roleNormal,
  ].filter(Boolean);
}

export function setInspectorEnabled(ui, on) {
  for (const el of inspectorFields(ui)) el.disabled = !on;
}

export function setInspectorTab(ui, tab) {
  ui.inspectorTab = tab;
  ui.inspTabs?.querySelectorAll('[data-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  ui.inspBody?.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.panel !== tab);
  });
}

export function setConsoleTab(ui, tab) {
  ui.consoleTab = tab;
  ui.consoleTabs?.querySelectorAll('[data-console]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.console === tab);
  });
  setHidden(ui.consoleSim, tab !== 'sim');
  setHidden(ui.consoleLog, tab !== 'log');
}

export function setConsoleCollapsed(ui, collapsed) {
  ui.consoleCollapsed = collapsed;
  ui.consoleEl?.classList.toggle('collapsed', collapsed);
  if (ui.consoleToggle) ui.consoleToggle.textContent = collapsed ? '展开' : '折叠';
}

export function renderDistList(ui, node, nodes) {
  if (!ui.distList) return;
  ui.distList.innerHTML = '';
  if (!node) return;
  for (const other of nodes) {
    if (other.id === node.id) continue;
    const d = Math.hypot(other.x - node.x, other.y - node.y, other.z - node.z);
    const row = document.createElement('div');
    row.className = 'dist-row';
    row.innerHTML = `<span>${escapeHtml(other.name || `N${other.id}`)}</span><span>${d.toFixed(1)} m</span>`;
    ui.distList.appendChild(row);
  }
}

export function renderEventLog(ui, events) {
  if (!ui.log) return;
  const follow = ui.logFollow?.checked !== false;
  const nearBottom = ui.log.scrollHeight - ui.log.scrollTop - ui.log.clientHeight < 24;
  ui.log.innerHTML = '';
  for (const entry of events) {
    const line = document.createElement('div');
    if (entry.kind) line.className = entry.kind;
    const prefix = Number.isFinite(entry.t) ? `${entry.t.toFixed(1)}s  ` : '';
    line.textContent = `${prefix}${entry.text}`;
    ui.log.appendChild(line);
  }
  if (follow || nearBottom) ui.log.scrollTop = ui.log.scrollHeight;
}

export function fillLinkSelects(ui, nodes, { txId, rxId }) {
  const fill = (select, selected, emptyLabel) => {
    if (!select) return;
    const current = String(selected ?? '');
    const keep = select === document.activeElement;
    if (keep) return;
    select.innerHTML = `<option value="">${emptyLabel}</option>` + nodes.map((n) => {
      const label = escapeHtml(n.name || `N${n.id}`);
      return `<option value="${n.id}">${label}</option>`;
    }).join('');
    select.value = current;
  };
  fill(ui.txSelect, txId, '未选择');
  fill(ui.rxSelect, rxId, '未选择');
}

export function renderNodeList(ui, nodes, ctx, handlers) {
  if (!ui.list) return;
  const q = (ui.nodeSearch?.value || '').trim().toLowerCase();
  ui.list.innerHTML = '';
  const filtered = nodes.filter((node) => {
    if (!q) return true;
    const role = nodeRole(node, ctx);
    const hay = `${node.name || ''} n${node.id} ${ORIGIN_LABEL[node.origin] || ''} ${ROLE_LABEL[role]}`.toLowerCase();
    return hay.includes(q);
  });
  if (ui.nodeCount) ui.nodeCount.textContent = String(nodes.length);
  if (ui.nodeEmpty) {
    ui.nodeEmpty.hidden = nodes.length > 0 && filtered.length > 0;
    ui.nodeEmpty.textContent = nodes.length === 0 ? '还没有节点' : '没有匹配的节点';
  }
  for (const node of filtered) {
    const role = nodeRole(node, ctx);
    const status = nodeStatus(node, ctx);
    const item = document.createElement('div');
    item.className = `node-item${node.id === ctx.selectedId ? ' selected' : ''}`;
    item.dataset.id = String(node.id);
    item.innerHTML = `
      <div class="node-item-main">
        <div class="node-item-title">${escapeHtml(node.name || `N${node.id}`)}</div>
        <div class="node-item-meta">
          <span class="pill type-${node.origin || 'local'}">${ORIGIN_LABEL[node.origin] || ORIGIN_LABEL.local}</span>
          <span class="pill role-${role}">${ROLE_LABEL[role]}</span>
          <span class="status ${status}" data-status><i></i>${STATUS_LABEL[status]}</span>
        </div>
      </div>
      <button class="node-more" type="button" data-id="${node.id}" title="操作">···</button>
    `;
    item.querySelector('.node-item-main').addEventListener('click', () => handlers.onSelect(node.id));
    item.querySelector('.node-more').addEventListener('click', (ev) => {
      ev.stopPropagation();
      handlers.onMenu(node.id, ev.currentTarget);
    });
    ui.list.appendChild(item);
  }
}

export function patchNodeStatus(ui, nodes, ctx) {
  if (!ui.list) return;
  for (const item of ui.list.querySelectorAll('.node-item')) {
    const node = nodes.find((n) => n.id === Number(item.dataset.id));
    if (!node) continue;
    const status = nodeStatus(node, ctx);
    const el = item.querySelector('[data-status]');
    if (!el) continue;
    el.className = `status ${status}`;
    el.innerHTML = `<i></i>${STATUS_LABEL[status]}`;
  }
}

function setStatusEl(el, status) {
  if (!el) return;
  el.className = `status ${status}`;
  el.innerHTML = `<i></i>${STATUS_LABEL[status] || status}`;
}

export function fillInspector(ui, node, ctx) {
  ui.syncing = true;
  if (!node) {
    setHidden(ui.inspEmpty, false);
    setHidden(ui.inspBody, true);
    if (ui.inspId) ui.inspId.textContent = '未选中';
    setInspectorEnabled(ui, false);
    renderDistList(ui, null, []);
    ui.syncing = false;
    return;
  }
  setHidden(ui.inspEmpty, true);
  setHidden(ui.inspBody, false);
  setInspectorEnabled(ui, true);
  const role = nodeRole(node, ctx);
  const status = nodeStatus(node, ctx);
  if (ui.inspId) ui.inspId.textContent = node.name || `N${node.id}`;
  if (ui.inspOrigin) {
    ui.inspOrigin.className = `pill type-${node.origin || 'local'}`;
    ui.inspOrigin.textContent = ORIGIN_LABEL[node.origin] || ORIGIN_LABEL.local;
  }
  if (ui.inspRole) {
    ui.inspRole.className = `pill role-${role}`;
    ui.inspRole.textContent = ROLE_LABEL[role];
  }
  setStatusEl(ui.inspStatus, status);
  if (ui.nId) ui.nId.value = String(node.id);
  if (ui.nName) ui.nName.value = node.name || `N${node.id}`;
  if (ui.nOrigin) ui.nOrigin.value = node.origin || 'local';
  if (ui.nRoleText) ui.nRoleText.textContent = ROLE_LABEL[role];
  if (ui.nStatusText) ui.nStatusText.textContent = STATUS_LABEL[status];
  ui.posX.value = node.x.toFixed(1);
  ui.posY.value = node.y.toFixed(1);
  ui.posZ.value = node.z.toFixed(1);
  if (ui.posDepth) ui.posDepth.value = Math.max(0, -node.y).toFixed(1);
  ui.nRange.value = node.acoustic.maxRange;
  ui.nSl.value = node.acoustic.sl;
  ui.nFreq.value = node.acoustic.freqKhz;
  if (ui.nBw) ui.nBw.value = node.acoustic.bandwidthKhz ?? 4;
  ui.nTh.value = node.acoustic.thresholdDb;
  ui.nFd.value = node.phy.fd;
  ui.nPhyMode.value = node.phy.mode;
  ui.nPower.value = node.phy.power;
  ui.nGuard.value = node.phy.guardTime;
  ui.nSlotIndex.value = node.mac.slotIndex;
  ui.nSlotCount.value = node.mac.slotCount;
  ui.nSlotMs.value = node.mac.slotDurationMs;
  if (ui.nChannel) ui.nChannel.value = node.phy.channel ?? 0;
  if (ui.nRate) ui.nRate.value = node.phy.rate ?? 24;
  if (ui.nAddr) ui.nAddr.value = node.id;
  ui.nNetDst.value = node.net.destination;
  ui.nNetHop.value = node.net.nextHop;
  ui.moveEnabled.checked = !!node.moveEnabled;
  ui.moveSpeed.value = node.speed;
  ui.moveHeading.value = node.heading;
  ui.moveVSpeed.value = node.vSpeed;
  ui.moveHold.checked = node.holdDepth !== false;
  ui.tx?.classList.toggle('active', role === 'tx');
  ui.rx?.classList.toggle('active', role === 'rx');
  ui.listen?.classList.toggle('active', role === 'listen');
  ui.roleNormal?.classList.toggle('active', role === 'normal');
  renderDistList(ui, node, ctx.nodes || []);
  ui.syncing = false;
}

export function applyAcousticFromUi(ui, node) {
  if (!node) return;
  node.acoustic.maxRange = Number(ui.nRange.value);
  node.acoustic.sl = Number(ui.nSl.value);
  node.acoustic.freqKhz = Number(ui.nFreq.value);
  node.acoustic.thresholdDb = Number(ui.nTh.value);
  if (ui.nBw) node.acoustic.bandwidthKhz = Number(ui.nBw.value);
}

export function applyProtocolFromUi(ui, node) {
  if (!node) return;
  node.phy.fd = Number(ui.nFd.value) || 0;
  node.phy.mode = Number(ui.nPhyMode.value) || 0;
  node.phy.power = Number(ui.nPower.value) || 0;
  node.phy.guardTime = Number(ui.nGuard.value) || 0;
  if (ui.nChannel) node.phy.channel = Number(ui.nChannel.value) || 0;
  if (ui.nRate) node.phy.rate = Number(ui.nRate.value) || 0;
  node.mac.slotIndex = Number(ui.nSlotIndex.value) || 0;
  node.mac.slotCount = Number(ui.nSlotCount.value) || 0;
  node.mac.slotDurationMs = Number(ui.nSlotMs.value) || 0;
  node.net.destination = Number(ui.nNetDst.value) || 0;
  node.net.nextHop = Number(ui.nNetHop.value) || 0;
}

let lastLinkKey = '';

export function renderLinkResult(ui, tx, rx, hit, broadcast = false) {
  const txName = tx ? (tx.name || `N${tx.id}`) : '—';
  const rxName = rx ? (rx.name || `N${rx.id}`) : '—';
  const title = broadcast ? `广播 TX ${txName} · 观察 ${rxName}` : `TX ${txName} → RX ${rxName}`;
  const key = hit
    ? [title, hit.distance, hit.tof, hit.spreading, hit.absorption, hit.receivedLevel, hit.success, hit.inRange].join('|')
    : `${title}|empty`;
  if (key === lastLinkKey) return;
  lastLinkKey = key;
  if (ui.rxMeta) ui.rxMeta.textContent = title;
  if (!ui.physics) return;
  if (!hit) {
    ui.physics.innerHTML = '';
    return;
  }
  const verdict = hit.success ? '可通信' : hit.inRange ? '低于门限' : '超出作用距离';
  const klass = hit.success ? 'ok' : 'fail';
  const mark = hit.success ? '✓' : '⚠';
  const rows = [
    ['三维距离', `${hit.distance.toFixed(2)} m`],
    ['传播时延', `${hit.tof.toFixed(2)} s`],
    ['传播损耗 TL', `${hit.spreading.toFixed(2)} dB`],
    ['Thorpe 吸收', `${hit.absorption.toFixed(3)} dB`],
    ['接收级 RL', `${hit.receivedLevel.toFixed(2)} dB`],
    ['链路判定', `${mark} ${verdict}`],
  ];
  ui.physics.innerHTML = rows.map(([k, v], i) => {
    const extra = i === 5 ? ` class="${klass}"` : '';
    return `<li><span>${k}</span><b${extra}>${v}</b></li>`;
  }).join('');
}

export function placeMethod() {
  const el = document.querySelector('input[name="place-method"]:checked');
  return el?.value || 'click';
}

export function closeMenu(ui) {
  setHidden(ui.nodeMenu, true);
}

export function openMenu(ui, anchor) {
  const menu = ui.nodeMenu;
  if (!menu) return;
  setHidden(menu, false);
  const rect = anchor.getBoundingClientRect();
  const w = menu.offsetWidth || 168;
  const h = menu.offsetHeight || 240;
  let left = rect.right - 8;
  let top = rect.bottom + 4;
  if (left + w > window.innerWidth - 8) left = rect.left - w + 8;
  if (top + h > window.innerHeight - 8) top = rect.top - h - 4;
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
}
