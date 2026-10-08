// Susuki by the river: the page (drag to part the grass and touch the water) and the film (?film / ?render).
import * as THREE from 'three';
import { EffectComposer } from '../vendor/three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from '../vendor/three/examples/jsm/postprocessing/ShaderPass.js';
import { makeClumps, terrainH, rng } from './world.js';
import { makeSusuki } from './susuki.js';
import { makeGround, makeRidges, makeSky } from './land.js';
import { Touch, makeWater, makeSeeds } from './water.js';
import { FILM_LEN, filmAt } from './film.js';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render'), FILM = RENDER || q.has('film');
const RS = Number(q.get('rs')) || Math.min(devicePixelRatio, FILM ? 2 : 1.25);
const QUALITY = FILM ? 1 : Number(q.get('q')) || (matchMedia('(pointer: coarse)').matches ? 0.6 : 0.85);

const EYE = [-2.6, 1.0];
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: RENDER });
renderer.setPixelRatio(RS);
renderer.autoClear = true;

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const U = {
  uTime: { value: 0 }, uSunDir: { value: V3(0, 0.06, -1).normalize() }, uSunCol: { value: V3(1, 1, 1) },
  uSkyTop: { value: V3() }, uSkyHor: { value: V3() }, uGlowCol: { value: V3() }, uAmbTop: { value: V3() }, uAmbBot: { value: V3() },
  uFogDen: { value: 0.006 }, uNight: { value: 0 }, uWind: { value: new THREE.Vector2(0.28, 0.96).normalize() }, uWindStr: { value: 0.55 },
  uFront: { value: -1e4 }, uMirror: { value: 1 }, uSpec: { value: 1 }, uCamPos: { value: V3() },
  uTrample: { value: null }, uTrampleBox: { value: new THREE.Vector4() },
};

// light keys: golden hour, the afterglow, moonlight
const SUN = V3(-0.075, 0.062, -1).normalize();
const MOON = V3(0.075, 0.2, -1).normalize();
const KEYS = [
  { sun: SUN, sunCol: [5.6, 3.0, 1.25], skyTop: [0.11, 0.12, 0.22], skyHor: [1.25, 0.5, 0.16], glow: [1.9, 0.78, 0.22], ambTop: [0.11, 0.11, 0.17], ambBot: [0.07, 0.045, 0.025], fog: 0.0026, exp: 0.62, spec: 1, stars: 0, moon: 0, disc: 1, cloud: [1, 1] },
  { sun: V3(-0.075, -0.03, -1).normalize(), sunCol: [0.9, 0.42, 0.3], skyTop: [0.07, 0.09, 0.22], skyHor: [0.75, 0.3, 0.26], glow: [1.0, 0.38, 0.22], ambTop: [0.12, 0.12, 0.2], ambBot: [0.06, 0.04, 0.04], fog: 0.005, exp: 1.0, spec: 0.6, stars: 0.2, moon: 0.4, disc: 0, cloud: [1, 0.8] },
  { sun: MOON, sunCol: [0.42, 0.5, 0.66], skyTop: [0.003, 0.006, 0.016], skyHor: [0.012, 0.02, 0.036], glow: [0.07, 0.09, 0.13], ambTop: [0.035, 0.05, 0.085], ambBot: [0.008, 0.01, 0.014], fog: 0.0035, exp: 1.25, spec: 0.3, stars: 1, moon: 1, disc: 0, cloud: [0.7, 0.55] },
];

const scene = new THREE.Scene();
const clumps = makeClumps({ eye: EYE, keep: [[EYE[0] + 0.3, 2.2, 1.3], [EYE[0] + 0.3, 0.9, 1.3], [EYE[0] + 0.4, -0.4, 1.3], [EYE[0] + 0.5, -1.8, 1.3]], density: FILM ? 1 : QUALITY + 0.15 });
const susuki = makeSusuki(clumps, U, { quality: QUALITY, eye: EYE });
const touch = new Touch(renderer, U);
const sky = makeSky(U);
const ground = makeGround(U, EYE);
const ridges = makeRidges(U, EYE);
const water = makeWater(U, touch, EYE);
const seeds = makeSeeds(U, EYE, FILM ? 1600 : 900);
scene.add(sky, ridges, ground, susuki, water, seeds);
console.log('susuki', JSON.stringify(susuki.userData.counts), 'clumps', clumps.length);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);

