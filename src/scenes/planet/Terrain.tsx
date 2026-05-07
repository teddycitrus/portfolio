import { useMemo } from 'react';
import * as THREE from 'three';

interface Props {
  ground: string;
  atmosphere: string;
}

const TERRAIN_RADIUS = 60;

const Terrain = ({ ground, atmosphere }: Props) => {
  // Subtly displaced disc so the ground reads as not-quite-flat without
  // making walking feel jittery. Vertices are perturbed by a smooth
  // pseudo-random field.
  const geometry = useMemo(() => {
    const seg = 96;
    const geo = new THREE.CircleGeometry(TERRAIN_RADIUS, seg);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i += 1) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 0.5) continue; // keep area near the player flat
      const n =
        Math.sin(x * 0.18) * 0.5 +
        Math.cos(z * 0.21) * 0.5 +
        Math.sin((x + z) * 0.07) * 0.4;
      pos.setY(i, n);
    }
    geo.computeVertexNormals();
    return geo;
  }, []);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow position={[0, 0, 0]}>
        <meshStandardMaterial
          color={ground}
          roughness={0.95}
          metalness={0.02}
          emissive={atmosphere}
          emissiveIntensity={0.06}
        />
      </mesh>
      {/* horizon haze ring */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TERRAIN_RADIUS * 0.85, TERRAIN_RADIUS * 1.05, 64]} />
        <meshBasicMaterial
          color={atmosphere}
          transparent
          opacity={0.22}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export default Terrain;
export { TERRAIN_RADIUS };
