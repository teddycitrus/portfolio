import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Planet, Vec3 } from '@/types/content';
import { getOrbitalPosition, planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';

/** Related sections: awards won by projects, skills used by projects. */
const LINKS: [string, string][] = [
  ['awards', 'projects'],
  ['skills', 'projects'],
];
const SEGMENTS = 64;

const VERTEX = /* glsl */ `
  attribute float aT;
  varying float vT;
  void main() {
    vT = aT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uProgress;
  uniform float uFade;
  uniform float uReverse;
  uniform float uTime;
  varying float vT;
  void main() {
    float t = mix(vT, 1.0 - vT, uReverse);
    if (t > uProgress) discard;
    float ends = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.92, 1.0, vT));
    float pulse = 0.65 + 0.35 * sin(t * 36.0 - uTime * 1.6);
    float head = smoothstep(uProgress - 0.12, uProgress, t) * (1.0 - step(0.999, uProgress));
    float a = uFade * ends * (0.26 * pulse + 0.5 * head);
    gl_FragColor = vec4(mix(uColA, uColB, vT) * a, 1.0);
  }
`;

interface LinkState {
  a: Planet;
  b: Planet;
  line: THREE.Line;
  mat: THREE.ShaderMaterial;
  pos: Float32Array;
  attr: THREE.BufferAttribute;
  progress: number;
  fade: number;
}

const _pa: Vec3 = [0, 0, 0];
const _pb: Vec3 = [0, 0, 0];
const A = new THREE.Vector3();
const B = new THREE.Vector3();
const D = new THREE.Vector3();
const M = new THREE.Vector3();
const P = new THREE.Vector3();
const C = new THREE.Vector3();
const S = new THREE.Vector3();
const E = new THREE.Vector3();

/** Faint progressive lines between related planets while either end is hovered. */
const Constellations = () => {
  const group = useRef<THREE.Group>(null);

  const links = useMemo<LinkState[]>(
    () =>
      LINKS.flatMap(([ia, ib]) => {
        const a = planetById(ia);
        const b = planetById(ib);
        if (!a || !b) return [];
        const pos = new Float32Array((SEGMENTS + 1) * 3);
        const ts = new Float32Array(SEGMENTS + 1).map((_, i) => i / SEGMENTS);
        const geo = new THREE.BufferGeometry();
        const attr = new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage);
        geo.setAttribute('position', attr);
        geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
        const mat = new THREE.ShaderMaterial({
          uniforms: {
            uColA: { value: new THREE.Color(a.accent) },
            uColB: { value: new THREE.Color(b.accent) },
            uProgress: { value: 0 },
            uFade: { value: 0 },
            uReverse: { value: 0 },
            uTime: { value: 0 },
          },
          vertexShader: VERTEX,
          fragmentShader: FRAGMENT,
          transparent: true,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
        });
        const line = new THREE.Line(geo, mat);
        line.frustumCulled = false;
        line.visible = false;
        line.renderOrder = 5;
        return [{ a, b, line, mat, pos, attr, progress: 0, fade: 0 }];
      }),
    [],
  );

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    for (const l of links) g.add(l.line);
    return () => {
      for (const l of links) {
        g.remove(l.line);
        l.line.geometry.dispose();
        l.mat.dispose();
      }
    };
  }, [links]);

  useFrame(({ clock }, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = useAppStore.getState();
    const live = s.mode === 'overworld' || s.mode === 'intro';
    const hov = live ? s.hoveredPlanetId : null;
    const t = clock.elapsedTime;

    for (const l of links) {
      const active = hov === l.a.id || hov === l.b.id;
      if (active && l.fade < 0.01) l.mat.uniforms.uReverse.value = hov === l.b.id ? 1 : 0;
      l.fade += ((active ? 1 : 0) - l.fade) * (1 - Math.exp(-(active ? 6 : 5) * dt));
      if (active) l.progress = Math.min(1, l.progress + dt / 0.75);
      else if (l.fade < 0.01) l.progress = 0;
      l.line.visible = l.fade > 0.01;
      if (!l.line.visible) continue;

      // Gentle arc from limb to limb, bowed upward in the view plane
      getOrbitalPosition(l.a, t, _pa);
      getOrbitalPosition(l.b, t, _pb);
      A.set(_pa[0], _pa[1], _pa[2]);
      B.set(_pb[0], _pb[1], _pb[2]);
      D.subVectors(B, A);
      const len = D.length();
      D.divideScalar(len);
      S.copy(A).addScaledVector(D, l.a.radius * (l.a.rings ? 1.25 : 1.2));
      E.copy(B).addScaledVector(D, -l.b.radius * (l.b.rings ? 1.25 : 1.2));
      M.addVectors(S, E).multiplyScalar(0.5);
      P.crossVectors(D, C.copy(M).normalize()).normalize();
      if (P.y < 0) P.negate();
      C.copy(M).addScaledVector(P, len * 0.1);
      for (let i = 0; i <= SEGMENTS; i++) {
        const u = i / SEGMENTS;
        const w0 = (1 - u) * (1 - u);
        const w1 = 2 * u * (1 - u);
        const w2 = u * u;
        l.pos[i * 3] = S.x * w0 + C.x * w1 + E.x * w2;
        l.pos[i * 3 + 1] = S.y * w0 + C.y * w1 + E.y * w2;
        l.pos[i * 3 + 2] = S.z * w0 + C.z * w1 + E.z * w2;
      }
      l.attr.needsUpdate = true;
      const u = l.mat.uniforms;
      u.uProgress.value = 1 - Math.pow(1 - l.progress, 3);
      u.uFade.value = l.fade;
      u.uTime.value = t;
    }
  });

  return <group ref={group} />;
};

export default Constellations;
