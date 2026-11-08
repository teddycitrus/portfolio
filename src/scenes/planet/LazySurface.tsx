import { useEffect, useLayoutEffect, useReducer } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { onSurfaceLoaded, scheduleSurfaceLoad, surfaceScene } from './loadSurface';

/** Renders the planet surface scene once its chunk is in; nothing before (it would show nothing yet anyway). */
const LazySurface = () => {
  const gl = useThree((s) => s.gl);
  const [, loaded] = useReducer((n: number) => n + 1, 0);

  // enable soft shadows once, before any material compiles: switching later would recompile them all
  useLayoutEffect(() => {
    if (!gl.shadowMap.enabled || gl.shadowMap.type !== THREE.PCFSoftShadowMap) {
      gl.shadowMap.enabled = true;
      gl.shadowMap.type = THREE.PCFSoftShadowMap;
      gl.shadowMap.needsUpdate = true;
    }
  }, [gl]);

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
