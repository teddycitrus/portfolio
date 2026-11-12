import { Component, Suspense, useEffect, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import OverworldScene from '@/scenes/overworld/OverworldScene';
import PlanetSurfaceScene from '@/scenes/planet/LazySurface';
import TransitionController from '@/scenes/transition/TransitionController';
import Cockpit from '@/scenes/ship/Cockpit';
import Effects from '@/scenes/Effects';
import Preload from '@/scenes/Preload';
import UiRoot from '@/ui/UiRoot';
import { useInputBridge } from '@/hooks/useInputBridge';
import { useHashRoute } from '@/hooks/useHashRoute';
import { useAppStore } from '@/state/useAppStore';
import { hideBoot } from '@/ui/boot';
import { startQuality } from '@/scenes/gpuTier';

/** No WebGL, or WebGL drawn on the CPU: no 3D at all (see gpuTier) */
const hasWebGL = startQuality !== 'none';

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
  const low = useAppStore((s) => s.quality === 'low');

  useEffect(() => {
    if (!hasWebGL) useAppStore.getState().setNoWebGL();
  }, []);

  // no scene frames to wait for: the reader or the no-WebGL page shows straight away
  useEffect(() => {
    if (!hasWebGL || noWebGL || readerOpen) hideBoot();
  }, [noWebGL, readerOpen]);

  return (
    <div className="fixed inset-0 bg-space">
      {hasWebGL && !noWebGL && (
        <SceneBoundary>
          <Canvas
            gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
            dpr={low ? 1 : [1, 1.75]}
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
              <Cockpit />
              <Effects />
              {/* mounts once the scene is in; lets the loader go when everything is ready */}
              <Preload />
            </Suspense>
          </Canvas>
        </SceneBoundary>
      )}
      {/* in-world beacon screens (drei Html) render here: above the canvas, below the HUD */}
      <div id="screen-layer" className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" />
      <UiRoot />
    </div>
  );
};

export default App;
