import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { ResolvedSky } from '@/data/skyPresets';
import { flight } from '@/state/runtime';
import ShipHull, { DARK_COLOR, HULL_COLOR, useHullParts } from '@/scenes/ship/ShipHull';

/*
 * The ship that lowered the viewer down its beam. It is already up there,
 * cruising a slow wide loop high over the landing spot, prow first: out of
 * view at the resting pitch, in view once you look up past about 40 degrees.
 * Fog would erase it at that range, so the hull is tinted toward the sky by
 * distance instead.
 */

/** Centre and radii of the loop, about 50 to 65 degrees above the horizon from the spawn */
const LOOP = new THREE.Vector3(10, 240, -165);
const LOOP_RX = 95;
const LOOP_RZ = 55;
/** Radians per second around the loop: a walking-pace crawl at this height */
const LOOP_RATE = 0.026;
/** Where on the loop it is when the viewer lands, so it starts broadside and ahead */
const LOOP_PHASE = Math.PI / 2;
/** Share of the sky colour mixed into the hull at station range, standing in for aerial haze */
const HAZE = 0.42;

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const _p = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _top = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _yUp = new THREE.Vector3(0, 1, 0);

/** A column of light: rings rising toward the ship, faint streaks, soft at both ends. */
const BEAM_VERT = /* glsl */ `
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
const BEAM_FRAG = /* glsl */ `
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
const PAD_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
/** Where the beam meets the ground: a soft disc and a ring pulsing outward */
const PAD_FRAG = /* glsl */ `
  uniform float uA;
  uniform float uTime;
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    float disc = exp(-r * r * 3.0) * 0.35;
    float wave = fract(uTime * 0.8);
    // squared by hand: pow() of a negative base is NaN on Metal
    float rw = (r - wave) * 14.0;
    float rr = (r - 0.62) * 22.0;
    float ring = exp(-rw * rw) * (1.0 - wave) * 0.6;
    float rim = exp(-rr * rr) * 0.5;
    vec3 col = vec3(0.6, 0.88, 1.0) * (disc + ring + rim) * (1.0 - smoothstep(0.85, 1.0, r));
    gl_FragColor = vec4(col * uA, 1.0);
    #include <colorspace_fragment>
  }
`;
const _base = new THREE.Color();

const noRaycast = () => null;

interface Props {
  sky: ResolvedSky;
  reducedMotion?: boolean;
}

const Mothership = ({ sky, reducedMotion }: Props) => {
  const root = useRef<THREE.Group>(null);
  /** Seconds along the loop since landing */
  const cruise = useRef(0);

  const parts = useHullParts();
  const haze = useMemo(() => sky.fogColor.clone(), [sky]);

  const beamRef = useRef<THREE.Mesh>(null);
  const padRef = useRef<THREE.Mesh>(null);
  const [beamMat, padMat] = useMemo(() => {
    const common = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false } as const;
    return [
      new THREE.ShaderMaterial({
        ...common,
        side: THREE.DoubleSide,
        uniforms: { uA: { value: 0 }, uLen: { value: 1 }, uTime: { value: 0 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
      }),
      new THREE.ShaderMaterial({
        ...common,
        uniforms: { uA: { value: 0 }, uTime: { value: 0 } },
        vertexShader: PAD_VERT,
        fragmentShader: PAD_FRAG,
      }),
    ];
  }, []);
  useEffect(
    () => () => {
      beamMat.dispose();
      padMat.dispose();
    },
    [beamMat, padMat],
  );

  useFrame(({ clock, camera }, delta) => {
    const g = root.current;
    if (!g) return;
    const t = clock.elapsedTime;
    if (!reducedMotion) cruise.current += Math.min(delta, 0.1);
    const a = LOOP_PHASE + cruise.current * LOOP_RATE;
    _p.set(LOOP.x + Math.cos(a) * LOOP_RX, LOOP.y + Math.sin(t * 0.13) * 1.4, LOOP.z - Math.sin(a) * LOOP_RZ);
    g.position.copy(_p);
    flight.mother.x = _p.x;
    flight.mother.y = _p.y - 9;
    flight.mother.z = _p.z;

    // the tractor beam, from the belly down to the viewer's feet
    const bw = flight.beam;
    const bm = beamRef.current;
    const pad = padRef.current;
    if (bm && pad) {
      bm.visible = pad.visible = bw > 0.001;
      if (bm.visible) {
        const f = flight.beamFoot;
        _foot.set(f.x, f.y, f.z);
        _top.set(flight.mother.x, flight.mother.y, flight.mother.z);
        _axis.subVectors(_top, _foot);
        const len = _axis.length();
        _axis.divideScalar(len);
        bm.position.copy(_foot).addScaledVector(_axis, len / 2);
        bm.quaternion.setFromUnitVectors(_yUp, _axis);
        bm.scale.set(1, len, 1);
        beamMat.uniforms.uA.value = bw;
        beamMat.uniforms.uLen.value = len;
        beamMat.uniforms.uTime.value = t;
        pad.position.copy(_foot).y += 0.05;
        padMat.uniforms.uA.value = bw;
        padMat.uniforms.uTime.value = t;
      }
    }
    // prow along the loop (the prow is local -x), banked a little into the turn
    const vx = -Math.sin(a) * LOOP_RX;
    const vz = -Math.cos(a) * LOOP_RZ;
    const yaw = Math.atan2(vz, -vx);
    g.rotation.set(0.05 + Math.sin(t * 0.09) * 0.012, yaw + Math.sin(t * 0.04) * 0.02, 0, 'YZX');

    // aerial haze by distance
    const d = camera.position.distanceTo(g.position);
    const hz = HAZE * smooth(40, 320, d);
    parts.hull.color.copy(_base.set(HULL_COLOR)).lerp(haze, hz);
    parts.hull.emissive.copy(haze).multiplyScalar(0.66 * hz);
    parts.dark.color.copy(_base.set(DARK_COLOR)).lerp(haze, hz);
    parts.dark.emissive.copy(haze).multiplyScalar(0.52 * hz);
  });

  return (
    <>
      {/* the tractor beam: wide at the ground, narrowing up into the belly */}
      <mesh ref={beamRef} material={beamMat} visible={false} raycast={noRaycast} frustumCulled={false} renderOrder={5}>
        <cylinderGeometry args={[2.2, 3.4, 1, 48, 1, true]} />
      </mesh>
      <mesh ref={padRef} material={padMat} visible={false} rotation={[-Math.PI / 2, 0, 0]} raycast={noRaycast} renderOrder={5}>
        <planeGeometry args={[9, 9]} />
      </mesh>
    <group ref={root} scale={1.5} raycast={noRaycast}>
      <ShipHull parts={parts} />
    </group>
    </>
  );
};

export default Mothership;
