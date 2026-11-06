import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
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

const SHADOW_EXTENT = 34;
const SUN_DISTANCE = 70;

const Surface = ({ planet }: { planet: Planet }) => {
  const scene = useThree((s) => s.scene);
  const reducedMotion = useAppStore((s) => s.reducedMotion);
  const isTouch = useAppStore((s) => s.isTouch);
  const ground = useMemo(() => heightFor(planet.style), [planet.style]);
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
        return { id: b.id, position: [x, ground(x, z), z] as Vec3, height: beaconHeight(planet, b) };
      }),
    [planet, ground],
  );
  const clearings = useMemo(
    () => beacons.map((b) => [b.position[0], b.position[2]] as [number, number]),
    [beacons],
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
      <Mothership sky={sky} ground={ground} reducedMotion={reducedMotion} />
      <Terrain planet={planet} sky={sky} reducedMotion={reducedMotion} />
      <Surroundings planet={planet} sky={sky} reducedMotion={reducedMotion} />
      <Vegetation planet={planet} beacons={clearings} reducedMotion={reducedMotion} />
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
        />
      ))}

      <PlanetCamera planetId={planet.id} beacons={beacons} ground={ground} walkRadius={walkRadius} />
    </>
  );
};

/**
 * Planet surface. Renders in 'planet' and through 'transitioning-out' so the
 * launch is visible; PlanetCamera only drives the camera in 'planet'.
 */
const PlanetSurfaceScene = () => {
  const gl = useThree((s) => s.gl);
  const mode = useAppStore((s) => s.mode);
  const activeId = useAppStore((s) => s.activePlanetId);
  const planet = useMemo(() => planetById(activeId), [activeId]);

  // enable soft shadows once, before any surface material compiles
  useLayoutEffect(() => {
    if (!gl.shadowMap.enabled || gl.shadowMap.type !== THREE.PCFSoftShadowMap) {
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl]);

  const show = (mode === 'planet' || mode === 'transitioning-out') && !!planet;
  if (!show || !planet) return null;
  return <Surface key={planet.id} planet={planet} />;
};

export default PlanetSurfaceScene;
