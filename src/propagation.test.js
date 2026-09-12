import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AcousticPulse } from './acoustics.js';
import { configureRecipients, advanceRecipient } from './propagation.js';
import { createWaveVisual, updateWaveVisual, disposeWaveObject, waveVisualFinished } from './wave.js';

const nodes = [0, 4000, 8000, 16000].map((x, i) => ({ id: i + 1, x, y: -80, z: 0, online: true }));
function pulse(mode = 'target', live = false) {
  const p = new AcousticPulse({ sourceId: 1, origin: new THREE.Vector3(0, -80, 0), payload: 'PING',
    maxRange: 8000, freqKhz: 12, sourceLevelDb: 200, thresholdDb: 90, startSimTime: 0 });
  configureRecipients(p, nodes, mode, 4, live);
  return p;
}
test('target, broadcast and live recipients; arrival and overhearing', () => {
  const p = pulse();
  assert.deepEqual([...p.recipientIds], [2, 3, 4]);
  assert.equal(advanceRecipient(p, nodes[1], 2), null);
  assert.equal(advanceRecipient(p, nodes[1], 4000 / 1480).overheard, true);
  assert.equal(advanceRecipient(p, nodes[1], 3), null);
  assert.equal(advanceRecipient(p, nodes[2], 8000 / 1480).distance, 8000);
  assert.equal(advanceRecipient(p, nodes[3], 8000 / 1480).inRange, false);
  const b = pulse('broadcast');
  assert.deepEqual([...b.recipientIds], [2, 3]);
  assert.equal(advanceRecipient(b, nodes[1], 3).overheard, false);
  assert.equal(advanceRecipient(b, { id: 5, x: 100 }, 3), null);
  assert.deepEqual([...pulse('target', true).recipientIds], [4]);
});
test('weak signals, moving receivers and frozen arrival positions', () => {
  const p = pulse(); p.thresholdDb = 300;
  const moving = { ...nodes[1], x: 5000 };
  assert.equal(advanceRecipient(p, moving, 3), null);
  const hit = advanceRecipient(p, moving, 4);
  assert.equal(hit.success, false);
  moving.x = 6000;
  assert.equal(hit.position.x, 5000);
  assert.equal(p.origin.x, 0);
});
test('visual wavefront uses acoustic radius, caps at range, fades and disposes', () => {
  const p = pulse();
  const v = createWaveVisual(p);
  const camera = new THREE.PerspectiveCamera(46, 1.4, 2, 80000);
  camera.position.set(0, 10000, 10000);
  const update = t => updateWaveVisual(v, t, id => nodes.find(n => n.id === id), camera, 1000);
  update(1);
  assert.equal(v.paths.get(2).end.x, 1480);
  assert.equal(v.paths.get(4).end.x, 1480);
  assert.ok(v.paths.get(4).line.material.linewidth > v.paths.get(2).line.material.linewidth);
  for (const node of nodes) advanceRecipient(p, node, 6);
  update(6);
  assert.equal(v.paths.get(4).end.x, 8000);
  update(7.3);
  assert.equal(v.paths.get(2).line.visible, false);
  assert.equal(waveVisualFinished(v, 8), true);
  let disposed = 0;
  v.paths.get(2).line.geometry.addEventListener('dispose', () => disposed++);
  disposeWaveObject(v.group);
  assert.equal(disposed, 1);
});
