// The land and the river in JS (the same as glsl.js), and where the susuki clumps grow.

export const riverX = (z) => -2.6 + 0.075 * (z - 1) + 4.6 * Math.exp(-Math.pow(z / 50, 2)) + 2.2 * Math.sin(z * 0.03) * smooth(10, 80, -z);
export const riverW = (z) => 3.0 + 0.7 * Math.sin(z * 0.043 + 0.7);
const bankWob = (z) => 0.45 * Math.sin(z * 0.61 + 1.3) * Math.sin(z * 0.23) + 0.25 * Math.sin(z * 1.7 + 0.4);
export const riverD = (x, z) => { const s = x - riverX(z); return Math.abs(s) - riverW(z) + bankWob(z + Math.sign(s) * 37); };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;

export function terrainH(x, z) {
  const d = riverD(x, z), w = riverW(z);
  const bed = -0.55 * (1 - Math.pow(clamp((d + w) / w, 0, 1), 2)) - 0.08;
  const hills = 0.55 * Math.sin(x * 0.035 + 0.3) * Math.sin(z * 0.027) + 0.25 * Math.sin(x * 0.09 + z * 0.05);
  const far = 7.0 * smooth(120, 420, -z) * (0.6 + 0.4 * Math.sin(x * 0.013 + 1));
  const bank = smooth(-0.15, 1.7, d);
  return mix(bed, 0.32 + (hills + far) * smooth(0.5, 12, d), bank);
}

// the river's surface is y = 0; ground or water under (x, z)
export const surfaceH = (x, z) => Math.max(terrainH(x, z), 0);

export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// Clumps on a jittered grid that coarsens with distance from the eye, inside the view wedge.
// Returns [{x, z, y, r (distance), size, seed}]
export function makeClumps({ eye = [-2.6, 1], keep = [], maxDist = 170, halfAngle = 1.15, density = 1 } = {}) {
  const R = rng(7);
  const out = [];
  for (let z = eye[1] + 4; z > eye[1] - maxDist; ) {
    const r0 = Math.max(1, eye[1] - z);
    const s = (0.72 + r0 * 0.026) / Math.sqrt(density);
    const half = Math.tan(halfAngle) * r0 + 6;
    for (let x = eye[0] - half; x < eye[0] + half; x += s) {
      const px = x + (R() - 0.5) * s * 0.9, pz = z + (R() - 0.5) * s * 0.9;
      const dx = px - eye[0], dz = pz - eye[1];
      const r = Math.hypot(dx, dz);
      if (Math.abs(Math.atan2(dx, -dz)) > halfAngle && r > 6) continue;
      const rd = riverD(px, pz);
      if (rd < 0.25) continue;                         // not in the water
      if (rd < 1.4 && R() < 0.45) continue;             // thinner on the bank
      if (keep.some(([kx, kz, kr]) => Math.hypot(px - kx, pz - kz) < kr)) continue;
      if (R() < 0.12) continue;                         // gaps
      out.push({ x: px, z: pz, y: terrainH(px, pz), r, size: 0.8 + R() * 0.45, seed: R() });
    }
    z -= s;
  }
  return out;
}
