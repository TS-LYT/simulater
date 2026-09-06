import * as THREE from 'three';

function paleRed(opacity) {
  return new THREE.MeshBasicMaterial({
    color: '#e7b4ae',
    transparent: true,
    opacity,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
}

function makeTorus() {
  return new THREE.Mesh(new THREE.TorusGeometry(1, 0.0042, 8, 192), paleRed(0.12));
}

export function createWaveVisual(pulse, dest) {
  const group = new THREE.Group();
  group.position.copy(pulse.origin);

  const equator = makeTorus();
  equator.rotation.x = Math.PI / 2;
  const meridianA = makeTorus();
  const meridianB = makeTorus();
  meridianB.rotation.y = Math.PI / 2;

  const band = new THREE.Mesh(new THREE.RingGeometry(0.993, 1.0, 160), paleRed(0.1));
  band.rotation.x = -Math.PI / 2;

  const target = dest ? dest.clone() : pulse.origin.clone();
  const offset = target.clone().sub(pulse.origin);
  const dist = Math.max(offset.length(), 1);
  const dir = offset.clone().normalize();

  const pathLine = new THREE.Mesh(
    new THREE.CylinderGeometry(3.4, 3.4, 1, 10),
    new THREE.MeshBasicMaterial({
      color: '#f0c6bf',
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
    })
  );
  pathLine.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  pathLine.scale.y = 0.01;

  const packet = new THREE.Mesh(new THREE.SphereGeometry(12, 14, 14), paleRed(0.22));

  group.add(equator, meridianA, meridianB, band, pathLine, packet);
  return {
    pulse,
    group,
    rings: [equator, meridianA, meridianB],
    band,
    packet,
    pathLine,
    offset,
    dist,
    dir,
  };
}

export function updateWaveVisual(visual, simTime) {
  const pulse = visual.pulse;
  const r = Math.max(pulse.radius(simTime), 0.8);
  const fade = 1 - r / pulse.maxRange;
  const energy = 0.45 + 0.55 * fade;

  for (const ring of visual.rings) {
    ring.scale.setScalar(r);
    ring.material.opacity = 0.045 + 0.07 * energy;
  }
  visual.band.scale.set(r, r, r);
  visual.band.material.opacity = 0.04 + 0.06 * energy;

  const along = Math.min(r, visual.dist);
  visual.pathLine.scale.y = Math.max(along, 0.01);
  visual.pathLine.position.copy(visual.dir).multiplyScalar(along * 0.5);
  visual.packet.position.copy(visual.dir).multiplyScalar(along);
  visual.packet.material.opacity = r >= visual.dist ? 0.06 : 0.2;
  visual.packet.scale.setScalar(r >= visual.dist ? 0.3 : 1 + 0.08 * Math.sin(simTime * 18));
}
