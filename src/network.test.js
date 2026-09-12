import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalNetworkSimulator, LOCAL_POSES } from './network.js';
function setup(topology = 'auto', schedule = 'fixed') {
  const nodes = LOCAL_POSES.map((p, i) => ({ ...p, id: i + 1, online: true, acoustic: { maxRange: 8000, sl: 200, freqKhz: 12, thresholdDb: 90 }, phy: { guardTime: 150 } }));
  const events = [], engine = new LocalNetworkSimulator(() => nodes, e => events.push({ type: e.type, time: e.time }));
  Object.assign(engine.config, { topology, schedule }); return { nodes, engine, events };
}
for (const [topology, schedule, route] of [
  ['auto', 'fixed', [1, 2, 4, 5]], ['chain', 'route', [1, 2, 3, 4, 5]], ['cluster', 'cluster', [1, 2, 4, 5]],
]) test(`${topology}: route, schedule, complete reception before forwarding`, () => {
  const { engine } = setup(topology, schedule);
  assert.deepEqual(engine.route(1), route);
  assert.equal(engine.minimumSlot(), 5.67);
  engine.start(0); engine.update(119);
  assert.ok(engine.stats.delivered > 0);
  const packet = engine.records.find(p => p.source === 1 && p.status === '已送达');
  assert.ok(packet);
  assert.deepEqual(packet.visited, route);
  packet.hops.forEach((hop, i) => {
    assert.ok(Math.abs(hop.completed - hop.arrived - 256 / 2400) < 1e-7);
    if (i) assert.ok(hop.sent >= packet.hops[i - 1].completed);
  });
});
test('event stepping equals large time jump; pause and invalid slot', () => {
  const a = setup().engine, b = setup().engine;
  a.start(0); b.start(0); a.update(100);
  for (let t = 0; t <= 100; t++) b.update(t);
  assert.deepEqual(a.stats, b.stats);
  b.pause(); b.update(110); assert.equal(b.time, 100); b.resume(); b.update(110);
  const c = setup().engine; c.config.manualSlot = 1; assert.throws(() => c.start(0), /时隙不足/);
});
test('broken chain, offline nodes, timeout, stop cleanup', () => {
  const { engine, nodes } = setup('chain', 'route'); nodes[1].acoustic.maxRange = 1;
  assert.deepEqual(engine.route(1), []);
  engine.start(0); engine.update(130); assert.ok(engine.stats.dropped > 0);
  nodes[4].online = false; engine.update(160); assert.equal(engine.status, 'paused');
  engine.stop(); assert.equal(engine.flights.length, 0); assert.equal(engine.queues.size, 0);
});
test('FIFO limit and TTL prevent unbounded forwarding', () => {
  const { engine } = setup(); engine.start(0); engine.update(0);
  for (let i = 0; i < 40; i++) engine.enqueue(2, { id: 100 + i, source: 2, done: false });
  assert.equal(engine.queues.get(2).length, 32); assert.ok(engine.stats.dropped > 0);
  const p = engine.queues.get(2)[0]; p.hops = Array(16).fill({});
  engine.update(6); assert.match(p.status, /TTL/);
});
