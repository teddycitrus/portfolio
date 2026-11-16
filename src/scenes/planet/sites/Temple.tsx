import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Beacon as BeaconData, Planet } from '@/types/content';
import type { HeightFn } from '../Terrain';
import { TEMPLE, templeLevels } from './site';
import { addRim, Fire, noRaycast, Strut, useCanvasTexture, type FireLevel } from './common';
import { decalMaterial } from './dress';
import { buildTemple } from './templeDress';

/*
 * The awards planet is an open-air temple at dawn: a raised floor reached by
 * steps, a colonnade down each side, and an eternal flame on a dais closing
 * the aisle under a gate. The awards are statues down the aisle in pairs,
 * robed figures holding up an emblem of what was won, each on a plinth with a
 * bronze plaque. The braziers beside a statue flare as you walk up to it.
 */

const STONE = '#cdbfa6';
const GOLD = '#dcb664';
const BRONZE = '#8a5a2b';
/** Parsed once: the frame loop only copies and scales them */
const BRONZE_C = new THREE.Color(BRONZE);
const FLAME_C = new THREE.Color('#ffd27a');

/** Plinth top, and the statue's scale on it */
const PLINTH_H = 1.15;
const STATUE_SCALE = 1.05;
/** Statue top (emblem included), for labels and the screens */
export const STATUE_HEIGHT = PLINTH_H + 2.85 * STATUE_SCALE;

const useStone = (planet: Planet, rimColor: THREE.Color | undefined, rim: number) =>
  useMemo(() => {
    const rc = rimColor ?? new THREE.Color(planet.accent);
    const stone = addRim(
      new THREE.MeshStandardMaterial({ color: new THREE.Color(STONE), roughness: 0.72, metalness: 0.02, flatShading: true }),
      rc,
      rim * 0.16,
    );
    const dark = addRim(
      new THREE.MeshStandardMaterial({ color: new THREE.Color(STONE).multiplyScalar(0.62), roughness: 0.9, flatShading: true }),
      rc,
      rim * 0.08,
    );
    const gold = new THREE.MeshStandardMaterial({
      color: GOLD,
      roughness: 0.3,
      metalness: 0.8,
      emissive: new THREE.Color(GOLD).multiplyScalar(0.1),
    });
    const iron = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.6, metalness: 0.6 });
    return { stone, dark, gold, iron };
  }, [planet, rimColor, rim]);

type Mats = ReturnType<typeof useStone>;

const useDispose = (mats: Record<string, THREE.Material>) =>
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);

/** A brazier: an iron tripod and bowl with a fire in it. */
const Brazier = ({ mats, level, height = 0.95, bowl = 0.22, flame = 0.5, reducedMotion, seed }: {
  mats: Mats;
  level: FireLevel;
  height?: number;
  bowl?: number;
  flame?: number;
  reducedMotion?: boolean;
  seed?: number;
}) => (
  <group>
    {[0, 1, 2].map((i) => {
      const a = (i / 3) * Math.PI * 2;
      return (
        <Strut
          key={i}
          a={[Math.cos(a) * bowl * 1.1, 0, Math.sin(a) * bowl * 1.1]}
          b={[Math.cos(a) * bowl * 0.35, height - 0.06, Math.sin(a) * bowl * 0.35]}
          r={0.022}
          material={mats.iron}
        />
      );
    })}
    <mesh material={mats.iron} position={[0, height, 0]} castShadow raycast={noRaycast}>
      <cylinderGeometry args={[bowl, bowl * 0.45, bowl * 0.6, 10, 1]} />
    </mesh>
    <mesh material={mats.gold} position={[0, height + bowl * 0.3, 0]} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
      <torusGeometry args={[bowl, 0.018, 6, 24]} />
    </mesh>
    <group position={[0, height + bowl * 0.15, 0]}>
      <Fire level={level} size={flame} ground={-height - bowl * 0.15} pool={2.6} reducedMotion={reducedMotion} seed={seed} />
    </group>
  </group>
);

/** Floor slabs with grout lines, tiled over the temple floor. */
const useFloorTexture = () =>
  useCanvasTexture(
    256,
    256,
    (g) => {
      g.fillStyle = '#d6c9b0';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 260; i += 1) {
        g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,250,240' : '60,45,30'},${0.03 + Math.random() * 0.04})`;
        g.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 30, 1 + Math.random() * 3);
      }
      g.strokeStyle = 'rgba(70,55,40,0.55)';
      g.lineWidth = 3;
      g.strokeRect(1.5, 1.5, 253, 253);
      g.beginPath();
      g.moveTo(128, 0);
      g.lineTo(128, 128);
      g.moveTo(0, 128);
      g.lineTo(256, 128);
      g.moveTo(64, 128);
      g.lineTo(64, 256);
      g.moveTo(192, 128);
      g.lineTo(192, 256);
      g.stroke();
    },
    [],
  );

