import * as THREE from 'three';

export let BASIN_RADIUS = 10000;
export function setBasinDiameter(km, nodes = []) {
  if (!Number.isFinite(km) || km < 1 || km > 100) throw new Error('水域直径请输入 1～100 km');
  const required = Math.max(0, ...nodes.map(node => Math.hypot(node.x, node.z) + 140)) * 2 / 1000;
  if (km < required) throw new Error(`现有节点需要至少 ${(Math.ceil(required * 10) / 10).toFixed(1)} km 直径；请先移动或删除边缘节点`);
  BASIN_RADIUS = km * 500;
}
export const WATER_DEPTH = 4000;
export const GRID_STEP = 1000;

const waterVert = /* glsl */ `
  uniform float uTime;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;

  vec3 gerstner(vec2 p, float steep, float lambda, float speed, vec2 dir) {
    float k = 6.28318530718 / lambda;
    float c = sqrt(9.8 / k) * speed;
    float f = k * (dot(dir, p) - c * uTime);
    float a = steep / k;
    return vec3(dir.x * a * cos(f), a * sin(f), dir.y * a * cos(f));
  }

  void main() {
    vec3 pos = position;
    vec3 d1 = gerstner(pos.xz, 0.025, 1800.0, 0.32, normalize(vec2(1.0, 0.28)));
    vec3 d2 = gerstner(pos.xz, 0.016, 1000.0, 0.48, normalize(vec2(-0.7, 1.0)));
    vec3 d3 = gerstner(pos.xz, 0.008, 600.0, 0.7, normalize(vec2(0.2, -1.0)));
    pos += d1 + d2 + d3;
    vHeight = pos.y;
    vec3 t = vec3(1.0, 0.0, 0.0) + vec3(0.0, d1.y + d2.y, 0.0);
    vec3 b = vec3(0.0, 0.0, 1.0) + vec3(0.0, d1.y + d3.y, 0.0);
    vNormalW = normalize(cross(b, t));
    vec4 world = modelMatrix * vec4(pos, 1.0);
    vWorld = world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const waterFrag = /* glsl */ `
  uniform vec3 uSun;
  uniform float uRadius;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying float vHeight;

  void main() {
    if (length(vWorld.xz) > uRadius) discard;
    vec3 n = normalize(vNormalW);
    vec3 view = normalize(cameraPosition - vWorld);
    float ndv = max(dot(n, view), 0.0);
    float fres = pow(1.0 - ndv, 5.0);
    float spec = pow(max(dot(reflect(-uSun, n), view), 0.0), 140.0);
    vec3 glass = vec3(0.88, 0.95, 0.98);
    vec3 rim = vec3(0.62, 0.82, 0.90);
    vec3 col = mix(glass, rim, fres * 0.5);
    col += vec3(1.0) * spec * 0.18;
    float alpha = 0.008 + fres * 0.035 + spec * 0.02;
    gl_FragColor = vec4(col, alpha);
  }
