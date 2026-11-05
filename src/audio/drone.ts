import { useSyncExternalStore } from 'react';
import { planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';

/**
 * Ambient string drone, synthesised with Web Audio. Each planet has a key;
 * the drone crossfades to it on arrival and sits quieter in orbit. Audio can
 * only start after a user gesture, so the first click or key press starts it
 * (when the stored preference is on).
 */

const PREF_KEY = 'sound';
/** Key played in orbit with no destination chosen */
const ORBIT_KEY = 'D major';
const LEVEL_PLANET = 0.2;
const LEVEL_ORBIT = 0.08;
const CROSSFADE_S = 4;
const ATTACK_S = 3;

const NOTE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** "C# minor" -> MIDI note of the root around C3 and whether it is minor. */
const parseKey = (key: string): { root: number; minor: boolean } => {
  const m = /^([A-G])([#b]?)\s*(major|minor)?/i.exec(key.trim());
  if (!m) return { root: 50, minor: false };
  const pc = NOTE[m[1].toUpperCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  // roots between A2 and G#3 keep every key in the same low register
  const root = 45 + ((((pc - 9) % 12) + 12) % 12);
  return { root, minor: (m[3] ?? '').toLowerCase() === 'minor' };
};

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/* ---------- preference ---------- */

const readPref = (): boolean => {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
};

let enabled = readPref();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

/* ---------- graph ---------- */

interface Voice {
  out: GainNode;
  nodes: AudioScheduledSourceNode[];
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let bus: GainNode | null = null;
let voice: Voice | null = null;
let currentKey = '';

const impulse = (c: AudioContext, seconds: number) => {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i += 1) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  return buf;
};

const build = () => {
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3;
  master.connect(comp).connect(ctx.destination);

  // dark section sound: lowpass with a slow breathing cutoff, then a long hall
  bus = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 900;
  lp.Q.value = 0.4;
  const sweep = ctx.createOscillator();
  sweep.frequency.value = 0.04;
  const sweepAmt = ctx.createGain();
  sweepAmt.gain.value = 320;
  sweep.connect(sweepAmt).connect(lp.frequency);
  sweep.start();
  bus.connect(lp);
  const dry = ctx.createGain();
  dry.gain.value = 0.55;
  const wet = ctx.createGain();
  wet.gain.value = 0.75;
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 5);
  lp.connect(dry).connect(master);
  lp.connect(verb).connect(wet).connect(master);
  return true;
};

/** One sustained chord: root, fifth, octave and third, each a few detuned saws with slow swells. */
const makeVoice = (c: AudioContext, key: string): Voice => {
  const { root, minor } = parseKey(key);
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(bus!);
  const nodes: AudioScheduledSourceNode[] = [];
  const notes = [root - 12, root, root + 7, root + 12, root + (minor ? 15 : 16)];
  const weights = [0.5, 0.9, 0.7, 0.55, 0.4];
  notes.forEach((n, i) => {
    const g = c.createGain();
    g.gain.value = weights[i] * 0.05;
    // each note swells on its own slow cycle, like players bowing out of step
    const swell = c.createOscillator();
    swell.frequency.value = 0.05 + i * 0.013;
    const swellAmt = c.createGain();
    swellAmt.gain.value = weights[i] * 0.02;
    swell.connect(swellAmt).connect(g.gain);
    swell.start(c.currentTime + Math.random() * 2);
    nodes.push(swell);
    // gentle shared vibrato
    const vib = c.createOscillator();
    vib.frequency.value = 4.6 + Math.random() * 0.6;
    const vibAmt = c.createGain();
    vibAmt.gain.value = 3;
    vib.connect(vibAmt);
    vib.start();
    nodes.push(vib);
    for (const cents of [-7, 0, 6]) {
      const o = c.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sawtooth';
      o.frequency.value = hz(n);
      o.detune.value = cents;
      vibAmt.connect(o.detune);
      o.connect(g);
      o.start();
      nodes.push(o);
    }
    g.connect(out);
  });
  return { out, nodes };
};

const desiredKey = () => {
  const s = useAppStore.getState();
  const id = s.mode === 'overworld' ? null : s.mode === 'transitioning-in' ? s.lockedPlanetId : s.activePlanetId;
  return planetById(id)?.key ?? ORBIT_KEY;
};

const desiredLevel = () => {
  const m = useAppStore.getState().mode;
  return m === 'planet' ? LEVEL_PLANET : LEVEL_ORBIT;
};

const sync = () => {
  if (!ctx || !master) return;
  const now = ctx.currentTime;
  const key = desiredKey();
  if (key !== currentKey) {
    currentKey = key;
    const old = voice;
    voice = makeVoice(ctx, key);
    voice.out.gain.setTargetAtTime(1, now, (old ? CROSSFADE_S : ATTACK_S) / 3);
    if (old) {
      old.out.gain.setTargetAtTime(0, now, CROSSFADE_S / 3);
      const stopAt = now + CROSSFADE_S * 1.5;
      old.nodes.forEach((n) => n.stop(stopAt));
      window.setTimeout(() => old.out.disconnect(), CROSSFADE_S * 1500 + 200);
    }
  }
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(enabled ? desiredLevel() : 0, now, enabled ? 1.2 : 0.25);
};

let started = false;

/** Called on the first gesture and whenever sound is switched on. */
const start = () => {
  if (!enabled) return;
  if (!ctx && !build()) return;
  if (ctx!.state === 'suspended') void ctx!.resume();
  if (!started) {
    started = true;
    useAppStore.subscribe((s, p) => {
      if (s.mode !== p.mode || s.activePlanetId !== p.activePlanetId || s.lockedPlanetId !== p.lockedPlanetId) sync();
    });
  }
  sync();
};

/** Installs the first-gesture listener and tab visibility handling. Call once. */
export const initDrone = () => {
  if (import.meta.env.DEV) {
    (window as unknown as { __drone: () => object }).__drone = () => ({
      state: ctx?.state ?? 'none',
      key: currentKey,
      level: master?.gain.value ?? 0,
      enabled,
    });
  }
  const onGesture = () => {
    if (enabled) start();
    if (ctx) {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    }
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else if (enabled) void ctx.resume();
  });
};

export const setSoundEnabled = (on: boolean) => {
  enabled = on;
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* private mode: the choice lasts for this visit */
  }
  if (on) start();
  else {
    sync();
    // let the fade finish, then stop the clock so the synth costs nothing while off
    window.setTimeout(() => {
      if (!enabled && ctx?.state === 'running') void ctx.suspend();
    }, 1500);
  }
  emit();
};

export const useSoundEnabled = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => enabled,
  );