export const TempleGrounds = ({
  planet,
  ground,
  rim,
  rimColor,
  reducedMotion,
}: {
  planet: Planet;
  ground: HeightFn;
  rim: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
}) => {
  const mats = useStone(planet, rimColor, rim);
  useDispose(mats);
  const floorTex = useFloorTexture();
  const floor = useMemo(() => {
    const m = addRim(new THREE.MeshStandardMaterial({ color: '#ffffff', map: floorTex, roughness: 0.8 }), rimColor ?? new THREE.Color(planet.accent), rim * 0.06);
    return m;
  }, [floorTex, planet, rim, rimColor]);
  useEffect(() => () => floor.dispose(), [floor]);
  const { top, base } = useMemo(() => templeLevels(ground), [ground]);
  const W = TEMPLE.x1 - TEMPLE.x0;
  const D = TEMPLE.z1 - TEMPLE.z0;
  const cx = (TEMPLE.x0 + TEMPLE.x1) / 2;
  const cz = (TEMPLE.z0 + TEMPLE.z1) / 2;
  useMemo(() => {
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
    floorTex.repeat.set(W / 2.4, D / 2.4);
  }, [floorTex, W, D]);
  const eternal = useRef<FireLevel>({ v: 1 });
  const dress = useMemo(() => buildTemple(planet, ground, top, base), [planet, ground, top, base]);
  useEffect(() => () => Object.values(dress).forEach((g) => g.dispose()), [dress]);
  const dressMats = useMemo(() => {
    const rc = rimColor ?? new THREE.Color(planet.accent);
    return {
      cast: addRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.72, metalness: 0.02, flatShading: true }), rc, rim * 0.16),
      flat: addRim(
        new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, flatShading: true, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
        rc,
        rim * 0.08,
      ),
      stain: decalMaterial(),
      ember: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    };
  }, [planet, rim, rimColor]);
  useDispose(dressMats);

  useFrame(({ clock }) => {
    const k = reducedMotion ? 0.9 : 0.85 + 0.15 * Math.sin(clock.elapsedTime * 0.7);
    dressMats.ember.color.setScalar(k);
  });

  return (
    <group>
      {/* the floor and its foundation, sunk into the rock */}
      <mesh material={floor} position={[cx, (top + base) / 2, cz]} receiveShadow raycast={noRaycast}>
        <boxGeometry args={[W, top - base, D]} />
      </mesh>
      {/* steps, colonnades, gate and dais; their carving; inlays and offerings; stains */}
      <mesh geometry={dress.cast} material={dressMats.cast} castShadow receiveShadow raycast={noRaycast} />
      <mesh geometry={dress.flat} material={dressMats.flat} receiveShadow raycast={noRaycast} />
      <mesh geometry={dress.gold} material={mats.gold} raycast={noRaycast} />
      <mesh geometry={dress.stain} material={dressMats.stain} renderOrder={1} raycast={noRaycast} />
      <mesh geometry={dress.ember} material={dressMats.ember} raycast={noRaycast} />
      {/* the eternal flame */}
      <group position={[0, top + 1.3, TEMPLE.daisZ]}>
        <mesh material={mats.gold} castShadow raycast={noRaycast}>
          <cylinderGeometry args={[0.62, 0.3, 0.32, 14, 1]} />
        </mesh>
        <group position={[0, 0.1, 0]}>
          <Fire level={eternal.current} size={1.35} ground={-1.4} pool={7} reducedMotion={reducedMotion} seed={9} />
        </group>
      </group>
    </group>
  );
};

/* ---------- the statues ---------- */

type Emblem = 'shield' | 'eye' | 'knot' | 'laurel' | 'star';

const emblemFor = (b: BeaconData): Emblem =>
  /hackcanada|shield/.test(b.id) ? 'shield' : /htv|iris/.test(b.id) ? 'eye' : /ccc/.test(b.id) ? 'knot' : /peo/.test(b.id) ? 'laurel' : 'star';

const SHIELD = (() => {
  const sh = new THREE.Shape();
  sh.moveTo(-0.22, 0.25);
  sh.lineTo(0.22, 0.25);
  sh.lineTo(0.22, 0.0);
  sh.quadraticCurveTo(0.2, -0.19, 0, -0.32);
  sh.quadraticCurveTo(-0.2, -0.19, -0.22, 0.0);
  sh.closePath();
  return sh;
})();

/** A robed figure: lathe profile from the hem up to the shoulders (radius, height) */
const ROBE = new THREE.LatheGeometry(
  [
    [0, 0],
    [0.44, 0],
    [0.47, 0.08],
    [0.4, 0.5],
    [0.33, 0.95],
    [0.29, 1.2],
    [0.33, 1.36],
    [0.3, 1.47],
    [0.15, 1.56],
    [0.09, 1.6],
    [0, 1.61],
  ].map(([r, y]) => new THREE.Vector2(r, y)),
  10,
);

