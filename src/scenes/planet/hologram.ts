import * as THREE from 'three';

/** Largest outline the shader accepts (the octagon). */
export const HOLO_MAX_VERTS = 8;

/** Per-screen look, seeded so neighbouring screens never match. */
export interface HoloLook {
  /** Scanline frequency (radians per world unit) */
  scan: number;
  /** Scanline direction in radians (0 = horizontal lines) */
  angle: number;
  /** 0..1 strength of a dot grid behind the content */
  grid: number;
  /** Width of the eroded, fizzing border in world units */
  edge: number;
  /** Noise scale of the erosion */
  grain: number;
  /** 0..1 shift of the rim colour toward white */
  tint: number;
}

export const holoLook = (rnd: () => number): HoloLook => ({
  scan: 140 + rnd() * 110,
  angle: [0, 0, Math.PI / 2, 0.42, -0.42][Math.floor(rnd() * 5)],
  grid: rnd() < 0.45 ? 0.5 + rnd() * 0.5 : 0,
  edge: 0.022 + rnd() * 0.022,
  grain: 34 + rnd() * 30,
  tint: rnd() * 0.45,
});

const vert = /* glsl */ `
  varying vec2 vP;
  void main() {
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */ `
  #define MAXV ${HOLO_MAX_VERTS}
  uniform vec2 uPoly[MAXV];
  uniform int uN;
  uniform float uM;
  uniform float uTime;
  uniform float uSeed;
  uniform float uOpacity;
  uniform vec3 uAccent;
  uniform vec3 uCore;
  uniform vec4 uLook;   // scan, angle, grid, edge
  uniform vec2 uLook2;  // grain, tint
  varying vec2 vP;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }

  // distance from the fragment to the nearest outline edge (fragments are always inside)
  float edgeDist(vec2 p) {
    float d = 1e5;
    for (int k = 0; k < MAXV; k++) {
      if (k >= uN) break;
      vec2 a = uPoly[k];
      vec2 b = uPoly[k + 1 < uN ? k + 1 : 0];
      vec2 ab = b - a;
      float h = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
      d = min(d, length(p - a - ab * h));
    }
    return d;
  }

  void main() {
    float t = uTime;
    float d = edgeDist(vP);
    float ew = mix(0.012, uLook.w, uM);

    // the border erodes along drifting noise and keeps fizzing
    float n = noise(vP * uLook2.x + vec2(t * 0.7, -t * 0.45) + uSeed * 13.0);
    float n2 = noise(vP * uLook2.x * 2.7 - vec2(t * 1.3, t * 0.9) + uSeed * 7.0);
    float erode = (n * 0.7 + n2 * 0.3) * ew;
    float body = smoothstep(0.0, ew * 0.6, d - erode);

    // specks that crackle off just outside the eroded line
    vec2 cell = floor(vP * 190.0);
    float spark = step(0.965, hash(cell + floor(t * 12.0) + uSeed)) * (1.0 - smoothstep(0.0, ew * 1.6, d)) * (1.0 - body);

    // soft rim light hugging the eroded edge
    float rim = exp(-max(d - erode, 0.0) / max(ew * 0.35, 0.002)) * body;

    // scanlines, a slow refresh band and a faint dot grid
    vec2 dir = vec2(-sin(uLook.y), cos(uLook.y));
    float scan = 0.5 + 0.5 * sin(dot(vP, dir) * uLook.x + t * 2.2);
    float band = 1.0 - smoothstep(0.0, 0.16, abs(fract(dot(vP, dir) * 1.1 - t * 0.12 + uSeed) - 0.5));
    vec2 g = fract(vP * 70.0) - 0.5;
    float dots = (1.0 - smoothstep(0.05, 0.11, length(g))) * uLook.z;

    // while flying, the face itself dissolves in and out of noise
    float mid = sin(3.14159 * clamp(uM, 0.0, 1.0));
    float build = mix(1.0, smoothstep(0.25, 0.75, noise(vP * 16.0 + uSeed * 3.0 + t * 0.4) + (uM - 0.5) * 1.2), mid);

    // rare flicker
    float flick = 1.0 - 0.18 * step(0.985, hash(vec2(floor(t * 18.0), uSeed)));

    vec3 rimCol = mix(uAccent, vec3(1.0), uLook2.y);
    vec3 base = mix(uAccent * 0.3, uCore, uM);
    vec3 col = base
      + uAccent * (scan * 0.007 + band * 0.012 + dots * 0.014) * uM
      + rimCol * rim * mix(0.7, 0.42, uM)
      + rimCol * spark * 0.8;

    float a = body * build * mix(0.5, 0.9, uM) * (0.95 + scan * 0.05);
    a += rim * 0.25 + spark * 0.75;
    a *= flick * uOpacity;
    if (a < 0.003) discard;
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const hologramMaterial = (accent: THREE.Color, look: HoloLook, seed: number) =>
  new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: {
      uPoly: { value: Array.from({ length: HOLO_MAX_VERTS }, () => new THREE.Vector2()) },
      uN: { value: 0 },
      uM: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: seed },
      uOpacity: { value: 1 },
      uAccent: { value: accent.clone() },
      uCore: { value: new THREE.Color('#070a12').lerp(accent, 0.05) },
      uLook: { value: new THREE.Vector4(look.scan, look.angle, look.grid, look.edge) },
      uLook2: { value: new THREE.Vector2(look.grain, look.tint) },
    },
  });
