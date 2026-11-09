import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { getOrbitalPosition, planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { flight } from '@/state/runtime';
import type { Vec3 } from '@/types/content';
import { BEAM_FRAG, BEAM_VERT } from '@/scenes/beamShader';

/** Beam radius where it leaves the aperture, and at the planet as a share of its radius */
const MOUTH = 0.05;
const SPREAD = 0.42;
/** The beam stops this share of the radius short of the planet's centre, inside its air */
const STOP = 0.85;

const _orb: Vec3 = [0, 0, 0];
const _from = new THREE.Vector3();
const _to = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _yUp = new THREE.Vector3(0, 1, 0);
const noRaycast = () => null;

/**
 * The tractor beam the deck fires at a chosen planet: it reaches out from the
 * bottom of the aperture to the planet, and the viewer is pulled along inside
 * it (the transition controller drives flight.launch*).
 */
const LaunchBeam = () => {
  const lockedId = useAppStore((s) => s.lockedPlanetId);
  const planet = planetById(lockedId);
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        side: THREE.DoubleSide,
        uniforms: { uA: { value: 0 }, uLen: { value: 1 }, uTime: { value: 0 } },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
      }),
    [],
  );
  // narrow at the aperture (-y), wide at the planet (+y)
  const geo = useMemo(() => {
    const r = (planet?.radius ?? 1) * SPREAD;
    const g = new THREE.CylinderGeometry(r, MOUTH, 1, 48, 1, true);
    return g;
  }, [planet]);
  useEffect(() => () => mat.dispose(), [mat]);
  useEffect(() => () => geo.dispose(), [geo]);

  useFrame(({ clock }) => {
    const m = mesh.current;
    if (!m) return;
    const a = flight.launchBeam;
    m.visible = !!planet && a > 0.001 && flight.launchReach > 0.001;
    if (!m.visible || !planet) return;
    getOrbitalPosition(planet, clock.elapsedTime, _orb);
    _from.set(flight.launchFrom.x, flight.launchFrom.y, flight.launchFrom.z);
    _to.set(_orb[0], _orb[1], _orb[2]);
    _axis.subVectors(_to, _from);
    const full = Math.max(0.01, _axis.length() - planet.radius * STOP);
    _axis.normalize();
    const len = full * flight.launchReach;
    m.position.copy(_from).addScaledVector(_axis, len / 2);
    m.quaternion.setFromUnitVectors(_yUp, _axis);
    // the cone keeps its taper as it reaches out: radius grows with the share of the way covered
    const w = Math.max(flight.launchReach, MOUTH / Math.max(planet.radius * SPREAD, 1e-3));
    m.scale.set(w, len, w);
    mat.uniforms.uA.value = a;
    mat.uniforms.uLen.value = len;
    mat.uniforms.uTime.value = clock.elapsedTime;
  });

  return <mesh ref={mesh} geometry={geo} material={mat} visible={false} raycast={noRaycast} frustumCulled={false} renderOrder={6} />;
};

export default LaunchBeam;
