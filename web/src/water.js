// The river: a surface at y = 0 that shows the mirrored scene (drawn first into a texture), rippled by
// flowing noise and by a ripple height field solved on the GPU. Also the trample map the hand writes
// into the field, and the seeds of the plumes drifting on the wind.
import * as THREE from 'three';
import { COMMON } from './glsl.js';
import { riverX, riverW } from './world.js';

const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

class PingPong {
  constructor(renderer, n, fs, uniforms) {
    const o = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping };
    this.r = renderer; this.a = new THREE.WebGLRenderTarget(n, n, o); this.b = new THREE.WebGLRenderTarget(n, n, o);
    this.mat = new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: fs, uniforms: { uPrev: { value: null }, uTexel: { value: new THREE.Vector2(1 / n, 1 / n) }, ...uniforms }, depthTest: false });
    this.scene = new THREE.Scene(); this.cam = new THREE.Camera();
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat));
    this.clear();
  }
  clear() { const c = new THREE.Color(0, 0, 0); for (const t of [this.a, this.b]) { this.r.setRenderTarget(t); this.r.setClearColor(c, 0); this.r.clear(); } this.r.setRenderTarget(null); }
  step() {
    this.mat.uniforms.uPrev.value = this.a.texture;
    this.r.setRenderTarget(this.b); this.r.render(this.scene, this.cam); this.r.setRenderTarget(null);
    [this.a, this.b] = [this.b, this.a];
  }
  get tex() { return this.a.texture; }
}

// --- trample: per texel, how far (and which way) the stalks there are pushed; it fades back
const TRAMPLE_FS = /* glsl */ `
uniform sampler2D uPrev; uniform vec2 uTexel; uniform vec4 uBox; uniform vec4 uSeg; uniform float uR; uniform float uOn; uniform float uDecay;
varying vec2 vUv;
void main(){
  vec2 p = uBox.xy + vUv * uBox.zw;
  vec2 v = texture2D(uPrev, vUv).xy * uDecay;
  if (uOn > 0.) {
    vec2 a = uSeg.xy, ab = uSeg.zw - uSeg.xy;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0., 1.);
    vec2 d = p - (a + ab * t); float l = length(d);
    float k = smoothstep(uR, uR * 0.25, l) * uOn;
    vec2 dir = l > 1e-4 ? d / l : vec2(0.);
    vec2 push = dir * (0.55 + 0.45 * smoothstep(0., uR, l)) * k;
    if (dot(push, push) > dot(v, v)) v = mix(v, push, k);
  }
  gl_FragColor = vec4(v, 0., 1.);
}`;

// --- ripples: height and velocity; damped wave equation, carried downstream
const RIPPLE_FS = /* glsl */ `
uniform sampler2D uPrev; uniform vec2 uTexel; uniform vec2 uFlowUV; uniform float uC2; uniform float uDamp;
uniform vec4 uDrop; // uv x, uv y, radius (uv), strength
varying vec2 vUv;
void main(){
  vec2 uv = vUv - uFlowUV;
  vec4 s = texture2D(uPrev, uv);
  float h = s.x, v = s.y;
  float lap = texture2D(uPrev, uv + vec2(uTexel.x, 0.)).x + texture2D(uPrev, uv - vec2(uTexel.x, 0.)).x
            + texture2D(uPrev, uv + vec2(0., uTexel.y)).x + texture2D(uPrev, uv - vec2(0., uTexel.y)).x - 4. * h;
  v += uC2 * lap; v *= uDamp; h += v; h *= 0.9985;
  if (uDrop.w != 0.) { float d = length(vUv - uDrop.xy) / uDrop.z; h -= uDrop.w * exp(-d * d); }
  vec2 e = min(vUv, 1. - vUv); h *= smoothstep(0., 0.04, min(e.x, e.y));
  gl_FragColor = vec4(h, v, 0., 1.);
}`;

