// Susuki by the river: the page (drag to part the grass and touch the water) and the film (?film / ?render).
import * as THREE from 'three';
import { Post } from './post.js';
import { setLight } from './light.js';
import { makeDragonflies } from './critters.js';
import { makeClumps, terrainH, rng } from './world.js';
import { makeSusuki } from './susuki.js';
import { makeGround, makeRidges, makeSky } from './land.js';
import { Touch, makeWater, makeSeeds, makeFloaters } from './water.js';
import * as filmJa from './film.js';
import * as filmEn from './film_en.js';

const q = new URLSearchParams(location.search);
const RENDER = q.has('render'), FILM = RENDER || q.has('film');
const { FILM_LEN, filmAt } = (q.get('v') || q.get('film')) === 'en' ? filmEn : filmJa;
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

const scene = new THREE.Scene();
const clumps = makeClumps({ eye: EYE, keep: [[EYE[0] + 0.3, 2.2, 1.3], [EYE[0] + 0.3, 0.9, 1.3], [EYE[0] + 0.4, -0.4, 1.3], [EYE[0] + 0.5, -1.8, 1.3]], density: FILM ? 1 : QUALITY + 0.15 });
const susuki = makeSusuki(clumps, U, { quality: QUALITY, eye: EYE });
const touch = new Touch(renderer, U);
const sky = makeSky(U);
const ground = makeGround(U, EYE);
const ridges = makeRidges(U, EYE);
const water = makeWater(U, touch, EYE);
const seeds = makeSeeds(U, EYE, FILM ? 1600 : 900);
const floaters = makeFloaters(U);
const flies = makeDragonflies(U, [[-2.45, 1.95, -0.6, 0.35], [-1.9, 1.75, -1.4, 0.4], [-2.9, 2.05, -1.9, 0.4], [-1.2, 1.25, -2.2, 0.45], [-2.2, 2.25, -3.0, 0.5], [-0.6, 1.0, -3.4, 0.5], [-3.3, 1.8, -2.6, 0.4]]);
scene.add(sky, ridges, ground, susuki, water, seeds, floaters, flies);
console.log('susuki', JSON.stringify(susuki.userData.counts), 'clumps', clumps.length);

const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 6000);

// the reflection: the same camera, the scene mirrored in y = 0, drawn first into its own target
let reflRT = null;
const post = new Post(renderer);

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
  reflRT?.dispose();
  reflRT = new THREE.WebGLRenderTarget(Math.round(pw * 0.6), Math.round(ph * 0.6), { type: THREE.HalfFloatType, samples: 4 });
  post.setSize(pw, ph);
  water.material.uniforms.uRes.value.set(pw, ph);
}

const lightPos = new THREE.Vector3();
function draw(lit, lens = {}) {
  resize();
  flies.material.uniforms.uShow.value = 1 - Math.min(1, Math.max(0, (U.uNight.value * 2 - 0.5) / 0.6));
  camera.updateMatrixWorld();
  const cp = camera.position;
  // reflection pass
  U.uMirror.value = -1; U.uCamPos.value.set(cp.x, -cp.y, cp.z);
  water.visible = false; seeds.visible = false; floaters.visible = false; flies.visible = false;
  renderer.setRenderTarget(reflRT); renderer.clear(); renderer.render(scene, camera);
  water.visible = true; seeds.visible = true; floaters.visible = true; flies.visible = flies.material.uniforms.uShow.value > 0;
  U.uMirror.value = 1; U.uCamPos.value.copy(cp);
  water.material.uniforms.uRefl.value = reflRT.texture;
  seeds.material.uniforms.uPx.value = floaters.material.uniforms.uPx.value = H * RS;
  renderer.setRenderTarget(post.target); renderer.clear(); renderer.render(scene, camera);
  // where the light is on the screen, for the shafts
  lightPos.copy(U.uSunDir.value).multiplyScalar(1000).add(cp).project(camera);
  const onScreen = lightPos.z < 1 && Math.abs(lightPos.x) < 1.6 && Math.abs(lightPos.y) < 1.6;
  Object.assign(post.opts, { exposure: lit.exposure, rays: lit.rays, grain: (U.uTime.value * 7.13) % 1, focus: lens.focus ?? 9, aperture: lens.aperture ?? 8 });
  post.render(camera, onScreen ? new THREE.Vector2(lightPos.x * 0.5 + 0.5, lightPos.y * 0.5 + 0.5) : null);
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
  draw(setLight(U, sky, f.light), f.lens);
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
    draw(setLight(U, sky, light));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
window.addEventListener('resize', () => { if (!FILM) resize(); });
