import { Component, Suspense, useEffect, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import OverworldScene from '@/scenes/overworld/OverworldScene';
import PlanetSurfaceScene from '@/scenes/planet/PlanetSurfaceScene';
import TransitionController from '@/scenes/transition/TransitionController';
import Effects from '@/scenes/Effects';
import UiRoot from '@/ui/UiRoot';
import { useInputBridge } from '@/hooks/useInputBridge';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useAppStore } from '@/state/useAppStore';

const hasWebGL = (() => {
  try {
    return !!document.createElement('canvas').getContext('webgl2');
  } catch {
    return false;
  }
})();

/** Any render or context failure in the 3D tree drops the site into reader-only mode. */
class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    useAppStore.getState().setNoWebGL();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

const App = () => {
  useInputBridge();
  useHashRoute();
  const noWebGL = useAppStore((s) => s.noWebGL);
  const readerOpen = useAppStore((s) => s.readerOpen);

  useEffect(() => {
    if (!hasWebGL) useAppStore.getState().setNoWebGL();
  }, []);

  return (
    <div className="fixed inset-0 bg-space">
      {hasWebGL && !noWebGL && (
        <SceneBoundary>
          <Canvas
            gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
            dpr={[1, 1.75]}
            frameloop={readerOpen ? 'never' : 'always'}
            camera={{ position: [0, 0, 0], fov: 60, near: 0.1, far: 800 }}
            aria-hidden="true"
            onCreated={({ gl }) =>
              gl.domElement.addEventListener('webglcontextlost', () => useAppStore.getState().setNoWebGL())
            }
          >
            <color attach="background" args={['#05070d']} />
            <Suspense fallback={null}>
              <OverworldScene />
              <PlanetSurfaceScene />
              <TransitionController />
              <Effects />
            </Suspense>
          </Canvas>
        </SceneBoundary>
      )}
      <UiRoot />
    </div>
  );
};

export default App;
