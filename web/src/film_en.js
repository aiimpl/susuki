// The 15-second film for the English post (?film=en): the same place, shot with a lens.
// Golden hour with light shafts and a gust rolling in, a hand parting the plumes into the river,
// the Sun going down, then the Moon's path on the water and a slow rise over the field.
import { terrainH } from './world.js';

export const FILM_LEN = 15;

const sm = (a, b, t) => { const x = Math.min(1, Math.max(0, (t - a) / (b - a))); return x * x * (3 - 2 * x); };
const lerp = (a, b, t) => a + (b - a) * t;

function path(keys, t) {
  if (t <= keys[0][0]) return keys[0].slice(1);
  for (let i = 0; i < keys.length - 1; i++) {
    const [t0, x0, z0] = keys[i], [t1, x1, z1] = keys[i + 1];
    if (t <= t1) { const s = sm(t0, t1, t) * 0.6 + ((t - t0) / (t1 - t0)) * 0.4; return [lerp(x0, x1, s), lerp(z0, z1, s)]; }
  }
  return keys[keys.length - 1].slice(1);
}

const HAND1 = [[4.0, -2.6, -2.5], [4.9, -2.5, -3.5], [5.6, -2.3, -4.5], [6.2, -1.6, -5.4], [6.7, -0.8, -5.9], [7.2, -0.1, -6.2]];
const HAND2 = [[9.4, -1.5, -7.6], [10.3, -0.8, -8.8], [11.2, -0.1, -9.8]];

export function filmAt(t) {
  const out = { time: 40 + t, scene: '' };
  out.light = 2 * sm(7.2, 8.8, t);
  out.scene = t < 4 ? 'gust' : t < 7.2 ? 'touch' : t < 8.8 ? 'dusk' : t < 12.2 ? 'moon' : 'rise';
  // a gust that rolls in toward us while we watch, and one more at the end
  out.front = t < 7 ? lerp(-45, 16, t / 4.6) : t > 11.5 ? lerp(-70, 14, (t - 11.8) / 3.4) : -1e4;
  // the eye: a slow push along the bank, then up over the plumes
  const k = Math.min(t, 12.2) / 12.2;
  const z = lerp(1.9, -1.0, sm(0, 12.2, t) * 0.7 + k * 0.3);
  const x = lerp(-2.7, -2.35, k);
  const g = terrainH(x, z);
  const rise = sm(12.0, 15, t);
  out.cam = [x - rise * 0.3, g + 1.3 + Math.sin(t * 1.7) * 0.01 + rise * 1.35, z + rise * 1.5];
  out.look = [lerp(-1.5, -1.9, t / 15), lerp(-1.7, -2.6, rise), -22];
  // focus: the backlit plumes, pulled in to the hand while it parts them, then out to the water
  const near = sm(4.0, 4.6, t) * (1 - sm(6.4, 7.4, t));
  out.lens = { focus: lerp(lerp(7.5, 4.2, near), 5.5, sm(8.8, 10, t)), aperture: lerp(lerp(12, 8, sm(8.8, 10, t)), 6, rise) };
  // the hand
  let hand = null;
  const vis1 = sm(3.75, 4.05, t) * (1 - sm(7.1, 7.45, t));
  const vis2 = sm(9.15, 9.45, t) * (1 - sm(11.1, 11.45, t));
  if (vis1 > 0) {
    const [hx, hz] = path(HAND1, t);
    const gh = terrainH(hx, hz);
    hand = { x: hx, z: hz, y: Math.max(gh, 0) + (gh < 0 ? 0 : 1.15 * Math.min(1, gh / 0.25)), on: t > 4.0 && t < 7.15 ? 1 : 0, water: gh < 0, vis: vis1 };
  } else if (vis2 > 0) {
    const [hx, hz] = path(HAND2, t);
    hand = { x: hx, z: hz, y: 0, on: t > 9.4 && t < 11.1 ? 1 : 0, water: true, vis: vis2 };
  }
  if (hand) hand.press = hand.on > 0;
  out.hand = hand;
  const drips = [[11.9, 3.4, -14], [13.4, 0.8, -19]];
  for (const [dt, dx, dz] of drips) if (t >= dt && t < dt + 1 / 60) out.drip = { x: dx, z: dz, s: 0.012 };
  return out;
}
