// After the scene: depth of field, light shafts toward the Sun or the Moon, bloom, then tone mapping.
// The scene is drawn into a 4x MSAA half-float target whose depth is resolved into a texture, so the
// later passes can read how far each pixel is.
import * as THREE from 'three';
import { UnrealBloomPass } from '../vendor/three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FullScreenQuad } from '../vendor/three/examples/jsm/postprocessing/Pass.js';

const LIN = /* glsl */ `
uniform float uNear; uniform float uFar;
float linDepth(float d){ float z = d * 2. - 1.; return 2. * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
`;
const VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';

// depth of field: gather over a golden-angle disc, each tap counted if its own blur reaches this pixel
const DOF_FS = LIN + /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uPx; uniform float uFocus; uniform float uAperture; uniform float uMaxR;
varying vec2 vUv;
float coc(float z){ return clamp(uAperture * abs(1. / uFocus - 1. / z), 0., uMaxR); }
void main(){
  float zc = linDepth(texture2D(tDepth, vUv).x);
  float rc = coc(zc);
  vec3 acc = texture2D(tColor, vUv).rgb; float wsum = 1.;
  const int N = 40;
  for (int i = 1; i < N; i++) {
    float f = float(i) / float(N);
    float r = sqrt(f) * uMaxR;
    float a = float(i) * 2.39996;
    vec2 uv = vUv + vec2(cos(a), sin(a)) * r * uPx;
    float z = linDepth(texture2D(tDepth, uv).x);
    float rs = coc(z);
    // a tap counts if it is blurred enough to reach us; behind-in-focus taps don't bleed over a blurred foreground
    float w = smoothstep(r - 1.5, r, z < zc ? rs : min(rs, rc));
    acc += texture2D(tColor, uv).rgb * w; wsum += w;
  }
  gl_FragColor = vec4(acc / wsum, 1.);
}`;

// light shafts (GPU Gems 3, ch. 13): the bright open sky near the light, smeared toward it
const MASK_FS = LIN + /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tDepth; uniform vec2 uLight; uniform float uAspect;
varying vec2 vUv;
void main(){
  float sky = step(0.99999, texture2D(tDepth, vUv).x);
  vec3 c = min(max(texture2D(tColor, vUv).rgb - 1.2, 0.), vec3(8.));
  float near = smoothstep(0.32, 0.0, length((vUv - uLight) * vec2(uAspect, 1.)));
  gl_FragColor = vec4(c * sky * near, 1.);
}`;
const RAYS_FS = /* glsl */ `
uniform sampler2D tMask; uniform vec2 uLight; uniform float uLen; uniform float uDecay;
varying vec2 vUv;
void main(){
  const int N = 48;
  vec2 d = (vUv - uLight) * uLen / float(N);
  vec2 uv = vUv; vec3 acc = vec3(0.); float k = 1.;
  for (int i = 0; i < N; i++) { uv -= d; acc += texture2D(tMask, uv).rgb * k; k *= uDecay; }
  gl_FragColor = vec4(acc / float(N), 1.);
}`;

