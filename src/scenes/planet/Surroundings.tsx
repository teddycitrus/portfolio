import { useEffect, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Planet } from '@/types/content';
import type { ResolvedSky } from '@/data/skyPresets';
import { CLOUD_DECK_Y, fbm2, heightFor, noise2, TERRAIN_RADIUS, terrainPalette, WATER_LEVEL } from './Terrain';

/* ---------- shallow water (oceanic) ---------- */

const WATER_RADIUS = 360;

const waterVert = /* glsl */ `
  attribute float aDepth;
  varying vec3 vW;
  varying float vDepth;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vDepth = aDepth;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const waterFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uSun;
  uniform vec3 uSunColor;
  uniform vec3 uSky;
  uniform vec3 uHorizon;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform float uFogDensity;
  varying vec3 vW;
  varying float vDepth;
  vec2 wave(vec2 p, vec2 d, float k, float s, float a) {
    float ph = dot(p, d) * k + uTime * s;
    return d * cos(ph) * k * a;
  }
  void main() {
    vec3 V = normalize(cameraPosition - vW);
    vec2 p = vW.xz;
    // summed analytic wave slopes for a cheap rippled normal
    vec2 g = wave(p, vec2(0.8, 0.6), 0.9, 1.1, 0.06)
           + wave(p, vec2(-0.5, 0.86), 1.7, 1.6, 0.03)
           + wave(p, vec2(0.96, -0.28), 3.1, 2.3, 0.012)
           + wave(p, vec2(-0.2, -0.98), 5.3, 3.1, 0.006);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 water = mix(uShallow, uDeep, smoothstep(0.0, 3.5, vDepth));
    vec3 R = reflect(-V, N);
    vec3 skyc = mix(uHorizon, uSky, clamp(R.y * 2.5, 0.0, 1.0));
    vec3 col = mix(water, skyc, fres * 0.9);
    vec3 H = normalize(V + uSun);
    col += uSunColor * pow(max(dot(N, H), 0.0), 220.0) * 2.5;
    // lapping foam at the shoreline
    float foam = (1.0 - smoothstep(0.03, 0.32, vDepth)) * (0.55 + 0.45 * sin(uTime * 1.3 + vDepth * 18.0 + p.x * 0.35));
    col = mix(col, vec3(0.92, 0.94, 0.93), foam * 0.55);
    float alpha = mix(0.3, 0.94, smoothstep(0.0, 2.0, vDepth));
    alpha = max(max(alpha, fres * 0.9), foam * 0.6);
    // exponential-squared fog, same as the scene fog
    float d = length(vW - cameraPosition);
    float f = 1.0 - exp(-pow(d * uFogDensity, 2.0));
    col = mix(col, uHorizon, f);
    alpha = mix(alpha, 1.0, f);
    gl_FragColor = vec4(max(col, vec3(0.0)), alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const buildWater = (planet: Planet) => {
  const H = heightFor(planet.style);
  const RINGS = 72;
  const SEGS = 128;
  const pos: number[] = [0, WATER_LEVEL, 0];
  const depth: number[] = [Math.max(0, WATER_LEVEL - H(0, 0))];
  for (let r = 0; r < RINGS; r += 1) {
    const rad = WATER_RADIUS * Math.pow((r + 1) / RINGS, 1.8);
    for (let s = 0; s < SEGS; s += 1) {
      const a = (s / SEGS) * Math.PI * 2;
      const x = Math.cos(a) * rad;
      const z = Math.sin(a) * rad;
      pos.push(x, WATER_LEVEL, z);
      depth.push(rad < TERRAIN_RADIUS - 2 ? Math.max(0, WATER_LEVEL - H(x, z)) : 12);
    }
  }
  const idx: number[] = [];
  for (let s = 0; s < SEGS; s += 1) idx.push(0, 1 + ((s + 1) % SEGS), 1 + s);
  for (let r = 0; r < RINGS - 1; r += 1) {
    const a0 = 1 + r * SEGS;
    const b0 = a0 + SEGS;
    for (let s = 0; s < SEGS; s += 1) {
      const s1 = (s + 1) % SEGS;
      idx.push(a0 + s, a0 + s1, b0 + s, a0 + s1, b0 + s1, b0 + s);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aDepth', new THREE.Float32BufferAttribute(depth, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
};

/* ---------- luminous cloud deck (gas-giant) ---------- */

const cloudVert = /* glsl */ `
  varying vec3 vW;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const cloudFrag = /* glsl */ `
  uniform float uTime;
  uniform vec3 uC0;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform vec3 uGlow;
  uniform vec3 uHorizon;
  uniform float uFogDensity;
  uniform float uShadowR;
  varying vec3 vW;
  float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float s = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) { s += vn(p) * a; p = p * 2.03 + 11.7; a *= 0.5; }
    return s;
  }
  void main() {
    vec2 p = vW.xz * 0.012;
    float t = uTime;
    // long latitude bands, sheared by turbulence and drifting slowly
    float turb = fbm(p * 1.6 + vec2(t * 0.012, 0.0));
    float v = p.y * 3.2 + turb * 2.4 + sin(p.x * 0.7 + t * 0.02) * 0.3;
    float band = sin(v * 3.14159) * 0.5 + 0.5;
    vec3 col = mix(uC2, uC0, smoothstep(0.15, 0.85, band));
    float puff = fbm(p * 4.0 - vec2(t * 0.02, t * 0.008));
    col = mix(col, uC1, smoothstep(0.55, 0.85, puff) * 0.55);
    // luminous seams between bands
    col += uGlow * pow(1.0 - abs(band - 0.5) * 2.0, 8.0) * 0.6;
    // the mesa shades the deck right below it
    col *= mix(0.45, 1.0, smoothstep(uShadowR * 0.6, uShadowR * 2.2, length(vW.xz)));
    float d = length(vW - cameraPosition);
    float f = 1.0 - exp(-pow(d * uFogDensity, 2.0));
    col = mix(col, uHorizon, f);
    gl_FragColor = vec4(max(col, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/* ---------- floating rock islands (gas-giant) ---------- */

const floatingRock = () => {
  const cone = new THREE.ConeGeometry(1, 2.4, 8, 3).rotateX(Math.PI).translate(0, -1.2, 0);
  const cap = new THREE.CylinderGeometry(1, 1.02, 0.35, 8, 1).translate(0, 0.12, 0);
  [cone, cap].forEach((g) => g.deleteAttribute('uv'));
  const geo = mergeGeometries([cone.toNonIndexed(), cap.toNonIndexed()])!;
  const p = geo.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 1) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const k = 0.8 + noise2(x * 2.3 + y, z * 2.3 - y) * 0.4;
    p.setXYZ(i, x * k, y < 0 ? y * (0.85 + noise2(x * 3, z * 3) * 0.3) : y, z * k);
  }
  geo.computeVertexNormals();
  return geo;
};

const ROCKS: Array<[number, number, number, number]> = [
  // angle (deg from -Z, positive right), distance, height, scale
  [-58, 70, 2, 6],
  [-28, 120, 6, 11],
  [12, 150, -2, 14],
  [44, 95, 4, 7],
  [78, 62, -1, 4],
  [150, 110, 3, 9],
  [-130, 90, 0, 8],
];

interface SurroundingsProps {
  planet: Planet;
  sky: ResolvedSky;
  reducedMotion?: boolean;
}

/** Style-specific world around the play area: sea for oceanic, cloud deck and floating rocks for gas giants. */
const Surroundings = ({ planet, sky, reducedMotion }: SurroundingsProps) => {
  const time = useMemo(() => ({ value: 0 }), []);
  const style = planet.style;

  const water = useMemo(() => {
    if (style !== 'oceanic') return null;
    const accent = new THREE.Color(planet.accent);
    return {
      geo: buildWater(planet),
      mat: new THREE.ShaderMaterial({
        vertexShader: waterVert,
        fragmentShader: waterFrag,
        transparent: true,
        depthWrite: false,
        fog: false,
        uniforms: {
          uTime: time,
          uSun: { value: sky.lightDir },
          uSunColor: { value: sky.lightColor },
          uSky: { value: sky.upper },
          uHorizon: { value: sky.fogColor },
          uShallow: { value: new THREE.Color('#4fb0aa').lerp(accent, 0.12) },
          uDeep: { value: new THREE.Color('#0f3a52').lerp(new THREE.Color(planet.palette[2]), 0.3) },
          uFogDensity: { value: sky.fogDensity },
        },
      }),
    };
  }, [style, planet, sky, time]);

  const clouds = useMemo(() => {
    if (style !== 'gas-giant') return null;
    const [p0, p1, p2] = planet.palette.map((c) => new THREE.Color(c));
    const mat = new THREE.ShaderMaterial({
      vertexShader: cloudVert,
      fragmentShader: cloudFrag,
      fog: false,
      uniforms: {
        uTime: time,
        uC0: { value: p0.clone().lerp(sky.hemiSky, 0.2).multiplyScalar(1.1) },
        uC1: { value: p1.clone().multiplyScalar(0.9) },
        uC2: { value: p2.clone().lerp(p0, 0.25) },
        uGlow: { value: new THREE.Color(planet.accent).multiplyScalar(1.2) },
        uHorizon: { value: sky.fogColor },
        uFogDensity: { value: sky.fogDensity * 0.4 },
        uShadowR: { value: 28 },
      },
    });
    const pal = terrainPalette(planet);
    const rockMat = new THREE.MeshStandardMaterial({
      color: pal.rock.clone().lerp(pal.high, 0.35),
      roughness: 0.9,
      flatShading: true,
    });
    const rockGeo = floatingRock();
    const rocks = new THREE.InstancedMesh(rockGeo, rockMat, ROCKS.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const sc = new THREE.Vector3();
    ROCKS.forEach(([deg, dist, y, k], i) => {
      const a = (deg * Math.PI) / 180;
      v.set(Math.sin(a) * dist, y, -Math.cos(a) * dist);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fbm2(i * 3.1, 0.7) * 6.28);
      sc.set(k, k * (0.8 + 0.3 * fbm2(i, 2.2)), k);
      rocks.setMatrixAt(i, m.compose(v, q, sc));
    });
    rocks.computeBoundingSphere();
    rocks.raycast = () => undefined;
    return { mat, rocks };
  }, [style, planet, sky, time]);

  useEffect(
    () => () => {
      water?.geo.dispose();
      water?.mat.dispose();
      if (clouds) {
        clouds.mat.dispose();
        clouds.rocks.geometry.dispose();
        (clouds.rocks.material as THREE.Material).dispose();
        clouds.rocks.dispose();
      }
    },
    [water, clouds],
  );

  useFrame((_, dt) => {
    time.value += reducedMotion ? dt * 0.2 : dt;
  });

  return (
    <group>
      {water && <mesh geometry={water.geo} material={water.mat} renderOrder={-1} frustumCulled={false} />}
      {clouds && (
        <>
          <mesh material={clouds.mat} position={[0, CLOUD_DECK_Y, 0]} rotation={[-Math.PI / 2, 0, 0]} frustumCulled={false}>
            <circleGeometry args={[620, 96]} />
          </mesh>
          <primitive object={clouds.rocks} />
        </>
      )}
    </group>
  );
};

export default Surroundings;
