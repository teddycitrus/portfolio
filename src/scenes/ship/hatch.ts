import * as THREE from 'three';
import type { Pt } from './shape';

/*
 * The hatch the viewer steps out through after touchdown. Like the cockpit it
 * lives in frame units: x / -z is the screen position (1 = screen edge) once
 * the group is scaled by the resting lens.
 */

/** Plane of the door slabs and of the jamb in front of them */
export const DOOR_Z = -0.5;
export const JAMB_Z = -0.47;
/** Doorway opening at the jamb, in screen units */
const HOLE_W = 0.78;
const HOLE_TOP = 0.8;
const HOLE_BOTTOM = -1.6;
/** Each slab, in frame units; the seam sits at x = 0 */
export const SLAB_W = 0.44;
export const SLAB_H = 1.12;
export const SLAB_Y = -0.08;
/** How far a slab travels to clear the doorway (into the wall behind the jamb) */
export const SLAB_TRAVEL = 0.46;

/** Doorway outline at the jamb plane, counter-clockwise, rounded top corners. */
export const doorway = (): Pt[] => {
  const d = -JAMB_Z;
  const x = HOLE_W * d;
  const top = HOLE_TOP * d;
  const bot = HOLE_BOTTOM * d;
  const r = 0.07;
  const pts: Pt[] = [
    [-x, bot],
    [x, bot],
  ];
  for (let k = 0; k <= 6; k += 1) {
    const a = (k / 6) * (Math.PI / 2);
    pts.push([x - r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  for (let k = 0; k <= 6; k += 1) {
    const a = Math.PI / 2 + (k / 6) * (Math.PI / 2);
    pts.push([-x + r + Math.cos(a) * r, top - r + Math.sin(a) * r]);
  }
  return pts;
};

/**
 * One door slab drawn to a canvas: dark plating with ribs, a hazard band on
 * the leading edge and a lit stencil line. Mirrored for the right slab.
 */
export const slabTexture = (mirror: boolean) => {
  const W = 256;
  const H = 640;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  if (mirror) {
    g.translate(W, 0);
    g.scale(-1, 1);
  }
  g.fillStyle = '#6c7482';
  g.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i += 1) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${0.03 + Math.random() * 0.03})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1, 20 + Math.random() * 90);
  }
  // reinforcing ribs: raised bars with a lit top edge and a shadow below
  for (const y of [70, 210, 350, 490, 600]) {
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(14, y + 10, W - 70, 6);
    g.fillStyle = '#7d8696';
    g.fillRect(14, y, W - 70, 10);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(14, y, W - 70, 2);
  }
  // inset panel with bolts
  g.strokeStyle = 'rgba(0,0,0,0.55)';
  g.lineWidth = 3;
  g.strokeRect(30, 250, W - 110, 200);
  g.strokeStyle = 'rgba(255,255,255,0.12)';
  g.lineWidth = 1;
  g.strokeRect(32, 252, W - 110, 200);
  for (const [bx, by] of [
    [40, 260],
    [W - 90, 260],
    [40, 440],
    [W - 90, 440],
  ]) {
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.beginPath();
    g.arc(bx + 1, by + 1, 4, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.4)';
    g.beginPath();
    g.arc(bx, by, 3, 0, Math.PI * 2);
    g.fill();
  }
  // hazard band along the edge that meets the other slab
  const bandX = W - 46;
  g.save();
  g.beginPath();
  g.rect(bandX, 0, 46, H);
  g.clip();
  g.fillStyle = '#d9a21b';
  g.fillRect(bandX, 0, 46, H);
  g.fillStyle = '#16181d';
  for (let y = -60; y < H + 60; y += 36) {
    g.beginPath();
    g.moveTo(bandX, y);
    g.lineTo(bandX + 46, y + 30);
    g.lineTo(bandX + 46, y + 48);
    g.lineTo(bandX, y + 18);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = 'rgba(0,0,0,0.6)';
  g.fillRect(bandX - 4, 0, 4, H);
  // the seam lip
  g.fillStyle = '#2a2e36';
  g.fillRect(W - 4, 0, 4, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
};
