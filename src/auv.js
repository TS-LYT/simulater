import * as THREE from 'three';

export function createAuv(bodyMat) {
  const model = new THREE.Group();
  const accent = new THREE.MeshStandardMaterial({
    color: 0x3d4a52,
    metalness: 0.45,
    roughness: 0.4,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x15191c,
    metalness: 0.55,
    roughness: 0.35,
  });
  const stripe = new THREE.MeshStandardMaterial({
    color: 0xc9a15a,
    metalness: 0.5,
    roughness: 0.4,
  });

  const hull = new THREE.Mesh(new THREE.CylinderGeometry(5.4, 5.4, 34, 28), bodyMat);
  hull.rotation.x = Math.PI / 2;

  const nose = new THREE.Mesh(new THREE.SphereGeometry(5.4, 24, 16), bodyMat);
  nose.position.z = 17;
  nose.scale.z = 1.45;

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 5.4, 10, 24), bodyMat);
  tail.rotation.x = Math.PI / 2;
  tail.position.z = -22;

  const band = new THREE.Mesh(new THREE.TorusGeometry(5.55, 0.28, 8, 28), stripe);
  band.position.z = 6;

  const sail = new THREE.Mesh(new THREE.BoxGeometry(3.2, 4.8, 9), accent);
  sail.position.set(0, 6.2, 5);
  const window = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.4, 2.6), dark);
  window.position.set(0, 7.4, 7.2);

  const sensor = new THREE.Mesh(new THREE.SphereGeometry(1.5, 14, 12), stripe);
  sensor.position.z = 24.2;

  const fins = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.45, 6.5, 7.5), accent);
    fin.position.set(0, 4.6, -18);
    fin.rotation.x = 0.18;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI) / 2;
    pivot.add(fin);
    fins.add(pivot);
  }

  const propeller = new THREE.Group();
  propeller.position.z = -27.4;
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 1.8, 12), dark);
  hub.rotation.x = Math.PI / 2;
  propeller.add(hub);
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.3, 8.2, 0.35), dark);
    blade.position.y = 3.6;
    blade.rotation.x = 0.35;
    const pivot = new THREE.Group();
    pivot.rotation.z = (i * Math.PI * 2) / 3;
    pivot.add(blade);
    propeller.add(pivot);
  }

  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(16, 20, 16),
    new THREE.MeshBasicMaterial({
      color: 0x7ee7d0,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );

  model.add(hull, nose, tail, band, sail, window, sensor, fins, propeller, glow);
  model.userData = { glow, propeller };
  return model;
}
