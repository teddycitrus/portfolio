import { Suspense, useMemo } from 'react';
import { useAppStore } from '@/state/useAppStore';
import { planetById } from '@/data/content';
import { skyPresets, getSunDirection } from '@/data/skyPresets';
import SkyDome from './SkyDome';
import Terrain from './Terrain';
import Vegetation from './Vegetation';
import Beacon from './Beacon';
import PlanetCamera from './PlanetCamera';
import Starfield from '../overworld/Starfield';

const PlanetSurfaceScene = () => {
  const activeId = useAppStore((s) => s.activePlanetId);
  const mode = useAppStore((s) => s.mode);
  const planet = useMemo(() => (activeId ? planetById(activeId) : undefined), [activeId]);

  const exclusionPoints = useMemo<Array<[number, number]>>(() => {
    if (!planet) return [];
    return planet.beacons.map((b) => [b.position[0], b.position[2]] as [number, number]);
  }, [planet]);

  const preset = useMemo(() => (planet ? skyPresets[planet.time] : skyPresets.night), [planet]);
  const sunDir = useMemo(() => getSunDirection(preset).multiplyScalar(40), [preset]);

  if (!planet || mode === 'overworld') return null;

  return (
    <Suspense fallback={null}>
      <ambientLight intensity={preset.ambientIntensity} color={preset.ambientColor} />
      <directionalLight
        position={[sunDir.x, Math.max(sunDir.y, 4), sunDir.z]}
        intensity={preset.sunLightIntensity}
        color={preset.sunLightColor}
        castShadow
      />
      {/* Planet-tinted fill light from below to keep ground readable */}
      <directionalLight
        position={[-sunDir.x * 0.5, 2, -sunDir.z * 0.5]}
        intensity={0.25}
        color={planet.color}
      />
      <fog attach="fog" args={[preset.fogColor, preset.fogNear, preset.fogFar]} />

      <SkyDome preset={preset} />
      {preset.starOpacity > 0 && (
        <Starfield count={1500} radius={170} opacity={preset.starOpacity} />
      )}

      <Terrain ground={planet.surface.ground} atmosphere={planet.surface.atmosphere} />
      <Vegetation
        ground={planet.surface.ground}
        accent={planet.accent}
        exclusionPoints={exclusionPoints}
      />

      {planet.beacons.map((b) => (
        <Beacon key={b.id} beacon={b} accent={planet.accent} />
      ))}

      <PlanetCamera />
    </Suspense>
  );
};

export default PlanetSurfaceScene;