// the reflection: the same camera, the scene mirrored in y = 0
let reflRT = null, composer = null, bloom = null, finalPass = null;
const FINAL = {
  uniforms: { tDiffuse: { value: null }, uExposure: { value: 1 }, uGrain: { value: 0 }, uAspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uExposure; uniform float uGrain; uniform float uAspect; varying vec2 vUv;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0., 1.); }
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uGrain) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb * uExposure;
      vec2 v = (vUv - 0.5) * vec2(uAspect, 1.);
      c *= 1. - 0.35 * smoothstep(0.25, 0.85, length(v));
      c = aces(c);
      c = pow(c, vec3(1. / 2.2));
      c += (h(vUv * 1000.) - 0.5) * 0.018;
      gl_FragColor = vec4(c, 1.);
    }`,
};

let W = 0, H = 0;
function resize() {
  const w = FILM ? 540 : innerWidth, h = FILM ? 675 : innerHeight;
  if (w === W && h === H) return;
  W = w; H = h;
  renderer.setSize(w, h, !FILM);
  if (FILM) { canvas.style.width = w + 'px'; canvas.style.height = h + 'px'; }
  camera.aspect = w / h;
  camera.fov = w / h < 1 ? 52 : 40;
  camera.updateProjectionMatrix();
  const pw = Math.round(w * RS), ph = Math.round(h * RS);
  const o = { type: THREE.HalfFloatType, samples: 4 };
  reflRT?.dispose();
  reflRT = new THREE.WebGLRenderTarget(Math.round(pw * 0.6), Math.round(ph * 0.6), o);
  composer?.dispose?.();
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(pw, ph, o));
  composer.setPixelRatio(1);
  composer.setSize(pw, ph);
  composer.addPass(new RenderPass(scene, camera));
  bloom = new UnrealBloomPass(new THREE.Vector2(pw, ph), 0.32, 0.35, 3.5);
  composer.addPass(bloom);
  finalPass = new ShaderPass(FINAL);
  composer.addPass(finalPass);
  water.material.uniforms.uRes.value.set(pw, ph);
}

const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
function setLight(n) {
  // n: 0 golden, 1 afterglow, 2 moonlight
  const i = Math.min(1, Math.floor(n)), t = n - i;
  const a = KEYS[i], b = KEYS[i + 1];
  const s = t * t * (3 - 2 * t);
  U.uSunDir.value.copy(a.sun).lerp(b.sun, s).normalize();
  U.uSunCol.value.fromArray(lerp3(a.sunCol, b.sunCol, s));
  for (const [k, key] of [['uSkyTop', 'skyTop'], ['uSkyHor', 'skyHor'], ['uGlowCol', 'glow'], ['uAmbTop', 'ambTop'], ['uAmbBot', 'ambBot']]) U[k].value.fromArray(lerp3(a[key], b[key], s));
  U.uFogDen.value = a.fog + (b.fog - a.fog) * s;
  U.uNight.value = n / 2;
  U.uSpec.value = a.spec + (b.spec - a.spec) * s;
  const su = sky.material.uniforms;
  su.uStars.value = a.stars + (b.stars - a.stars) * s;
  su.uMoonLit.value = a.moon + (b.moon - a.moon) * s;
  su.uSunDisc.value = a.disc + (b.disc - a.disc) * s;
  su.uMoonDir.value.copy(MOON);
  su.uCloud.value.set(...lerp3(a.cloud, b.cloud, s), 1);
  // exposure in log space
  return Math.exp(Math.log(a.exp) + (Math.log(b.exp) - Math.log(a.exp)) * s);
}

function draw(exposure) {
  resize();
  camera.updateMatrixWorld();
  const cp = camera.position;
  // reflection pass
  U.uMirror.value = -1; U.uCamPos.value.set(cp.x, -cp.y, cp.z);
  water.visible = false; seeds.visible = false;
  renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  water.visible = true; seeds.visible = true;
  U.uMirror.value = 1; U.uCamPos.value.copy(cp);
  water.material.uniforms.uRefl.value = reflRT.texture;
  finalPass.uniforms.uExposure.value = exposure;
  finalPass.uniforms.uGrain.value = (U.uTime.value * 7.13) % 1;
  finalPass.uniforms.uAspect.value = W / H;
  seeds.material.uniforms.uPx.value = H * RS;
  composer.render();
}

// --- the hand: a ring on the screen where it touches
const ring = document.getElementById('hand');
function showHand(h) {
  if (!h || !(h.vis > 0)) { ring.style.opacity = 0; return; }
  const p = V3(h.x, h.y ?? terrainH(h.x, h.z), h.z).project(camera);
  ring.style.opacity = h.vis;
  ring.style.transform = `translate(${(p.x * 0.5 + 0.5) * W}px, ${(-p.y * 0.5 + 0.5) * H}px) translate(-50%, -50%) scale(${h.press ? 0.86 : 1})`;
}

// ===== film
let simT = -1;
function filmFrame(t) {
  if (t < simT - 1e-6 || simT < 0) { touch.reset(); simT = 0; }
  const DT = 1 / 60;
  while (simT + DT <= t + 1e-6) {
    const f = filmAt(simT);
    U.uTime.value = f.time;
    touch.step(f.hand && f.hand.on ? f.hand : null, DT);
    if (f.drip) touch.drip = f.drip;
    simT += DT;
  }
  const f = filmAt(t);
  U.uTime.value = f.time;
  U.uFront.value = f.front;
  camera.position.set(...f.cam);
  camera.lookAt(...f.look);
  const exp = setLight(f.light);
  draw(exp);
  showHand(f.hand);
  return f;
}

if (FILM) {
  document.body.classList.add('film');
  window.__filmLen = FILM_LEN;
  window.__renderAt = (frame, fps) => { const f = filmFrame(frame / fps); return { scene: f.scene, t: +(frame / fps).toFixed(3) }; };
  window.__ready = true;
  if (!RENDER) {
    const t0 = performance.now();
    const loop = () => { filmFrame(((performance.now() - t0) / 1000) % FILM_LEN); requestAnimationFrame(loop); };
    loop();
  }
} else {
  startPage();
}

// ===== the page
function startPage() {
  const T = {
    en: { dusk: 'Dusk', moon: 'Moonlight', hint: 'Drag to part the grass · touch the river' },
    ja: { dusk: '夕暮れ', moon: '月夜', hint: 'ドラッグですすきをかき分ける・川に触れる' },
  };
  const lang = q.get('lang') === 'ja' || (!q.get('lang') && (navigator.language || '').startsWith('ja')) ? 'ja' : 'en';
  const L = T[lang];
  document.documentElement.lang = lang;
  const bDusk = document.getElementById('b-dusk'), bMoon = document.getElementById('b-moon');
  bDusk.textContent = L.dusk; bMoon.textContent = L.moon;
  document.getElementById('hint').textContent = L.hint;
  let target = q.get('t') === 'moon' ? 2 : 0, light = target;
  const pick = (n) => { target = n; bDusk.classList.toggle('on', n === 0); bMoon.classList.toggle('on', n === 2); };
  bDusk.onclick = () => pick(0); bMoon.onclick = () => pick(2);
  pick(target);

  // pointer -> the ground or the water under it
  const ray = new THREE.Raycaster();
  let hand = null, lastMove = 0;
  const hit = (cx, cy) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const o = ray.ray.origin, d = ray.ray.direction;
    for (let s = 0.3; s < 60; s *= 1.02) {
      const x = o.x + d.x * s, y = o.y + d.y * s, z = o.z + d.z * s;
      const g = terrainH(x, z);
      if (y < Math.max(g, 0) + 0.9) {                   // touch the grass at about knee height
        const water = g < 0 && y < 0.05 + 0.9;
        return { x, z, y: Math.max(g, 0), water };
      }
    }
    return null;
  };
  let down = false;
  canvas.addEventListener('pointerdown', (e) => { down = true; canvas.setPointerCapture(e.pointerId); hand = hit(e.clientX, e.clientY); if (hand) hand.on = 1; lastMove = performance.now(); });
  canvas.addEventListener('pointermove', (e) => { if (!down) return; const h = hit(e.clientX, e.clientY); if (h) { hand = h; hand.on = 1; lastMove = performance.now(); } });
  const up = () => { down = false; if (hand) hand.on = 0; };
  canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);

  const t0 = performance.now();
  let prev = t0, acc = 0;
  const R = rng(5);
  const loop = (now) => {
    const dt = Math.min(0.1, (now - prev) / 1000); prev = now;
    const t = (now - t0) / 1000;
    light += (target - light) * Math.min(1, dt * 1.6);
    if (Math.abs(target - light) < 0.002) light = target;
    acc += dt;
    while (acc >= 1 / 60) {
      U.uTime.value += 1 / 60;
      if (R() < 0.006) touch.drip = { x: 0.5 + R() * 4, z: -6 - R() * 14, s: 0.004 };   // a fish, an insect
      touch.step(hand && hand.on ? hand : null, 1 / 60);
      acc -= 1 / 60;
    }
    if (hand && performance.now() - lastMove > 120 && down) hand.on = 0.6;
    // a slow drift of the eye
    camera.position.set(EYE[0] + Math.sin(t * 0.07) * 0.25, terrainH(EYE[0], EYE[1]) + 1.32 + Math.sin(t * 0.11) * 0.04, EYE[1]);
    camera.lookAt(-1.6 + Math.sin(t * 0.05) * 0.8, -1.9, -22);
    U.uFront.value = -1e4;
    draw(setLight(light));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => { if (!FILM) resize(); });
