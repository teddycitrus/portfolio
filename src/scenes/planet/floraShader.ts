import * as THREE from 'three';

/*
 * One vertex program drives every plant. Geometry carries two weights in aVeg
 * (x: how far this vertex bends, y: how much it glows) and an optional aOpen
 * offset for petals. Wind is sampled at the plant root, so a gust is a front
 * crossing the ground rather than each plant swaying alone.
 */

/** Uniforms shared by every plant on a planet */
export interface FloraEnv {
  time: { value: number };
  /** Viewer world position; left far overhead while motion is frozen */
  viewer: { value: THREE.Vector3 };
  /** Prevailing wind, unit vector on xz */
  wind: { value: THREE.Vector2 };
}

export interface FloraMotion {
  /** Resting bend downwind (wind-trained growth), kept when motion is frozen */
  lean?: number;
  /** Extra bend at the peak of a passing gust */
  gust?: number;
  /** Small fast movement, grows with the gust */
  flutter?: number;
  /** 1 = the wind blows outward from the origin (updraft off a mesa rim) */
  radial?: number;
  /** How far the plant leans away from a close viewer */
  shy?: number;
  shyRadius?: number;
  glow?: THREE.Color;
  /** Steady share of the glow */
  glowBase?: number;
  /** Slowly pulsing share of the glow */
  glowPulse?: number;
  glowSpeed?: number;
  /** Ground-space frequency: the pulse travels across a colony */
  glowWave?: number;
  /** Height frequency: the pulse climbs the plant */
  glowClimb?: number;
  /** Petal opening: base, slow cycle amount, amount added near the viewer */
  bloom?: [number, number, number];
  /** 1 = the glow is scaled by how far the flower is open */
  glowOpen?: number;
}

const COMMON_V = /* glsl */ `
attribute vec2 aVeg;
attribute vec3 aOpen;
uniform float uTime;
uniform vec3 uViewer;
uniform vec2 uWindDir;
uniform vec3 uBend;
uniform float uRadial;
uniform vec2 uShy;
uniform vec4 uGlowAnim;
uniform float uGlowClimb;
uniform vec3 uBloom;
uniform float uGlowOpen;
varying float vGlow;
`;

const BEGIN_V = /* glsl */ `
#include <begin_vertex>
#ifdef USE_INSTANCING
  vec3 iPos = instanceMatrix[3].xyz;
  mat3 iBasis = mat3(instanceMatrix);
#else
  vec3 iPos = vec3(0.0);
  mat3 iBasis = mat3(1.0);
#endif
float iS2 = max(dot(iBasis[1], iBasis[1]), 0.0001);
float iPh = fract(iPos.x * 0.37 + iPos.z * 0.71) * 6.2832;

vec2 outward = iPos.xz / (length(iPos.xz) + 0.001);
vec2 wd = mix(uWindDir, outward, uRadial);
float along = dot(iPos.xz, wd);
float across = dot(iPos.xz, vec2(-wd.y, wd.x));
// narrow crests moving downwind, curved so a front is not a ruled line
float crest = 0.5 + 0.5 * sin(along * 0.09 - uTime * 0.46 + sin(across * 0.05 + 1.0) * 1.2);
crest *= crest;
crest *= crest;
float gust = crest * (0.55 + 0.45 * sin(uTime * 0.11 + across * 0.02));
float bend = uBend.x + uBend.y * gust + uBend.z * (0.35 + gust) * sin(uTime * 1.3 + iPh + position.y * 1.6);
// world direction into instance space: transpose of the basis over its squared scale
transformed += (vec3(wd.x, 0.0, wd.y) * iBasis) / iS2 * aVeg.x * bend;

vec2 fromViewer = iPos.xz - uViewer.xz;
float viewer2 = dot(fromViewer, fromViewer);
float nearby = (1.0 - smoothstep(0.0, uShy.y, viewer2)) * (1.0 - smoothstep(3.0, 6.0, uViewer.y - iPos.y));
transformed += (vec3(fromViewer.x, 0.0, fromViewer.y) * iBasis) / iS2 / (sqrt(viewer2) + 0.001) * aVeg.x * nearby * uShy.x;

float flora_open = clamp(uBloom.x + uBloom.y * (0.5 + 0.5 * sin(uTime * 0.075 + iPh)) + uBloom.z * nearby, 0.0, 1.0);
transformed += aOpen * flora_open;

float pulse = 0.5 + 0.5 * sin(uTime * uGlowAnim.z - dot(iPos.xz, vec2(uGlowAnim.w)) - position.y * uGlowClimb + iPh * 0.4);
vGlow = aVeg.y * (uGlowAnim.x + uGlowAnim.y * pulse) * mix(1.0, flora_open, uGlowOpen);
`;

export const floraMaterial = (
  params: THREE.MeshStandardMaterialParameters,
  env: FloraEnv,
  o: FloraMotion,
): THREE.MeshStandardMaterial => {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
    ...params,
  });
  m.customProgramCacheKey = () => 'flora';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = env.time;
    shader.uniforms.uViewer = env.viewer;
    shader.uniforms.uWindDir = env.wind;
    shader.uniforms.uBend = { value: new THREE.Vector3(o.lean ?? 0, o.gust ?? 0, o.flutter ?? 0) };
    shader.uniforms.uRadial = { value: o.radial ?? 0 };
    const shyR = o.shyRadius ?? 1.6;
    shader.uniforms.uShy = { value: new THREE.Vector2(o.shy ?? 0, shyR * shyR) };
    shader.uniforms.uGlow = { value: o.glow ?? new THREE.Color(0) };
    shader.uniforms.uGlowAnim = {
      value: new THREE.Vector4(o.glowBase ?? 0, o.glowPulse ?? 0, o.glowSpeed ?? 0.4, o.glowWave ?? 0),
    };
    shader.uniforms.uGlowClimb = { value: o.glowClimb ?? 0 };
    shader.uniforms.uBloom = { value: new THREE.Vector3(...(o.bloom ?? [0, 0, 0])) };
    shader.uniforms.uGlowOpen = { value: o.glowOpen ?? 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${COMMON_V}`)
      .replace('#include <begin_vertex>', BEGIN_V);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uGlow;\nvarying float vGlow;`)
      // leaves keep their authored normals on both faces so a blade lights the same from either side
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
        #if defined(DOUBLE_SIDED) && !defined(FLAT_SHADED)
          normal *= faceDirection;
        #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance += uGlow * vGlow;`,
      );
  };
  return m;
};
