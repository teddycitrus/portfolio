/**
 * The tractor beam: a column of light with rings running along it toward its
 * far end (+y of a unit cylinder), faint streaks, soft at both ends. Shared by
 * the beam down from the mothership and the deck's launch beam.
 */
export const BEAM_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vN = normalize(mat3(modelMatrix) * normal);
    vV = normalize(cameraPosition - wp.xyz);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;
export const BEAM_FRAG = /* glsl */ `
  uniform float uA;
  uniform float uLen;
  uniform float uTime;
  varying vec2 vUv;
  varying vec3 vN;
  varying vec3 vV;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  void main() {
    float y = vUv.y * uLen;
    float rings = pow(max(0.5 + 0.5 * sin(y * 0.55 - uTime * 9.0), 0.0), 8.0);
    float streaks = pow(noise(vec2(vUv.x * 48.0, y * 0.04 - uTime * 0.9)), 3.0);
    float ends = smoothstep(0.0, 0.015, vUv.y) * (1.0 - smoothstep(0.85, 1.0, vUv.y));
    // brighter where the wall is seen edge-on, so the column reads as a tube
    float edge = 0.35 + 0.65 * pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 2.0);
    vec3 col = vec3(0.55, 0.85, 1.0) * (0.05 + rings * 0.45 + streaks * 0.35) * edge;
    gl_FragColor = vec4(col * ends * uA, 1.0);
    #include <colorspace_fragment>
  }
`;
