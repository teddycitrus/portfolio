import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { Billboard, Html, Text } from '@react-three/drei';
import type {
  BadgeContent,
  Beacon as BeaconType,
  LinkContent,
  ProjectContent,
  StoryContent,
} from '@/types/content';

interface Props {
  beacon: BeaconType;
  accent: string;
}

const PANEL_VISIBLE = 11;
const PANEL_HIDE = 12; // hysteresis
const VIDEO_VISIBLE = 4;
const VIDEO_HIDE = 5.5;
const TITLE_FADE_NEAR = 8;
const TITLE_FADE_FAR = 16;

const ROCK_COUNT = 6;

const seedRandom = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffffffff;
  }
  return (n: number) => {
    const x = Math.sin(h + n * 1.31) * 10000;
    return x - Math.floor(x);
  };
};

interface RockSpec {
  ox: number;
  oy: number;
  oz: number;
  size: number;
  bobPhase: number;
  bobAmp: number;
  rotSpeed: number;
  rotAxis: THREE.Vector3;
  geomKind: number;
}

/* ---------- info-panel content per beacon kind ---------- */

const PanelHeading = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <h3 className="text-base font-medium mb-2" style={{ color: accent }}>
    {children}
  </h3>
);

const Tag = ({ children, accent }: { children: React.ReactNode; accent: string }) => (
  <span
    className="inline-block px-2 py-0.5 rounded-full text-[10px] uppercase tracking-widest mb-2"
    style={{ color: accent, background: `${accent}1c`, border: `1px solid ${accent}55` }}
  >
    {children}
  </span>
);

const renderPanel = (
  beacon: BeaconType,
  accent: string,
  showVideo: boolean,
): React.ReactNode => {
  const c = beacon.content;
  switch (beacon.kind) {
    case 'badge': {
      const data = c as BadgeContent;
      return (
        <>
          <PanelHeading accent={accent}>{beacon.label}</PanelHeading>
          <Tag accent={accent}>{data.level}</Tag>
          <p className="text-white/85 text-[11px] leading-relaxed">{data.description}</p>
        </>
      );
    }
    case 'story': {
      const data = c as StoryContent;
      return (
        <>
          <PanelHeading accent={accent}>{data.heading}</PanelHeading>
          <p className="text-white/85 text-[11px] leading-relaxed">{data.body}</p>
        </>
      );
    }
    case 'project': {
      const data = c as ProjectContent;
      return (
        <>
          <PanelHeading accent={accent}>{data.heading}</PanelHeading>
          {data.video && showVideo && (
            <div
              className="aspect-video rounded overflow-hidden mb-2 bg-black"
              style={{ border: `1px solid ${accent}33` }}
            >
              <iframe
                src={data.video}
                title={data.heading}
                className="w-full h-full"
                allow="accelerometer; clipboard-write; encrypted-media; picture-in-picture"
                allowFullScreen
              />
            </div>
          )}
          <p className="text-white/85 text-[11px] leading-relaxed">{data.description}</p>
          {data.links.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {data.links.map((l) => (
                <a
                  key={l.url + l.label}
                  href={l.url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 rounded text-[10px] uppercase tracking-widest"
                  style={{ color: accent, border: `1px solid ${accent}55` }}
                >
                  {l.label} ↗
                </a>
              ))}
            </div>
          )}
        </>
      );
    }
    case 'link': {
      const data = c as LinkContent;
      return (
        <>
          <PanelHeading accent={accent}>{beacon.label}</PanelHeading>
          <p className="text-white/85 text-[11px] leading-relaxed mb-2">{data.description}</p>
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="inline-block px-3 py-1.5 rounded text-[10px] uppercase tracking-widest"
            style={{ color: accent, border: `1px solid ${accent}` }}
          >
            Open {beacon.label} ↗
          </a>
        </>
      );
    }
  }
};

/* ---------- floating rocks ---------- */

const Rock = ({ spec, accent }: { spec: RockSpec; accent: string }) => {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.position.y = spec.oy + Math.sin(t * 0.9 + spec.bobPhase) * spec.bobAmp;
    meshRef.current.rotateOnAxis(spec.rotAxis, spec.rotSpeed * 0.016);
  });

  // Random geometry per rock for variety (icos / dodec / octa)
  let geometry: React.ReactNode;
  if (spec.geomKind < 0.34) {
    geometry = <icosahedronGeometry args={[spec.size, 0]} />;
  } else if (spec.geomKind < 0.67) {
    geometry = <dodecahedronGeometry args={[spec.size, 0]} />;
  } else {
    geometry = <octahedronGeometry args={[spec.size, 0]} />;
  }

  return (
    <mesh ref={meshRef} position={[spec.ox, spec.oy, spec.oz]}>
      {geometry}
      <meshStandardMaterial
        color="#5a5a62"
        emissive={accent}
        emissiveIntensity={0.18}
        roughness={0.85}
        metalness={0.15}
        flatShading
      />
    </mesh>
  );
};

