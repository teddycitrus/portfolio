import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { getBeaconPosition, planetById } from '@/data/content';
import { buildSky } from '@/data/skyPresets';
import type { Planet, Vec3 } from '@/types/content';
import SkyDome from './SkyDome';
import Terrain, { heightFor, walkRadiusFor } from './Terrain';
import Surroundings from './Surroundings';
import Vegetation from './Vegetation';
import Wildlife from './Wildlife';
import Mothership from './Mothership';
import Beacon, { beaconHeight } from './Beacon';
import PlanetCamera, { type SurfaceBeacon } from './PlanetCamera';
import { siteFor } from './sites/site';
import { TempleGrounds } from './sites/Temple';
import { OutpostGrounds } from './sites/Outpost';

const SHADOW_EXTENT = 34;
const SUN_DISTANCE = 70;

/**
 * The sun and its shadow frame are fixed, and only slow things move (animals, my head, the
 * floating crowns), so the shadow map is redrawn every other frame: half the cost of the extra
 * pass the whole scene is drawn in, with no visible difference.
 */
const ShadowCadence = () => {
  const gl = useThree((s) => s.gl);
  const frame = useRef(0);
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(() => {
    frame.current = (frame.current + 1) % 2;
    if (frame.current === 0) gl.shadowMap.needsUpdate = true;
  });
  return null;
};

const Surface = ({ planet }: { planet: Planet }) => {
  const scene = useThree((s) => s.scene);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const isTouch = useAppStore((s) => s.isTouch);
  const terrain = useMemo(() => heightFor(planet.style), [planet.style]);
  // built ground (a temple floor, a landing pad) over the terrain
  const site = useMemo(() => siteFor(planet, terrain), [planet, terrain]);
  const ground = site.ground;
  const walkRadius = walkRadiusFor(planet.style);
  const sun = useRef<THREE.DirectionalLight>(null);
  const sky = useMemo(() => buildSky(planet), [planet]);
  // soft fill from the spawn side so monument faces read when backlit
  const fillPos = useMemo<Vec3>(() => [-sky.lightDir.x * 30, 18, 40], [sky]);
  const fillColor = useMemo(() => sky.hemiSky.clone().lerp(sky.lightColor, 0.45), [sky]);
  // backlit skies (sun in front of the spawn view) need a stronger fill
  const fillIntensity = sky.lightIntensity * (sky.lightDir.z < -0.3 ? 0.7 : 0.45);

  const beacons = useMemo<SurfaceBeacon[]>(
    () =>
      planet.beacons.map((b, i) => {
        const [x, , z] = getBeaconPosition(planet, i);
        return { id: b.id, position: [x, ground(x, z), z] as Vec3, height: beaconHeight(planet, b), collide: site.collide(i) };
      }),
    [planet, ground, site],
  );
  const clearings = useMemo(
    () => [...beacons.map((b) => [b.position[0], b.position[2]] as [number, number]), ...site.clearings],
    [beacons, site],
  );

  // exponential fog matching the sky horizon; removed on unmount so the overworld stays clear
  useEffect(() => {
    scene.fog = new THREE.FogExp2(sky.fogColor.getHex(), sky.fogDensity);
    return () => {
      scene.fog = null;
    };
  }, [scene, sky]);

  useLayoutEffect(() => {
    const l = sun.current;
    if (!l) return;
    l.position.copy(sky.lightDir).multiplyScalar(SUN_DISTANCE);
    l.target.position.set(0, 0, 0);
    l.target.updateMatrixWorld();
    const cam = l.shadow.camera;
    cam.left = cam.bottom = -SHADOW_EXTENT;
    cam.right = cam.top = SHADOW_EXTENT;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2;
    cam.updateProjectionMatrix();
  }, [sky]);

  return (
    <>
      <ShadowCadence />
      <hemisphereLight args={[sky.hemiSky, sky.hemiGround, sky.hemiIntensity]} />
      <directionalLight
        ref={sun}
        color={sky.lightColor}
        intensity={sky.lightIntensity}
        castShadow
        shadow-mapSize={isTouch ? [1024, 1024] : [2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />

      <directionalLight position={fillPos} color={fillColor} intensity={fillIntensity} />

      <SkyDome sky={sky} reducedMotion={reducedMotion} />
      <Mothership sky={sky} reducedMotion={reducedMotion} />
      <Terrain planet={planet} sky={sky} reducedMotion={reducedMotion} />
      <Surroundings planet={planet} sky={sky} reducedMotion={reducedMotion} />
      <Vegetation planet={planet} beacons={clearings} reducedMotion={reducedMotion} />
      {planet.architecture === 'temple' && (
        <TempleGrounds planet={planet} ground={terrain} rim={sky.rim} rimColor={sky.rimColor} reducedMotion={reducedMotion} />
      )}
      {planet.architecture === 'outpost' && (
        <OutpostGrounds planet={planet} ground={terrain} rim={sky.rim} rimColor={sky.rimColor} reducedMotion={reducedMotion} />
      )}
      <Wildlife planet={planet} ground={ground} obstacles={clearings} isTouch={isTouch} reducedMotion={reducedMotion} />

      {planet.beacons.map((b, i) => (
        <Beacon
          key={b.id}
          beacon={b}
          planet={planet}
          index={i}
          position={beacons[i].position}
          rim={sky.rim}
          rimColor={sky.rimColor}
          reducedMotion={reducedMotion}
          ground={ground}
        />
      ))}

      <PlanetCamera planetId={planet.id} beacons={beacons} ground={ground} walkRadius={walkRadius} colliders={site.colliders} />
    </>
  );
};

/**
 * Planet surface. Renders in 'planet' and through 'transitioning-out' so the
 * launch is visible; PlanetCamera only drives the camera in 'planet'.
 */
const PlanetSurfaceScene = () => {
  const mode = useAppStore((s) => s.mode);
  const activeId = useAppStore((s) => s.activePlanetId);
  const planet = useMemo(() => planetById(activeId), [activeId]);

  // the shadow map is switched on by LazySurface, before this chunk loads
  const show = (mode === 'planet' || mode === 'transitioning-out') && !!planet;
  if (!show || !planet) return null;
  return <Surface key={planet.id} planet={planet} />;
};

export default PlanetSurfaceScene;