const FINAL_FS = /* glsl */ `
uniform sampler2D tColor; uniform sampler2D tRays; uniform float uRays; uniform float uExposure; uniform float uGrain; uniform float uAspect; uniform float uCA;
varying vec2 vUv;
vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0., 1.); }
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + uGrain) * 43758.5453); }
void main(){
  vec2 v = (vUv - 0.5) * vec2(uAspect, 1.);
  vec2 ca = (vUv - 0.5) * uCA * dot(v, v);
  vec3 c = vec3(texture2D(tColor, vUv - ca).r, texture2D(tColor, vUv).g, texture2D(tColor, vUv + ca).b);
  c += texture2D(tRays, vUv).rgb * uRays;
  c *= uExposure;
  c *= 1. - 0.38 * smoothstep(0.25, 0.9, length(v));
  c = aces(c);
  c = pow(c, vec3(1. / 2.2));
  c += (h(vUv * 1000.) - 0.5) * 0.016;
  gl_FragColor = vec4(c, 1.);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    const mat = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.uLin = { uNear: { value: 0.05 }, uFar: { value: 6000 } };
    this.dof = new FullScreenQuad(mat(DOF_FS, { ...this.uLin, tColor: { value: null }, tDepth: { value: null }, uPx: { value: new THREE.Vector2() }, uFocus: { value: 8 }, uAperture: { value: 0 }, uMaxR: { value: 12 } }));
    this.mask = new FullScreenQuad(mat(MASK_FS, { ...this.uLin, tColor: { value: null }, tDepth: { value: null }, uLight: { value: new THREE.Vector2() }, uAspect: { value: 1 } }));
    this.rays = new FullScreenQuad(mat(RAYS_FS, { tMask: { value: null }, uLight: { value: new THREE.Vector2() }, uLen: { value: 0.9 }, uDecay: { value: 0.985 } }));
    this.final = new FullScreenQuad(mat(FINAL_FS, { tColor: { value: null }, tRays: { value: null }, uRays: { value: 0 }, uExposure: { value: 1 }, uGrain: { value: 0 }, uAspect: { value: 1 }, uCA: { value: 0.0025 } }));
    this.opts = { focus: 8, aperture: 0, rays: 0, exposure: 1, grain: 0 };
  }
  setSize(w, h) {
    for (const t of [this.scene, this.blur, this.mA, this.mB]) t?.dispose();
    const hf = { type: THREE.HalfFloatType };
    this.scene = new THREE.WebGLRenderTarget(w, h, { ...hf, samples: 4, depthTexture: new THREE.DepthTexture(w, h, THREE.FloatType) });
    this.blur = new THREE.WebGLRenderTarget(w, h, { ...hf, depthBuffer: false });
    const hw = Math.round(w / 2), hh = Math.round(h / 2);
    this.mA = new THREE.WebGLRenderTarget(hw, hh, { ...hf, depthBuffer: false });
    this.mB = new THREE.WebGLRenderTarget(hw, hh, { ...hf, depthBuffer: false });
    this.bloom?.dispose();
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.3, 0.4, 3.5);
    this.w = w; this.h = h;
  }
  get target() { return this.scene; }
  // light: the Sun's or the Moon's position on the screen (0..1), or null when it is behind the eye
  render(camera, light) {
    const r = this.r, o = this.opts;
    this.uLin.uNear.value = camera.near; this.uLin.uFar.value = camera.far;
    const aspect = this.w / this.h;
    // depth of field
    const du = this.dof.material.uniforms;
    du.tColor.value = this.scene.texture; du.tDepth.value = this.scene.depthTexture;
    du.uPx.value.set(1 / this.w, 1 / this.h).multiplyScalar(this.h / 1350);
    du.uFocus.value = o.focus; du.uAperture.value = o.aperture; du.uMaxR.value = 12;
    r.setRenderTarget(this.blur); this.dof.render(r);
    // light shafts
    let rays = 0;
    if (light && o.rays > 0) {
      const mu = this.mask.material.uniforms;
      mu.tColor.value = this.scene.texture; mu.tDepth.value = this.scene.depthTexture; mu.uLight.value.copy(light); mu.uAspect.value = aspect;
      r.setRenderTarget(this.mA); this.mask.render(r);
      const ru = this.rays.material.uniforms;
      ru.uLight.value.copy(light);
      ru.tMask.value = this.mA.texture; ru.uLen.value = 0.85; ru.uDecay.value = 0.985;
      r.setRenderTarget(this.mB); this.rays.render(r);
      ru.tMask.value = this.mB.texture; ru.uLen.value = 0.25; ru.uDecay.value = 0.995;
      r.setRenderTarget(this.mA); this.rays.render(r);
      rays = o.rays;
    }
    // bloom adds into the blurred picture
    this.bloom.render(r, null, this.blur);
    const fu = this.final.material.uniforms;
    fu.tColor.value = this.blur.texture; fu.tRays.value = this.mA.texture; fu.uRays.value = rays;
    fu.uExposure.value = o.exposure; fu.uGrain.value = o.grain; fu.uAspect.value = aspect;
    r.setRenderTarget(null); this.final.render(r);
  }
}