/* ---------- main beacon component ---------- */

const Beacon = ({ beacon, accent }: Props) => {
  const groupRef = useRef<THREE.Group>(null);
  const titleRef = useRef<THREE.Object3D>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [showVideo, setShowVideo] = useState(false);
  const [titleOp, setTitleOp] = useState(0);

  const { camera } = useThree();

  const rocks = useMemo<RockSpec[]>(() => {
    const r = seedRandom(beacon.id);
    const out: RockSpec[] = [];
    for (let i = 0; i < ROCK_COUNT; i += 1) {
      const angle = (i / ROCK_COUNT) * Math.PI * 2 + r(i + 1) * 0.6;
      const radius = 0.5 + r(i + 7) * 0.9;
      const ox = Math.cos(angle) * radius;
      const oz = Math.sin(angle) * radius;
      const oy = 1.0 + r(i + 13) * 1.7; // 1.0..2.7
      const size = 0.22 + r(i + 23) * 0.32;
      const bobPhase = r(i + 31) * Math.PI * 2;
      const bobAmp = 0.15 + r(i + 41) * 0.22;
      const rotAxis = new THREE.Vector3(
        r(i + 53) - 0.5,
        r(i + 61) - 0.5,
        r(i + 67) - 0.5,
      ).normalize();
      const rotSpeed = 0.2 + r(i + 71) * 0.35;
      out.push({ ox, oy, oz, size, bobPhase, bobAmp, rotAxis, rotSpeed, geomKind: r(i + 83) });
    }
    return out;
  }, [beacon.id]);

  useFrame(() => {
    // XZ distance from player to beacon centre
    const dx = camera.position.x - beacon.position[0];
    const dz = camera.position.z - beacon.position[2];
    const d = Math.hypot(dx, dz);

    // Hysteresis-gated visibility — avoid panel flap at the threshold
    if (d < PANEL_VISIBLE && !showPanel) setShowPanel(true);
    else if (d > PANEL_HIDE && showPanel) setShowPanel(false);
    if (d < VIDEO_VISIBLE && !showVideo) setShowVideo(true);
    else if (d > VIDEO_HIDE && showVideo) setShowVideo(false);

    // Title fade — quantised to 10 steps so we don't churn the React tree
    const target = THREE.MathUtils.clamp(
      (TITLE_FADE_FAR - d) / (TITLE_FADE_FAR - TITLE_FADE_NEAR),
      0,
      1,
    );
    const stepped = Math.round(target * 10) / 10;
    if (stepped !== titleOp) setTitleOp(stepped);
  });

  return (
    <group
      ref={groupRef}
      position={[beacon.position[0], 0, beacon.position[2]]}
    >
      {/* faint ground accent so the cluster has a footprint */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.4, 1.6, 32]} />
        <meshBasicMaterial
          color={accent}
          transparent
          opacity={0.18}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Floating rock cluster */}
      {rocks.map((spec, i) => (
        <Rock key={i} spec={spec} accent={accent} />
      ))}

      {/* Soft point light in the centre of the cluster */}
      <pointLight position={[0, 1.8, 0]} color={accent} intensity={0.7} distance={5} decay={2} />

      {/* Title — visible from far, fades with distance */}
      <Billboard position={[0, 3.4, 0]}>
        <Text
          ref={titleRef as React.MutableRefObject<THREE.Object3D>}
          fontSize={0.34}
          color={accent}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.012}
          outlineColor="#04060f"
          fillOpacity={titleOp}
          outlineOpacity={titleOp * 0.7}
          letterSpacing={0.08}
        >
          {beacon.label.toUpperCase()}
        </Text>
      </Billboard>

      {/* Info panel — only mounted when player is near. Heavy iframe gated
          tighter so it doesn't load until you're really close. */}
      {showPanel && (
        <Billboard position={[0, 1.6, 0]}>
          <Html
            transform
            distanceFactor={6}
            zIndexRange={[100, 0]}
            style={{
              width: 320,
              pointerEvents: 'auto',
              userSelect: 'text',
            }}
          >
            <div
              className="rounded-lg p-4 backdrop-blur-md"
              style={{
                background: 'rgba(8, 12, 24, 0.78)',
                border: `1px solid ${accent}44`,
                boxShadow: `0 4px 24px ${accent}22`,
              }}
            >
              {renderPanel(beacon, accent, showVideo)}
            </div>
          </Html>
        </Billboard>
      )}
    </group>
  );
};

export default Beacon;
