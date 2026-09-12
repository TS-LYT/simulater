import { receivedLevelDb, SOUND_SPEED } from './acoustics.js';

export const LOCAL_POSES = [
  { x: -7200, y: -450, z: -2500 }, { x: -3600, y: -1000, z: 1100 },
  { x: -500, y: -1700, z: -2700 }, { x: 3200, y: -850, z: 800 },
  { x: 7100, y: -1300, z: 2900 },
];
export const networkDefaults = () => ({ topology: 'auto', schedule: 'fixed', sink: 5,
  bytes: 32, bitrate: 2400, generationFrames: 4, manualSlot: 0, chain: [1, 2, 3, 4, 5],
  clusters: [{ head: 2, members: [1, 3] }, { head: 4, members: [] }] });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class LocalNetworkSimulator {
  constructor(getNodes, onEvent = () => {}) {
    this.getNodes = getNodes; this.onEvent = onEvent; this.config = networkDefaults(); this.reset();
  }
  reset() { this.stop(); this.time = 0; this.serial = 0; this.records = []; this.stats = { generated: 0, delivered: 0, dropped: 0, latency: 0 }; }
  stop() {
    for (const p of this.records || []) if (!p.done) this.drop(p, '停止取消');
    this.status = 'stopped'; this.error = ''; this.queues = new Map(); this.flights = []; this.routes = new Map(); this.slots = []; this.frame = 0; this.slotIndex = 0;
  }
  nodes() { return this.getNodes().filter(n => n.online !== false).sort((a, b) => a.id - b.id); }
  node(id) { return this.nodes().find(n => n.id === id); }
  evaluate(a, b) {
    const d = distance(a, b), levels = receivedLevelDb({ distance: d, sourceLevelDb: a.acoustic.sl, freqKhz: a.acoustic.freqKhz });
    return { distance: d, tof: d / SOUND_SPEED, ...levels, inRange: d <= a.acoustic.maxRange,
      detectable: levels.receivedLevel >= a.acoustic.thresholdDb,
      success: d <= a.acoustic.maxRange && levels.receivedLevel >= a.acoustic.thresholdDb };
  }
  allowed(id) {
    const c = this.config;
    if (id === c.sink) return [];
    if (c.topology === 'chain') { const i = c.chain.indexOf(id); return i < 0 ? [] : c.chain.slice(i + 1, i + 2); }
    if (c.topology === 'cluster') {
      const cluster = c.clusters.find(v => v.head === id || v.members.includes(id));
      if (!cluster) return [];
      return cluster.head === id ? [...c.clusters.map(v => v.head).filter(v => v !== id), c.sink] : [cluster.head];
    }
    return this.nodes().map(n => n.id).filter(v => v !== id);
  }
  route(id, visited = []) {
    const pending = [{ ids: [id], delay: 0 }];
    const best = new Map();
    while (pending.length) {
      pending.sort((a, b) => a.ids.length - b.ids.length || a.delay - b.delay || a.ids.join(',').localeCompare(b.ids.join(','), undefined, { numeric: true }));
      const path = pending.shift(), last = path.ids.at(-1);
      if (last === this.config.sink) return path.ids;
      const previous = best.get(last);
      if (previous && (previous.hops < path.ids.length || previous.hops === path.ids.length && previous.delay <= path.delay)) continue;
      best.set(last, { hops: path.ids.length, delay: path.delay });
      const from = this.node(last); if (!from) continue;
      for (const next of this.allowed(last)) {
        const to = this.node(next);
        if (!to || path.ids.includes(next) || visited.includes(next)) continue;
        const hit = this.evaluate(from, to);
        if (hit.success) pending.push({ ids: [...path.ids, next], delay: path.delay + hit.tof });
      }
    }
    return [];
  }
  minimumSlot() {
    return Math.ceil((this.config.bytes * 8 / this.config.bitrate + Math.max(0, ...this.nodes().map(n => n.acoustic.maxRange)) / SOUND_SPEED
      + Math.max(0, ...this.nodes().map(n => n.phy.guardTime)) / 1000) * 100) / 100;
  }
  validate() {
    const c = this.config;
    if (!this.node(c.sink)) throw Error('汇聚节点不在线');
    if (!Number.isInteger(c.generationFrames) || c.generationFrames < 1) throw Error('产生周期必须为正整数');
    if (!Number.isInteger(c.bytes) || c.bytes < 1 || c.bytes > 4096 || !(c.bitrate > 0) || !Number.isFinite(c.bitrate)) throw Error('包长需为 1～4096 字节，数据率必须为正数');
    if (!Number.isFinite(c.manualSlot) || c.manualSlot < 0) throw Error('手动时隙必须为正数');
    if (c.manualSlot && c.manualSlot < this.minimumSlot()) throw Error(`时隙不足，至少需要 ${this.minimumSlot().toFixed(2)} 秒`);
    if (c.schedule === 'cluster' && c.topology !== 'cluster') throw Error('两阶段调度仅适用于簇状组网');
    if (c.topology === 'chain' && (new Set(c.chain).size !== c.chain.length || c.chain.at(-1) !== c.sink)) throw Error('链节点不能重复，汇聚节点必须位于末尾');
    if (c.topology === 'cluster') {
      const ids = c.clusters.flatMap(v => [v.head, ...v.members]);
      if (new Set(ids).size !== ids.length || ids.includes(c.sink)) throw Error('簇成员不能重复，汇聚节点不能属于簇');
    }
  }
  start(time) {
    this.validate(); this.reset(); this.time = time; this.status = 'running'; this.nextSlot = time;
  }
  pause() { if (this.status === 'running') this.status = 'paused'; }
  resume() { this.validate(); if (this.status === 'paused') this.status = 'running'; }
  drop(p, reason) { if (p.done) return; p.done = true; p.reason = reason; p.status = `丢弃：${reason}`; this.stats.dropped++; this.onEvent({ type: 'drop', packet: p, time: this.time }); }
  enqueue(id, packet) {
    const q = (this.queues.get(id) || []).filter(p => !p.done); this.queues.set(id, q);
    if (q.length >= 32) this.drop(packet, '队列已满'); else { q.push(packet); packet.holder = id; packet.status = '排队'; }
  }
  beginFrame() {
    this.validate(); this.frame++; this.slotLength = this.config.manualSlot || this.minimumSlot();
    const nodes = this.nodes(); this.routes = new Map(nodes.map(n => [n.id, this.route(n.id)]));
    this.slots = nodes.map(n => n.id);
    const order = (a, b) => (this.routes.get(b)?.length || 0) - (this.routes.get(a)?.length || 0) || a - b;
    if (this.config.schedule === 'route') this.slots.sort(order);
    if (this.config.schedule === 'cluster') {
      const heads = this.config.clusters.map(c => c.head).filter(id => this.node(id));
      const members = this.config.clusters.flatMap(c => c.members).filter(id => this.node(id)).sort((a, b) => a - b);
      this.slots = [...members, ...heads.sort(order)];
    }
    if (!this.slots.length) throw Error('没有可调度节点');
    for (const n of nodes) {
      if ((this.frame - 1) % this.config.generationFrames !== 0) continue;
      if (n.id === this.config.sink || (this.config.topology !== 'auto' && !this.allowed(n.id).length)) continue;
      const p = { id: ++this.serial, source: n.id, destination: this.config.sink, created: this.time, bytes: this.config.bytes,
        visited: [n.id], hops: [], done: false };
      this.records.push(p); this.stats.generated++; this.enqueue(n.id, p);
    }
    // Keep active packets and a bounded display history.
    const completed = this.records.filter(p => p.done).slice(-200);
    this.records = [...completed, ...this.records.filter(p => !p.done)];
    this.onEvent({ type: 'frame', time: this.time });
  }
  sendSlot() {
    if (this.slotIndex === 0) this.beginFrame();
    const id = this.slots[this.slotIndex], q = this.queues.get(id) || [];
    this.currentSender = id;
    while (q[0]?.done) q.shift();
    const p = q[0];
    if (p) {
      const route = this.route(id, p.visited.slice(0, -1));
      if (p.hops.length >= 16) { q.shift(); this.drop(p, 'TTL 耗尽'); }
      else if (route.length < 2) p.status = '等待路由';
      else {
        q.shift(); const tx = this.node(id), rx = this.node(route[1]);
        const duration = p.bytes * 8 / this.config.bitrate;
        const hop = { from: id, to: rx.id, sent: this.time, duration };
        p.hops.push(hop); p.status = '发送/传播中';
        const f = { packet: p, hop, origin: { x: tx.x, y: tx.y, z: tx.z }, acoustic: { ...tx.acoustic }, duration };
        this.flights.push(f); this.onEvent({ type: 'send', flight: f, time: this.time });
      }
    }
    this.slotIndex = (this.slotIndex + 1) % this.slots.length;
    this.nextSlot += this.slotLength;
  }
  update(toTime) {
    if (this.status !== 'running') return;
    // Event times are recomputed for moving receivers using their current physical position.
    while (this.status === 'running') {
      let next = this.nextSlot;
      for (const p of this.records) if (!p.done) next = Math.min(next, p.created + 120);
      for (const f of this.flights) {
        const rx = this.node(f.hop.to);
        const arrival = rx ? f.hop.sent + Math.min(distance(f.origin, rx), f.acoustic.maxRange) / SOUND_SPEED : this.time;
        next = Math.min(next, f.hop.arrived == null ? Math.max(this.time, arrival) : f.hop.arrived + f.duration);
      }
      if (next > toTime + 1e-8) break;
      this.time = next;
      for (const p of this.records) if (!p.done && (next >= p.created + 120 || !this.node(p.holder))) this.drop(p, '超时或持包节点离线');
      for (const f of [...this.flights]) {
        const rx = this.node(f.hop.to);
        if (!rx || !this.node(f.hop.from)) this.drop(f.packet, '链路节点离线');
        if (!f.packet.done && f.hop.arrived == null) {
          const hit = this.evaluate({ ...f.origin, acoustic: f.acoustic }, rx);
          if (next + 1e-8 >= f.hop.sent + Math.min(hit.distance, f.acoustic.maxRange) / SOUND_SPEED) {
            f.hop.arrived = next; f.hit = hit; f.packet.status = '接收中';
            this.onEvent({ type: 'arrival', flight: f, time: next });
          }
        }
        if (!f.packet.done && f.hop.arrived != null && next + 1e-8 >= f.hop.arrived + f.duration) {
          f.hop.completed = next; this.onEvent({ type: 'receive', flight: f, time: next });
          if (!f.hit.success) this.drop(f.packet, '接收失败');
          else {
            f.packet.visited.push(rx.id);
            if (rx.id === f.packet.destination) {
              f.packet.done = true; f.packet.status = '已送达'; f.packet.delivered = next;
              this.stats.delivered++; this.stats.latency += next - f.packet.created;
            } else this.enqueue(rx.id, f.packet);
          }
        }
        if (f.packet.done || f.hop.completed != null) this.flights.splice(this.flights.indexOf(f), 1);
      }
      if (next + 1e-8 >= this.nextSlot) {
        try { this.sendSlot(); } catch (error) { this.status = 'paused'; this.error = error.message; break; }
      }
    }
    this.time = toTime;
  }
}
