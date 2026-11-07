import * as THREE from 'three';

/*
 * The drop pod's doors: two halves meeting at a seam down the middle, with a
 * round porthole split between them. They live in "pod units": the group is
 * scaled uniformly by the resting lens, so at the door plane a y of 0.5 is the
 * top of the screen and the porthole stays round at any aspect.
 */

/** Plane of the doors' inner face, just behind the jamb of the hatch */
export const POD_DOOR_Z = -0.5;
/** Porthole radius in pod units (0.3 is 60% of the screen's half-height) */
export const POD_R = 0.3;
const DOOR_DEPTH = 0.04;
/** Far larger than any view, so a shut door covers the screen */
const E = 12;

/** One door half; side -1 is the left. The porthole's half is cut out of the seam edge. */
export const doorGeometry = (side: -1 | 1) => {
  const pts: THREE.Vector2[] = [new THREE.Vector2(0, -E), new THREE.Vector2(0, -POD_R)];
  const steps = 28;
  for (let i = 1; i < steps; i += 1) {
    const a = -Math.PI / 2 - (i / steps) * Math.PI;
    pts.push(new THREE.Vector2(Math.cos(a) * POD_R, Math.sin(a) * POD_R));
  }
  pts.push(new THREE.Vector2(0, POD_R), new THREE.Vector2(0, E), new THREE.Vector2(-E, E), new THREE.Vector2(-E, -E));
  const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * -side, p.y)));
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: DOOR_DEPTH,
    bevelEnabled: true,
    bevelThickness: 0.006,
    bevelSize: 0.006,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // the bevel grows the outline: pull the halves apart so their seam faces do not overlap
  g.translate(side * 0.006, 0, POD_DOOR_Z - DOOR_DEPTH - 0.006);
  return g;
};

/** The metal lip around one half of the porthole, on the door's inner face */
export const rimGeometry = (side: -1 | 1) => {
  const g = new THREE.TorusGeometry(POD_R + 0.006, 0.011, 8, 40, Math.PI);
  g.rotateZ(side < 0 ? Math.PI / 2 : -Math.PI / 2);
  g.translate(0, 0, POD_DOOR_Z + 0.004);
  return g;
};

/** One half of the porthole glass, set back inside the cut */
export const glassGeometry = (side: -1 | 1) => {
  const g = new THREE.CircleGeometry(POD_R, 48, side < 0 ? Math.PI / 2 : -Math.PI / 2, Math.PI);
  g.translate(0, 0, POD_DOOR_Z - DOOR_DEPTH * 0.6);
  return g;
};

/**
 * Plating for one door half, drawn to a canvas: ribs, a bolted collar around
 * the porthole and a hazard band along the seam. 512 px per pod unit, the
 * seam on the right edge for the left half (mirrored for the right).
 */
export const doorTexture = (side: -1 | 1) => {
  const W = 512;
  const H = 1024;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (side > 0) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  const cx = W;
  const cy = H / 2;
  const px = 512;
  g.fillStyle = '#5f6774';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 1600; i += 1) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.025 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1, 30 + Math.random() * 120);
  }
  // reinforcing ribs: raised bars with a lit top edge and a shadow below
  for (const y of [90, 250, 774, 934]) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(0, y + 14, W - 40, 7);
    g.fillStyle = '#737c8a';
    g.fillRect(0, y, W - 40, 14);
    g.fillStyle = 'rgba(255,255,255,0.2)';
    g.fillRect(0, y, W - 40, 2);
  }
  // hazard band along the seam
  const band = 34;
  g.save();
  g.beginPath();
  g.rect(W - band, 0, band, H);
  g.clip();
  g.fillStyle = '#d9a21b';
  g.fillRect(W - band, 0, band, H);
  g.fillStyle = '#16181d';
  for (let y = -60; y < H + 60; y += 40) {
    g.beginPath();
    g.moveTo(W - band, y);
    g.lineTo(W, y + 30);
    g.lineTo(W, y + 50);
    g.lineTo(W - band, y + 20);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(W - band - 4, 0, 4, H);
  // the porthole collar: a raised ring of plate with bolts
  const rOut = (POD_R + 0.085) * px;
  const grad = g.createRadialGradient(cx, cy, POD_R * px, cx, cy, rOut);
  grad.addColorStop(0, '#848d9b');
  grad.addColorStop(0.75, '#6d7584');
  grad.addColorStop(1, '#3d434d');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(cx, cy, rOut, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cy, rOut, 0, Math.PI * 2);
  g.stroke();
  const rb = (POD_R + 0.05) * px;
  for (let k = 0; k < 16; k += 1) {
    const a = (k / 16) * Math.PI * 2 + Math.PI / 16;
    const bx = cx + Math.cos(a) * rb;
    const by = cy + Math.sin(a) * rb;
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(bx + 1.5, by + 1.5, 7, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#a3abb8';
    g.beginPath();
    g.arc(bx, by, 6, 0, Math.PI * 2);
    g.fill();
  }
  // the seam lip
  g.fillStyle = '#22262d';
  g.fillRect(W - 4, 0, 4, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  // shape coordinates are the UVs: x in [-1, 0] (or [0, 1]) and y in [-1, 1] span the canvas
  t.repeat.set(1, 0.5);
  t.offset.set(side < 0 ? 1 : 0, 0.5);
  return t;
};

/**
 * Porthole glass: nearly clear, a soft reflection, and on entry plasma
 * streaming across it and burning around the rim (uHeat).
 */
export const podGlassMaterial = () =>
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
        vN = position.xy / ${POD_R.toFixed(3)};
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
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float r = length(vN);
        float d = dot(vN, normalize(vec2(1.0, 0.7)));
        float refl = exp(-pow((d - 0.45) / 0.09, 2.0)) * 0.012 + smoothstep(0.82, 1.0, r) * 0.01;
        vec3 col = vec3(0.75, 0.85, 1.0) * refl;
        if (uHeat > 0.001) {
          float a = atan(vN.y, vN.x);
          float streak = noise(vec2(a * 7.0, r * 3.0 - uTime * 8.0)) * 0.6 + noise(vec2(a * 19.0, r * 6.0 - uTime * 13.0)) * 0.4;
          float rim = smoothstep(0.25 - uHeat * 0.25, 1.0, r);
          float flame = uHeat * rim * (0.3 + streak * 1.2);
          col += mix(uHeatColor, vec3(1.0, 0.92, 0.75), 0.35) * flame * 0.9;
        }
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }
    `,
  });
