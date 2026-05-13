import * as THREE from 'three';

/**
 * Continuously-emitted massless tracer particles. They follow the local
 * flow exactly (with a small diffusion jitter), age, and fade. Each
 * particle remembers which source emitted it so we can color by source
 * in dev mode.
 *
 * Two color modes:
 *   - 'truth' : single color (what a one-scalar smell sensor "sees")
 *   - 'dev'   : per-source hue (what the simulator knows)
 */
export function buildParticles({
  sources,
  size = 300,
  perSourcePerSec = 20,
  lifetimeSec = 15,
  diffusion = 1.8,   // sqrt of variance per second
  pointSize = 5.0,
  truthColor = new THREE.Color(0xff8a3d),
} = {}) {
  const capacity = Math.ceil(sources.length * perSourcePerSec * lifetimeSec * 1.25);

  const positions = new Float32Array(capacity * 3);
  const colors    = new Float32Array(capacity * 3);
  const ages      = new Float32Array(capacity); // seconds alive; -1 = dead
  const lifes     = new Float32Array(capacity); // total allotted lifetime
  const srcIds    = new Int16Array(capacity);

  // Per-source hue palette for dev mode (evenly spaced HSL).
  const devColors = sources.map((_, i) => {
    const c = new THREE.Color();
    c.setHSL(i / sources.length, 0.7, 0.6);
    return c;
  });

  for (let i = 0; i < capacity; i++) ages[i] = -1;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geom.setAttribute('color',    new THREE.BufferAttribute(colors,    3).setUsage(THREE.DynamicDrawUsage));
  geom.setDrawRange(0, 0); // updated each frame

  const mat = new THREE.PointsMaterial({
    size: pointSize,
    vertexColors: true,
    transparent: true,
    opacity: 1.0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
    map: makeSoftSprite(),
  });

  const points = new THREE.Points(geom, mat);
  points.name = 'particles';
  points.frustumCulled = false;

  const state = {
    points,
    capacity,
    cursor: 0,             // ring-buffer write head
    live: 0,               // count of live particles
    emitAccum: sources.map(() => 0),
    perSourcePerSec,
    lifetimeSec,
    diffusion,
    sources,
    devColors,
    truthColor,
    mode: 'truth',         // 'truth' | 'dev'
  };

  return state;
}

export function setParticleMode(state, mode) {
  if (mode !== 'truth' && mode !== 'dev') return;
  state.mode = mode;
  // Next updateParticles() call will repaint all live particles using
  // the new mode. Dead slots are already zeroed; nothing else to do.
}

/**
 * Advance particles one fixed step.
 *
 *  - emit new particles from each source at rate `perSourcePerSec`
 *  - advect every live particle by sampleFlow(p, t)
 *  - add Brownian jitter with std = diffusion * sqrt(dt)
 *  - age each particle; recycle when age > lifetime
 *  - soft wall confinement: zero outward normal velocity at the boundary
 *  - update per-particle color alpha-curve via vertex color scaling
 */
