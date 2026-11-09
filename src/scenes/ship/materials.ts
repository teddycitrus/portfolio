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
        // squared by hand: pow() of a negative base is NaN on Metal (Safari, every Mac browser)
        float r1 = (d - 0.42) / 0.11;
        float r2 = (d - 0.62) / 0.035;
        float refl = exp(-r1 * r1) * 0.006 + exp(-r2 * r2) * 0.005;
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
          float a = atan(n.y, n.x + 1e-6);
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

/**
 * Lining of the window cut: frames, seams and bolts drawn procedurally along
 * the strip, with a rubber seal at the glass and a cold rim from the sky.
 * uv is (arc length in frame units, 0 at the ring .. 1 at the glass).
 */
export const linerMaterial = (uTime: { value: number }) =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vP;
      void main() {
        vUv = uv;
        vP = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying vec2 vP;

      float hash(float p) { return fract(sin(p * 91.7) * 43758.5453); }
      float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash2(i), hash2(i + vec2(1.0, 0.0)), u.x), mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x), u.y);
      }

      void main() {
        float v = vUv.y;
        // ribs at a fixed pitch; every panel between them is a little different
        float pitch = 0.086;
        float c = vUv.x / pitch;
        float id = floor(c);
        float f = fract(c);
        float tone = 0.8 + 0.4 * hash(id);
        vec3 col = vec3(0.046, 0.052, 0.064) * tone;

        // long seams across the strip, offset panel to panel
        float s1 = 0.36 + 0.05 * hash(id + 3.0);
        float seam = smoothstep(0.012, 0.0, abs(v - s1));
        col *= 1.0 - 0.6 * seam;
        col += vec3(0.05, 0.056, 0.07) * smoothstep(0.012, 0.0, abs(v - s1 - 0.018)) * 0.5;

        // ribs: a dark gap, a raised lit edge and a shadow
        float rib = smoothstep(0.035, 0.0, min(f, 1.0 - f));
        col = mix(col, vec3(0.012, 0.014, 0.018), rib);
        float lip = smoothstep(0.03, 0.0, abs(f - 0.05));
        col += vec3(0.07, 0.078, 0.095) * lip * 0.55;

        // bolts down each rib: little domes lit from the cabin side
        for (int i = 0; i < 3; i++) {
          float bv = 0.14 + float(i) * 0.26;
          vec2 d = vec2((min(f, 1.0 - f) - 0.1) * pitch, (v - bv) * 0.074);
          float r = length(d);
          float bolt = smoothstep(0.0022, 0.0016, r);
          col = mix(col, vec3(0.1, 0.106, 0.118) * (0.75 + 0.5 * (d.y / 0.0022)), bolt);
          col *= 1.0 - 0.4 * smoothstep(0.0034, 0.0022, r) * (1.0 - bolt);
        }

        // grime pooled at the low side of the panels, scuffs and streaks
        float grime = noise(vec2(vUv.x * 90.0, v * 6.0)) * noise(vec2(vUv.x * 13.0 + 4.0, v * 2.0));
        col *= 0.72 + 0.6 * grime;
        float scratch = smoothstep(0.86, 0.96, noise(vec2(vUv.x * 240.0, v * 3.0)));
        col += vec3(0.05, 0.055, 0.06) * scratch * 0.35 * (1.0 - rib);

        // an occasional service lamp on a slow, independent beat
        float every = 11.0;
        float lid = floor(c / every);
        float lf = (c / every - lid) * every;
        vec2 ld = vec2((lf - 5.5) * pitch, (v - 0.68) * 0.074);
        float lamp = smoothstep(0.0024, 0.0008, length(ld));
        float period = 14.0 + 26.0 * hash(lid + 9.0);
        float phase = fract(uTime / period + hash(lid + 2.0));
        float on = smoothstep(0.0, 0.06, phase) * smoothstep(0.7, 0.58, phase);
        vec3 lampC = hash(lid + 5.0) > 0.72 ? vec3(1.0, 0.68, 0.36) : vec3(0.42, 0.8, 1.0);
        col = mix(col, lampC * (0.06 + 0.42 * on), lamp);

        // the seal at the glass, then the sky's cold rim on it
        float seal = smoothstep(0.82, 0.86, v);
        col = mix(col, vec3(0.012, 0.014, 0.018), seal);
        col += vec3(0.16, 0.22, 0.36) * smoothstep(0.93, 1.0, v) * 0.34;
        // the near end sits in the shadow of the frame ring
        col *= 0.55 + 0.45 * smoothstep(0.0, 0.4, v);
        // the lower sill catches more of the cabin light than the head
        col *= 1.0 + 0.5 * smoothstep(0.1, -0.4, vP.y);
        // kept well below anything in the window
        col *= 0.5;

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/**
 * Lamps, dial marks and needles from the detail kit, all in one geometry.
 * aMode: 0 lamp, 1 needle, 2 scope, 3 fixed mark. See Lamps in ShipDetails.
 */
export const lightsMaterial = (uTime: { value: number }, uFit: { value: THREE.Vector2 }) =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    uniforms: { uTime, uFit },
    vertexShader: /* glsl */ `
      attribute vec3 aAnchor;
      attribute vec3 aColor;
      attribute vec3 aRhythm;
      attribute float aMode;
      uniform float uTime;
      uniform vec2 uFit;
      varying vec3 vCol;
      varying vec2 vUv;
      varying float vMode;
      varying float vPhase;
      varying float vLevel;
      void main() {
        vec3 q = position - aAnchor;
        if (aMode > 0.5 && aMode < 1.5) {
          float a = aRhythm.x * (sin(uTime * 0.083 + aRhythm.y * 6.3) * 0.7 + sin(uTime * 0.21 + aRhythm.y * 17.0) * 0.3);
          float c = cos(a);
          float s = sin(a);
          q.xy = vec2(q.x * c - q.y * s, q.x * s + q.y * c);
        }
        vec3 p = aAnchor + q * vec3(uFit, 1.0);
        vCol = aColor;
        vUv = uv;
        vMode = aMode;
        vPhase = aRhythm.y;
        float level = 1.0;
        if (aMode < 0.5) {
          float s = fract(uTime / aRhythm.x + aRhythm.y);
          level = 0.12 + 0.88 * smoothstep(0.0, 0.05, s) * smoothstep(aRhythm.z, max(aRhythm.z - 0.05, 0.0), s);
        } else if (aMode > 2.5) {
          level = aRhythm.x;
        }
        vLevel = level;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vCol;
      varying vec2 vUv;
      varying float vMode;
      varying float vPhase;
      varying float vLevel;
      void main() {
        vec3 col = vCol;
        float a = 1.0;
        if (vMode < 0.5) {
          vec2 d = vUv * 2.0 - 1.0;
          float r = dot(d, d);
          a = smoothstep(1.0, 0.25, r);
          col *= vLevel * 0.62;
        } else if (vMode > 1.5 && vMode < 2.5) {
          vec2 d = vUv * 2.0 - 1.0;
          float r = length(d);
          float ang = d.x * d.x + d.y * d.y < 1e-6 ? 0.0 : atan(d.y, d.x);
          float s = fract((ang - uTime * 0.31 - vPhase) / 6.2832);
          float trail = exp(-s * 5.0);
          float rings = smoothstep(0.05, 0.0, abs(r - 0.66)) * 0.3 + smoothstep(0.05, 0.0, abs(r - 0.33)) * 0.3;
          a = smoothstep(1.0, 0.94, r);
          col = vec3(0.008, 0.018, 0.026) + vCol * (rings * 0.22 + trail * 0.34);
        } else {
          col *= vLevel * (vMode > 2.5 ? 1.0 : 0.72);
        }
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/**
 * Dust hanging in the cabin air, drifting with the ventilation. It stays out
 * of the middle of the window and shows only faintly around the frame.
 */
export const dustMaterial = (uTime: { value: number }) =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime },
    vertexShader: /* glsl */ `
      attribute float aSeed;
      uniform float uTime;
      varying float vA;
      void main() {
        float t = uTime * (0.6 + aSeed * 0.6);
        vec3 w = fract(position + vec3(t * 0.0041, t * 0.0027, t * 0.0019));
        w.x += sin(t * 0.17 + aSeed * 40.0) * 0.012;
        w.y += sin(t * 0.13 + aSeed * 70.0) * 0.014;
        vec3 p = vec3((w.x - 0.5) * 1.15, (w.y - 0.5) * 1.1, -0.2 - w.z * 0.38);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vec2 ndc = abs(p.xy / -p.z);
        // kept clear of the content: only near the frame edge and the dash
        float edge = smoothstep(0.62, 0.98, max(ndc.x, ndc.y));
        // no popping where the drift wraps round
        vec3 b = min(w, 1.0 - w);
        float wrap = smoothstep(0.0, 0.08, min(b.x, min(b.y, b.z)));
        float twinkle = 0.7 + 0.3 * sin(t * 0.7 + aSeed * 90.0);
        vA = edge * wrap * twinkle * (0.25 + 0.75 * aSeed);
        gl_PointSize = clamp((1.3 + aSeed * 1.5) * (0.42 / max(-mv.z, 0.05)), 1.0, 3.2);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vA;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.25, 0.0, dot(d, d));
        vec3 col = vec3(0.72, 0.8, 0.95) * a * vA * 0.22;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

/** Dash displays: 0 is a telemetry trace, 1 is a radar sweep with a readout. */
/**
 * A dash display. `keys` splits the key face into that many cells side by side
 * (the console in orbit); `stretch` is how much wider than 2:1 the face is, so
 * the flight graphics keep their proportions.
 */
export const instrumentMaterial = (kind: 0 | 1, keys = 1, stretch = 1) =>
  new THREE.ShaderMaterial({
    fog: false,
    transparent: true,
    // the site opens in orbit, where the displays are key faces
    uniforms: {
      uTime: { value: 0 },
      uKind: { value: kind },
      // 0 = the instrument, 1 = the key faces; in between, the faces sweep in from the left
      uFace: { value: 0 },
      uHover: { value: 0 },
      uKeys: { value: keys },
      uHot: { value: -1 },
      uStretch: { value: stretch },
      // the logos painted on the key cells (alpha), and whether they are there yet
      uLogos: { value: null as THREE.Texture | null },
      uLogoOn: { value: 0 },
    },
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
      uniform float uKeys;
      // the key cell under the pointer, or -1
      uniform float uHot;
      uniform float uStretch;
      uniform sampler2D uLogos;
      uniform float uLogoOn;
      varying vec2 vUv;
      void main() {
        vec2 uv = vUv;
        vec2 su = vec2(uv.x * uStretch, uv.y);
        vec3 ink = vec3(0.42, 0.8, 1.0);
        vec2 gp = fract(su * vec2(14.0, 7.0));
        float grid = (step(gp.x, 0.05) + step(gp.y, 0.08)) * 0.07;
        float g = 0.0;
        if (uKind < 0.5) {
          float y1 = 0.56 + 0.2 * sin(su.x * 13.0 + uTime * 2.1) * sin(su.x * 3.3 - uTime * 0.6);
          float y2 = 0.36 + 0.08 * sin(su.x * 29.0 - uTime * 3.6);
          g += smoothstep(0.035, 0.0, abs(uv.y - y1)) + 0.5 * smoothstep(0.025, 0.0, abs(uv.y - y2));
          float bx = floor(su.x * 12.0);
          float bh = 0.08 + 0.09 * (0.5 + 0.5 * sin(bx * 1.7 + uTime * 2.4));
          g += step(uv.y, bh) * step(0.3, fract(su.x * 12.0)) * 0.45;
        } else {
          vec2 q = (uv - vec2(0.27, 0.5)) * vec2(2.0, 1.0) / 0.42;
          float r = length(q);
          float rings = smoothstep(0.03, 0.0, abs(r - 1.0)) + 0.5 * smoothstep(0.025, 0.0, abs(r - 0.6)) + 0.4 * smoothstep(0.04, 0.0, abs(q.x) * step(r, 1.0)) * 0.6;
          float a = atan(q.y, q.x + 1e-6);
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

        // key faces: dark glass, one cell per key with an inset hairline frame, a status light in
        // its corner, and a glow on the hovered one
        float cell = floor(uv.x * uKeys);
        vec2 cu = vec2(fract(uv.x * uKeys), uv.y);
        float hot = max(uHover, 1.0 - step(0.5, abs(cell - uHot)));
        vec2 q = cu - 0.5;
        vec2 fe = abs(q) - vec2(0.44, 0.38);
        float box = max(fe.x, fe.y * 0.5);
        float line = smoothstep(0.006, 0.0, abs(box));
        float led = smoothstep(0.022, 0.0, length((cu - vec2(0.105, 0.78)) * vec2(2.0, 1.0)));
        float ledOn = 0.55 + 0.45 * sin(uTime * 1.6 + cell * 1.9);
        float glow = exp(-dot(q * vec2(1.6, 3.0), q * vec2(1.6, 3.0)) * 4.0);
        vec3 faceCol = mix(vec3(0.012, 0.022, 0.04), vec3(0.03, 0.05, 0.08), uv.y)
          + ink * line * (0.22 + 0.45 * hot)
          + ink * glow * (0.03 + 0.14 * hot)
          + vec3(0.45, 1.0, 0.7) * led * ledOn * 0.9
          + ink * (0.5 + 0.5 * sin(uv.y * 160.0)) * 0.006;
        // the sweep: a bright edge crosses the console, key faces behind it, the logos a beat later
        float edgeX = uFace * 1.3 - 0.15;
        float rev = smoothstep(edgeX + 0.06, edgeX - 0.06, uv.x);
        float revLogo = smoothstep(edgeX - 0.04, edgeX - 0.2, uv.x);
        float ex = (uv.x - edgeX) * 30.0;
        float edge = exp(-ex * ex) * step(0.001, uFace) * step(uFace, 0.999);
        col = mix(col, faceCol, rev) + ink * edge * 0.9;
        col += vec3(0.62, 0.86, 1.0) * (uLogoOn > 0.5 ? texture2D(uLogos, uv).a : 0.0) * (0.75 + 0.55 * hot) * revLogo;
        gl_FragColor = vec4(col * vig, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