export class Touch {
  constructor(renderer, uniforms) {
    this.box = new THREE.Vector4(-12, -22, 24, 24);            // trample map over the near field
    this.rbox = new THREE.Vector4(-6, -24, 22, 22);            // ripple map over the near river
    this.tr = new PingPong(renderer, 256, TRAMPLE_FS, { uBox: { value: this.box }, uSeg: { value: new THREE.Vector4() }, uR: { value: 0.85 }, uOn: { value: 0 }, uDecay: { value: 1 } });
    this.rp = new PingPong(renderer, 384, RIPPLE_FS, { uFlowUV: { value: new THREE.Vector2() }, uC2: { value: 0.22 }, uDamp: { value: 0.988 }, uDrop: { value: new THREE.Vector4() } });
    uniforms.uTrample.value = this.tr.tex;
    uniforms.uTrampleBox.value = this.box;
    this.u = uniforms;
    const cz = this.rbox.y + this.rbox.w / 2, e = 0.5;
    const tan = new THREE.Vector2(riverX(cz + e) - riverX(cz - e), 2 * e).normalize();
    this.flow = tan.multiplyScalar(0.45);                     // m/s, toward the eye (+z)
    this.last = null;
  }
  reset() { this.tr.clear(); this.rp.clear(); this.last = null; }
  // one 1/60 s step; hand = {x, z, on, water} or null
  step(hand, dt = 1 / 60) {
    const tu = this.tr.mat.uniforms;
    tu.uDecay.value = Math.exp(-dt / 2.6);
    if (hand && hand.on) {
      const a = this.last && this.last.on ? this.last : hand;
      tu.uSeg.value.set(a.x, a.z, hand.x, hand.z); tu.uOn.value = Math.min(1, hand.on);
    } else tu.uOn.value = 0;
    this.tr.step();
    const ru = this.rp.mat.uniforms;
    ru.uFlowUV.value.set(this.flow.x * dt / this.rbox.z, this.flow.y * dt / this.rbox.w);
    ru.uDrop.value.set(0, 0, 0, 0);
    const drop = hand && hand.on && hand.water ? hand : this.drip;
    if (drop) {
      const moved = this.last ? Math.hypot(drop.x - this.last.x, drop.z - this.last.z) : 0;
      const k = drop === hand ? Math.min(0.022, 0.008 + moved * 0.12) * hand.on : drop.s;
      ru.uDrop.value.set((drop.x - this.rbox.x) / this.rbox.z, (drop.z - this.rbox.y) / this.rbox.w, 0.08 / this.rbox.z, k);
    }
    this.drip = null;
    this.rp.step();
    this.u.uTrample.value = this.tr.tex;
    this.last = hand ? { ...hand } : null;
  }
}

