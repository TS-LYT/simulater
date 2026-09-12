import { MathUtils } from 'three';

// Renderer-only units. Never use these values in acoustics, motion or coverage.
export const visualizationConfig = Object.freeze({
  uuvScale: 17,
  selectedUuvScale: 1.2,
  minUuvVisualScale: 2.4,
  maxUuvVisualScale: 32,
  referenceDistance: 16000,
  distanceExponent: 0.65,
  scaleSmoothing: 10,
  labelHeight: 19,
  propagation: Object.freeze({ targetColor: 0xffcb70, otherColor: 0x66d9d1,
    failureColor: 0xe27a66, targetWidth: 3, otherWidth: 1.5, broadcastWidth: 2.2,
    dashSize: 180, gapSize: 100, hold: 0.8, fade: 0.4 }),
  camera: Object.freeze({
    elevation: 42, azimuth: 38, sideElevation: 10,
    minDistance: 650, maxDistance: 38000, focusDistance: 1700,
    duration: 0.45, dampingFactor: 0.08,
  }),
});

export function uuvVisualScale(distance, selected = false) {
  const c = visualizationConfig;
  return MathUtils.clamp(c.uuvScale * (Math.max(distance, 1) / c.referenceDistance) ** c.distanceExponent
    * (selected ? c.selectedUuvScale : 1), c.minUuvVisualScale, c.maxUuvVisualScale);
}
