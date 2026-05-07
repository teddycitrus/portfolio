import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface Props {
  ground: string;
  accent: string;
  exclusionPoints?: Array<[number, number]>;
}

const FIELD_RADIUS = 28;
const SPAWN_CLEAR = 1.6;
const BEACON_CLEAR = 0.7;

const noise2 = (x: number, z: number): number => {
  const a = Math.sin(x * 0.18 + 1.3) * Math.cos(z * 0.21 - 0.4);
  const b = Math.sin((x + z) * 0.07);
  const c = Math.sin(x * 0.42) * Math.sin(z * 0.37);
  return THREE.MathUtils.clamp((a * 0.5 + b * 0.3 + c * 0.2 + 0.5), 0, 1);
};

const insideExclusion = (
  x: number,
  z: number,
  zones: Array<[number, number]> | undefined,
  r: number,
): boolean => {
  if (!zones) return false;
  for (const [zx, zz] of zones) {
    if (Math.hypot(x - zx, z - zz) < r) return true;
  }
  return false;
};

interface Scatter {
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
}

interface ScatterArgs {
  count: number;
  rMin?: number;
  rMax?: number;
  density: number;
  populate: (dummy: THREE.Object3D, x: number, z: number) => void;
  colorPicker: () => THREE.Color;
  exclusions: Array<[number, number]>;
}

const buildScatter = ({
  count,
  rMin = 1.0,
  rMax = FIELD_RADIUS,
  density,
  populate,
  colorPicker,
  exclusions,
}: ScatterArgs): Scatter => {
  const dummy = new THREE.Object3D();
  const matrices: THREE.Matrix4[] = [];
  const colors: THREE.Color[] = [];

  let attempts = 0;
  const maxAttempts = count * 6;
  while (matrices.length < count && attempts < maxAttempts) {
    attempts += 1;
    const r = rMin + Math.sqrt(Math.random()) * (rMax - rMin);
    const t = Math.random() * Math.PI * 2;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;

    if (Math.hypot(x, z) < SPAWN_CLEAR) continue;
    if (insideExclusion(x, z, exclusions, BEACON_CLEAR)) continue;

    const n = noise2(x, z);
    if (Math.random() > n * density + (1 - density) * 0.3) continue;

    populate(dummy, x, z);
    dummy.updateMatrix();
    matrices.push(dummy.matrix.clone());
    colors.push(colorPicker());
  }

  return { matrices, colors };
};

