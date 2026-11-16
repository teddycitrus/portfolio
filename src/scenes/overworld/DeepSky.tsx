import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import DebrisBelt from './DebrisBelt';
import { GALAXY_AXIS, REST_DIR, mulberry32 } from './skyField';

/*
 * What lies beyond the planets, seen through the deck window: distant
 * galaxies, a belt of rubble, and on rare occasions a faint meteor (the
 * nebulae are painted into the baked sky, see SpaceBackdrop). Everything is
 * additive, far behind the planets and never takes a click.
 */

/** Distance of the deep-sky layer: past the planets, inside the starfield shell */
const FAR = 170;
const noRaycast = () => null;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATLAS_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Four galaxy shapes, one per quadrant: face-on spiral, barred spiral, edge-on disc, elliptical
const ATLAS_FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.07 + 11.3; a *= 0.5; }
    return v;
  }

  vec3 spiral(vec2 uv, float seed, float tilt, float wind, float bar) {
    vec2 p = uv;
    p.y /= tilt;
    float r = length(p);
    float a = atan(p.y, p.x + 1e-6);
    float arms = 0.5 + 0.5 * cos(2.0 * (a - log(r + 0.04) * wind) + fbm(p * 6.0 + seed) * 2.0);
    arms = pow(max(arms, 0.0), 2.5);
    float clumps = smoothstep(0.45, 0.9, fbm(p * 14.0 + seed * 3.0));
    float lanes = smoothstep(0.5, 0.75, fbm(p * 9.0 + seed * 5.0));
    float disc = exp(-r * 3.2) * (0.22 + 0.95 * arms * (0.6 + 0.6 * clumps)) * (1.0 - 0.5 * lanes);
    float core = exp(-r * r * 60.0);
    float bars = bar * exp(-p.x * p.x * 9.0 - p.y * p.y * 180.0);
    return vec3(0.62, 0.74, 1.0) * disc + vec3(1.0, 0.86, 0.66) * (core * 1.6 + bars * 0.9)
      + vec3(1.0, 0.55, 0.7) * clumps * arms * exp(-r * 3.0) * 0.28;
  }

  vec3 edgeOn(vec2 p, float seed) {
    float r = length(p);
    float disc = exp(-abs(p.y) * 22.0) * exp(-abs(p.x) * 2.6);
    float bulge = exp(-r * r * 40.0);
    float lane = exp(-p.y * p.y * 900.0) * (0.55 + 0.45 * fbm(vec2(p.x * 18.0, seed)));
    return (vec3(0.72, 0.8, 1.0) * disc * (0.5 + fbm(vec2(p.x * 12.0, p.y * 40.0) + seed)) + vec3(1.0, 0.85, 0.66) * bulge * 1.3) * (1.0 - 0.9 * lane);
  }

  vec3 elliptical(vec2 p) {
    float r = length(p * vec2(1.0, 1.5));
    return vec3(1.0, 0.86, 0.7) * (exp(-r * 5.0) * 0.55 + exp(-r * r * 90.0) * 0.8);
  }

  void main() {
    vec2 cell = floor(vUv * 2.0);
    vec2 uv = fract(vUv * 2.0) * 2.0 - 1.0;
    vec3 c;
    if (cell.x < 0.5 && cell.y < 0.5) c = spiral(uv, 2.0, 0.42, 2.4, 0.0);
    else if (cell.y < 0.5) c = spiral(uv, 5.0, 0.72, 3.1, 1.0);
    else if (cell.x < 0.5) c = edgeOn(uv, 9.0);
    else c = elliptical(uv);
    float edge = 1.0 - smoothstep(0.72, 0.98, length(uv));
    gl_FragColor = vec4(sqrt(max(c * edge, 0.0)), 1.0);
  }
