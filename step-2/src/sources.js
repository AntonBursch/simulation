import * as THREE from 'three';

/**
 * Deterministic scattered point sources inside the bounded volume.
 * Each source is a small Object3D container (core sphere + faint halo)
 * with an attached `velocity` Vector3 so it can be advected by currents
 * and bounced off the walls.
 *
 * Placement uses a tiny seeded LCG so the layout is identical across
 * reloads.
 */
export function buildSources({
  size = 100,
  count = 12,
  margin = 8,
  seed = 1337,
  radius = 1.2,
} = {}) {
  const group = new THREE.Group();
  group.name = 'sources';

  const rng = makeLCG(seed);
  const half = size / 2 - margin;

  // Shared geometry/materials to keep cost trivial.
  const coreGeom = new THREE.SphereGeometry(radius, 20, 16);
  const haloGeom = new THREE.SphereGeometry(radius * 2.4, 20, 16);
  const coreMat = new THREE.MeshBasicMaterial({ color: 0xff8a3d });
  const haloMat = new THREE.MeshBasicMaterial({
    color: 0xff8a3d,
    transparent: true,
    opacity: 0.15,
    depthWrite: false,
  });

  const sources = [];

  for (let i = 0; i < count; i++) {
    const node = new THREE.Object3D();
    node.position.set(
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half,
      (rng() * 2 - 1) * half
    );

    const core = new THREE.Mesh(coreGeom, coreMat);
    const halo = new THREE.Mesh(haloGeom, haloMat);
    node.add(core);
    node.add(halo);
    group.add(node);

    sources.push({
      id: i,
      node,
      velocity: new THREE.Vector3(0, 0, 0),
    });
  }

  group.userData.sources = sources;
  return group;
}

/**
 * Integrate sources one step under a velocity field + drag, and bounce
 * elastically off the bounded cube walls.
 *
 * @param {THREE.Group} group       — group returned by buildSources
 * @param {(out, x, y, z, t) => THREE.Vector3} sampleFlow
 * @param {number} dt               — seconds
 * @param {number} t                — current sim time, seconds
 * @param {number} size             — world cube edge length
 * @param {object} [opts]
 * @param {number} [opts.drag=0.4]        — per-second linear damping
 * @param {number} [opts.coupling=2.0]    — how fast a source matches the flow
 * @param {number} [opts.restitution=0.9] — wall bounce energy retention
 */
const _flowTmp = new THREE.Vector3();
export function updateSources(group, sampleFlow, dt, t, size, opts = {}) {
  const drag = opts.drag ?? 0.4;
  const coupling = opts.coupling ?? 2.0;
  const restitution = opts.restitution ?? 0.9;
  const half = size / 2;

  const sources = group.userData.sources;
  for (let i = 0; i < sources.length; i++) {
    const s = sources[i];
    const p = s.node.position;
    const v = s.velocity;

    sampleFlow(_flowTmp, p.x, p.y, p.z, t);

    // Pull velocity toward the local flow, with light drag.
    v.x += (_flowTmp.x - v.x) * coupling * dt - v.x * drag * dt;
    v.y += (_flowTmp.y - v.y) * coupling * dt - v.y * drag * dt;
    v.z += (_flowTmp.z - v.z) * coupling * dt - v.z * drag * dt;

    p.x += v.x * dt;
    p.y += v.y * dt;
    p.z += v.z * dt;

    // Elastic wall bounce on each axis.
    if (p.x >  half) { p.x =  half; if (v.x > 0) v.x = -v.x * restitution; }
    if (p.x < -half) { p.x = -half; if (v.x < 0) v.x = -v.x * restitution; }
    if (p.y >  half) { p.y =  half; if (v.y > 0) v.y = -v.y * restitution; }
    if (p.y < -half) { p.y = -half; if (v.y < 0) v.y = -v.y * restitution; }
    if (p.z >  half) { p.z =  half; if (v.z > 0) v.z = -v.z * restitution; }
    if (p.z < -half) { p.z = -half; if (v.z < 0) v.z = -v.z * restitution; }
  }
}

function makeLCG(seed) {
  // Numerical Recipes LCG — good enough for placement.
  let s = seed >>> 0;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
