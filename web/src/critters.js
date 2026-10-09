// Red dragonflies (aka-tombo) over the plumes and the water at golden hour: hovering, darting,
// wings a blur that catches the light when the Sun is behind them.
import * as THREE from 'three';
import { COMMON } from './glsl.js';

function dragonflyGeometry() {
  // part 0: body (a tapered strip, head at +x); parts 1-4: wings (fore/hind, left/right)
  const pos = [], part = [], uv = [], idx = [];
  let v = 0;
  const quad = (a, b, c, d, p) => {
    for (const q of [a, b, c, d]) { pos.push(q[0], q[1], q[2]); part.push(p); uv.push(q[3], q[4]); }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  };
  // body as two crossed strips so it reads from the side and from above
  quad([-0.03, 0, -0.0022, 0, 0], [0.012, 0, -0.0036, 1, 0], [0.012, 0, 0.0036, 1, 1], [-0.03, 0, 0.0022, 0, 1], 0);
  quad([-0.03, -0.0022, 0, 0, 0], [0.012, -0.0036, 0, 1, 0], [0.012, 0.0036, 0, 1, 1], [-0.03, 0.0022, 0, 0, 1], 0);
  // wings: root on the body, span along z
  for (const [x, sz, p] of [[0.004, 1, 1], [0.004, -1, 2], [-0.004, 1, 3], [-0.004, -1, 4]]) {
    const w = 0.0075, L = 0.034 * sz;
    quad([x + w, 0, 0, 0, 0], [x - w, 0, 0, 0, 1], [x - w * 0.6, 0, L, 1, 1], [x + w * 0.6, 0, L, 1, 0], p);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

// homes: [x, y, z, roam radius]
export function makeDragonflies(uniforms, homes) {
  const g = dragonflyGeometry();
  const n = homes.length;
  const home = new Float32Array(n * 4), rnd = new Float32Array(n);
  homes.forEach((h, i) => { home.set(h, i * 4); rnd[i] = (i * 0.618) % 1; });
  g.setAttribute('iHome', new THREE.InstancedBufferAttribute(home, 4));
  g.setAttribute('iRnd', new THREE.InstancedBufferAttribute(rnd, 1));
  g.instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uShow: { value: 1 } },
    side: THREE.DoubleSide, transparent: true, depthWrite: false,
    vertexShader: COMMON + /* glsl */ `
      attribute float aPart; attribute vec4 iHome; attribute float iRnd;
      varying float vPart; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      // where it is at time t: drifting hovers joined by quick darts
      vec3 flight(float t){
        float seg = floor(t / 1.7 + iRnd * 7.);
        float f = fract(t / 1.7 + iRnd * 7.);
        float dart = smoothstep(0.72, 0.9, f);          // most of the time it hangs still, then darts
        vec3 a = vec3(hash12(vec2(seg, iRnd)) - 0.5, hash12(vec2(seg, iRnd + 3.)) - 0.5, hash12(vec2(seg, iRnd + 7.)) - 0.5);
        vec3 b = vec3(hash12(vec2(seg + 1., iRnd)) - 0.5, hash12(vec2(seg + 1., iRnd + 3.)) - 0.5, hash12(vec2(seg + 1., iRnd + 7.)) - 0.5);
        vec3 p = mix(a, b, dart) * vec3(2., 0.6, 2.) * iHome.w;
        p += vec3(sin(t * 1.3 + iRnd * 9.), sin(t * 2.1 + iRnd * 5.) * 0.5, cos(t * 1.1 + iRnd * 3.)) * 0.03;
        return iHome.xyz + p;
      }
      void main(){
        float t = uTime;
        vec3 P = flight(t);
        vec3 vel = flight(t + 0.05) - flight(t - 0.05);
        // heading follows the last dart; it keeps its heading while hovering
        float seg = floor(t / 1.7 + iRnd * 7.);
        vec3 toNext = flight((seg + 0.85 - iRnd * 7.) * 1.7 + 0.02) - flight((seg + 0.7 - iRnd * 7.) * 1.7);
        vec2 hd = normalize(toNext.xz + vec2(1e-4, 0.));
        float yaw = atan(hd.y, hd.x);
        vec3 q = position;
        if (aPart > 0.5) {
          // wings beat ~30 Hz: drawn as a fan through the stroke, so they read as a blur
          float side = aPart < 2.5 ? 1. : -1.;
          float hind = aPart > 2.5 ? 1. : 0.;
          float beat = sin(t * 190. + hind * 1.6 + iRnd * 30.);
          float ang = side * (0.15 + 0.5 * beat) * sign(q.z + 1e-6);
          q = vec3(q.x, q.z * sin(ang), q.z * cos(ang));
        }
        float c = cos(yaw), s = sin(yaw);
        q = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
        vW = P + q * 1.4;
        vPart = aPart; vUv = uv;
        vN = normalize(vec3(-s * 0.2, 1., c * 0.2));
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.);
      }`,
    fragmentShader: COMMON + /* glsl */ `
      uniform float uShow;
      varying float vPart; varying vec2 vUv; varying vec3 vW; varying vec3 vN;
      void main(){
        vec3 V = normalize(uCamPos - vW);
        float through = pow(max(dot(-V, uSunDir), 0.), 6.);
        vec3 c; float a;
        if (vPart < 0.5) {
          // the red abdomen, dark against the light, glowing at its edges
          float rim = smoothstep(0.55, 1., abs(vUv.y - 0.5) * 2.);
          c = vec3(0.3, 0.05, 0.02) * uAmbTop * 0.6 + vec3(1., 0.3, 0.08) * uSunCol * through * 0.12 * rim;
          a = 1.;
        } else {
          // wings: clear membrane with veins, mostly seen by the light through them
          float vein = smoothstep(0.85, 1., abs(sin(vUv.x * 40.))) + smoothstep(0.9, 1., abs(sin(vUv.y * 9.)));
          c = uSunCol * (0.03 + through * 0.22) * vec3(1., 0.85, 0.65) + vein * 0.03 * uSunCol;
          a = 0.3 * smoothstep(1., 0.8, vUv.x);
        }
        gl_FragColor = vec4(fog(c, vW), a * uShow);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}
