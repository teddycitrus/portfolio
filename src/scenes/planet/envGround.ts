import * as THREE from 'three';
import type { PlanetStyle } from '@/types/content';

/*
 * Surface micro-detail for the terrain material: three reads of a baked tiling
 * texture, fine, close and broad, shaped differently per world. Detail fades
 * with distance through mipmaps and an explicit near mask.
 */

const SHARED = /* glsl */ `
  vec2 edP = vEnvW.xz;
  float edDist = length(edP - cameraPosition.xz);
  float edNear = 1.0 - smoothstep(24.0, 62.0, edDist);
  vec4 edA = texture2D(uEnvTex, edP * 0.27);
  vec4 edC = texture2D(uEnvTex, vec2(edP.x * 0.6 - edP.y * 0.8, edP.y * 0.6 + edP.x * 0.8) * 0.73);
  vec4 edB = texture2D(uEnvTex, vec2(edP.x * 0.8 + edP.y * 0.6, edP.y * 0.8 - edP.x * 0.6) * 0.061);
  float edFlat = smoothstep(0.78, 0.97, vEnvN.y);
  float edCliff = 1.0 - edFlat;
  float edGrain = mix(1.0, 0.86 + 0.28 * edC.a, edNear);
`;

const ALBEDO: Record<PlanetStyle, string> = {
  rocky: /* glsl */ `
    // bedding planes on anything steep, tracked by height so they run level
    float edBand = sin(vEnvW.y * 3.2 + edB.a * 7.0 + edB.b * 2.0) * 0.5 + 0.5;
    diffuseColor.rgb *= 1.0 + (edBand - 0.5) * 0.45 * edCliff;
    // pale wind-laid dust in the hollows, crazed where it has dried
    float edPan = smoothstep(0.5, 0.7, edB.a) * edFlat;
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvA, edPan * 0.26);
    float edCrack = 1.0 - smoothstep(0.02, 0.11, edA.b);
    diffuseColor.rgb *= 1.0 - edCrack * 0.36 * edPan * edNear;
    diffuseColor.rgb *= edGrain;
  `,
  'gas-giant': /* glsl */ `
    // fractured plates, a broad set and a fine set, with rime in the low spots
    float edSeam = 1.0 - smoothstep(0.02, 0.09, edA.b);
    float edRift = 1.0 - smoothstep(0.015, 0.06, edB.b);
    diffuseColor.rgb *= 1.0 - edSeam * 0.34 * edNear - edRift * 0.3;
    diffuseColor.rgb *= mix(1.0, 0.8 + 0.4 * edA.a, edNear);
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvA, smoothstep(0.54, 0.78, edB.a) * edFlat * 0.22);
    float edBand = sin(vEnvW.y * 2.1 + edB.a * 5.0) * 0.5 + 0.5;
    diffuseColor.rgb *= 1.0 + (edBand - 0.5) * 0.5 * edCliff;
  `,
  molten: /* glsl */ `
    // ropy flow skin close up, cold ash settled in the hollows
    diffuseColor.rgb *= mix(1.0, 0.7 + 0.6 * edA.a, edNear);
    float edAsh = smoothstep(0.5, 0.74, edB.a) * edFlat;
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvA, edAsh * 0.42);
    float edPlate = 1.0 - smoothstep(0.02, 0.1, edB.b);
    diffuseColor.rgb *= 1.0 - edPlate * 0.4;
  `,
  oceanic: /* glsl */ `
    // tide-wet sand at the waterline, wind ripples above it, moss over the grass
    float edWet = (1.0 - smoothstep(0.02, 0.55, vEnvW.y)) * smoothstep(-0.9, -0.1, vEnvW.y);
    diffuseColor.rgb *= 1.0 - edWet * 0.36;
    float edSand = (1.0 - smoothstep(0.35, 0.85, vEnvW.y)) * edFlat;
    diffuseColor.rgb *= mix(1.0, 0.9 + 0.2 * edA.b, edSand * edNear);
    float edMoss = smoothstep(0.54, 0.72, edB.a) * smoothstep(0.6, 1.1, vEnvW.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvA, edMoss * 0.3);
    diffuseColor.rgb *= edGrain;
  `,
  forested: /* glsl */ `
    // moss cushions over damp earth, flecked with fallen litter
    float edMoss = smoothstep(0.46, 0.7, edB.a * 0.7 + edA.a * 0.35) * edFlat;
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvA, edMoss * 0.42);
    float edLitter = 1.0 - smoothstep(0.03, 0.1, edA.b);
    diffuseColor.rgb = mix(diffuseColor.rgb, uEnvB, edLitter * 0.3 * edNear);
    diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.2, 0.5, edB.a)) * 0.18;
    diffuseColor.rgb *= edGrain;
  `,
};

const ROUGHNESS: Partial<Record<PlanetStyle, string>> = {
  oceanic: 'roughnessFactor = mix(roughnessFactor, 0.34, edWet);',
};

const EMISSIVE: Partial<Record<PlanetStyle, string>> = {
  // a trace of mineral light along the broad fractures, only in the dark
  'gas-giant': 'totalEmissiveRadiance += uEnvB * edRift * 0.022 * (0.4 + 0.6 * edB.a);',
};

const SLOPE: Record<PlanetStyle, number> = {
  rocky: 0.3,
  'gas-giant': 0.3,
  molten: 0.36,
  oceanic: 0.22,
  forested: 0.3,
};

/** Adds the world's micro-detail to a standard material, on top of any existing patch. */
export const withGroundDetail = (
  material: THREE.MeshStandardMaterial,
  style: PlanetStyle,
  tex: THREE.Texture,
  hueA: THREE.Color,
  hueB: THREE.Color,
) => {
  const previous = material.onBeforeCompile;
  material.customProgramCacheKey = () => `terrain-detail-${style}`;
  material.onBeforeCompile = (shader, renderer) => {
    previous.call(material, shader, renderer);
    shader.uniforms.uEnvTex = { value: tex };
    shader.uniforms.uEnvA = { value: hueA };
    shader.uniforms.uEnvB = { value: hueB };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vEnvW;\nvarying vec3 vEnvN;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvEnvN = objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEnvW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uEnvTex;
uniform vec3 uEnvA;
uniform vec3 uEnvB;
varying vec3 vEnvW;
varying vec3 vEnvN;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${SHARED}
${ALBEDO[style]}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
${ROUGHNESS[style] ?? ''}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + mat3(viewMatrix) * vec3(edC.r - 0.5 + (edA.r - 0.5) * 0.35, 0.0, edC.g - 0.5 + (edA.g - 0.5) * 0.35) * ${SLOPE[style].toFixed(2)} * edNear);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${EMISSIVE[style] ?? ''}`);
  };
  return material;
};