`;

const atlasCache = new WeakMap<THREE.WebGLRenderer, THREE.Texture>();

/** Bakes the four galaxy shapes once per renderer. */
const bakeAtlas = (gl: THREE.WebGLRenderer) => {
  const hit = atlasCache.get(gl);
  if (hit) return hit;
  const rt = new THREE.WebGLRenderTarget(512, 512, {
    type: THREE.UnsignedByteType,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
  });
  const mat = new THREE.ShaderMaterial({ vertexShader: ATLAS_VERT, fragmentShader: ATLAS_FRAG, depthTest: false, depthWrite: false });
  const geo = new THREE.PlaneGeometry(2, 2);
  const scene = new THREE.Scene();
  const quad = new THREE.Mesh(geo, mat);
  quad.frustumCulled = false;
  scene.add(quad);
  const prev = gl.getRenderTarget();
  gl.setRenderTarget(rt);
  gl.render(scene, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
  gl.setRenderTarget(prev);
  mat.dispose();
  geo.dispose();
  atlasCache.set(gl, rt.texture);
  return rt.texture;
};

const GALAXY_VERT = /* glsl */ `
  attribute vec2 aCell;
  attribute vec3 aTint;
  varying vec2 vAtlas;
  varying vec3 vTint;
  void main() {
    vAtlas = (uv + aCell) * 0.5;
    vTint = aTint;
    gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const GALAXY_FRAG = /* glsl */ `
  uniform sampler2D uAtlas;
  varying vec2 vAtlas;
  varying vec3 vTint;
  void main() {
    vec3 c = texture2D(uAtlas, vAtlas).rgb;
    gl_FragColor = vec4(c * c * vTint, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const GALAXY_COUNT = 26;
const CELLS: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1]];

/** All the distant galaxies in one instanced draw: one small spiral placed by hand, the rest strewn */
const buildGalaxies = (gl: THREE.WebGLRenderer) => {
  const rand = mulberry32(90125);
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: bakeAtlas(gl) } },
      vertexShader: GALAXY_VERT,
      fragmentShader: GALAXY_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
    GALAXY_COUNT,
  );
  const cells = new Float32Array(GALAXY_COUNT * 2);
  const tints = new Float32Array(GALAXY_COUNT * 3);
  const o = new THREE.Object3D();
  const d = new THREE.Vector3();
  for (let i = 0; i < GALAXY_COUNT; i += 1) {
    const cell = i === 0 ? CELLS[0] : CELLS[Math.floor(rand() * 4)];
    let size = 7.5;
    let k = 0.42;
    if (i === 0) {
      // low in the left of the window, under the gas, nowhere near a label
      d.set(-0.56, -0.36, -1).normalize();
    } else {
      // none in the plane of the galaxy, where the dust hides them, and none around the planets
      do {
        const z = rand() * 2 - 1;
        const th = rand() * Math.PI * 2;
        const s = Math.sqrt(1 - z * z);
        d.set(s * Math.cos(th), z, s * Math.sin(th));
      } while (Math.abs(d.dot(GALAXY_AXIS)) < 0.12 || d.dot(REST_DIR) > 0.86);
      size = 1.1 + rand() * rand() * 3.4;
      k = 0.2 + rand() * 0.3;
    }
    o.position.copy(d).multiplyScalar(FAR);
    o.lookAt(0, 0, 0);
    o.rotateZ(i === 0 ? 0.6 : rand() * Math.PI * 2);
    o.scale.setScalar(size);
    o.updateMatrix();
    mesh.setMatrixAt(i, o.matrix);
    cells.set(cell, i * 2);
    tints.set([k, k * (0.92 + rand() * 0.08), k * (0.9 + rand() * 0.15)], i * 3);
  }
  mesh.geometry.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  mesh.geometry.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 3));
  mesh.frustumCulled = false;
  mesh.raycast = noRaycast;
  return mesh;
};

/** One meteor: a thin streak, white-hot at the head, fading along its tail. */
const meteorMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uA: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float uA;
      varying vec2 vUv;
      void main() {
        // head at x = 1, tail toward x = -1
        float t = (vUv.x + 1.0) * 0.5;
        float body = pow(max(t, 0.0), 3.0) * (1.0 - smoothstep(0.0, 1.0 - t * 0.6, abs(vUv.y)));
        float head = exp(-((vUv.x - 0.92) * (vUv.x - 0.92)) * 300.0 - vUv.y * vUv.y * 6.0);
        vec3 col = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.95, 0.85), t) * body * 1.4 + vec3(1.4) * head;
        gl_FragColor = vec4(col * uA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

const METEORS = 1;

interface Meteor {
  mat: THREE.ShaderMaterial;
  start: THREE.Vector3;
  dir: THREE.Vector3;
  born: number;
  life: number;
  len: number;
  /** Units per second along dir */
  speed: number;
  next: number;
}

const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _head = new THREE.Vector3();

const DeepSky = () => {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const reduced = useAppStore((s) => s.reducedMotion);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  const galaxies = useMemo(() => buildGalaxies(gl), [gl]);

  const meteors = useMemo<Meteor[]>(
    () =>
      Array.from({ length: METEORS }, (_, i) => ({
        mat: meteorMaterial(),
        start: new THREE.Vector3(),
        dir: new THREE.Vector3(),
        born: -1,
        life: 0.8,
        len: 10,
        speed: 60,
        next: 20 + i * 15,
      })),
    [],
  );

  useEffect(
    () => () => {
      galaxies.geometry.dispose();
      (galaxies.material as THREE.Material).dispose();
      galaxies.dispose();
      meteors.forEach((m) => m.mat.dispose());
    },
    [galaxies, meteors],
  );

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    meteors.forEach((m, i) => {
      const mesh = meshes.current[i];
      if (!mesh) return;
      if (reduced) {
        mesh.visible = false;
        return;
      }
      if (m.born < 0 && t >= m.next) {
        // somewhere in the window, heading down and across at a slant
        m.born = t;
        m.life = 0.55 + Math.random() * 0.5;
        m.len = 8 + Math.random() * 10;
        m.speed = 12 + Math.random() * 10;
        m.start.set((Math.random() - 0.5) * 1.4, 0.05 + Math.random() * 0.45, -1).normalize().multiplyScalar(120 + Math.random() * 30);
        const side = Math.random() < 0.5 ? -1 : 1;
        m.dir.set(side * (0.6 + Math.random() * 0.5), -(0.35 + Math.random() * 0.4), 0).normalize();
      }
      const age = m.born < 0 ? -1 : (t - m.born) / m.life;
      if (age < 0 || age > 1) {
        mesh.visible = false;
        if (age > 1) {
          m.born = -1;
          m.next = t + 24 + Math.random() * 40;
        }
        return;
      }
      mesh.visible = true;
      m.mat.uniforms.uA.value = Math.sin(Math.PI * age) * 0.32;
      // a streak from the tail to the head, lying flat toward the eye
      _head.copy(m.start).addScaledVector(m.dir, m.speed * (t - m.born));
      _x.copy(m.dir);
      _z.copy(camera.position).sub(_head).normalize();
      _y.crossVectors(_z, _x).normalize();
      _z.crossVectors(_x, _y);
      _m.makeBasis(_x, _y, _z);
      mesh.quaternion.setFromRotationMatrix(_m);
      mesh.position.copy(_head).addScaledVector(m.dir, -m.len / 2);
      mesh.scale.set(m.len, 0.16, 1);
    });
  });

  return (
    <group renderOrder={-5}>
      <primitive object={galaxies} />
      <DebrisBelt />
      {meteors.map((m, i) => (
        <mesh
          key={`m${i}`}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          material={m.mat}
          visible={false}
          raycast={noRaycast}
          frustumCulled={false}
        >
          <planeGeometry args={[1, 1]} />
        </mesh>
      ))}
    </group>
  );
};

export default DeepSky;
