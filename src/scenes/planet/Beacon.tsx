import { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Billboard, Text } from '@react-three/drei';
import * as THREE from 'three';
import type { Beacon as BeaconData, BeaconKind, Planet, Vec3 } from '@/types/content';
import { useAppStore } from '@/state/useAppStore';
import { dragLook } from '@/state/runtime';

export const LABEL_FONT =
  'https://cdn.jsdelivr.net/npm/@fontsource/ibm-plex-mono@5/files/ibm-plex-mono-latin-500-normal.woff';

/** Approximate monument height per kind, used for labels and screen-size estimates. */
export const BEACON_HEIGHT: Record<BeaconKind, number> = {
  project: 3.9,
  award: 3.2,
  skills: 2.5,
  link: 2.9,
  profile: 2.6,
};

const KIND_LABEL: Record<BeaconKind, string> = {
  project: 'PROJECT',
  award: 'AWARD',
  skills: 'SKILLS',
  link: 'LINK',
  profile: 'ABOUT',
};

/* ---------- shared resources ---------- */

const poolMaterial = (color: THREE.Color) =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: { uColor: { value: color }, uIntensity: { value: 0.5 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uIntensity;
      varying vec2 vUv;
      void main() {
        float d = length(vUv - 0.5) * 2.0;
        float a = exp(-d * d * 4.5) * (1.0 - smoothstep(0.85, 1.0, d));
        gl_FragColor = vec4(uColor * a * uIntensity, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

const damp = (cur: number, target: number, rate: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-rate * dt));

interface BeaconProps {
  beacon: BeaconData;
  planet: Planet;
  index: number;
  /** World position at ground level */
  position: Vec3;
  reducedMotion?: boolean;
}

const Beacon = ({ beacon, planet, index, position, reducedMotion }: BeaconProps) => {
  const kind = beacon.kind;
  const height = BEACON_HEIGHT[kind];
  const floater = useRef<THREE.Group>(null);
  const label = useRef<THREE.Mesh>(null);
  const sub = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const state = useRef({ focus: 0, label: 0, ring: 0 });

  // face the spawn side so seams and faces read from the walkway
  const yaw = useMemo(() => Math.atan2(-position[0], 5 - position[2]), [position]);

  const mats = useMemo(() => {
    const accent = new THREE.Color(planet.accent);
    const gold = new THREE.Color('#d8b46a').lerp(accent, 0.2);
    const stoneColor = new THREE.Color('#8c8780').lerp(new THREE.Color(planet.palette[0]), 0.18);
    const stone = new THREE.MeshStandardMaterial({ color: stoneColor, roughness: 0.72, metalness: 0.05, flatShading: true });
    const plinth = new THREE.MeshStandardMaterial({ color: stoneColor.clone().multiplyScalar(0.8), roughness: 0.9 });
    const metal = new THREE.MeshStandardMaterial({
      color: kind === 'award' ? gold : stoneColor.clone().lerp(accent, 0.25),
      roughness: 0.35,
      metalness: 0.55,
    });
    const seamBase = (kind === 'award' ? gold.clone().lerp(accent, 0.3) : accent.clone());
    const seam = new THREE.MeshBasicMaterial({ color: seamBase.clone() });
    const pool = poolMaterial(kind === 'award' ? gold.clone() : accent.clone());
    const ringMat = new THREE.MeshBasicMaterial({
      color: seamBase.clone().multiplyScalar(1.4),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    return { stone, plinth, metal, seam, seamBase, pool, ringMat };
  }, [planet, kind]);

  useEffect(
    () => () => {
      Object.values(mats).forEach((m) => m instanceof THREE.Material && m.dispose());
      document.body.style.cursor = '';
    },
    [mats],
  );

  useFrame(({ camera, clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const s = state.current;
    const t = clock.elapsedTime;
    const focused = useAppStore.getState().focusedBeaconId === beacon.id;
    s.focus = damp(s.focus, focused ? 1 : 0, 4, dt);

    const dx = camera.position.x - position[0];
    const dz = camera.position.z - position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const near = 1 - THREE.MathUtils.smoothstep(dist, 5, 17);
    s.label = damp(s.label, Math.max(0.22 + near * 0.6, s.focus), 5, dt);

    const breathe = reducedMotion ? 0 : Math.sin(t * 1.1 + index * 1.7) * 0.5 + 0.5;
    const glow = 0.95 + breathe * 0.3 + s.focus * 1.5;
    mats.seam.color.copy(mats.seamBase).multiplyScalar(glow);
    mats.pool.uniforms.uIntensity.value = 0.13 + breathe * 0.04 + s.focus * 0.3;

    if (floater.current && !reducedMotion) {
      floater.current.rotation.y = t * 0.25 + index;
      floater.current.position.y = Math.sin(t * 0.7 + index) * 0.06;
    }

    // expanding ground ring while focused
    if (ring.current) {
      const phase = (t * 0.45 + index * 0.3) % 1;
      const k = reducedMotion ? 0.6 : phase;
      ring.current.scale.setScalar(0.9 + k * 1.8);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = s.focus * (1 - k) * 0.4;
      ring.current.visible = s.focus > 0.01;
    }

    const op = s.label;
    for (const m of [label.current, sub.current]) {
      if (!m) continue;
      const txt = m as THREE.Mesh & { fillOpacity: number; outlineOpacity: number };
      txt.fillOpacity = m === sub.current ? op * 0.75 : op;
      txt.outlineOpacity = op * 0.35;
      m.visible = op > 0.01;
    }
  });

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (dragLook.travel >= 6) return;
    const s = useAppStore.getState();
    s.glideToBeacon(beacon.id);
    s.setFocusedBeacon(beacon.id);
  };

  const seamStrip = (h: number, y: number, z: number, w = 0.028, tilt = 0) => (
    <mesh material={mats.seam} position={[0, y, z]} rotation={[tilt, 0, 0]}>
      <boxGeometry args={[w, h, 0.012]} />
    </mesh>
  );

  /**
   * Seam on the front of a tapered prism centred at cy. k is the ratio between
   * face distance and radius (cos(pi/n) for a face, 1 for an edge).
   */
  const faceSeam = (rTop: number, rBot: number, H: number, cy: number, len: number, k: number, w = 0.026) => {
    const r = (rTop + rBot) / 2;
    return seamStrip(len, cy, r * k + 0.01, w, -Math.atan(((rBot - rTop) * k) / H));
  };

  let body: JSX.Element;
  switch (kind) {
    case 'project':
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 1.7, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.34, 3.4, 4, 1]} />
          </mesh>
          <mesh material={mats.metal} position={[0, 3.52, 0]} rotation={[0, Math.PI / 4, 0]} castShadow>
            <coneGeometry args={[0.2, 0.32, 4]} />
          </mesh>
          {faceSeam(0.2, 0.34, 3.4, 1.7, 2.9, Math.SQRT1_2)}
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 3.95, 0]}>
              <octahedronGeometry args={[0.09, 0]} />
            </mesh>
          </group>
        </group>
      );
      break;
    case 'award':
      body = (
        <group>
          <mesh material={mats.stone} position={[0, 1.15, 0]} castShadow receiveShadow>
            <cylinderGeometry args={[0.2, 0.26, 2.3, 8]} />
          </mesh>
          <mesh material={mats.metal} position={[0, 2.36, 0]} castShadow>
            <cylinderGeometry args={[0.3, 0.22, 0.12, 8]} />
          </mesh>
          {faceSeam(0.2, 0.26, 2.3, 1.15, 1.9, 1, 0.022)}
          <group ref={floater} position={[0, 0, 0]}>
            <group position={[0, 2.78, 0]} rotation={[1.3, 0, 0.1]}>
              <mesh material={mats.metal} castShadow>
                <torusGeometry args={[0.42, 0.016, 8, 72]} />
              </mesh>
              <mesh material={mats.seam} scale={0.8}>
                <torusGeometry args={[0.42, 0.006, 6, 96]} />
              </mesh>
            </group>
            <mesh material={mats.seam} position={[0, 2.78, 0]}>
              <sphereGeometry args={[0.055, 16, 12]} />
            </mesh>
          </group>
        </group>
      );
      break;
    case 'skills':
      body = (
        <group>
          {(
            [
              [-0.38, 0.12, 1.5],
              [0.36, 0.2, 2.1],
              [0.02, -0.36, 1.15],
            ] as const
          ).map(([x, z, h], i) => (
            <group key={i} position={[x, 0, z]}>
              <mesh material={mats.stone} position={[0, h / 2, 0]} castShadow receiveShadow>
                <boxGeometry args={[0.28, h, 0.28]} />
              </mesh>
              <mesh material={mats.seam} position={[0, h + 0.012, 0]}>
                <boxGeometry args={[0.2, 0.02, 0.2]} />
              </mesh>
              {seamStrip(h * 0.75, h * 0.45, 0.145, 0.022)}
            </group>
          ))}
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 2.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[0.16, 0.012, 6, 48]} />
            </mesh>
          </group>
        </group>
      );
      break;
    case 'link':
      body = (
        <group>
          <group scale={[0.62, 1.7, 1]}>
            <mesh material={mats.metal} castShadow>
              <torusGeometry args={[0.95, 0.045, 8, 64, Math.PI]} />
            </mesh>
            <mesh material={mats.seam} position={[0, 0, 0.05]}>
              <torusGeometry args={[0.95, 0.008, 6, 96, Math.PI]} />
            </mesh>
          </group>
          <mesh material={mats.stone} position={[0, 1.25, -0.15]} castShadow>
            <cylinderGeometry args={[0.025, 0.04, 2.5, 6]} />
          </mesh>
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 2.62, -0.15]}>
              <sphereGeometry args={[0.06, 14, 10]} />
            </mesh>
          </group>
          <mesh material={mats.seam} position={[0, 1.05, 0]}>
            <octahedronGeometry args={[0.06, 0]} />
          </mesh>
        </group>
      );
      break;
    default:
      body = (
        <group rotation={[0, 0, 0.035]}>
          <group scale={[1.15, 1, 0.55]}>
            <mesh material={mats.stone} position={[0, 1.2, 0]} rotation={[0, Math.PI / 4, 0]} castShadow receiveShadow>
              <cylinderGeometry args={[0.3, 0.42, 2.4, 4, 1]} />
            </mesh>
          </group>
          {faceSeam(0.3, 0.42, 2.4, 1.15, 1.7, Math.SQRT1_2 * 0.55, 0.02)}
          <group ref={floater}>
            <mesh material={mats.seam} position={[0, 2.75, 0]}>
              <octahedronGeometry args={[0.06, 0]} />
            </mesh>
          </group>
        </group>
      );
  }

  return (
    <group position={position}>
      <group rotation={[0, yaw, 0]}>
        {/* plinth */}
        <mesh material={mats.plinth} position={[0, 0.04, 0]} receiveShadow castShadow>
          <cylinderGeometry args={[0.85, 0.95, 0.14, 8]} />
        </mesh>
        <group position={[0, 0.1, 0]}>{body}</group>
      </group>

      {/* soft light pool and focus ring */}
      <mesh material={mats.pool} position={[0, 0.06, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={2}>
        <planeGeometry args={[6, 6]} />
      </mesh>
      <mesh ref={ring} material={mats.ringMat} position={[0, 0.08, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={3}>
        <ringGeometry args={[1.0, 1.035, 96]} />
      </mesh>

      <Billboard position={[0, height + 0.55, 0]}>
        <Text
          ref={label}
          font={LABEL_FONT}
          fontSize={0.24}
          letterSpacing={0.16}
          color="#f3eee6"
          anchorX="center"
          anchorY="bottom"
          outlineWidth={0.006}
          outlineColor="#0a0c12"
          fillOpacity={0}
        >
          {beacon.label.toUpperCase()}
        </Text>
        <Text
          ref={sub}
          font={LABEL_FONT}
          fontSize={0.1}
          letterSpacing={0.3}
          color={planet.accent}
          anchorX="center"
          anchorY="top"
          position={[0, -0.06, 0]}
          fillOpacity={0}
        >
          {`${String(index + 1).padStart(2, '0')}  ${KIND_LABEL[kind]}`}
        </Text>
      </Billboard>

      {/* generous invisible hit volume */}
      <mesh
        position={[0, height / 2, 0]}
        visible={false}
        onClick={onClick}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          document.body.style.cursor = '';
        }}
      >
        <cylinderGeometry args={[1.3, 1.3, height + 1.4, 12]} />
      </mesh>
    </group>
  );
};

export default Beacon;
