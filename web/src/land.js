// The ground (near: soil and wet bank; far: a carpet of plumes), the ridges far away, and the sky.
import * as THREE from 'three';
import { COMMON } from './glsl.js';

export function makeGround(uniforms, eye) {
  const NA = 420, NB = 260;
  const pos = [], idx = [];
  for (let i = 0; i <= NA; i++) {
    const a = i / NA;
    const z = eye[1] + 8 - 560 * Math.pow(a, 2.0);
    const half = 14 + 420 * a;
    for (let j = 0; j <= NB; j++) {
      const b = j / NB;
      pos.push(eye[0] + (b - 0.5) * 2 * half, 0, z);
      if (i < NA && j < NB) { const p = i * (NB + 1) + j; idx.push(p, p + NB + 1, p + 1, p + 1, p + NB + 1, p + NB + 2); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: COMMON + /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main(){
        vec2 p = position.xz;
        float h = terrainH(p);
        float e = 0.25;
        vec3 n = normalize(vec3(terrainH(p - vec2(e, 0.)) - terrainH(p + vec2(e, 0.)), 2. * e, terrainH(p - vec2(0., e)) - terrainH(p + vec2(0., e))));
        vW = vec3(p.x, h, p.y); vN = n;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW.x, vW.y * uMirror, vW.z, 1.);
      }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vW; varying vec3 vN;
      void main(){
        if (uMirror < 0. && vW.y < -0.01) discard;
        vec3 N = normalize(vN);
        vec3 V = normalize(uCamPos - vW);
        float dist = length(uCamPos - vW);
        float n1 = fbm(vW.xz * 1.3), n2 = fbm(vW.xz * 0.11);
        // under the clumps: dark litter and old leaves
        vec3 soil = mix(vec3(0.045, 0.04, 0.02), vec3(0.11, 0.09, 0.045), n1);
        float d = riverD(vW.xz);
        float wet = 1. - smoothstep(0.0, 0.9, vW.y);
        soil = mix(soil, vec3(0.03, 0.028, 0.022), wet * 0.8);
        vec3 c = soil * (mix(uAmbBot, uAmbTop, N.y * 0.5 + 0.5) + uSunCol * max(dot(N, uSunDir), 0.) * 0.4);
        // far away the clumps merge into a carpet of plumes, brightening where the gusts lay them down
        float g = gust(vW.xz, uTime);
        vec3 alb = mix(vec3(0.2, 0.17, 0.12), vec3(0.32, 0.27, 0.2), n2) * (0.85 + 0.45 * g);
        vec3 carpet = shadeFoliage(alb, normalize(N + vec3(0., 0.6, 0.)), V, 1., 0.8 + 0.2 * n1, vec3(0.8, 0.62, 0.42) * (0.5 + 0.4 * g));
        float k = smoothstep(22., 90., dist) * smoothstep(0.6, 2.5, d);
        c = mix(c, carpet, k);
        gl_FragColor = vec4(fog(c, vW), 1.);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

// three ranges of hills beyond the field, fading into the haze
export function makeRidges(uniforms, eye) {
  const pos = [], lay = [], idx = [];
  const LAYERS = [[700, 38, 1.0], [1200, 75, 2.0], [2200, 150, 3.0]];
  let v = 0;
  LAYERS.forEach(([D, H, k]) => {
    const N = 240;
    for (let i = 0; i <= N; i++) {
      const az = (i / N - 0.5) * 2.4;                   // radians either side of straight ahead
      const x = eye[0] + Math.sin(az) * D, z = eye[1] - Math.cos(az) * D;
      const h = H * (0.45 + 0.35 * Math.sin(az * 3.1 * k + k) + 0.2 * Math.sin(az * 11.3 + k * 2.) + 0.08 * Math.sin(az * 37 + k));
      pos.push(x, -20, z, x, h, z);
      lay.push(k, 0, k, 1);
      if (i < N) idx.push(v, v + 2, v + 1, v + 1, v + 2, v + 3);
      v += 2;
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aL', new THREE.Float32BufferAttribute(lay, 2));
  g.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    uniforms, side: THREE.DoubleSide,
    vertexShader: COMMON + /* glsl */ `
      attribute vec2 aL; varying vec3 vW; varying vec2 vL;
      void main(){ vW = position; vL = aL; gl_Position = projectionMatrix * viewMatrix * vec4(position.x, position.y * uMirror, position.z, 1.); }`,
    fragmentShader: COMMON + /* glsl */ `
      varying vec3 vW; varying vec2 vL;
      void main(){
        vec3 V = normalize(vW - uCamPos);
        vec3 base = mix(uAmbBot, uAmbTop, 0.5) * 0.25 + uSunCol * 0.02;
        float f = 1. - exp(-length(vW - uCamPos) * uFogDen * (0.35 + 0.25 * vL.x));
        vec3 c = mix(base, hazeCol(V), clamp(f, 0., 1.));
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  return m;
}

export function makeSky(uniforms) {
  const g = new THREE.SphereGeometry(4000, 64, 32);
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...uniforms, uSunDisc: { value: 1 }, uMoonDir: { value: new THREE.Vector3(0, 0.2, -1).normalize() }, uMoonLit: { value: 0 }, uStars: { value: 0 }, uCloud: { value: new THREE.Vector3(1, 1, 1) } },
    side: THREE.DoubleSide, depthWrite: false,
    vertexShader: COMMON + /* glsl */ `
      varying vec3 vD;
      void main(){ vD = normalize(position); vec3 p = cameraPosition + vec3(position.x, position.y * uMirror, position.z); gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.); gl_Position.z = gl_Position.w * 0.99999; }`,
    fragmentShader: COMMON + /* glsl */ `
      uniform float uSunDisc; uniform vec3 uMoonDir; uniform float uMoonLit; uniform float uStars; uniform vec3 uCloud;
      varying vec3 vD;
      void main(){
        vec3 d = normalize(vD);
        vec3 c = skyCol(d);
        // the Sun's disc (only while it is the light)
        float sd = dot(d, uSunDir);
        c += uGlowCol * 30. * smoothstep(0.99985, 0.99992, sd) * uSunDisc;
        // stars
        if (uStars > 0.) {
          vec3 q = d * 420.;
          vec3 cell = floor(q);
          float h = hash12(cell.xy + cell.z * 17.3);
          vec3 fp = fract(q) - 0.5;
          float s = smoothstep(0.2, 0.0, length(fp)) * step(0.985, h) * pow(h, 30.) * 6.;
          c += vec3(0.8, 0.85, 1.0) * s * uStars * smoothstep(0.02, 0.2, d.y);
        }
        // the Moon
        float md = dot(d, uMoonDir);
        float disc = smoothstep(0.999955, 0.99998, md);
        if (disc > 0. && uMoonLit > 0.) {
          vec3 r = normalize(cross(uMoonDir, vec3(0, 1, 0)));
          vec3 up = cross(r, uMoonDir);
          vec2 p = vec2(dot(d, r), dot(d, up)) / 0.0063;
          float mare = fbm(p * 2.2 + 5.);
          c = mix(c, vec3(1.0, 0.97, 0.9) * (6. - 2.8 * smoothstep(0.45, 0.7, mare)), disc * min(uMoonLit * 2., 1.));
        }
        c += vec3(0.6, 0.7, 0.9) * 0.25 * pow(max(md, 0.), 900.) * uMoonLit;
        // clouds: thin streaks on a high plane, lit at their edges toward the light
        if (d.y > 0.0) {
          vec2 cp = d.xz / (d.y + 0.08) * 1.6 + vec2(uTime * 0.004, 0.);
          float n = fbm(cp * vec2(0.7, 1.6) + 2.) * 0.8 + fbm(cp * 2.5 + 9.) * 0.3;
          float cov = smoothstep(0.5, 0.9, n) * 0.8 * smoothstep(0.0, 0.12, d.y) * uCloud.x;
          float toL = pow(max(sd, 0.), 6.);
          vec3 cc = mix(uSkyHor * 0.55 + uAmbTop * 0.2, uGlowCol * 0.9, toL) * uCloud.y;
          c = mix(c, cc, cov * 0.85);
        }
        gl_FragColor = vec4(c, 1.);
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.renderOrder = -10;
  return m;
}
