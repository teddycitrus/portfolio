import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface StarfieldProps {
  count?: number;
  radius?: number;
  opacity?: number;
}

const Starfield = ({ count = 4500, radius = 220, opacity = 0.95 }: StarfieldProps) => {
  const ref = useRef<THREE.Points>(null);

  const { positions, colors, sizes } = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const palette = [
      new THREE.Color('#ffffff'),
      new THREE.Color('#bcd6ff'),
      new THREE.Color('#ffd6b3'),
      new THREE.Color('#cdb3ff'),
      new THREE.Color('#7ad7ff'),
    ];

    for (let i = 0; i < count; i += 1) {
      const u = Math.random();
      const v = Math.random();
      const theta = 2 * Math.PI * u;
      const phi = Math.acos(2 * v - 1);
      const r = radius * (0.6 + Math.random() * 0.4);

      const x = r * Math.sin(phi) * Math.cos(theta);
      const y = r * Math.sin(phi) * Math.sin(theta);
      const z = r * Math.cos(phi);

      positions[i * 3 + 0] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const c = palette[Math.floor(Math.random() * palette.length)];
      colors[i * 3 + 0] = c.r;
      colors[i * 3 + 1] = c.g;
      colors[i * 3 + 2] = c.b;

      sizes[i] = Math.pow(Math.random(), 4) * 1.6 + 0.4;
    }

    return { positions, colors, sizes };
  }, [count, radius]);

  useFrame((_, delta) => {
    if (!ref.current) return;
    ref.current.rotation.y += delta * 0.005;
    ref.current.rotation.x += delta * 0.001;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        <bufferAttribute attach="attributes-size" args={[sizes, 1]} />
      </bufferGeometry>
      <pointsMaterial
        vertexColors
        size={1.4}
        sizeAttenuation
        transparent
        depthWrite={false}
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        fog={false}
      />
    </points>
  );
};

export default Starfield;
