// Susuki (Miscanthus sinensis): long arching leaves, and stems with a plume of silky racemes at the top.
// Every blade and raceme is bent on the GPU (quadratic Bézier, after Ghost of Tsushima's grass), pushed by
// the wind field and by the hand's trample map. The racemes are camera-facing ribbons, hair drawn in the
// fragment shader and cut out with alpha-to-coverage, lit through from behind.
import * as THREE from 'three';
import { COMMON } from './glsl.js';
import { rng, riverD, terrainH } from './world.js';

const LEAF_SEG = 7;

function leafTemplate() {
  const pos = [], t = [], idx = [];
  for (let i = 0; i <= LEAF_SEG; i++) {
    for (const s of [-1, 1]) { pos.push(0, 0, 0); t.push(i / LEAF_SEG, s); }
    if (i < LEAF_SEG) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(t, 2));
  g.setIndex(idx);
  return g;
}

// kind 0: the stem (STEM_SEG segments); kind 1: raceme r (seg segments each)
function plumeTemplate(nr, seg) {
  const STEM_SEG = 6;
  const pos = [], k = [], idx = [];
  let v = 0;
  const strip = (kind, r, n) => {
    for (let i = 0; i <= n; i++) {
      for (const s of [-1, 1]) { pos.push(0, 0, 0); k.push(kind, r, i / n, s); }
      if (i < n) { const a = v + i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    v += (n + 1) * 2;
  };
  strip(0, 0, STEM_SEG);
  for (let r = 0; r < nr; r++) strip(1, r, seg);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aK', new THREE.Float32BufferAttribute(k, 4));
  g.setIndex(idx);
  return g;
}

const LEAF_VS = COMMON + /* glsl */ `
attribute vec2 aT;
attribute vec3 iRoot;
attribute vec4 iA;   // yaw, length, droop, width
attribute vec4 iB;   // colour, phase, lean, dry tip
varying vec3 vW; varying vec3 vN; varying vec2 vUV; varying vec4 vB;
void main(){
  float t = aT.x, side = aT.y;
  float L = iA.y;
  vec3 dir = vec3(cos(iA.x), 0., sin(iA.x));
  vec3 up = vec3(0, 1, 0);
  vec2 wnd = windAt(iRoot.xz, uTime, iB.y);
  vec2 tr = trampleAt(iRoot.xz);
  vec3 push = vec3(wnd.x, 0., wnd.y) * 0.5 + vec3(tr.x, 0., tr.y) * 1.4;
  vec3 p0 = iRoot;
  vec3 p1 = iRoot + up * L * 0.6 + dir * L * iB.z * 0.3 + push * L * 0.3;
  vec3 p2 = iRoot + up * L * (0.72 - iA.z) + dir * L * (0.2 + iB.z * 0.55) + push * L * 0.75;
  p2.y -= length(push) * L * 0.3;
  vec3 a = mix(p0, p1, t), b = mix(p1, p2, t);
  vec3 P = mix(a, b, t);
  vec3 T = normalize(b - a + 1e-5);
  float twist = (iB.y - 3.) * 0.25 * t;
  vec3 S = normalize(cross(up, dir)) * cos(twist) + dir * sin(twist);
  S = normalize(S - T * dot(S, T));
  float w = iA.w * pow(1. - t, 0.75) * (0.55 + 0.45 * min(t * 6., 1.));
  P += S * side * w * 0.5;
  vec3 N = normalize(cross(S, T));
  N = normalize(N + S * side * 0.45);
  vW = P; vN = N; vUV = vec2(t, side); vB = iB;
  gl_Position = projectionMatrix * viewMatrix * vec4(P.x, P.y * uMirror, P.z, 1.);
}`;

const LEAF_FS = COMMON + /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec2 vUV; varying vec4 vB;
void main(){
  if (uMirror < 0. && vW.y < 0.) discard;
  float t = vUV.x;
  vec3 green = mix(vec3(0.075, 0.12, 0.03), vec3(0.20, 0.19, 0.06), vB.x);
  vec3 dry = vec3(0.30, 0.20, 0.10);
  vec3 alb = mix(green, dry, smoothstep(1. - vB.w, 1.05 - vB.w * 0.6, t) * 0.85);
  alb *= 1. + 0.3 * (1. - smoothstep(0.0, 0.22, abs(vUV.y)));
  float shade = 0.55 + 0.45 * smoothstep(0.3, 0.7, fbm(vW.xz * 0.35 + 4.));   // shadows of the clumps on the field
  float ao = mix(0.12, 1., smoothstep(0.0, 0.85, t)) * shade * (0.6 + 0.6 * fract(vB.y * 3.7));
  vec3 V = normalize(uCamPos - vW);
  vec3 c = shadeFoliage(alb, normalize(vN), V, 1.0, ao, alb * 1.8 + vec3(0.02, 0.02, 0.0));
  gl_FragColor = vec4(fog(c, vW), 1.);
}`;

const PLUME_VS = COMMON + /* glsl */ `
attribute vec4 aK;   // kind, raceme, t, side
attribute vec3 iRoot;
attribute vec4 iA;   // lean yaw, height, lean, plume length
attribute vec4 iB;   // phase, colour, openness, random
uniform float uNR;
varying vec3 vW; varying vec3 vN; varying vec4 vK; varying vec4 vB; varying float vG;
vec3 bez(vec3 a, vec3 b, vec3 c, float t){ return mix(mix(a, b, t), mix(b, c, t), t); }
void main(){
  float H = iA.y;
  vec3 up = vec3(0, 1, 0);
  vec3 lean = vec3(cos(iA.x), 0., sin(iA.x)) * iA.z;
  vec2 wnd = windAt(iRoot.xz, uTime, iB.x);
  vec2 tr = trampleAt(iRoot.xz);
  vec3 push = vec3(wnd.x, 0., wnd.y) + vec3(tr.x, 0., tr.y) * 1.8;
  vec3 tipDir = normalize(up + lean + push * 0.85);
  vec3 p0 = iRoot, p1 = iRoot + up * H * 0.5, p2 = p1 + tipDir * H * 0.5;
  vec3 V0 = normalize(uCamPos - p2);
  vec3 P, T; float w;
  if (aK.x < 0.5) {
    float s = aK.z;
    P = bez(p0, p1, p2, s);
    T = normalize(mix(p1 - p0, p2 - p1, s));
    w = 0.0022 * (1. - 0.3 * s);
    vK = vec4(0., 0., s, aK.w);
  } else {
    float r = aK.y, u = aK.z;
    float f = r / uNR;
    float sa = 1. - 0.09 * f;                       // where it leaves the stem, the lowest at 0.91
    vec3 A = bez(p0, p1, p2, sa);
    vec3 Ta = normalize(mix(p1 - p0, p2 - p1, sa));
    vec3 B1 = normalize(cross(Ta, abs(Ta.x) < 0.9 ? vec3(1, 0, 0) : vec3(0, 0, 1)));
    vec3 B2 = cross(Ta, B1);
    float az = r * 2.39996 + iB.w * 6.283;
    vec3 out1 = cos(az) * B1 + sin(az) * B2;
    float open = iB.z * (0.08 + 0.4 * f);
    float Lr = iA.w * (0.62 + 0.38 * f) * (0.85 + 0.3 * fract(iB.w * 7.3 + r * 0.37));
    vec3 d0 = normalize(Ta * cos(open) + out1 * sin(open));
    float flick = sin(uTime * 7. + r * 1.7 + iB.x * 3.) * 0.05 * (0.4 + length(push));
    vec3 sweep = normalize(lean + vec3(0.001, 0., 0.)) * 0.35;
    vec3 bend = push * 0.7 + sweep - up * (0.3 + 0.5 * open) + out1 * (flick + 0.12 * open);
    P = A + d0 * Lr * u + bend * Lr * u * u;
    T = normalize(d0 + 2. * bend * u);
    w = (0.002 + 0.024 * pow(sin(3.1416 * (u * 0.92 + 0.04)), 0.8) * (1. - 0.35 * u)) * (0.75 + iB.z * 0.5);
    vK = vec4(1., r, u, aK.w);
  }
  vec3 V = normalize(uCamPos - P);
  vec3 S = normalize(cross(T, V));
  // keep thin things at least ~1 px wide; fade them instead (alpha in vG.y)
  float dist = length(uCamPos - P);
  float minW = dist * (aK.x < 0.5 ? 0.0005 : 0.0016);
  vG = gust(iRoot.xz, uTime);
  vN = normalize(V * 0.55 + S * aK.w * 0.8 + up * 0.25);
  vB = iB;
  vB.w = w / max(w, minW);
  w = max(w, minW);
  P += S * aK.w * w;
  vW = P;
  gl_Position = projectionMatrix * viewMatrix * vec4(P.x, P.y * uMirror, P.z, 1.);
}`;

const PLUME_FS = COMMON + /* glsl */ `
varying vec3 vW; varying vec3 vN; varying vec4 vK; varying vec4 vB; varying float vG;
void main(){
  if (uMirror < 0. && vW.y < 0.) discard;
  vec3 V = normalize(uCamPos - vW);
  float a;
  vec3 alb, trans;
  if (vK.x < 0.5) {
    a = 1.;
    alb = mix(vec3(0.06, 0.06, 0.025), vec3(0.16, 0.12, 0.06), vK.z);
    trans = alb * 0.6;
  } else {
    float u = vK.z, s = abs(vK.w);
    // silky hairs leaning toward the tip: streaks across the ribbon, broken up along it
    float hair = vnoise(vec2((u - s * 0.25) * 70. + vK.y * 13., vK.y * 5. + s * 1.5));
    float hair2 = vnoise(vec2((u - s * 0.35) * 150. + vK.y * 7., s * 4.));
    float core = 1. - smoothstep(0.03, 0.1, s);
    float hairs = smoothstep(0.32, 0.78, hair * 0.65 + hair2 * 0.45);
    float fluff = pow(1. - s, 1.4) * hairs;
    a = max(core * 0.9, fluff * 0.9) * smoothstep(0.0, 0.1, u) * (1. - smoothstep(0.62, 1.0, u));
    alb = mix(vec3(0.42, 0.37, 0.32), vec3(0.42, 0.30, 0.28), vB.y);   // silver, some still reddish
    alb = mix(alb, vec3(0.35, 0.27, 0.18), core * 0.45);
    trans = mix(vec3(1.0, 0.8, 0.55), vec3(1.0, 0.66, 0.5), vB.y) * 0.75;
    alb *= (1. + 0.35 * vG) * (0.55 + 0.45 * u) * (0.75 + 0.5 * fract(vK.y * 0.618 + vB.x));
    trans *= (1. + 0.7 * vG) * (0.5 + 0.5 * u) * (0.7 + 0.6 * fract(vK.y * 0.371 + vB.x * 1.3));
  }
  a *= vK.x > 0.5 ? 0.55 + 0.45 * vB.w : 0.3 + 0.7 * vB.w;
  if (a < 0.08) discard;
  vec3 c = shadeFoliage(alb, normalize(vN), V, 1.0, 1.0, trans);
  gl_FragColor = vec4(fog(c, vW), a);
}`;

export function makeSusuki(clumps, uniforms, { quality = 1, eye = [0, 0] } = {}) {
  const R = rng(11);
  const leaves = [], plumesHi = [], plumesLo = [];
  for (const c of clumps) {
    const nearK = Math.max(0, 1 - c.r / 60);
    const nLeaf = Math.round((10 + 46 * nearK) * c.size * quality);
    for (let i = 0; i < nLeaf; i++) {
      const yaw = R() * Math.PI * 2;
      const ox = Math.cos(yaw) * R() * 0.18 * c.size, oz = Math.sin(yaw) * R() * 0.18 * c.size;
      leaves.push([c.x + ox, c.y - 0.02, c.z + oz, yaw, (0.75 + R() * 0.55) * c.size, 0.2 + R() * 0.55, 0.012 + R() * 0.008,
        R(), R() * 6.28, 0.3 + R() * 0.9, R() * 0.6]);
    }
    const nPl = Math.round((8 + R() * 8 + 14 * Math.max(0, 1 - c.r / 40)) * c.size * Math.min(1, quality * 1.25));
    const leanYaw = R() * Math.PI * 2;
    for (let i = 0; i < nPl; i++) {
      const a = R() * Math.PI * 2, rr = R() * 0.14 * c.size;
      const arr = c.r < 28 ? plumesHi : plumesLo;
      arr.push([c.x + Math.cos(a) * rr, c.y - 0.02, c.z + Math.sin(a) * rr,
        leanYaw + (R() - 0.5) * 1.0, (1.2 + R() * 0.6) * c.size, 0.18 + R() * 0.45, 0.17 + R() * 0.09,
        R() * 6.28, Math.pow(R(), 2.5), 0.25 + R() * 0.8, R()]);
    }
  }
  // short grass between the clumps, near the eye
  const nGround = Math.round(70000 * quality);
  for (let i = 0; i < nGround; ) {
    const rr = 0.6 + Math.pow(R(), 1.6) * 34, a = (R() - 0.5) * 2.4;
    const x = eye[0] + Math.sin(a) * rr, z = eye[1] - Math.cos(a) * rr;
    if (riverD(x, z) < 0.1) continue;
    i++;
    leaves.push([x, terrainH(x, z) - 0.01, z, R() * 6.28, 0.22 + R() * 0.38, 0.05 + R() * 0.3, 0.006 + R() * 0.004, R(), R() * 6.28, 0.2 + R() * 0.6, 0.2 + R() * 0.8]);
  }
  const group = new THREE.Group();
  const mk = (geo, rows, vs, fs, extra = {}) => {
    const n = rows.length;
    const root = new Float32Array(n * 3), A = new Float32Array(n * 4), B = new Float32Array(n * 4);
    rows.forEach((r, i) => { root.set(r.slice(0, 3), i * 3); A.set(r.slice(3, 7), i * 4); B.set(r.slice(7, 11), i * 4); });
    geo.setAttribute('iRoot', new THREE.InstancedBufferAttribute(root, 3));
    geo.setAttribute('iA', new THREE.InstancedBufferAttribute(A, 4));
    geo.setAttribute('iB', new THREE.InstancedBufferAttribute(B, 4));
    geo.instanceCount = n;
    const mat = new THREE.ShaderMaterial({ vertexShader: vs, fragmentShader: fs, uniforms: { ...uniforms, ...extra }, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    group.add(m);
    return m;
  };
  mk(leafTemplate(), leaves, LEAF_VS, LEAF_FS);
  const hi = mk(plumeTemplate(14, 6), plumesHi, PLUME_VS, PLUME_FS, { uNR: { value: 14 } });
  const lo = mk(plumeTemplate(8, 3), plumesLo, PLUME_VS, PLUME_FS, { uNR: { value: 8 } });
  hi.material.alphaToCoverage = true;
  lo.material.alphaToCoverage = true;
  group.userData.counts = { leaves: leaves.length, plumesHi: plumesHi.length, plumesLo: plumesLo.length };
  return group;
}