const applyScatter = (mesh: THREE.InstancedMesh | null, data: Scatter): void => {
  if (!mesh) return;
  mesh.count = data.matrices.length;
  for (let i = 0; i < data.matrices.length; i += 1) {
    mesh.setMatrixAt(i, data.matrices[i]);
    mesh.setColorAt(i, data.colors[i]);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
};

const Vegetation = ({ ground, accent, exclusionPoints }: Props) => {
  const grassRef = useRef<THREE.InstancedMesh>(null);
  const weedRef = useRef<THREE.InstancedMesh>(null);
  const bushLowRef = useRef<THREE.InstancedMesh>(null);
  const bushTallRef = useRef<THREE.InstancedMesh>(null);
  const pebbleRef = useRef<THREE.InstancedMesh>(null);
  const swayRef = useRef<THREE.Group>(null);

  const exclusions = useMemo(() => exclusionPoints ?? [], [exclusionPoints]);

  const palette = useMemo(() => {
    const accentCol = new THREE.Color(accent);
    const groundCol = new THREE.Color(ground);
    return {
      grassA: accentCol.clone().offsetHSL(0, 0, -0.2),
      grassB: accentCol.clone().offsetHSL(0, 0, -0.08),
      weedA: accentCol.clone().offsetHSL(0.04, -0.05, -0.18),
      weedB: accentCol.clone().offsetHSL(0.04, -0.05, -0.04),
      bushA: groundCol.clone().lerp(accentCol, 0.35).offsetHSL(0, 0, 0.02),
      bushB: accentCol.clone().offsetHSL(0, -0.15, -0.18),
      bushC: groundCol.clone().lerp(accentCol, 0.55).offsetHSL(0, -0.05, -0.06),
      pebbleA: new THREE.Color('#5a5a62'),
      pebbleB: new THREE.Color('#3e3e46'),
    };
  }, [accent, ground]);

  const tinted = (a: THREE.Color, b: THREE.Color, jitter = 0.05): THREE.Color => {
    const c = a.clone().lerp(b, Math.random());
    if (jitter > 0) c.offsetHSL(0, 0, (Math.random() - 0.5) * jitter);
    return c;
  };

  const scatter = useMemo(() => {
    return {
      // Thin tall grass blades — narrow XZ so they don't read as pyramids
      grass: buildScatter({
        count: 700,
        density: 1.0,
        exclusions,
        populate: (d, x, z) => {
          const s = 0.5 + Math.random() * 0.6;
          d.position.set(x, s * 0.32, z);
          d.rotation.set(0, Math.random() * Math.PI * 2, 0);
          d.scale.set(s * 0.05, s * 0.65, s * 0.05);
        },
        colorPicker: () => tinted(palette.grassA, palette.grassB, 0.06),
      }),

      // Taller, slightly thicker accent weeds — sparse
      weeds: buildScatter({
        count: 200,
        rMin: 1.4,
        density: 0.7,
        exclusions,
        populate: (d, x, z) => {
          const s = 0.6 + Math.random() * 0.6;
          d.position.set(x, s * 0.5, z);
          d.rotation.set(0, Math.random() * Math.PI * 2, 0);
          d.scale.set(s * 0.07, s * 1.0, s * 0.07);
        },
        colorPicker: () => tinted(palette.weedA, palette.weedB, 0.08),
      }),

      // Low round bushes
      bushLow: buildScatter({
        count: 95,
        rMin: 2.4,
        density: 0.55,
        exclusions,
        populate: (d, x, z) => {
          const s = 0.32 + Math.random() * 0.45;
          d.position.set(x, s * 0.55, z);
          d.rotation.set(
            (Math.random() - 0.5) * 0.18,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.18,
          );
          d.scale.set(s, s * 0.7, s);
        },
        colorPicker: () => tinted(palette.bushA, palette.bushC, 0.06),
      }),

      // Taller wispy bushes — narrower, more vertical
      bushTall: buildScatter({
        count: 55,
        rMin: 3.0,
        density: 0.45,
        exclusions,
        populate: (d, x, z) => {
          const s = 0.28 + Math.random() * 0.4;
          d.position.set(x, s * 0.85, z);
          d.rotation.set(
            (Math.random() - 0.5) * 0.15,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.15,
          );
          d.scale.set(s * 0.55, s * 1.5, s * 0.55);
        },
        colorPicker: () => tinted(palette.bushB, palette.bushC, 0.05),
      }),

      // A handful of small pebbles — round-ish so they don't read as spikes
      pebbles: buildScatter({
        count: 70,
        density: 0.85,
        exclusions,
        populate: (d, x, z) => {
          const s = 0.07 + Math.random() * 0.13;
          d.position.set(x, s * 0.5, z);
          d.rotation.set(
            (Math.random() - 0.5) * 0.6,
            Math.random() * Math.PI * 2,
            (Math.random() - 0.5) * 0.6,
          );
          d.scale.set(s, s * 0.7, s);
        },
        colorPicker: () => tinted(palette.pebbleA, palette.pebbleB, 0.04),
      }),
    };
  }, [palette, exclusions]);

  useLayoutEffect(() => {
    applyScatter(grassRef.current, scatter.grass);
    applyScatter(weedRef.current, scatter.weeds);
    applyScatter(bushLowRef.current, scatter.bushLow);
    applyScatter(bushTallRef.current, scatter.bushTall);
    applyScatter(pebbleRef.current, scatter.pebbles);
  }, [scatter]);

  useFrame((state) => {
    if (!swayRef.current) return;
    swayRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.6) * 0.012;
  });

  return (
    <group ref={swayRef}>
      {/* Grass — 6-sided thin cones to soften the silhouette */}
      <instancedMesh ref={grassRef} args={[undefined, undefined, 700]}>
        <coneGeometry args={[1, 1, 6, 1]} />
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0} />
      </instancedMesh>
      {/* Weeds — same shape, taller */}
      <instancedMesh ref={weedRef} args={[undefined, undefined, 200]}>
        <coneGeometry args={[1, 1, 6, 1]} />
        <meshStandardMaterial vertexColors roughness={0.85} metalness={0} />
      </instancedMesh>
      {/* Low bushes — round icospheres, flattened */}
      <instancedMesh ref={bushLowRef} args={[undefined, undefined, 95]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0} flatShading />
      </instancedMesh>
      {/* Tall bushes — same geometry, stretched + different colour */}
      <instancedMesh ref={bushTallRef} args={[undefined, undefined, 55]}>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial vertexColors roughness={0.9} metalness={0} flatShading />
      </instancedMesh>
      {/* Pebbles — small round-ish stones, sparse */}
      <instancedMesh ref={pebbleRef} args={[undefined, undefined, 70]}>
        <icosahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial vertexColors roughness={0.95} metalness={0.05} flatShading />
      </instancedMesh>
    </group>
  );
};

export default Vegetation;
