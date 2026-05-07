import { Suspense } from 'react';
import Starfield from './Starfield';
import PlanetNode from './PlanetNode';
import TelescopeCamera from './TelescopeCamera';
import SpaceBackdrop from './SpaceBackdrop';
import { planets } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';

const OverworldScene = () => {
  const mode = useAppStore((s) => s.mode);
  const hide = mode === 'planet' || mode === 'transitioning-out';

  return (
    <Suspense fallback={null}>
      <ambientLight intensity={0.35} />
      <directionalLight position={[10, 12, 8]} intensity={0.9} color="#cfe9ff" />
      <directionalLight position={[-12, -6, -10]} intensity={0.4} color="#ffb37a" />
      <SpaceBackdrop />
      <Starfield />
      {!hide && planets.map((p) => <PlanetNode key={p.id} planet={p} />)}
      <TelescopeCamera />
    </Suspense>
  );
};

export default OverworldScene;
