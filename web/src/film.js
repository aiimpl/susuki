// The 15-second film: what happens at each second (camera, light, gusts, the hand).
import { terrainH } from './world.js';

export const FILM_LEN = 15;

const sm = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

// a path through keys [t, x, z]
function path(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, x0, z0] = keys[i], [t1, x1, z1] = keys[i + 1];
    if (t <= t1) { const s = sm(t0, t1, t) * 0.6 + ((t - t0) / (t1 - t0)) * 0.4; return [lerp(x0, x1, s), lerp(z0, z1, s)]; }
  }
  return keys[keys.length - 1].slice(1);
}

const HAND1 = [[3.0, -2.6, -2.5], [3.9, -2.5, -3.5], [4.6, -2.3, -4.5], [5.2, -1.6, -5.4], [5.7, -0.8, -5.9], [6.2, -0.1, -6.2]];
const HAND2 = [[8.4, -1.5, -7.6], [9.3, -0.8, -8.8], [10.2, -0.1, -9.8]];

export function filmAt(t) {
  const out = { time: 40 + t, scene: '' };
  // light: golden hour, then the Sun goes and the Moon is up
  out.light = 2 * sm(6.0, 7.3, t);
  out.scene = t < 3 ? 'gust' : t < 6.2 ? 'touch' : t < 7.3 ? 'dusk' : t < 12 ? 'moon' : 'rise';
  // gusts: one sweeping toward us at the start, one at the end
  out.front = t < 6 ? lerp(-32, 14, t / 3.4) : t > 11 ? lerp(-60, 12, (t - 11.4) / 3.6) : -1e4;
  // the eye: a slow walk along the bank, then up over the plumes
  const z = lerp(1.7, -1.0, sm(0, 12, t) * 0.7 + (Math.min(t, 12) / 12) * 0.3);
  const x = lerp(-2.65, -2.35, Math.min(t, 12) / 12);
  const g = terrainH(x, z);
  const rise = sm(11.6, 15, t);
  out.cam = [x - rise * 0.3, g + 1.32 + Math.sin(t * 1.9) * 0.012 + rise * 1.25, z + rise * 1.4];
  out.look = [lerp(-1.4, -1.9, t / 15), lerp(-1.9, -2.8, rise), -22];
  // the hand
  let hand = null;
  const vis1 = sm(2.75, 3.05, t) * (1 - sm(6.1, 6.45, t));
  const vis2 = sm(8.15, 8.45, t) * (1 - sm(10.1, 10.45, t));
  if (vis1 > 0) {
    const [hx, hz] = path(HAND1, t);
    const gh = terrainH(hx, hz);
    hand = { x: hx, z: hz, y: Math.max(gh, 0) + (gh < 0 ? 0 : 1.15 * Math.min(1, gh / 0.25)), on: t > 3.0 && t < 6.15 ? 1 : 0, water: gh < 0, vis: vis1 };
  } else if (vis2 > 0) {
    const [hx, hz] = path(HAND2, t);
    hand = { x: hx, z: hz, y: 0, on: t > 8.4 && t < 10.1 ? 1 : 0, water: true, vis: vis2 };
  }
  if (hand) hand.press = hand.on > 0;
  out.hand = hand;
  // a fish rising in the moonlight
  const drips = [[10.9, 3.4, -14], [12.6, 0.8, -19]];
  for (const [dt, dx, dz] of drips) if (t >= dt && t < dt + 1 / 60) out.drip = { x: dx, z: dz, s: 0.012 };
  return out;
}