const EmblemMesh = ({ kind, mats, glow }: { kind: Emblem; mats: Mats; glow: THREE.Material }) => {
  switch (kind) {
    case 'shield':
      // ShieldClaw: a shield scored by three claw marks
      return (
        <group>
          <mesh material={mats.gold} position={[0, 0, -0.03]} castShadow raycast={noRaycast}>
            <extrudeGeometry args={[SHIELD, { depth: 0.06, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 1 }]} />
          </mesh>
          {[-0.08, 0, 0.08].map((x) => (
            <mesh key={x} material={glow} position={[x, -0.02, 0.05]} rotation={[0, 0, 0.35]} raycast={noRaycast}>
              <boxGeometry args={[0.025, 0.34, 0.01]} />
            </mesh>
          ))}
        </group>
      );
    case 'eye':
      // Iris: an open eye
      return (
        <group>
          <mesh material={mats.gold} scale={[1.5, 0.75, 1]} castShadow raycast={noRaycast}>
            <torusGeometry args={[0.2, 0.03, 8, 40]} />
          </mesh>
          <mesh material={glow} raycast={noRaycast}>
            <sphereGeometry args={[0.085, 16, 12]} />
          </mesh>
          <mesh material={mats.gold} position={[0, 0, 0.07]} raycast={noRaycast}>
            <sphereGeometry args={[0.035, 10, 8]} />
          </mesh>
        </group>
      );
    case 'knot':
      // the CCC: an endless knot, for algorithms
      return (
        <group>
          <mesh material={mats.gold} castShadow raycast={noRaycast}>
            <torusKnotGeometry args={[0.16, 0.035, 96, 8, 2, 3]} />
          </mesh>
          <mesh material={glow} raycast={noRaycast}>
            <octahedronGeometry args={[0.06, 0]} />
          </mesh>
        </group>
      );
    case 'laurel':
      // first place: a laurel wreath around a star
      return (
        <group>
          {[-1, 1].map((side) =>
            Array.from({ length: 7 }, (_, i) => {
              const a = -Math.PI / 2 + side * (0.35 + (i / 6) * 2.3);
              return (
                <mesh
                  key={`${side}-${i}`}
                  material={mats.gold}
                  position={[Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0]}
                  rotation={[0, 0, a + side * 0.6]}
                  scale={[1, 0.45, 0.3]}
                  raycast={noRaycast}
                >
                  <sphereGeometry args={[0.07, 6, 4]} />
                </mesh>
              );
            }),
          )}
          <mesh material={glow} rotation={[Math.PI / 2, 0, 0]} raycast={noRaycast}>
            <cylinderGeometry args={[0.1, 0.1, 0.03, 5]} />
          </mesh>
        </group>
      );
    default:
      return (
        <mesh material={glow} raycast={noRaycast}>
          <octahedronGeometry args={[0.12, 0]} />
        </mesh>
      );
  }
};

/** Word-wraps a line into at most `max` lines that fit `width`. */
const wrap = (g: CanvasRenderingContext2D, text: string, width: number, max: number) => {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width > width && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines.slice(0, max);
};

/** The bronze plaque on a plinth: event, result, year and project. */
const usePlaque = (b: BeaconData) =>
  useCanvasTexture(
    512,
    300,
    (g) => {
      if (b.kind !== 'award') return;
      const c = b.content;
      const grd = g.createLinearGradient(0, 0, 0, 300);
      grd.addColorStop(0, '#9c6a35');
      grd.addColorStop(1, '#6e4520');
      g.fillStyle = grd;
      g.fillRect(0, 0, 512, 300);
      g.strokeStyle = 'rgba(255, 220, 160, 0.55)';
      g.lineWidth = 4;
      g.strokeRect(14, 14, 484, 272);
      g.strokeStyle = 'rgba(40, 20, 5, 0.6)';
      g.lineWidth = 2;
      g.strokeRect(22, 22, 468, 256);
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      const engrave = (text: string, y: number, font: string, color: string) => {
        g.font = font;
        g.fillStyle = 'rgba(30, 14, 2, 0.7)';
        g.fillText(text, 256, y + 2);
        g.fillStyle = color;
        g.fillText(text, 256, y);
      };
      g.font = '700 40px "Archivo Variable", "Arial Black", sans-serif';
      const lines = wrap(g, c.event.toUpperCase(), 440, 2);
      const y0 = lines.length > 1 ? 82 : 100;
      lines.forEach((l, i) => engrave(l, y0 + i * 46, '700 40px "Archivo Variable", "Arial Black", sans-serif', '#ffe4ae'));
      engrave(c.result, y0 + lines.length * 46 + 22, '600 30px "Archivo Variable", Arial, sans-serif', '#ffd27a');
      const foot = [c.project, c.year].filter(Boolean).join('  ·  ');
      if (foot) engrave(foot, 248, '500 24px "JetBrains Mono Variable", monospace', '#f3d6a4');
    },
    [b],
  );