const _tmp = new THREE.Vector3();
export function updateParticles(state, sampleFlow, dt, t, size) {
  const geom = state.points.geometry;
  const pos = geom.attributes.position.array;
  const col = geom.attributes.color.array;

  if (!state._ages) {
    // Lazily bind typed arrays we created in build to state, with stable names.
    // (Kept on state so update can see them across calls.)
  }
  // We stored these on local closures originally; re-pull from geom buffers
  // is fine, but we need ages/lifes/srcIds — keep them on state.
  // Initialize on first call:
  if (!state._ages) {
    state._ages = new Float32Array(state.capacity);
    state._lifes = new Float32Array(state.capacity);
    state._srcIds = new Int16Array(state.capacity);
    for (let i = 0; i < state.capacity; i++) state._ages[i] = -1;
  }
  const ages = state._ages;
  const lifes = state._lifes;
  const srcIds = state._srcIds;

  const half = size / 2;
  const sigma = state.diffusion * Math.sqrt(dt);
  const wallSoft = size * 0.04; // soft band near walls where normal flow is damped

  // --- emit -------------------------------------------------------------
  for (let s = 0; s < state.sources.length; s++) {
    state.emitAccum[s] += state.perSourcePerSec * dt;
    const src = state.sources[s];
    while (state.emitAccum[s] >= 1) {
      state.emitAccum[s] -= 1;
      const idx = state.cursor;
      state.cursor = (state.cursor + 1) % state.capacity;
      // initialize particle at the source position with tiny offset
      const ox = (Math.random() - 0.5) * 0.4;
      const oy = (Math.random() - 0.5) * 0.4;
      const oz = (Math.random() - 0.5) * 0.4;
      pos[idx * 3 + 0] = src.node.position.x + ox;
      pos[idx * 3 + 1] = src.node.position.y + oy;
      pos[idx * 3 + 2] = src.node.position.z + oz;
      ages[idx] = 0;
      lifes[idx] = state.lifetimeSec * (0.8 + Math.random() * 0.4);
      srcIds[idx] = s;
      const c = state.mode === 'dev' ? state.devColors[s] : state.truthColor;
      col[idx * 3 + 0] = c.r;
      col[idx * 3 + 1] = c.g;
      col[idx * 3 + 2] = c.b;
    }
  }

  // --- advect + age -----------------------------------------------------
  let live = 0;
  let maxIdx = 0;
  for (let i = 0; i < state.capacity; i++) {
    if (ages[i] < 0) continue;
    const a = (ages[i] += dt);
    if (a > lifes[i]) {
      ages[i] = -1;
      // zero color so the dead slot disappears in additive blending
      col[i * 3 + 0] = 0;
      col[i * 3 + 1] = 0;
      col[i * 3 + 2] = 0;
      continue;
    }

    const x = pos[i * 3 + 0];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    sampleFlow(_tmp, x, y, z, t);

    // Soft wall confinement: damp the component pointing outward when
    // close to a wall, scaled linearly within `wallSoft`.
    if (x >  half - wallSoft && _tmp.x > 0) _tmp.x *= Math.max(0, (half - x) / wallSoft);
    if (x < -half + wallSoft && _tmp.x < 0) _tmp.x *= Math.max(0, (x + half) / wallSoft);
    if (y >  half - wallSoft && _tmp.y > 0) _tmp.y *= Math.max(0, (half - y) / wallSoft);
    if (y < -half + wallSoft && _tmp.y < 0) _tmp.y *= Math.max(0, (y + half) / wallSoft);
    if (z >  half - wallSoft && _tmp.z > 0) _tmp.z *= Math.max(0, (half - z) / wallSoft);
    if (z < -half + wallSoft && _tmp.z < 0) _tmp.z *= Math.max(0, (z + half) / wallSoft);

    // Brownian jitter (Box-Muller-ish, cheap approximation via 2 uniforms)
    const jx = sigma * (Math.random() + Math.random() + Math.random() - 1.5) * 1.1547;
    const jy = sigma * (Math.random() + Math.random() + Math.random() - 1.5) * 1.1547;
    const jz = sigma * (Math.random() + Math.random() + Math.random() - 1.5) * 1.1547;

    let nx = x + _tmp.x * dt + jx;
    let ny = y + _tmp.y * dt + jy;
    let nz = z + _tmp.z * dt + jz;

    // Hard clamp at boundary just in case.
    if (nx >  half) nx =  half;
    if (nx < -half) nx = -half;
    if (ny >  half) ny =  half;
    if (ny < -half) ny = -half;
    if (nz >  half) nz =  half;
    if (nz < -half) nz = -half;

    pos[i * 3 + 0] = nx;
    pos[i * 3 + 1] = ny;
    pos[i * 3 + 2] = nz;

    // Age-based intensity scaling on color (additive blend → brightness = concentration)
    // Triangular curve: ramp up briefly, then fade.
    const u = a / lifes[i];
    const intensity = u < 0.15 ? (u / 0.15) : (1 - (u - 0.15) / 0.85);
    const baseC = state.mode === 'dev'
      ? state.devColors[srcIds[i]]
      : state.truthColor;
    col[i * 3 + 0] = baseC.r * intensity;
    col[i * 3 + 1] = baseC.g * intensity;
    col[i * 3 + 2] = baseC.b * intensity;

    live++;
    if (i > maxIdx) maxIdx = i;
  }
  state.live = live;

  geom.setDrawRange(0, maxIdx + 1);
  geom.attributes.position.needsUpdate = true;
  geom.attributes.color.needsUpdate = true;
}

function makeSoftSprite() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
  g.addColorStop(0.0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1.0, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
