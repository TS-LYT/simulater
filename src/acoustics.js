import * as THREE from 'three';

export const SOUND_SPEED = 1480;

export function timeOfFlight(distance, soundSpeed = SOUND_SPEED) {
  return distance / soundSpeed;
}

export function thorpAbsorptionDbPerKm(freqKhz) {
  const f2 = freqKhz * freqKhz;
  return (
    (0.11 * f2) / (1 + f2) +
    (44 * f2) / (4100 + f2) +
    2.75e-4 * f2 +
    0.003
  );
}

export function sphericalSpreadingDb(distance) {
  return 20 * Math.log10(Math.max(distance, 1));
}

export function receivedLevelDb({ distance, sourceLevelDb, freqKhz }) {
  const spreading = sphericalSpreadingDb(distance);
  const absorption = thorpAbsorptionDbPerKm(freqKhz) * (distance / 1000);
  return {
    receivedLevel: sourceLevelDb - spreading - absorption,
    spreading,
    absorption,
  };
}

let pulseSeq = 1;

export class AcousticPulse {
  constructor({
    sourceId,
    origin,
    payload,
    maxRange,
    freqKhz,
    sourceLevelDb,
    thresholdDb,
    startSimTime,
    baudRate = 24,
  }) {
    this.id = pulseSeq++;
    this.sourceId = sourceId;
    this.origin = origin.clone();
    this.payload = payload;
    this.maxRange = maxRange;
    this.freqKhz = freqKhz;
    this.sourceLevelDb = sourceLevelDb;
    this.thresholdDb = thresholdDb;
    this.startSimTime = startSimTime;
    this.baudRate = baudRate;
    this.packetDuration = Math.max(payload.length, 1) / baudRate;
    this.hits = new Map();
  }

  travelTime(simTime) {
    return Math.max(0, simTime - this.startSimTime);
  }

  radius(simTime) {
    return Math.min(SOUND_SPEED * this.travelTime(simTime), this.maxRange);
  }

  finished(simTime) {
    return this.travelTime(simTime) > this.maxRange / SOUND_SPEED + this.packetDuration + 0.8;
  }

  evaluateNode(node) {
    const dx = node.x - this.origin.x;
    const dy = node.y - this.origin.y;
    const dz = node.z - this.origin.z;
    const distance = Math.hypot(dx, dy, dz);
    const tof = timeOfFlight(distance);
    const levels = receivedLevelDb({
      distance,
      sourceLevelDb: this.sourceLevelDb,
      freqKhz: this.freqKhz,
    });
    const inRange = distance <= this.maxRange + 1e-4;
    const detectable = levels.receivedLevel >= this.thresholdDb;
    return {
      distance,
      tof,
      inRange,
      detectable,
      success: inRange && detectable,
      ...levels,
    };
  }
}

export function waveformSample(pulse, hit, simTime) {
  if (!hit) return 0;
  const local = simTime - (pulse.startSimTime + hit.tof);
  if (local < 0 || local > pulse.packetDuration) return 0;
  const env = Math.sin(Math.PI * (local / pulse.packetDuration)) ** 1.2;
  const amp = THREE.MathUtils.clamp((hit.receivedLevel - 80) / 60, 0.12, 1);
  const visualFreq = 7 + pulse.freqKhz * 0.08;
  return amp * env * Math.sin(2 * Math.PI * visualFreq * local);
}

export function decodedPrefix(pulse, hit, simTime) {
  if (!hit?.success) return '';
  const local = simTime - (pulse.startSimTime + hit.tof);
  const chars = Math.floor(Math.max(0, local) * pulse.baudRate);
  return pulse.payload.slice(0, Math.min(pulse.payload.length, chars + 1));
}
