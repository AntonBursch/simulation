import * as THREE from 'three';

/**
 * Multi-octave smooth 3D flow field. Each octave is a solenoidal-ish
 * sin/cos pattern; summing octaves at different spatial frequencies and
 * phase speeds produces eddies of different sizes that drift over time.
 *
 * Sample with `sampleFlow(out, x, y, z, t)`; writes into `out` to avoid
 * allocation in the hot loop.
 */
export function makeFlowField({
  size = 300,
  amplitude = 22,
  octaves = [
    { modes: 1.0, swirl: 0.10, weight: 1.00, phase: 0.0 },
    { modes: 2.3, swirl: 0.22, weight: 0.55, phase: 1.7 },
    { modes: 4.7, swirl: 0.45, weight: 0.25, phase: 3.1 },
  ],
} = {}) {
  // Normalize weights so peak speed stays near `amplitude`.
  const wSum = octaves.reduce((s, o) => s + o.weight, 0) || 1;
  const oct = octaves.map((o) => ({
    k: (2 * Math.PI * o.modes) / size,
    swirl: o.swirl,
    w: (o.weight / wSum) * amplitude,
    phase: o.phase,
  }));

  return function sampleFlow(out, x, y, z, t) {
    let vx = 0, vy = 0, vz = 0;
    for (let i = 0; i < oct.length; i++) {
      const { k, swirl, w, phase } = oct[i];
      const p = swirl * t + phase;
      vx += w * Math.sin(k * y + p)       * Math.cos(k * z - p * 0.7);
      vy += w * Math.sin(k * z + p * 1.3) * Math.cos(k * x + p * 0.5);
      vz += w * Math.sin(k * x - p * 0.9) * Math.cos(k * y + p * 1.1);
    }
    out.x = vx; out.y = vy; out.z = vz;
    return out;
  };
}
