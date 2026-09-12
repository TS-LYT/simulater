import * as THREE from 'three';
import { visualizationConfig } from './visualizationConfig.js';

const config = visualizationConfig.camera;
const position = node => new THREE.Vector3(node.x, node.y, node.z);

export class CameraController {
  constructor(camera, controls, getNodes, getLink) {
    Object.assign(this, { camera, controls, getNodes, getLink });
    controls.enableDamping = true;
    controls.dampingFactor = config.dampingFactor;
    controls.minDistance = config.minDistance;
    controls.maxDistance = config.maxDistance;
    controls.minPolarAngle = THREE.MathUtils.degToRad(2);
    controls.maxPolarAngle = THREE.MathUtils.degToRad(85);
    controls.rotateSpeed = 0.65;
    controls.panSpeed = 0.7;
    controls.addEventListener('start', () => { this.transition = null; });
  }

  direction(elevation = config.elevation, azimuth = config.azimuth) {
    const e = THREE.MathUtils.degToRad(elevation);
    const a = THREE.MathUtils.degToRad(azimuth);
    return new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
  }

  frame(nodes, direction, immediate = false, preferLink = false) {
    if (!nodes.length) return;
    const points = nodes.map(position);
    const center = new THREE.Box3().setFromPoints(points).getCenter(new THREE.Vector3());
    const link = this.getLink();
    if (preferLink && link.length === 2) center.copy(position(link[0])).lerp(position(link[1]), 0.5);
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
    const up = new THREE.Vector3().crossVectors(direction, right).normalize();
    // Keep endpoints and visual hulls inside the central area between the UI panels.
    const tanY = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 0.62;
    const tanX = tanY * this.camera.aspect * 0.62;
    let distance = config.focusDistance;
    for (const point of points) {
      const delta = point.clone().sub(center);
      distance = Math.max(distance, delta.dot(direction) + Math.max(
        (Math.abs(delta.dot(right)) + 650) / tanX,
        (Math.abs(delta.dot(up)) + 650) / tanY));
    }
    this.move(center, direction, distance, immediate);
  }

  move(target, direction, distance, immediate = false) {
    const end = target.clone().addScaledVector(direction, THREE.MathUtils.clamp(distance, config.minDistance, this.controls.maxDistance));
    // Clear residual OrbitControls damping before starting a scripted move.
    this.controls.enableDamping = false;
    this.controls.update();
    this.controls.enableDamping = true;
    this.transition = { elapsed: 0, from: this.camera.position.clone(), targetFrom: this.controls.target.clone(), end, target };
    if (immediate) this.update(config.duration);
  }

  setTopView() { this.frame(this.getNodes(), this.direction(88, 0)); }
  setSideView() { this.frame(this.getNodes(), this.direction(config.sideElevation, 0)); }
  setPerspectiveView() { this.frame(this.getNodes(), this.direction(), false, true); }
  fitAllNodes() { this.frame(this.getNodes(), this.direction()); }
  resetView(immediate = false) { this.frame(this.getNodes(), this.direction(), immediate, true); }
  focusNode(node) { if (node) this.move(position(node), this.direction(), config.focusDistance); }
  focusLink() {
    const nodes = this.getLink();
    if (nodes.length !== 2) return false;
    const delta = position(nodes[1]).sub(position(nodes[0]));
    // Observe across the link, with a slight diagonal, never along its axis.
    const azimuth = THREE.MathUtils.radToDeg(Math.atan2(delta.x, delta.z)) + 70;
    this.frame(nodes, this.direction(config.elevation, azimuth));
    return true;
  }
  update(dt) {
    const t = this.transition;
    if (t) {
      t.elapsed += dt;
      const u = Math.min(1, t.elapsed / config.duration);
      const s = u * u * (3 - 2 * u);
      this.camera.position.lerpVectors(t.from, t.end, s);
      this.controls.target.lerpVectors(t.targetFrom, t.target, s);
      if (u === 1) this.transition = null;
    }
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.controls.zoomSpeed = THREE.MathUtils.lerp(0.35, 0.95, THREE.MathUtils.clamp(distance / 24000, 0, 1));
    this.controls.update();
  }
}
