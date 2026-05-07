import * as THREE from 'three';

interface Props {
  ground: string;
  atmosphere: string;
}

const Ground = ({ ground, atmosphere }: Props) => {
  return (
    <group>
      {/* large curved planet surface */}
      <mesh position={[0, -52, 0]} receiveShadow>
        <sphereGeometry args={[50, 64, 64]} />
        <meshStandardMaterial
          color={ground}
          roughness={0.9}
          metalness={0.05}
          emissive={atmosphere}
          emissiveIntensity={0.05}
        />
      </mesh>
      {/* atmospheric fog ring near horizon */}
      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[18, 80, 64]} />
        <meshBasicMaterial
          color={atmosphere}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
};

export default Ground;
