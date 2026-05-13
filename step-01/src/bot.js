import * as THREE from 'three';

/**
 * The nanobot's physical body. Stateful: position, velocity, heading.
 * Visually: a small cone whose tip is the "nose" (sensor location, +Z in
 * local space). A faint ring around the body gives it a sense of scale
 * and makes the orientation legible from any angle.
 *
 * For step 2 the bot has no sensor and no behavior — it just exists in
 * the world, oriented, awaiting wiring.
 */
export function buildBot({
  size = 300,
  spawn = new THREE.Vector3(0, 0, 0),
  heading = new THREE.Vector3(1, 0, 0),
  bodyLength = 4.0,
  bodyRadius = 1.2,
  color = 0x6ad6ff,
} = {}) {
  const group = new THREE.Group();
  group.name = 'bot';

  // Cone built along +Z so we can aim it with quaternion.lookAt-style math.
  // three.js cones default to +Y up, so rotate the geometry once.
  const coneGeom = new THREE.ConeGeometry(bodyRadius, bodyLength, 16);
  coneGeom.rotateX(Math.PI / 2); // tip now points +Z
  coneGeom.translate(0, 0, bodyLength / 2); // base at origin, tip forward

  const bodyMat = new THREE.MeshBasicMaterial({ color });
  const body = new THREE.Mesh(coneGeom, bodyMat);
  group.add(body);

  // Equatorial ring for orientation legibility (lies in XY plane locally).
  const ringGeom = new THREE.TorusGeometry(bodyRadius * 1.4, bodyRadius * 0.12, 8, 32);
  const ringMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.55,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.position.z = bodyLength * 0.15;
  group.add(ring);

  // Faint trailing halo so it reads at distance.
  const haloGeom = new THREE.SphereGeometry(bodyRadius * 2.2, 16, 12);
  const haloMat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.10,
    depthWrite: false,
  });
  const halo = new THREE.Mesh(haloGeom, haloMat);
  group.add(halo);

  group.position.copy(spawn);

  const state = {
    group,
    position: group.position,        // alias
    velocity: new THREE.Vector3(0, 0, 0),
    heading: new THREE.Vector3().copy(heading).normalize(),
    // Nose offset in world space, derived from heading.
    nose: new THREE.Vector3().copy(spawn).addScaledVector(heading, bodyLength),
    bodyLength,
    bodyRadius,
  };

  applyHeading(state);
  return state;
}

/**
 * Orient the bot mesh to point along `state.heading`. Also updates the
 * cached world-space nose position.
 */
const _up = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _from = new THREE.Vector3(0, 0, 1);
export function applyHeading(state) {
  state.heading.normalize();
  _q.setFromUnitVectors(_from, state.heading);
  state.group.quaternion.copy(_q);
  state.nose.copy(state.position).addScaledVector(state.heading, state.bodyLength);
}

/**
 * Advect the bot by the local current, with light drag and elastic wall
 * bounce — same scheme used for sources, but the bot's `heading` is kept
 * pointing wherever its controller set it (not derived from velocity).
 */
const _flow = new THREE.Vector3();
export function updateBotDrift(state, sampleFlow, dt, t, size, opts = {}) {
  const drag = opts.drag ?? 0.5;
  const coupling = opts.coupling ?? 1.6;
  const restitution = opts.restitution ?? 0.9;
  const half = size / 2;

  sampleFlow(_flow, state.position.x, state.position.y, state.position.z, t);
  const v = state.velocity;
  v.x += (_flow.x - v.x) * coupling * dt - v.x * drag * dt;
  v.y += (_flow.y - v.y) * coupling * dt - v.y * drag * dt;
  v.z += (_flow.z - v.z) * coupling * dt - v.z * drag * dt;

  const p = state.position;
  p.x += v.x * dt;
  p.y += v.y * dt;
  p.z += v.z * dt;

  if (p.x >  half) { p.x =  half; if (v.x > 0) v.x = -v.x * restitution; }
  if (p.x < -half) { p.x = -half; if (v.x < 0) v.x = -v.x * restitution; }
  if (p.y >  half) { p.y =  half; if (v.y > 0) v.y = -v.y * restitution; }
  if (p.y < -half) { p.y = -half; if (v.y < 0) v.y = -v.y * restitution; }
  if (p.z >  half) { p.z =  half; if (v.z > 0) v.z = -v.z * restitution; }
  if (p.z < -half) { p.z = -half; if (v.z < 0) v.z = -v.z * restitution; }

  applyHeading(state); // keep nose cache fresh after the move
}

/**
 * Smoothly slew the bot's heading toward `target` (unit vector) at a
 * given max angular rate (radians/sec). Pass null to do nothing.
 */
const _axis = new THREE.Vector3();
const _slerpQ = new THREE.Quaternion();
const _curQ = new THREE.Quaternion();
const _tgtQ = new THREE.Quaternion();
export function steerHeading(state, target, dt, turnRate = 2.5) {
  if (!target) return;
  // Build target quaternion that points +Z along `target`.
  _tgtQ.setFromUnitVectors(_from, target);
  _curQ.setFromUnitVectors(_from, state.heading);
  // Angle between the two
  const dot = Math.min(1, Math.max(-1, _curQ.dot(_tgtQ)));
  const angle = 2 * Math.acos(Math.abs(dot));
  if (angle < 1e-4) return;
  const maxStep = turnRate * dt;
  const t = Math.min(1, maxStep / angle);
  _slerpQ.copy(_curQ).slerp(_tgtQ, t);
  // Extract new heading by rotating +Z by slerpQ.
  state.heading.copy(_from).applyQuaternion(_slerpQ).normalize();
  applyHeading(state);
}
