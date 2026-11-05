import { useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import Starfield from './Starfield';
import PlanetNode from './PlanetNode';
import TelescopeCamera from './TelescopeCamera';
import SpaceBackdrop from './SpaceBackdrop';
import Sun, { SUN_DIRECTION } from './Sun';
import Constellations from './Constellations';
import { planets, getOrbitalPosition } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { planetScreen } from '@/state/runtime';
import type { Vec3 } from '@/types/content';

const EDGE_MARGIN = 28;
const _orb: Vec3 = [0, 0, 0];
const _v = new THREE.Vector3();
const _view = new THREE.Vector3();
const SUN_LIGHT_POS = SUN_DIRECTION.clone().multiplyScalar(100);

for (const p of planets) planetScreen[p.id] ??= { x: 0, y: 0, visible: false, angle: 0, size: 0 };

/** Projects every planet to pixels each frame for the DOM marker layer. */
const ScreenProjector = () => {
  useFrame(({ camera, clock, size }) => {
    const cam = camera as THREE.PerspectiveCamera;
    cam.updateMatrixWorld();
    const w = size.width;
    const h = size.height;
    const cx = w / 2;
    const cy = h / 2;
    const focal = cy / Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2);

    for (const p of planets) {
      const info = planetScreen[p.id];
      getOrbitalPosition(p, clock.elapsedTime, _orb);
      _v.set(_orb[0], _orb[1], _orb[2]);
      _view.copy(_v).applyMatrix4(cam.matrixWorldInverse);
      const behind = _view.z > -0.01;
      const dist = _view.length();
      _v.project(cam);

      let dx = _v.x * cx;
      let dy = -_v.y * cy;
      if (behind) {
        // Mirror and push far out so the clamp lands on the correct edge
        dx = -dx * 1e3 || 1;
        dy = -dy * 1e3;
      }
      const onScreen = !behind && Math.abs(_v.x) <= 1 && Math.abs(_v.y) <= 1;
      info.visible = onScreen;
      info.angle = Math.atan2(dy, dx);
      info.size = (p.radius / Math.max(dist, 1e-3)) * focal;

      if (onScreen) {
        info.x = cx + dx;
        info.y = cy + dy;
      } else {
        const hx = Math.max(cx - EDGE_MARGIN, 1);
        const hy = Math.max(cy - EDGE_MARGIN, 1);
        const s = Math.min(hx / Math.max(Math.abs(dx), 1e-6), hy / Math.max(Math.abs(dy), 1e-6));
        info.x = cx + dx * s;
        info.y = cy + dy * s;
      }
    }
  });
  return null;
};

const OverworldScene = () => {
  const mode = useAppStore((s) => s.mode);
  const show = mode === 'overworld' || mode === 'transitioning-in';

  useEffect(() => {
    if (mode !== 'overworld') document.body.style.cursor = '';
  }, [mode]);

  useEffect(() => {
    if (!show) for (const p of planets) planetScreen[p.id].visible = false;
  }, [show]);

  if (!show) return null;

  return (
    <>
      <ambientLight intensity={0.02} />
      <directionalLight position={SUN_LIGHT_POS} intensity={2.2} color="#fff3e2" />
      <SpaceBackdrop />
      <Starfield />
      <Sun />
      {planets.map((p) => (
        <PlanetNode key={p.id} planet={p} />
      ))}
      <Constellations />
      <TelescopeCamera />
      <ScreenProjector />
    </>
  );
};

export default OverworldScene;
