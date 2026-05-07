import { useMemo } from 'react';
import * as THREE from 'three';
import type { SkyPreset } from '@/data/skyPresets';
import { getSunDirection } from '@/data/skyPresets';

interface Props {
  preset: SkyPreset;
}

const SkyDome = ({ preset }: Props) => {
  const material = useMemo(() => {
    const sunDir = getSunDirection(preset);
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        horizonColor: { value: new THREE.Color(preset.horizonColor) },
        midColor: { value: new THREE.Color(preset.midColor) },
        topColor: { value: new THREE.Color(preset.topColor) },
        glowColor: { value: new THREE.Color(preset.glowColor) },
        glowFalloff: { value: preset.glowFalloff },
        sunCoreColor: { value: new THREE.Color(preset.sunCoreColor) },
        sunIntensity: { value: preset.sunIntensity },
        sunDir: { value: sunDir },
      },
      vertexShader: `
        varying vec3 vWorldPos;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: `
        uniform vec3 horizonColor;
        uniform vec3 midColor;
        uniform vec3 topColor;
        uniform vec3 glowColor;
        uniform float glowFalloff;
        uniform vec3 sunCoreColor;
        uniform float sunIntensity;
        uniform vec3 sunDir;
        varying vec3 vWorldPos;

        void main() {
          vec3 d = normalize(vWorldPos);
          float h = clamp(d.y, 0.0, 1.0);

          // Three-stop gradient: horizon -> mid -> top
          vec3 base;
          if (h < 0.4) {
            base = mix(horizonColor, midColor, h / 0.4);
          } else {
            base = mix(midColor, topColor, (h - 0.4) / 0.6);
          }

          // Sun glow halo
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          base += glowColor * pow(sd, glowFalloff) * 0.85;

          // Sun disc — sharp bright core (only when sunIntensity > 0)
          float disc = smoothstep(0.9985, 0.9995, sd);
          base = mix(base, sunCoreColor, disc * sunIntensity);

          gl_FragColor = vec4(base, 1.0);
        }
      `,
    });
  }, [preset]);

  return (
    <mesh material={material} renderOrder={-10}>
      <sphereGeometry args={[200, 48, 24]} />
    </mesh>
  );
};

export default SkyDome;
