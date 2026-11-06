import * as THREE from 'three';
import { FRAME_DEPTH } from './shape';

/**
 * Canopy glass: almost invisible. Two soft reflection bands, a haze where the
 * glass meets the frame and a few specks of dust. On atmospheric entry
 * (uHeat) plasma streams outward from the centre and burns along the rim.
 */
export const glassMaterial = () =>
  new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
    uniforms: {
      uTime: { value: 0 },
      uHeat: { value: 0 },
      uHeatColor: { value: new THREE.Color('#ffb070') },
    },
    vertexShader: /* glsl */ `
      varying vec2 vN;
      void main() {
        vN = position.xy / ${FRAME_DEPTH.toFixed(3)};
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uHeat;
      uniform vec3 uHeatColor;
      varying vec2 vN;

      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        vec2 n = vN;
        // reflections of the cabin: two soft diagonal bands
        float d = dot(n, normalize(vec2(1.0, 0.62)));
        float refl = exp(-pow((d - 0.42) / 0.11, 2.0)) * 0.006 + exp(-pow((d - 0.62) / 0.035, 2.0)) * 0.005;
        refl *= smoothstep(-0.2, 0.6, n.y + 0.3);
        // haze toward the frame
        float edge = max(abs(n.x) / 0.9, (n.y > 0.0 ? n.y / 0.8 : -n.y / 0.7));
        float haze = smoothstep(0.85, 1.0, edge) * 0.006;
        // dust
        float dust = step(0.9975, hash(floor(n * 260.0))) * 0.02 * noise(n * 6.0);
        vec3 col = vec3(0.75, 0.85, 1.0) * (refl + haze + dust);

        // entry plasma: streaks rushing outward, brightest at the rim
        if (uHeat > 0.001) {
          float r = length(n * vec2(1.0, 1.15));
          float a = atan(n.y, n.x);
          float streak = noise(vec2(a * 9.0, r * 2.5 - uTime * 7.0)) * 0.65 + noise(vec2(a * 23.0, r * 5.0 - uTime * 11.0)) * 0.35;
          float rim = smoothstep(0.35 - uHeat * 0.3, 1.1, r);
          float flame = uHeat * rim * (0.35 + streak * 1.1);
          vec3 hot = mix(vec3(1.0, 0.92, 0.8), uHeatColor, smoothstep(0.4, 1.1, r));
          col += hot * flame * 1.6 + uHeatColor * uHeat * 0.12;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/** Dash displays: 0 is a telemetry trace, 1 is a radar sweep with a readout. */
export const instrumentMaterial = (kind: 0 | 1) =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    // the site opens in orbit, where the displays are key faces
    uniforms: { uTime: { value: 0 }, uKind: { value: kind }, uFace: { value: 1 }, uHover: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uKind;
      // 1 = a plain console key face for a control label (no graphics under the text)
      uniform float uFace;
      uniform float uHover;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        vec3 ink = vec3(0.42, 0.8, 1.0);
        vec2 gp = fract(uv * vec2(14.0, 7.0));
        float grid = (step(gp.x, 0.05) + step(gp.y, 0.08)) * 0.07;
        float g = 0.0;
        if (uKind < 0.5) {
          float y1 = 0.56 + 0.2 * sin(uv.x * 13.0 + uTime * 2.1) * sin(uv.x * 3.3 - uTime * 0.6);
          float y2 = 0.36 + 0.08 * sin(uv.x * 29.0 - uTime * 3.6);
          g += smoothstep(0.035, 0.0, abs(uv.y - y1)) + 0.5 * smoothstep(0.025, 0.0, abs(uv.y - y2));
          float bx = floor(uv.x * 12.0);
          float bh = 0.08 + 0.09 * (0.5 + 0.5 * sin(bx * 1.7 + uTime * 2.4));
          g += step(uv.y, bh) * step(0.3, fract(uv.x * 12.0)) * 0.45;
        } else {
          vec2 q = (uv - vec2(0.27, 0.5)) * vec2(2.0, 1.0) / 0.42;
          float r = length(q);
          float rings = smoothstep(0.03, 0.0, abs(r - 1.0)) + 0.5 * smoothstep(0.025, 0.0, abs(r - 0.6)) + 0.4 * smoothstep(0.04, 0.0, abs(q.x) * step(r, 1.0)) * 0.6;
          float a = atan(q.y, q.x);
          float s = fract((a - uTime * 1.5) / 6.2832);
          float sweep = exp(-s * 7.0) * step(r, 1.0) * 0.9;
          float blip = 0.0;
          for (int i = 0; i < 4; i++) {
            float fi = float(i);
            vec2 bp = vec2(cos(fi * 2.1 + 0.6), sin(fi * 2.1 + 0.6)) * (0.35 + fract(fi * 0.37) * 0.55);
            float age = fract((atan(bp.y, bp.x) - uTime * 1.5) / 6.2832);
            blip += smoothstep(0.09, 0.0, length(q - bp)) * exp(-age * 3.0);
          }
          g += rings * 0.7 + sweep * 0.55 + blip * 1.4;
          // readout bars on the right
          if (uv.x > 0.56) {
            float row = floor(uv.y * 7.0);
            float w = 0.6 + 0.08 + 0.3 * (0.5 + 0.5 * sin(row * 2.3 + uTime * (0.8 + row * 0.2)));
            g += step(uv.x, w) * step(0.35, fract(uv.y * 7.0)) * step(fract(uv.y * 7.0), 0.75) * 0.45;
          }
        }
        float scan = 0.85 + 0.15 * sin(uv.y * 160.0);
        vec2 e = min(uv, 1.0 - uv);
        float vig = smoothstep(0.0, 0.06, min(e.x, e.y * 2.0));
        vec3 col = vec3(0.01, 0.024, 0.04) + ink * (grid + g) * scan * 0.85;

        // key face: dark glass, an inset hairline frame, a status light in the corner, a glow on hover
        vec2 q = uv - 0.5;
        vec2 fe = abs(q) - vec2(0.44, 0.38);
        float box = max(fe.x, fe.y * 0.5);
        float line = smoothstep(0.006, 0.0, abs(box));
        float led = smoothstep(0.022, 0.0, length((uv - vec2(0.105, 0.78)) * vec2(2.0, 1.0)));
        float ledOn = 0.55 + 0.45 * sin(uTime * 1.6);
        float glow = exp(-dot(q * vec2(1.6, 3.0), q * vec2(1.6, 3.0)) * 4.0);
        vec3 faceCol = mix(vec3(0.012, 0.022, 0.04), vec3(0.03, 0.05, 0.08), uv.y)
          + ink * line * (0.22 + 0.45 * uHover)
          + ink * glow * (0.03 + 0.1 * uHover)
          + vec3(0.45, 1.0, 0.7) * led * ledOn * 0.9
          + ink * (0.5 + 0.5 * sin(uv.y * 160.0)) * 0.006;
        col = mix(col, faceCol, uFace);
        gl_FragColor = vec4(col * vig, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
