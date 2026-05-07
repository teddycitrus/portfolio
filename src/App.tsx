import { Suspense, lazy, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import OverworldScene from '@/scenes/overworld/OverworldScene';
import Crosshair from '@/ui/Crosshair';
import PlanetHud from '@/ui/PlanetHud';
import GlobalInput from '@/ui/GlobalInput';
import MovementJoystick from '@/ui/MovementJoystick';
import TransitionFade from '@/ui/TransitionFade';

const PlanetSurfaceScene = lazy(() => import('@/scenes/planet/PlanetSurfaceScene'));
const TransitionScene = lazy(() => import('@/scenes/transition/TransitionScene'));

const prefetchScenes = () => {
  void import('@/scenes/planet/PlanetSurfaceScene');
  void import('@/scenes/transition/TransitionScene');
};

const App = () => {
  useEffect(() => {
    prefetchScenes();
  }, []);

  return (
    <div className="fixed inset-0 bg-cosmos-deep">
      <Canvas
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
        dpr={[1, 2]}
        camera={{ position: [0, 0, 0], fov: 75, near: 0.1, far: 600 }}
      >
        <color attach="background" args={['#04060f']} />
        <OverworldScene />
        <Suspense fallback={null}>
          <PlanetSurfaceScene />
          <TransitionScene />
        </Suspense>
      </Canvas>

      <Crosshair />
      <PlanetHud />
      <MovementJoystick />
      <TransitionFade />
      <GlobalInput />
    </div>
  );
};

export default App;
