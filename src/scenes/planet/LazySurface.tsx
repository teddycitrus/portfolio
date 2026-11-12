import { useEffect, useLayoutEffect, useReducer } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAppStore } from '@/state/useAppStore';
import { onSurfaceLoaded, scheduleSurfaceLoad, surfaceScene } from './loadSurface';

/** Renders the planet surface scene once its chunk is in; nothing before (it would show nothing yet anyway). */
const LazySurface = () => {
  const gl = useThree((s) => s.gl);
  const [, loaded] = useReducer((n: number) => n + 1, 0);
  // no shadows on the low tier (see gpuTier): the extra pass draws the whole surface again
  const shadows = useAppStore((s) => s.quality === 'high');

  // set before any material compiles: switching later recompiles them all (only a step down
  // to the low tier does, under the loader)
  useLayoutEffect(() => {
    if (gl.shadowMap.enabled !== shadows || gl.shadowMap.type !== THREE.PCFSoftShadowMap) {
      gl.shadowMap.enabled = shadows;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl, shadows]);

  useEffect(() => {
    if (surfaceScene()) return;
    const off = onSurfaceLoaded(loaded);
    scheduleSurfaceLoad();
    return () => {
      off();
    };
  }, []);

  const Scene = surfaceScene();
  return Scene ? <Scene /> : null;
};

export default LazySurface;
