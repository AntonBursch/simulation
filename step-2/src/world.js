import * as THREE from 'three';

/**
 * Build the bounded simulation volume:
 *   - bright outline of the cube edges
 *   - faint inner 3D grid (interior subdivision lines on all three axis families)
 *
 * The cube is centered on the origin with side length `size`.
 */
export function buildWorld({ size = 100, divisions = 10 } = {}) {
  const group = new THREE.Group();
  group.name = 'world';

  const half = size / 2;

  // --- Bright cube edges --------------------------------------------------
  const cubeGeom = new THREE.BoxGeometry(size, size, size);
  const edges = new THREE.EdgesGeometry(cubeGeom);
  const edgeMat = new THREE.LineBasicMaterial({
    color: 0xc8d4e0,
    transparent: true,
    opacity: 0.9,
  });
  const edgeLines = new THREE.LineSegments(edges, edgeMat);
  edgeLines.name = 'world.edges';
  group.add(edgeLines);

  // --- Faint inner 3D grid ------------------------------------------------
  // For each pair of (i, j) in [1..divisions-1] across two axes we emit a
  // line segment that spans the cube along the third axis. We do this for
  // all three axis-families so the interior reads as a 3D lattice.
  const positions = [];
  const step = size / divisions;

  for (let i = 1; i < divisions; i++) {
    for (let j = 1; j < divisions; j++) {
      const a = -half + i * step;
      const b = -half + j * step;

      // lines parallel to X (vary X, fix Y=a, Z=b)
      positions.push(-half, a, b,  half, a, b);
      // lines parallel to Y (vary Y, fix X=a, Z=b)
      positions.push(a, -half, b,  a,  half, b);
      // lines parallel to Z (vary Z, fix X=a, Y=b)
      positions.push(a, b, -half,  a, b,  half);
    }
  }

  const innerGeom = new THREE.BufferGeometry();
  innerGeom.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  const innerMat = new THREE.LineBasicMaterial({
    color: 0x6a7a8c,
    transparent: true,
    opacity: 0.08, // 8% — within the requested 5-20% band
    depthWrite: false,
  });
  const innerLines = new THREE.LineSegments(innerGeom, innerMat);
  innerLines.name = 'world.innerGrid';
  group.add(innerLines);

  return group;
}