export const TempleStatue = ({
  beacon,
  planet,
  focus,
  rim,
  rimColor,
  reducedMotion,
  index,
}: {
  beacon: BeaconData;
  planet: Planet;
  /** The beacon's focus, 0..1, written every frame */
  focus: MutableRefObject<{ focus: number }>;
  rim: number;
  rimColor?: THREE.Color;
  reducedMotion?: boolean;
  index: number;
}) => {
  const mats = useStone(planet, rimColor, rim);
  useDispose(mats);
  const glow = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd27a'), toneMapped: false }), []);
  const plaqueMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.55 }), []);
  useEffect(
    () => () => {
      glow.dispose();
      plaqueMat.dispose();
    },
    [glow, plaqueMat],
  );
  const plaque = usePlaque(beacon);
  useMemo(() => {
    plaqueMat.map = plaque;
    plaqueMat.needsUpdate = true;
  }, [plaque, plaqueMat]);
  const emblem = emblemFor(beacon);
  const fire = useRef<FireLevel>({ v: 0.3 });
  const held = useRef<THREE.Group>(null);

  useFrame(({ clock }) => {
    const f = focus.current.focus;
    fire.current.v = 0.3 + 0.7 * f;
    glow.color.copy(FLAME_C).multiplyScalar(1 + f * 1.6);
    plaqueMat.emissive.copy(BRONZE_C).multiplyScalar(0.25 + f * 0.6);
    plaqueMat.emissiveMap = plaque;
    if (held.current && !reducedMotion) held.current.rotation.y = Math.sin(clock.elapsedTime * 0.5 + index) * 0.25;
  });

  const shoulder = 1.38;
  return (
    <group>
      {/* plinth with the plaque on its face */}
      <mesh material={mats.dark} position={[0, 0.08, 0]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[1.3, 0.16, 1.15]} />
      </mesh>
      <mesh material={mats.stone} position={[0, 0.16 + 0.42, 0]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[1.02, 0.84, 0.9]} />
      </mesh>
      <mesh material={mats.stone} position={[0, PLINTH_H - 0.08, 0]} castShadow receiveShadow raycast={noRaycast}>
        <boxGeometry args={[1.22, 0.16, 1.08]} />
      </mesh>
      <mesh material={mats.iron} position={[0, 0.6, 0.452]} raycast={noRaycast}>
        <boxGeometry args={[0.9, 0.56, 0.01]} />
      </mesh>
      <mesh material={plaqueMat} position={[0, 0.6, 0.459]} raycast={noRaycast}>
        <planeGeometry args={[0.86, 0.5]} />
      </mesh>

      {/* the figure, holding the emblem up */}
      <group position={[0, PLINTH_H, 0]} scale={STATUE_SCALE}>
        <mesh geometry={ROBE} material={mats.stone} castShadow receiveShadow raycast={noRaycast} />
        <mesh material={mats.stone} position={[0, 1.79, 0]} castShadow raycast={noRaycast}>
          <sphereGeometry args={[0.17, 10, 8]} />
        </mesh>
        {/* the hood */}
        <mesh material={mats.stone} position={[0, 1.81, -0.04]} scale={[1, 1.12, 1]} castShadow raycast={noRaycast}>
          <sphereGeometry args={[0.2, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62]} />
        </mesh>
        {[-1, 1].map((s) => (
          <group key={s}>
            <Strut a={[0.26 * s, shoulder, 0]} b={[0.36 * s, 1.86, 0.06]} r={0.075} material={mats.stone} />
            <Strut a={[0.36 * s, 1.86, 0.06]} b={[0.17 * s, 2.3, 0.08]} r={0.062} material={mats.stone} />
            <mesh material={mats.stone} position={[0.17 * s, 2.32, 0.08]} raycast={noRaycast}>
              <sphereGeometry args={[0.07, 8, 6]} />
            </mesh>
          </group>
        ))}
        <group ref={held} position={[0, 2.55, 0.08]}>
          <EmblemMesh kind={emblem} mats={mats} glow={glow} />
        </group>
      </group>

      {/* braziers either side, flaring as you walk up */}
      {[-1, 1].map((s) => (
        <group key={s} position={[0.88 * s, 0, 0.72]}>
          <Brazier mats={mats} level={fire.current} reducedMotion={reducedMotion} seed={index * 2 + (s > 0 ? 1 : 0)} />
        </group>
      ))}
    </group>
  );
};
