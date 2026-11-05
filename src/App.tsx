import { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import OverworldScene from '@/scenes/overworld/OverworldScene';
import PlanetSurfaceScene from '@/scenes/planet/PlanetSurfaceScene';
import TransitionController from '@/scenes/transition/TransitionController';
import Effects from '@/scenes/Effects';
import UiRoot from '@/ui/UiRoot';
import { useInputBridge } from '@/hooks/useInputBridge';

const App = () => {
  useInputBridge();

  return (
    <div className="fixed inset-0 bg-space">
      <Canvas
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 800 }}
        aria-hidden="true"
      >
        <color attach="background" args={['#05070d']} />
        <Suspense fallback={null}>
          <OverworldScene />
          <PlanetSurfaceScene />
          <TransitionController />
          <Effects />
        </Suspense>
      </Canvas>
      <UiRoot />
    </div>
  );
};

export default App;
