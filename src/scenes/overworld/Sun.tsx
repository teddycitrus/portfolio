import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

/** World-space direction toward the sun. Shared by every overworld shader. */
export const SUN_DIRECTION = new THREE.Vector3(-0.6, 0.35, 0.2).normalize();
/** Linear HDR sun colour used for planet lighting. */
export const SUN_COLOR = new THREE.Color(1.0, 0.95, 0.88).multiplyScalar(1.55);

const SUN_DISTANCE = 300;

const HALO_VERTEX = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv * 2.0 - 1.0;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Radial falloff: tight hot core, broad faint scatter. Values are HDR so bloom only takes the centre.
const HALO_FRAGMENT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    float r = length(vUv);
    if (r > 1.0) discard;
    float core = exp(-r * r * 260.0) * 6.0;
    float glow = exp(-r * 9.0) * 0.55;
    float scatter = pow(1.0 - r, 3.0) * 0.06;
    vec3 col = vec3(1.0, 0.93, 0.84) * (core + glow) + vec3(1.0, 0.82, 0.66) * scatter;
    gl_FragColor = vec4(col, 1.0);
  }
`;

/** Distant star that follows the camera so its direction never changes. */
const Sun = () => {
  const group = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);

  const haloMat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: HALO_VERTEX,
        fragmentShader: HALO_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    [],
  );

  useFrame(({ camera }) => {
    if (!group.current || !halo.current) return;
    group.current.position.copy(camera.position).addScaledVector(SUN_DIRECTION, SUN_DISTANCE);
    halo.current.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group}>
      <mesh renderOrder={-90}>
        <sphereGeometry args={[2.4, 24, 16]} />
        <meshBasicMaterial color={[14, 13, 11.5]} fog={false} toneMapped={false} />
      </mesh>
      <mesh ref={halo} material={haloMat} renderOrder={-89}>
        <planeGeometry args={[90, 90]} />
      </mesh>
    </group>
  );
};

export default Sun;
