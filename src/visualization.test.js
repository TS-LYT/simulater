import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { AcousticPulse } from './acoustics.js';
import { CameraController } from './CameraController.js';
import { uuvVisualScale } from './visualizationConfig.js';

test('visual scales preserve acoustic results and retain perspective', () => {
  const node = { x: 8000, y: -80, z: 0, model: new THREE.Group() };
  const pulse = new AcousticPulse({ sourceId: 1, origin: new THREE.Vector3(-8000, -80, 0),
    payload: 'PING', maxRange: 8000, freqKhz: 12, sourceLevelDb: 200, thresholdDb: 90, startSimTime: 0 });
  const before = pulse.evaluateNode(node);
  for (const distance of [100, 1700, 16000, 38000, 100000]) {
    const scale = uuvVisualScale(distance, true);
    node.model.scale.setScalar(scale);
    assert.ok(scale >= 2.4 && scale <= 32);
    assert.deepEqual(pulse.evaluateNode(node), before);
  }
  assert.equal(before.distance, 16000);
  assert.equal(uuvVisualScale(16000), 17);
  assert.ok(uuvVisualScale(32000) < 2 * uuvVisualScale(16000));
});

test('views and link focus frame endpoints; transitions preserve physical coordinates', () => {
  const nodes = [{ x: -8000, y: -80, z: -870 }, { x: 8000, y: -1800, z: 870 }];
  const original = JSON.stringify(nodes);
  const camera = new THREE.PerspectiveCamera(46, 1.44, 2, 80000);
  camera.position.set(0, 4200, 14000);
  const controls = { target: new THREE.Vector3(), addEventListener() {}, update() {
    camera.lookAt(this.target); camera.updateMatrixWorld();
  } };
  const controller = new CameraController(camera, controls, () => nodes, () => nodes);
  for (const method of ['setTopView', 'setSideView', 'setPerspectiveView', 'fitAllNodes', 'focusLink']) {
    controller[method](); controller.update(0.5);
    for (const node of nodes) {
      const p = new THREE.Vector3(node.x, node.y, node.z).project(camera);
      assert.ok(Math.abs(p.x) < 0.7 && Math.abs(p.y) < 0.7, `${method}: ${p.toArray()}`);
    }
  }
  controller.focusNode(nodes[0]); controller.update(0.5);
  assert.equal(camera.position.distanceTo(controls.target).toFixed(0), '1700');
  assert.deepEqual(controls.target.toArray(), [-8000, -80, -870]);
  assert.equal(JSON.stringify(nodes), original);
});
