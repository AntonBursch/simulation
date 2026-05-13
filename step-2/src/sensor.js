import * as THREE from 'three';

/**
 * Nasal smell sensor for the bot.
 *
 * Conceptually a single scalar: concentration at the bot's nose.
 * We approximate it by summing contributions from every live particle
 * within `radius`, weighted by a soft kernel (1 - r²/R²)² and the
 * particle's age-fade intensity. That gives a smooth, finite reading
 * that grows continuously as the bot enters a plume.
 *
 * For step 3 we also expose a *gradient estimate*: we sample the field
 * at the nose AND at four "antenna" points slightly offset around the
 * nose. The dominant offset direction (after subtracting the central
 * value) becomes the inferred "smell direction." This is the cheapest
 * possible bidirectional sensor — fine for a "point toward smell" demo,
 * and easy to replace later with a more biological model.
 *
 * Truth-mode reading (single color) treats all particles equally.
 * Dev-mode reading is identical numerically — the colors are only for
 * the human watching.
 */

const _delta = new THREE.Vector3();
const _samplePts = [
  // central + 6 axial offsets in bot-local frame (will be rotated by heading)
  new THREE.Vector3( 0,  0,  0),
  new THREE.Vector3(+1,  0,  0),
  new THREE.Vector3(-1,  0,  0),
  new THREE.Vector3( 0, +1,  0),
  new THREE.Vector3( 0, -1,  0),
  new THREE.Vector3( 0,  0, +1),
  new THREE.Vector3( 0,  0, -1),
];
const _worldSample = new THREE.Vector3();
const _accumDir = new THREE.Vector3();

export function createSensor({
  radius = 18.0,     // sample sphere radius in world units
  antennaOffset = 2.0, // how far the gradient probes sit from the nose
  noise = 0.0,       // additive Gaussian noise std (off for v1; reactive will use)
} = {}) {
  return { radius, antennaOffset, noise };
}

/**
 * Compute concentration at a single world-space point.
 * O(N) over live particles. With ~4500 capacity and a few sample points
 * per tick this is negligible.
 */
function concentrationAt(point, particlesState, radius) {
  const ages = particlesState._ages;
  const lifes = particlesState._lifes;
  const pos = particlesState.points.geometry.attributes.position.array;
  const r2 = radius * radius;
  let sum = 0;
  for (let i = 0; i < particlesState.capacity; i++) {
    const a = ages[i];
    if (a < 0) continue;
    const dx = pos[i * 3 + 0] - point.x;
    const dy = pos[i * 3 + 1] - point.y;
    const dz = pos[i * 3 + 2] - point.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= r2) continue;
    // Smooth compact kernel (1 - d²/R²)²
    const t = 1 - d2 / r2;
    // Match the per-particle age intensity used for rendering so the
    // sensor agrees with what the human sees.
    const u = a / lifes[i];
    const intensity = u < 0.15 ? (u / 0.15) : (1 - (u - 0.15) / 0.85);
    sum += t * t * intensity;
  }
  return sum;
}

/**
 * Sample the sensor: returns
 *   {
 *     concentration: scalar at nose
 *     direction: THREE.Vector3 unit vector toward inferred smell source,
 *                or null if the field is effectively flat
 *     confidence: 0..1 (how strong the gradient was vs noise floor)
 *   }
 */
export function readSensor(bot, sensor, particlesState) {
  const noseC = concentrationAt(bot.nose, particlesState, sensor.radius);

  // Probe 6 axial offsets around the nose to estimate a gradient.
  // Offsets are in world space (axis-aligned is fine — direction is what we want).
  _accumDir.set(0, 0, 0);
  let total = 0;
  for (let i = 1; i < _samplePts.length; i++) {
    const o = _samplePts[i];
    _worldSample.set(
      bot.nose.x + o.x * sensor.antennaOffset,
      bot.nose.y + o.y * sensor.antennaOffset,
      bot.nose.z + o.z * sensor.antennaOffset,
    );
    const c = concentrationAt(_worldSample, particlesState, sensor.radius);
    const delta = c - noseC;
    // Walk uphill: weight each offset direction by how much *higher* it reads.
    if (delta > 0) {
      _accumDir.addScaledVector(o, delta);
      total += delta;
    }
  }

  let direction = null;
  let confidence = 0;
  if (total > 1e-6 && _accumDir.lengthSq() > 1e-12) {
    const len = _accumDir.length();
    direction = _accumDir.clone().multiplyScalar(1 / len);
    // Confidence: gradient magnitude relative to nose reading + epsilon.
    confidence = Math.min(1, len / (noseC + len + 1e-6));
  }

  return { concentration: noseC, direction, confidence };
}
