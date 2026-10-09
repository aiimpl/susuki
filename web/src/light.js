// The three light keys (golden hour, afterglow, moonlight) and the blend between them.
import * as THREE from 'three';

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
export const SUN = V3(-0.075, 0.062, -1).normalize();
export const MOON = V3(0.075, 0.2, -1).normalize();

// rays: light shafts strength; dof: lens aperture (blur radius scale)
const KEYS = [
  { sun: SUN, sunCol: [5.6, 3.0, 1.25], skyTop: [0.11, 0.12, 0.22], skyHor: [1.25, 0.5, 0.16], glow: [1.9, 0.78, 0.22], ambTop: [0.11, 0.11, 0.17], ambBot: [0.07, 0.045, 0.025], fog: 0.0026, exp: 0.62, spec: 1, stars: 0, moon: 0, disc: 1, cloud: [1, 1], rays: 0.4 },
  { sun: V3(-0.075, -0.03, -1).normalize(), sunCol: [0.9, 0.42, 0.3], skyTop: [0.07, 0.09, 0.22], skyHor: [0.75, 0.3, 0.26], glow: [1.0, 0.38, 0.22], ambTop: [0.12, 0.12, 0.2], ambBot: [0.06, 0.04, 0.04], fog: 0.005, exp: 1.0, spec: 0.6, stars: 0.2, moon: 0.4, disc: 0, cloud: [1, 0.8], rays: 0.5 },
  { sun: MOON, sunCol: [0.42, 0.5, 0.66], skyTop: [0.003, 0.006, 0.016], skyHor: [0.012, 0.02, 0.036], glow: [0.07, 0.09, 0.13], ambTop: [0.035, 0.05, 0.085], ambBot: [0.008, 0.01, 0.014], fog: 0.0035, exp: 1.25, spec: 0.3, stars: 1, moon: 1, disc: 0, cloud: [0.7, 0.55], rays: 0.22 },
];

const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const lerp = (a, b, t) => a + (b - a) * t;

// n: 0 golden, 1 afterglow, 2 moonlight. Sets the shared uniforms and the sky's; returns {exposure, rays}
export function setLight(U, sky, n) {
  const i = Math.min(1, Math.floor(n)), t = n - i;
  const a = KEYS[i], b = KEYS[i + 1];
  const s = t * t * (3 - 2 * t);
  U.uSunDir.value.copy(a.sun).lerp(b.sun, s).normalize();
  U.uSunCol.value.fromArray(lerp3(a.sunCol, b.sunCol, s));
  for (const [k, key] of [['uSkyTop', 'skyTop'], ['uSkyHor', 'skyHor'], ['uGlowCol', 'glow'], ['uAmbTop', 'ambTop'], ['uAmbBot', 'ambBot']]) U[k].value.fromArray(lerp3(a[key], b[key], s));
  U.uFogDen.value = lerp(a.fog, b.fog, s);
  U.uNight.value = n / 2;
  U.uSpec.value = lerp(a.spec, b.spec, s);
  const su = sky.material.uniforms;
  su.uStars.value = lerp(a.stars, b.stars, s);
  su.uMoonLit.value = lerp(a.moon, b.moon, s);
  su.uSunDisc.value = lerp(a.disc, b.disc, s);
  su.uMoonDir.value.copy(MOON);
  su.uCloud.value.set(...lerp3(a.cloud, b.cloud, s), 1);
  return { exposure: Math.exp(lerp(Math.log(a.exp), Math.log(b.exp), s)), rays: lerp(a.rays, b.rays, s), moon: n > 1 };
}