`;

const causticVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const causticFrag = /* glsl */ `
  uniform float uTime;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    if (length(p) > 1.0) discard;
    vec2 uv = vUv * 5.0;
    float t = uTime * 0.28;
    float c =
      sin(uv.x + sin(uv.y + t) * 1.4) *
      sin(uv.y * 1.15 - cos(uv.x * 0.65 + t * 1.1));
    float caustic = smoothstep(0.2, 0.85, 0.5 + 0.5 * c);
    vec3 sand = vec3(0.22, 0.23, 0.21);
    vec3 light = vec3(0.16, 0.28, 0.30);
    vec3 col = mix(sand, sand + light, caustic * 0.07);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function createBasin(scene) {
  const group = new THREE.Group();
  const bottomMat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: causticVert,
    fragmentShader: causticFrag,
  });
  const bottomGeo = new THREE.PlaneGeometry(BASIN_RADIUS * 2, BASIN_RADIUS * 2, 1, 1);
  bottomGeo.rotateX(-Math.PI / 2);
  const bottom = new THREE.Mesh(bottomGeo, bottomMat);
  bottom.position.y = -WATER_DEPTH;
  bottom.receiveShadow = true;

  const slope = new THREE.Mesh(
    new THREE.CylinderGeometry(BASIN_RADIUS + 120, BASIN_RADIUS + 700, 220, 80, 1, true),
    new THREE.MeshStandardMaterial({ color: 0x6a6258, roughness: 1, side: THREE.DoubleSide })
  );
  slope.position.y = -WATER_DEPTH + 80;

  const volume = new THREE.Mesh(
    new THREE.CylinderGeometry(BASIN_RADIUS, BASIN_RADIUS, WATER_DEPTH, 80, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0xcfe8f0,
      transparent: true,
      opacity: 0.012,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
  );
  volume.position.y = -WATER_DEPTH / 2;
  volume.renderOrder = 1;

  const grid = new THREE.Group();
  const gridMat = new THREE.LineBasicMaterial({ color: 0x8aa8a4, transparent: true, opacity: 0.12 });
  for (let r = BASIN_RADIUS / 10; r <= BASIN_RADIUS + 0.01; r += BASIN_RADIUS / 10) {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, -WATER_DEPTH + 0.4, Math.sin(a) * r));
    }
    grid.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), gridMat));
  }
  const axisMat = new THREE.LineBasicMaterial({ color: 0xe7b56a, transparent: true, opacity: 0.28 });
  grid.add(
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-BASIN_RADIUS, -WATER_DEPTH + 0.4, 0),
        new THREE.Vector3(BASIN_RADIUS, -WATER_DEPTH + 0.4, 0),
      ]),
      axisMat
    ),
    new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, -WATER_DEPTH + 0.4, -BASIN_RADIUS),
        new THREE.Vector3(0, -WATER_DEPTH + 0.4, BASIN_RADIUS),
      ]),
      axisMat
    )
  );

  group.add(bottom, slope, volume, grid);
  scene.add(group);
  return { group, bottomMat };
}

export function createWater() {
  const segs = 96;
  const geometry = new THREE.PlaneGeometry(BASIN_RADIUS * 2, BASIN_RADIUS * 2, segs, segs);
  geometry.rotateX(-Math.PI / 2);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uRadius: { value: BASIN_RADIUS },
      uSun: { value: new THREE.Vector3(0.45, 0.82, 0.28).normalize() },
    },
    vertexShader: waterVert,
    fragmentShader: waterFrag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return { mesh, material };
}

export function createSky() {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vPos;
      void main() {
        vec3 n = normalize(vPos);
        float h = n.y * 0.5 + 0.5;
        vec3 low = vec3(0.07, 0.16, 0.18);
        vec3 high = vec3(0.55, 0.72, 0.74);
        vec3 col = mix(low, high, pow(clamp(h, 0.0, 1.0), 1.05));
        float sun = pow(max(dot(n, normalize(vec3(0.45, 0.38, 0.28))), 0.0), 90.0);
        col += vec3(1.0, 0.9, 0.62) * sun;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  return new THREE.Mesh(new THREE.SphereGeometry(40000, 32, 16), material);
}

export function createGridLabels() {
  const group = new THREE.Group();
  const marks = Array.from({ length: 5 }, (_, i) => BASIN_RADIUS * (i + 1) / 5);
  for (const r of marks) {
    const label = r >= 1000 ? `${Number((r / 1000).toFixed(2))} km` : `${Math.round(r)} m`;
    group.add(makeSprite(label, r, 20, 0));
    group.add(makeSprite(label, 0, 20, r));
  }
  return group;
}

function makeSprite(text, x, y, z) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = 'rgba(6, 20, 24, 0.45)';
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = '#d7efe6';
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 32);
  const map = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false })
  );
  sprite.position.set(x, y, z);
  sprite.scale.set(420, 105, 1);
  return sprite;
}
