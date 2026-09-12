import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { visualizationConfig } from './visualizationConfig.js';

const config = visualizationConfig.propagation;
const up = new THREE.Vector3(0, 1, 0);

export function disposeWaveObject(object) {
  object.removeFromParent();
  object.traverse(child => {
    child.geometry?.dispose();
    if (Array.isArray(child.material)) child.material.forEach(material => material.dispose());
    else child.material?.dispose();
  });
}

export function createWaveVisual(pulse) {
  const group = new THREE.Group();
  group.position.copy(pulse.origin);
  const rings = Array.from({ length: 3 }, () => new THREE.Mesh(
    new THREE.TorusGeometry(1, 0.0042, 8, 192),
    new THREE.MeshBasicMaterial({ color: 0xe7b4ae, transparent: true, opacity: 0.08, depthWrite: false })));
  rings[0].rotation.x = Math.PI / 2;
  rings[2].rotation.y = Math.PI / 2;
  rings.forEach(ring => { ring.visible = false; group.add(ring); });
  const paths = new Map();
  for (const id of pulse.recipientIds) {
    const target = pulse.targetId === id;
    const color = target ? config.targetColor : config.otherColor;
    const opacity = target || pulse.sendMode === 'broadcast' ? 0.95 : 0.48;
    const geometry = new LineGeometry();
    geometry.setPositions([0, 0, 0, 0, 0, 1]);
    const material = new LineMaterial({ color, linewidth: target ? config.targetWidth
      : pulse.sendMode === 'broadcast' ? config.broadcastWidth : config.otherWidth,
    dashed: true, dashSize: config.dashSize, gapSize: config.gapSize,
    transparent: true, opacity, depthTest: false, depthWrite: false });
    const line = new Line2(geometry, material);
    line.computeLineDistances();
    line.renderOrder = target ? 24 : 22;
    line.frustumCulled = false;
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false }));
    arrow.renderOrder = target ? 25 : 23;
    group.add(line, arrow);
    paths.set(id, { line, arrow, opacity, direction: new THREE.Vector3(), end: new THREE.Vector3() });
  }
  return { pulse, group, rings, paths };
}

export function updateWaveVisual(visual, simTime, getNode, camera, height) {
  const { pulse } = visual;
  const radius = pulse.radius(simTime);
  for (const ring of visual.rings) {
    ring.scale.setScalar(Math.max(radius, 0.001));
    ring.material.opacity = 0.04 + 0.05 * (1 - radius / pulse.maxRange);
  }
  for (const [id, path] of visual.paths) {
    const node = getNode(id);
    if (!node || node.online === false) {
      disposeWaveObject(path.line); disposeWaveObject(path.arrow);
      visual.paths.delete(id);
      continue;
    }
    const hit = pulse.hits.get(id);
    const pos = hit?.position || node;
    path.direction.set(pos.x, pos.y, pos.z).sub(pulse.origin);
    const distance = path.direction.length();
    path.direction.normalize();
    const along = Math.min(radius, hit ? hit.distance : distance, pulse.maxRange);
    path.end.copy(path.direction).multiplyScalar(along);
    const end = path.line.geometry.attributes.instanceEnd;
    end.setXYZ(0, path.end.x, path.end.y, path.end.z);
    end.data.needsUpdate = true;
    const distances = path.line.geometry.attributes.instanceDistanceEnd;
    distances.setX(0, along); distances.data.needsUpdate = true;
    const fade = hit ? 1 - THREE.MathUtils.clamp((simTime - (hit.completedAt ?? hit.arrivedAt) - config.hold) / config.fade, 0, 1) : 1;
    path.line.visible = path.arrow.visible = along > 0 && fade > 0;
    path.line.material.opacity = path.arrow.material.opacity = path.opacity * fade;
    if (hit && !hit.success) {
      path.line.material.color.setHex(config.failureColor);
      path.arrow.material.color.setHex(config.failureColor);
    }
    const metresPerPixel = camera.position.distanceTo(pulse.origin) * 2
      * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.max(height, 1);
    const length = Math.min(along, metresPerPixel * 10);
    path.arrow.quaternion.setFromUnitVectors(up, path.direction.lengthSq() ? path.direction : up);
    path.arrow.scale.set(metresPerPixel * 3, length, metresPerPixel * 3);
    path.arrow.position.copy(path.end).addScaledVector(path.direction, -length / 2);
  }
}

export function waveVisualFinished(visual, simTime) {
  return visual.pulse.finished(simTime) && [...visual.paths.keys()].every(id => {
    const hit = visual.pulse.hits.get(id);
    return hit && simTime >= (hit.completedAt ?? hit.arrivedAt) + config.hold + config.fade;
  });
}
