// GLSL shared by every material: noise, the land and the river, wind, sky and haze, foliage light.
// world.js has the same land in JS; keep the two in step.

export const COMMON = /* glsl */ `
uniform float uTime;
uniform vec3 uSunDir;     // toward the light that shapes the picture (the Sun, later the Moon)
uniform vec3 uSunCol;     // its radiance
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform vec3 uGlowCol;    // the glow around the light, also the haze toward it
uniform vec3 uAmbTop;
uniform vec3 uAmbBot;
uniform float uFogDen;
uniform float uNight;
uniform vec2 uWind;       // where the wind blows to (unit, xz)
uniform float uWindStr;
uniform float uFront;     // a scripted big gust: its front, metres along the wind (-1e4 = none)
uniform float uMirror;    // 1, or -1 while drawing the reflection in the river
uniform float uSpec;      // glitter on the water
uniform vec3 uCamPos;     // the eye (mirrored below the water in the reflection pass)
uniform sampler2D uTrample;
uniform vec4 uTrampleBox; // x0, z0, width, depth

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){ float a = .5, s = 0.; for (int i = 0; i < 4; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(17.1, 9.2); a *= .5; } return s; }

float riverX(float z){ return -2.6 + 0.075 * (z - 1.) + 4.6 * exp(-pow(z / 50., 2.)) + 2.2 * sin(z * 0.03) * smoothstep(10., 80., -z); }
float riverW(float z){ return 3.0 + 0.7 * sin(z * 0.043 + 0.7); }
float bankWob(float z){ return 0.45 * sin(z * 0.61 + 1.3) * sin(z * 0.23) + 0.25 * sin(z * 1.7 + 0.4); }
float riverD(vec2 p){ float s = p.x - riverX(p.y); return abs(s) - riverW(p.y) + bankWob(p.y + sign(s) * 37.); }   // < 0 in the water
float terrainH(vec2 p){
  float d = riverD(p);
  float w = riverW(p.y);
  float bed = -0.55 * (1. - pow(clamp((d + w) / w, 0., 1.), 2.)) - 0.08;
  float hills = 0.55 * sin(p.x * 0.035 + 0.3) * sin(p.y * 0.027) + 0.25 * sin(p.x * 0.09 + p.y * 0.05);
  float far = 7.0 * smoothstep(120., 420., -p.y) * (0.6 + 0.4 * sin(p.x * 0.013 + 1.));
  float bank = smoothstep(-0.15, 1.7, d);
  return mix(bed, 0.32 + (hills + far) * smoothstep(0.5, 12., d), bank);
}

float gust(vec2 p, float t){
  float along = dot(p, uWind), across = dot(p, vec2(-uWind.y, uWind.x));
  float g = fbm(vec2(along * 0.05 - t * 0.36, across * 0.028 + 3.));
  g = smoothstep(0.38, 0.78, g);
  if (uFront > -1e3) g += 1.1 * exp(-pow((along - uFront) / 7., 2.));
  return g;
}
vec2 windAt(vec2 p, float t, float ph){
  float g = gust(p, t);
  float fl = sin(t * 2.1 + ph) * 0.55 + sin(t * 3.3 + ph * 1.7) * 0.3;
  return uWind * uWindStr * (0.22 + 0.95 * g + 0.16 * fl * (0.35 + g));
}
vec2 trampleAt(vec2 p){
  vec2 uv = (p - uTrampleBox.xy) / uTrampleBox.zw;
  if (uv.x < 0. || uv.y < 0. || uv.x > 1. || uv.y > 1.) return vec2(0.);
  return texture2D(uTrample, uv).xy;
}

vec3 skyCol(vec3 d){
  float e = d.y, sd = max(dot(d, uSunDir), 0.);
  vec3 mid = uSkyHor * vec3(0.62, 0.52, 0.55);
  vec3 c = mix(uSkyHor, mid, smoothstep(0.0, 0.1, e));
  c = mix(c, uSkyTop, smoothstep(0.06, 0.45, e));
  float low = 1. - 0.6 * clamp(e * 2., 0., 1.);
  c += uGlowCol * (0.18 * pow(sd, 5.) + 0.45 * pow(sd, 40.) + 1.6 * pow(sd, 500.)) * low;
  return c;
}
vec3 hazeCol(vec3 d){ return skyCol(normalize(vec3(d.x, max(d.y, 0.015), d.z))); }
vec3 fog(vec3 col, vec3 wp){
  vec3 v = wp - uCamPos; float dist = length(v);
  float f = 1. - exp(-dist * uFogDen);
  return mix(col, hazeCol(v / dist), f);
}

// thin foliage: wrapped diffuse from the light, sky light, and the light shining through when the eye faces it
vec3 shadeFoliage(vec3 alb, vec3 N, vec3 V, float trans, float ao, vec3 transCol){
  vec3 L = uSunDir;
  if (dot(N, V) < 0.) N = -N;
  float diff = clamp((dot(N, L) + 0.35) / 1.35, 0., 1.);
  vec3 amb = mix(uAmbBot, uAmbTop, clamp(N.y * 0.5 + 0.5, 0., 1.));
  float through = pow(max(dot(-V, L), 0.), 5.) * 0.7 + pow(max(dot(-V, L), 0.), 40.) * 1.4;
  float behind = 0.25 + 0.75 * max(-dot(N, L), 0.);   // light reaching the far side of a thin leaf
  float edge = pow(1. - abs(dot(N, V)), 2.);
  return alb * (amb * ao + uSunCol * diff * ao * 0.75) + transCol * uSunCol * (through * behind * (0.45 + edge)) * trans * ao * ao;
}
`;
