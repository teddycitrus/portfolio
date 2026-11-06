import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';

/*
 * What lies beyond the planets, seen through the deck window: distant spiral
 * galaxies, and now and then a meteor streaking past (the nebulae are painted
 * into the baked sky, see SpaceBackdrop). Everything is additive, far behind
 * the planets and never takes a click.
 */

/** Distance of the deep-sky layer: past the planets, inside the starfield shell */
const FAR = 170;
const noRaycast = () => null;

const NOISE = /* glsl */ `
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
`;

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** A spiral galaxy seen at an angle: two log-spiral arms, a warm core, a cool disc. */
const galaxyMaterial = (seed: number, tilt: number, spin: number, strength: number) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uSeed: { value: seed }, uTilt: { value: tilt }, uSpin: { value: spin }, uK: { value: strength } },
    vertexShader: VERT,
    fragmentShader: /* glsl */ `
      uniform float uSeed;
      uniform float uTilt;
      uniform float uSpin;
      uniform float uK;
      varying vec2 vUv;
      ${NOISE}
      void main() {
        // undo the viewing angle: the disc is squashed along y
        float c = cos(uSpin), s = sin(uSpin);
        vec2 p = mat2(c, -s, s, c) * vUv;
        p.y /= max(0.2, uTilt);
        float r = length(p);
        float a = atan(p.y, p.x);
        float arms = 0.5 + 0.5 * cos(2.0 * (a - log(r + 0.04) * 2.4) + fbm(p * 6.0 + uSeed) * 2.0);
        arms = pow(arms, 2.5);
        float clumps = smoothstep(0.45, 0.9, fbm(p * 14.0 + uSeed * 3.0));
        float disc = exp(-r * 3.2) * (0.25 + 0.9 * arms * (0.6 + 0.6 * clumps));
        float core = exp(-r * r * 60.0);
        float edge = 1.0 - smoothstep(0.7, 1.0, length(vUv));
        vec3 col = vec3(0.62, 0.74, 1.0) * disc + vec3(1.0, 0.86, 0.66) * core * 1.6 + vec3(1.0, 0.55, 0.7) * clumps * arms * exp(-r * 3.0) * 0.25;
        gl_FragColor = vec4(col * edge * uK, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

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
        float body = pow(t, 3.0) * (1.0 - smoothstep(0.0, 1.0 - t * 0.6, abs(vUv.y)));
        float head = exp(-((vUv.x - 0.92) * (vUv.x - 0.92)) * 300.0 - vUv.y * vUv.y * 6.0);
        vec3 col = mix(vec3(0.55, 0.75, 1.0), vec3(1.0, 0.95, 0.85), t) * body * 1.4 + vec3(1.4) * head;
        gl_FragColor = vec4(col * uA, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/** Direction from the viewer for a point in the window, roughly: x right, y up (tangents) */
const place = (x: number, y: number) => new THREE.Vector3(x, y, -1).normalize().multiplyScalar(FAR);

interface Sky {
  pos: THREE.Vector3;
  size: [number, number];
  roll: number;
  mat: THREE.ShaderMaterial;
}

const METEORS = 3;

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
  const reduced = useAppStore((s) => s.reducedMotion);
  const meshes = useRef<(THREE.Mesh | null)[]>([]);

  const sky = useMemo<Sky[]>(
    () => [
      // distant galaxies
      { pos: place(-0.12, 0.24), size: [16, 16], roll: 0, mat: galaxyMaterial(2.0, 0.42, 0.6, 0.55) },
      { pos: place(0.74, -0.2), size: [10, 10], roll: 0, mat: galaxyMaterial(5.0, 0.75, -0.3, 0.45) },
      { pos: place(-0.72, 0.2), size: [7, 7], roll: 0, mat: galaxyMaterial(9.0, 0.28, 1.2, 0.4) },
    ],
    [],
  );

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
        next: 1.5 + i * 3.1,
      })),
    [],
  );

  useEffect(
    () => () => {
      sky.forEach((s) => s.mat.dispose());
      meteors.forEach((m) => m.mat.dispose());
    },
    [sky, meteors],
  );

  // the deep-sky planes face the eye once; they are far enough that parallax does not matter
  useEffect(() => {
    sky.forEach((s, i) => {
      const m = meshes.current[i];
      if (!m) return;
      m.position.copy(s.pos);
      m.lookAt(0, 0, 0);
      m.rotateZ(s.roll);
    });
  }, [sky]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    sky.forEach((s) => {
      if (s.mat.uniforms.uTime) s.mat.uniforms.uTime.value = reduced ? 0 : t;
    });
    meteors.forEach((m, i) => {
      const mesh = meshes.current[sky.length + i];
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
        m.speed = 25 + Math.random() * 25;
        m.start.set((Math.random() - 0.5) * 1.4, 0.05 + Math.random() * 0.45, -1).normalize().multiplyScalar(120 + Math.random() * 30);
        const side = Math.random() < 0.5 ? -1 : 1;
        m.dir.set(side * (0.6 + Math.random() * 0.5), -(0.35 + Math.random() * 0.4), 0).normalize();
      }
      const age = m.born < 0 ? -1 : (t - m.born) / m.life;
      if (age < 0 || age > 1) {
        mesh.visible = false;
        if (age > 1) {
          m.born = -1;
          m.next = t + 2.5 + Math.random() * 6;
        }
        return;
      }
      mesh.visible = true;
      m.mat.uniforms.uA.value = Math.sin(Math.PI * age) * 0.9;
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
      {sky.map((s, i) => (
        <mesh
          key={i}
          ref={(el) => {
            meshes.current[i] = el;
          }}
          material={s.mat}
          raycast={noRaycast}
          frustumCulled={false}
        >
          <planeGeometry args={s.size} />
        </mesh>
      ))}
      {meteors.map((m, i) => (
        <mesh
          key={`m${i}`}
          ref={(el) => {
            meshes.current[sky.length + i] = el;
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