export function makeWater(uniforms, touch, eye) {
  const NZ = 700, NX = 24;
  const pos = [], idx = [];
  for (let i = 0; i <= NZ; i++) {
    const a = i / NZ, z = eye[1] + 10 - 620 * Math.pow(a, 1.8);
    const c = riverX(z), w = riverW(z) + 1.2;
    for (let j = 0; j <= NX; j++) {
      pos.push(c + (j / NX - 0.5) * 2 * w, 0, z);
      if (i < NZ && j < NX) { const p = i * (NX + 1) + j; idx.push(p, p + NX + 1, p + 1, p + 1, p + NX + 1, p + NX + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uRefl: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uRip: { value: null }, uRipBox: { value: touch.rbox }, uFlow: { value: 0.45 } },
    side: THREE.DoubleSide,
    vertexShader: COMMON + 'varying vec3 vW; void main(){ vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.); }',
    fragmentShader: COMMON + /* glsl */ `
      uniform sampler2D uRefl; uniform vec2 uRes; uniform sampler2D uRip; uniform vec4 uRipBox; uniform float uFlow;
      varying vec3 vW;
      float wh(vec2 q, float t, float detail){
        // q: across, along the river; patterns drift downstream (+z) and slowly change
        float h = fbm(vec2(q.x * 0.9 + t * 0.03, (q.y - t * uFlow) * 0.55)) * 0.55;
        h += vnoise(vec2(q.x * 3.1 - t * 0.21, (q.y - t * uFlow * 1.1) * 2.2)) * 0.22;
        h += detail * vnoise(vec2(q.x * 9. + t * 0.5, (q.y - t * uFlow * 1.2) * 7.)) * 0.07;
        h += detail * vnoise(vec2(q.x * 23. - t * 0.9, (q.y - t * uFlow * 1.3) * 19.)) * 0.025;
        return h;
      }
      void main(){
        vec3 V = normalize(uCamPos - vW);
        float dist = length(uCamPos - vW);
        vec2 q = vec2(vW.x - riverX(vW.z), vW.z);
        float detail = 1. - smoothstep(10., 60., dist);
        float e = 0.03 + dist * 0.004;
        float h0 = wh(q, uTime, detail);
        float amp = 0.11 / (1. + dist * 0.02);
        vec2 grad = vec2(wh(q + vec2(e, 0.), uTime, detail) - h0, wh(q + vec2(0., e), uTime, detail) - h0) / e * amp;
        // ripples from the hand
        vec2 ruv = (vW.xz - uRipBox.xy) / uRipBox.zw;
        if (ruv.x > 0. && ruv.y > 0. && ruv.x < 1. && ruv.y < 1.) {
          float rt = 1. / 384.;
          float r0 = texture2D(uRip, ruv).x;
          grad += vec2(texture2D(uRip, ruv + vec2(rt, 0.)).x - r0, texture2D(uRip, ruv + vec2(0., rt)).x - r0) * 22.;
        }
        vec3 N = normalize(vec3(-grad.x, 1., -grad.y));
        float ndv = max(dot(N, V), 0.);
        float F = 0.02 + 0.98 * pow(1. - ndv, 5.);
        vec2 suv = gl_FragCoord.xy / uRes + N.xz * vec2(0.6, 0.9) * 0.06 / (1. + dist * 0.05);
        vec3 refl = texture2D(uRefl, clamp(suv, 0.001, 0.999)).rgb;
        // the water itself: dark, peaty, a little green where it is shallow by the banks
        float shallow = smoothstep(-0.25, 0.0, terrainH(vW.xz));
        vec3 body = mix(vec3(0.012, 0.02, 0.016), vec3(0.06, 0.055, 0.03), shallow) * (uAmbTop * 1.2 + uSunCol * 0.08);
        vec3 c = mix(body, refl, F);
        vec3 R = reflect(-V, N);
        float rl = max(dot(R, uSunDir), 0.);
        float spark = smoothstep(0.62, 0.95, vnoise(vW.xz * vec2(11., 6.) + vec2(uTime * 1.7, -uTime * 2.3)));
        c += uSunCol * (pow(rl, 1400.) * 70. * (0.1 + spark) + pow(rl, 200.) * 0.12) * (0.6 + 0.4 * detail) * uSpec;
        gl_FragColor = vec4(fog(c, vW), 1.);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.onBeforeRender = () => { mat.uniforms.uRip.value = touch.rp.tex; };
  return m;
}

// seeds of the plumes: tiny fluff carried on the wind, sparkling when the light is behind them
export function makeSeeds(uniforms, eye, n = 1400) {
  const pos = new Float32Array(n * 3), rnd = new Float32Array(n * 4);
  let s = 3;
  const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < n; i++) {
    pos.set([R(), R(), R()], i * 3);
    rnd.set([R(), R(), R(), R()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aR', new THREE.BufferAttribute(rnd, 4));
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uBoxMin: { value: new THREE.Vector3(eye[0] - 16, 0.2, eye[1] - 40) }, uBoxSize: { value: new THREE.Vector3(32, 3.5, 44) }, uPx: { value: 1000 }, uAmount: { value: 1 } },
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: COMMON + /* glsl */ `
      attribute vec4 aR; uniform vec3 uBoxMin; uniform vec3 uBoxSize; uniform float uPx;
      varying float vA; varying vec3 vW;
      void main(){
        vec3 drift = vec3(uWind.x, 0., uWind.y) * uTime * (0.9 + aR.x * 0.8) * uWindStr * 1.6 + vec3(0., sin(uTime * 0.4 + aR.y * 6.28) * 0.25 + uTime * 0.05 * (aR.z - 0.3), 0.);
        drift += vec3(sin(uTime * 1.3 + aR.w * 9.), 0., cos(uTime * 1.1 + aR.x * 7.)) * 0.15;
        vec3 p = uBoxMin + mod(position * uBoxSize + drift, uBoxSize);
        vW = p;
        vec4 mv = viewMatrix * vec4(p, 1.);
        float d = -mv.z;
        gl_PointSize = clamp(uPx * 0.006 * (0.6 + aR.y) / d, 1., 24.);
        vec3 V = normalize(uCamPos - p);
        float through = pow(max(dot(-V, uSunDir), 0.), 8.);
        vA = (0.08 + through * 1.4) * smoothstep(0.4, 2.0, d) * (0.4 + 0.6 * aR.z) * (0.6 + 0.4 * sin(uTime * 3. + aR.w * 20.));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: COMMON + /* glsl */ `
      uniform float uAmount; varying float vA; varying vec3 vW;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float r = length(c);
        float a = smoothstep(0.5, 0.0, r);
        gl_FragColor = vec4(uSunCol * vec3(1.0, 0.92, 0.8) * a * vA * uAmount * 0.6 + uGlowCol * a * vA * 0.05 * uAmount, 1.);
      }`,
  });
  const m = new THREE.Points(g, mat);
  m.frustumCulled = false;
  return m;
}
