import { useSyncExternalStore } from 'react';
import { planetById } from '@/data/content';
import { useAppStore } from '@/state/useAppStore';
import { TRACKS, startTrack, type Sequencer } from './tracks';

/**
 * Music, synthesised with Web Audio. In orbit an ambient string pad walks a
 * slow chord progression that keeps cadencing home (V to I), with a suspended
 * fourth resolving on every dominant, a soft bass and a sparse high chime.
 * Each planet has its own track (see tracks.ts), which takes over from the
 * pad from the dive onward. Audio can only start after a user gesture, so the
 * first click or key press starts it (when the stored preference is on).
 * Wildlife calls and ship sounds share the same graph.
 */

const PREF_KEY = 'sound';
/** Key played in orbit with no destination chosen */
const ORBIT_KEY = 'D major';
const LEVEL_PLANET = 0.2;
const LEVEL_ORBIT = 0.08;
/** Planet tracks against the pad (drums read louder than sustained chords at the same level) */
const TRACK_GAIN = 1.0;
/** Planet tracks fade in and out over this long */
const TRACK_XFADE_S = 2.5;
/** Seconds per chord on a planet and in orbit */
const CHORD_S = 8;
const CHORD_S_ORBIT = 11;
/** Overlap between one chord and the next */
const XFADE_S = 3.2;
/** Key changes on travel blend over this long */
const KEY_XFADE_S = 4;

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

/* ---------- harmony ---------- */

interface Chord {
  /** Semitones above the key root */
  root: number;
  /** Chord tones above the chord root */
  tones: number[];
  /** Dominant: start on a suspended fourth and resolve it to the third halfway through */
  sus?: boolean;
}

const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];

/** Two phrases, each closing on a V to I cadence (the loop returns to I). */
const PROGRESSION_MAJOR: Chord[] = [
  { root: 0, tones: MAJ },
  { root: 9, tones: MIN },
  { root: 5, tones: [0, 4, 7, 11] },
  { root: 7, tones: MAJ, sus: true },
  { root: 0, tones: MAJ },
  { root: 4, tones: MIN },
  { root: 2, tones: [0, 3, 7, 10] },
  { root: 7, tones: [0, 4, 7, 10], sus: true },
];

/** Natural minor colour, harmonic minor dominant for a real pull home. */
const PROGRESSION_MINOR: Chord[] = [
  { root: 0, tones: MIN },
  { root: 8, tones: [0, 4, 7, 11] },
  { root: 5, tones: MIN },
  { root: 7, tones: MAJ, sus: true },
  { root: 0, tones: MIN },
  { root: 3, tones: MAJ },
  { root: 10, tones: MAJ },
  { root: 7, tones: [0, 4, 7, 10], sus: true },
];

/**
 * Places the chord's upper tones as close as possible to the previous voicing
 * (smooth voice leading) inside one octave above the key root.
 */
const voice = (keyRoot: number, c: Chord, prev: number[] | null): number[] => {
  const pcs = c.tones.map((x) => (keyRoot + c.root + x) % 12);
  const lo = keyRoot + 7;
  const notes = pcs.map((pc) => {
    // candidates for this pitch class in the pad register
    const cands = [0, 12, 24].map((o) => lo + ((((pc - lo) % 12) + 12) % 12) + o).filter((n) => n < lo + 19);
    if (!prev) return cands[0];
    let best = cands[0];
    let bestD = Infinity;
    for (const n of cands) {
      const d = Math.min(...prev.map((p) => Math.abs(p - n)));
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  });
  return [...new Set(notes)].sort((a, b) => a - b);
};

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
let sfx: GainNode | null = null;
let verbIn: GainNode | null = null;
/** Planet tracks: their own level and hall send, so drums do not drown in the pad's hall */
let trackBus: GainNode | null = null;
let trackVerb: GainNode | null = null;
let seq: Sequencer | null = null;
let seqId = '';
let seqPump = 0;
let current: Voice | null = null;
let currentKey = '';
let step = 0;
let lastVoicing: number[] | null = null;
let timer = 0;

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
  // the loader makes one on the departure, inside the gesture, so it is already allowed to play
  ctx = (window as unknown as { __bootAudio?: AudioContext }).__bootAudio ?? new AC();
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 3;
  comp.connect(ctx.destination);
  master = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp);

  // shared hall for the pad and the critters
  const verb = ctx.createConvolver();
  verb.buffer = impulse(ctx, 5);
  verbIn = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 1.3;
  verbIn.connect(verb).connect(wet).connect(comp);

  // dark section sound: lowpass with a slow breathing cutoff
  bus = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 950;
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
  lp.connect(dry).connect(master);
  // the pad's hall send rides on the master level
  master.connect(verbIn);

  trackBus = ctx.createGain();
  trackBus.gain.value = 0;
  trackBus.connect(comp);
  trackVerb = ctx.createGain();
  trackVerb.gain.value = 0;
  trackVerb.connect(verbIn);

  // critter calls bypass the pad level but obey the sound toggle
  sfx = ctx.createGain();
  sfx.gain.value = enabled ? 1 : 0;
  sfx.connect(comp);
  return true;
};

/** One sustained chord: each tone a few detuned saws with its own slow swell. */
const makeChord = (c: AudioContext, keyRoot: number, chord: Chord, notes: number[], dur: number): Voice => {
  const out = c.createGain();
  out.gain.value = 0;
  out.connect(bus!);
  const nodes: AudioScheduledSourceNode[] = [];
  const now = c.currentTime;
  const bass = keyRoot - 12 + chord.root - (chord.root > 6 ? 12 : 0);
  const all = [bass, ...notes];
  // the suspended tone: the chord's third, sounded as a fourth first
  const thirdPc = (keyRoot + chord.root + chord.tones[1]) % 12;
  all.forEach((n, i) => {
    const isBass = i === 0;
    const g = c.createGain();
    const w = isBass ? 0.55 : 0.75 - i * 0.07;
    g.gain.value = w * 0.05;
    const swell = c.createOscillator();
    swell.frequency.value = 0.06 + i * 0.017;
    const swellAmt = c.createGain();
    swellAmt.gain.value = w * 0.018;
    swell.connect(swellAmt).connect(g.gain);
    swell.start(now + Math.random() * 2);
    nodes.push(swell);
    const vib = c.createOscillator();
    vib.frequency.value = 4.4 + Math.random() * 0.8;
    const vibAmt = c.createGain();
    vibAmt.gain.value = isBass ? 0 : 3;
    vib.connect(vibAmt);
    vib.start();
    nodes.push(vib);
    const sus = chord.sus && !isBass && n % 12 === thirdPc;
    for (const cents of isBass ? [0, 5] : [-7, 0, 6]) {
      const o = c.createOscillator();
      o.type = isBass ? 'triangle' : 'sawtooth';
      if (sus) {
        // hold the fourth, then lean down onto the third
        o.frequency.setValueAtTime(hz(n + (chord.tones[1] === 3 ? 2 : 1)), now);
        o.frequency.setValueAtTime(hz(n + (chord.tones[1] === 3 ? 2 : 1)), now + dur * 0.45);
        o.frequency.exponentialRampToValueAtTime(hz(n), now + dur * 0.45 + 0.9);
      } else {
        o.frequency.value = hz(n);
      }
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

/** A soft high chime on a chord tone: sine plus a quiet octave, long decay into the hall. */
const chime = (c: AudioContext, midi: number, at: number, level: number) => {
  const g = c.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(level, at + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 3.5);
  g.connect(master!);
  g.connect(verbIn!);
  for (const [mult, amp] of [
    [1, 1],
    [2, 0.25],
  ]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = hz(midi) * mult;
    const og = c.createGain();
    og.gain.value = amp;
    o.connect(og).connect(g);
    o.start(at);
    o.stop(at + 3.7);
  }
};

const destinationId = () => {
  const s = useAppStore.getState();
  return s.mode === 'overworld' ? null : s.mode === 'transitioning-in' ? s.lockedPlanetId : s.activePlanetId;
};
const desiredKey = () => planetById(destinationId())?.key ?? ORBIT_KEY;
/** The planet whose track should play, or '' for the pad */
const desiredTrack = () => {
  const id = destinationId();
  return id && TRACKS[id] ? id : '';
};

/** Fades the pad out and stops its clock (a planet track takes over). */
const stopPad = (fade: number) => {
  window.clearTimeout(timer);
  currentKey = '';
  lastVoicing = null;
  const old = current;
  current = null;
  if (!old || !ctx) return;
  const now = ctx.currentTime;
  old.out.gain.setTargetAtTime(0, now, fade / 3);
  old.nodes.forEach((n) => n.stop(now + fade * 1.6));
  window.setTimeout(() => old.out.disconnect(), fade * 1600 + 200);
};

const onPlanet = () => useAppStore.getState().mode === 'planet';
const desiredLevel = () => (onPlanet() ? LEVEL_PLANET : LEVEL_ORBIT);

/** Fades the current chord out and the next one in; reschedules itself. */
const advance = (fade: number) => {
  window.clearTimeout(timer);
  const dur = onPlanet() ? CHORD_S : CHORD_S_ORBIT;
  timer = window.setTimeout(() => advance(XFADE_S), dur * 1000);
  // nothing piles up while the context is paused (tab hidden, sound off)
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  const { root, minor } = parseKey(currentKey);
  const prog = minor ? PROGRESSION_MINOR : PROGRESSION_MAJOR;
  const chord = prog[step % prog.length];
  step += 1;
  const notes = voice(root, chord, lastVoicing);
  lastVoicing = notes;
  const old = current;
  current = makeChord(ctx, root, chord, notes, dur);
  current.out.gain.setTargetAtTime(1, now, fade / 3);
  if (old) {
    old.out.gain.setTargetAtTime(0, now, fade / 3);
    const stopAt = now + fade * 1.6;
    old.nodes.forEach((n) => n.stop(stopAt));
    window.setTimeout(() => old.out.disconnect(), fade * 1600 + 200);
  }
  // a chime now and then, more often on a planet; always on the home chord
  const chimeP = onPlanet() ? 0.7 : 0.35;
  if (chord.root === 0 || Math.random() < chimeP) {
    const top = notes[notes.length - 1] + 12;
    chime(ctx, top, now + 0.6 + Math.random() * 1.2, 0.05);
    if (Math.random() < 0.5) chime(ctx, notes[Math.floor(Math.random() * notes.length)] + 12, now + dur * 0.55, 0.035);
  }
};

const sync = () => {
  if (!ctx || !master || !sfx) return;
  const now = ctx.currentTime;
  const trackId = desiredTrack();
  if (trackId !== seqId) {
    seq?.stop(TRACK_XFADE_S);
    seq = null;
    seqId = trackId;
    if (trackId && trackBus && trackVerb && verbIn) {
      stopPad(TRACK_XFADE_S);
      seq = startTrack(ctx, TRACKS[trackId], trackBus, trackVerb, whiteNoise(ctx), now + 0.1, TRACK_XFADE_S);
      seq.fill(now + 0.3);
      if (!seqPump) {
        // look-ahead scheduling: a coarse timer queues notes a little before they play
        seqPump = window.setInterval(() => {
          if (seq && ctx?.state === 'running') seq.fill(ctx.currentTime + 0.3);
        }, 60);
      }
    }
  }
  if (!trackId) {
    const key = desiredKey();
    if (key !== currentKey) {
      // a new key starts its progression from home
      currentKey = key;
      step = 0;
      lastVoicing = null;
      advance(current ? KEY_XFADE_S : 3);
    }
  }
  // the music fades out while the page reader is open, and back in when it closes
  const playing = enabled && !reading();
  const tc = playing ? (ducks.size ? DUCK_FADE_S / 3 : 1.2) : enabled ? READER_FADE_S / 3 : 0.25;
  // a playing video pulls the music down to a faint bed
  const level = desiredLevel() * (ducks.size ? DUCK_LEVEL : 1);
  master.gain.cancelScheduledValues(now);
  master.gain.setTargetAtTime(playing ? level : 0, now, tc);
  const tl = playing ? level * TRACK_GAIN : 0;
  trackBus?.gain.setTargetAtTime(tl, now, tc);
  trackVerb?.gain.setTargetAtTime(tl * 0.6, now, tc);
  sfx.gain.setTargetAtTime(enabled ? 1 : 0, now, 0.1);
};

/** Sources (playing videos) holding the music down */
const ducks = new Set<string>();
/** Music level while ducked, as a fraction of normal, and how fast it dips */
const DUCK_LEVEL = 0.12;
const DUCK_FADE_S = 0.8;

/** Lowers the music while `on` for this source; it comes back once no source holds it. */
export const duckMusic = (source: string, on: boolean) => {
  if (on === ducks.has(source)) return;
  if (on) ducks.add(source);
  else ducks.delete(source);
  sync();
};

const reading = () => useAppStore.getState().readerOpen;
/** The music's fade into and out of the reader, seconds */
const READER_FADE_S = 1.2;

/** Silent (sound off or reading): once the fade is done, stop the clock so the synth costs nothing. */
const suspendWhenQuiet = () =>
  window.setTimeout(() => {
    if ((!enabled || reading()) && ctx?.state === 'running') void ctx.suspend();
  }, 1500);

let started = false;

/** Called on the first gesture and whenever sound is switched on. */
const start = () => {
  if (!enabled) return;
  if (!ctx && !build()) return;
  // reading the page keeps it asleep; closing the reader wakes it (below)
  if (ctx!.state === 'suspended' && !reading()) void ctx!.resume();
  if (!started) {
    started = true;
    useAppStore.subscribe((s, p) => {
      if (s.readerOpen !== p.readerOpen) {
        // back from the page: wake the clock first so the fade in is heard
        if (!s.readerOpen && enabled && !document.hidden && ctx?.state === 'suspended') void ctx.resume();
        sync();
        if (s.readerOpen) suspendWhenQuiet();
      } else if (s.mode !== p.mode || s.activePlanetId !== p.activePlanetId || s.lockedPlanetId !== p.lockedPlanetId) sync();
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
      step,
      voicing: lastVoicing,
      level: master?.gain.value ?? 0,
      enabled,
    });
  }
  const onGesture = () => {
    if (enabled) start();
    // a context made before any gesture stays suspended: keep listening until one resumes it
    if (ctx && ctx.state === 'running') {
      window.removeEventListener('pointerdown', onGesture, true);
      window.removeEventListener('keydown', onGesture, true);
    }
  };
  window.addEventListener('pointerdown', onGesture, true);
  window.addEventListener('keydown', onGesture, true);
  // departed before the bundle was here: that gesture already unlocked the loader's audio
  if ((window as unknown as { __bootAudio?: AudioContext }).__bootAudio) onGesture();
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else if (enabled && !reading()) void ctx.resume();
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
    suspendWhenQuiet();
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

/* ---------- wildlife calls ---------- */

export type CritterVoice = 'chirp' | 'squeak' | 'mew' | 'boop' | 'trill' | 'song' | 'rumble';

let lastCall = 0;

/**
 * A short, cute call from a creature. `distance` (world units) sets the level,
 * `pan` (-1 left .. 1 right) places it. Silent before the first gesture or
 * while sound is off; rate-limited so a crowd never turns into noise.
 */
export const critterCall = (kind: CritterVoice, distance: number, pan: number) => {
  if (!ctx || !sfx || !verbIn || !enabled || ctx.state !== 'running') return;
  // a surface drawn out of sight under the loader stays silent
  if (useAppStore.getState().warmPlanetId) return;
  const nowMs = performance.now();
  if (nowMs - lastCall < 220) return;
  lastCall = nowMs;
  // the big sky creatures' song carries much further than a small creature's call
  const far = kind === 'song' || kind === 'rumble';
  const reach = far ? 120 : 28;
  const level = (kind === 'rumble' ? 0.2 : kind === 'song' ? 0.12 : 0.16) * Math.max(0, 1 - distance / reach) ** 1.5;
  if (level < 0.004) return;
  const c = ctx;
  const t0 = c.currentTime + 0.01;
  const out = c.createGain();
  out.gain.value = level;
  const panner = c.createStereoPanner();
  panner.pan.value = Math.max(-1, Math.min(1, pan));
  out.connect(panner);
  panner.connect(sfx);
  const send = c.createGain();
  send.gain.value = 0.35;
  panner.connect(send).connect(verbIn);

  /** One pitched blip with an attack/decay envelope and a pitch path. */
  const blip = (type: OscillatorType, at: number, len: number, path: [number, number][], amp = 1, vibHz = 0) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(path[0][1], at);
    for (const [dt, f] of path.slice(1)) o.frequency.exponentialRampToValueAtTime(f, at + dt);
    if (vibHz) {
      const v = c.createOscillator();
      v.frequency.value = vibHz;
      const va = c.createGain();
      va.gain.value = path[0][1] * 0.04;
      v.connect(va).connect(o.frequency);
      v.start(at);
      v.stop(at + len + 0.05);
    }
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(amp, at + Math.min(0.02, len * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, at + len);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + len + 0.05);
  };

  const r = (a: number, b: number) => a + Math.random() * (b - a);
  switch (kind) {
    case 'chirp': {
      // two or three quick rising tweets
      const n = Math.random() < 0.5 ? 2 : 3;
      const base = r(2400, 3200);
      for (let i = 0; i < n; i += 1)
        blip('sine', t0 + i * 0.09, 0.07, [
          [0, base * (1 + i * 0.06)],
          [0.05, base * 1.45 * (1 + i * 0.06)],
        ], 0.6);
      break;
    }
    case 'squeak': {
      // a bouncy "bi-bip" up the scale
      const base = r(620, 820);
      blip('triangle', t0, 0.13, [[0, base], [0.1, base * 1.5]], 0.9, 18);
      blip('triangle', t0 + 0.15, 0.16, [[0, base * 1.2], [0.12, base * 1.9]], 0.8, 18);
      break;
    }
    case 'mew': {
      // a soft rising-falling "mrrp"
      const base = r(330, 420);
      blip('triangle', t0, 0.42, [[0, base], [0.16, base * 1.35], [0.4, base * 1.05]], 0.8, 28);
      break;
    }
    case 'trill': {
      // a quick dry clicking skitter
      const base = r(3600, 4600);
      for (let i = 0; i < 5; i += 1) blip('square', t0 + i * 0.045, 0.03, [[0, base * (1 + (i % 2) * 0.08)], [0.025, base * 0.85]], 0.18);
      break;
    }
    case 'song': {
      // a long low call that rises and falls, with a quiet overtone above it
      const base = r(130, 175);
      blip('sine', t0, 2.4, [[0, base], [0.9, base * 1.45], [2.3, base * 0.9]], 1, 4.5);
      blip('triangle', t0 + 0.12, 2.1, [[0, base * 2.01], [0.85, base * 2.9], [2.0, base * 1.8]], 0.18, 4.5);
      break;
    }
    case 'rumble': {
      // a deep grinding groan, like rock moving: two low tones beating against each other
      const base = r(52, 62);
      blip('sawtooth', t0, 3.0, [[0, base], [1.2, base * 1.25], [2.9, base * 0.8]], 0.5, 3);
      blip('sine', t0 + 0.05, 2.9, [[0, base * 1.02], [1.3, base * 1.3], [2.8, base * 0.82]], 0.9);
      blip('triangle', t0 + 0.4, 2.2, [[0, base * 3], [1.0, base * 3.6], [2.1, base * 2.4]], 0.12, 2);
      break;
    }
    case 'boop': {
      // a round, falling bubble with a little echo
      const base = r(380, 520);
      blip('sine', t0, 0.5, [[0, base], [0.45, base * 0.6]], 1);
      blip('sine', t0 + 0.18, 0.35, [[0, base * 1.5], [0.3, base * 1.0]], 0.4);
      break;
    }
  }
  window.setTimeout(() => {
    out.disconnect();
    panner.disconnect();
    send.disconnect();
  }, kind === 'song' || kind === 'rumble' ? 4500 : 2000);
};

/* ---------- ship ---------- */

export type ShipSound = 'lock' | 'lower' | 'beam' | 'dropout';

let noiseBuf: AudioBuffer | null = null;
const whiteNoise = (c: AudioContext) => {
  if (noiseBuf) return noiseBuf;
  noiseBuf = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i += 1) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
};

/**
 * Ship sounds: the beam taking hold in the lobby, the ride down it onto a
 * planet (feet touching `touchdown` seconds later), the pull back up, and the
 * drop out of hyperspace (the flash `touchdown` seconds later). Silent while
 * sound is off.
 */
export const shipSound = (kind: ShipSound, touchdown = 0.54) => {
  if (!ctx || !sfx || !verbIn || !enabled || ctx.state !== 'running') return;
  const c = ctx;
  const t0 = c.currentTime + 0.005;
  const out = c.createGain();
  out.gain.value = 1;
  out.connect(sfx);
  const send = c.createGain();
  send.gain.value = 0.22;
  out.connect(send).connect(verbIn);

  /** Filtered noise with a frequency sweep and an attack/decay envelope. */
  const air = (at: number, dur: number, f0: number, f1: number, q: number, peak: number, attack: number, type: BiquadFilterType = 'bandpass') => {
    const src = c.createBufferSource();
    src.buffer = whiteNoise(c);
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, at);
    f.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(out);
    src.start(at, Math.random());
    src.stop(at + dur + 0.05);
  };
  /** A low pitched body: thrust kick or ground thud. */
  const body = (at: number, dur: number, f0: number, f1: number, peak: number) => {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  /** A held tone that glides between two pitches. */
  const tone = (at: number, dur: number, f0: number, f1: number, peak: number, attack: number, type: OscillatorType) => {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(f1, at + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(out);
    o.start(at);
    o.stop(at + dur + 0.05);
  };

  switch (kind) {
    case 'beam':
      // the beam locks on with a soft thrum, then a rising hum and shimmer as it pulls
      body(t0, 0.5, 70, 45, 0.22);
      tone(t0 + 0.1, 2.0, 95, 380, 0.09, 0.7, 'triangle');
      tone(t0 + 0.15, 1.95, 191, 762, 0.035, 0.8, 'sine');
      air(t0 + 0.05, 2.0, 900, 5200, 3.0, 0.05, 1.1);
      air(t0 + 0.6, 1.4, 220, 2600, 0.8, 0.12, 1.0);
      break;
    case 'lock':
      // the ship comes round and plunges: a thrum, a rising hum and the rush of air swelling into the sky
      body(t0, 0.5, 70, 45, 0.22);
      tone(t0 + 0.05, 1.35, 120, 420, 0.08, 0.85, 'triangle');
      tone(t0 + 0.08, 1.3, 241, 842, 0.03, 0.85, 'sine');
      air(t0 + 0.1, 1.3, 1200, 6000, 2.5, 0.06, 1.05);
      break;
    case 'dropout':
      // the drive spools up in a rising whine, then the drop: a deep boom and the rush of normal space falling away
      tone(t0, touchdown + 0.08, 160, 1300, 0.05, touchdown * 0.9, 'sawtooth');
      tone(t0, touchdown + 0.08, 322, 2600, 0.025, touchdown * 0.9, 'sine');
      air(t0, touchdown + 0.1, 1400, 9000, 2.0, 0.07, touchdown * 0.9);
      body(t0 + touchdown, 1.4, 110, 30, 0.42);
      air(t0 + touchdown, 1.6, 4200, 140, 0.7, 0.24, 0.015, 'lowpass');
      tone(t0 + touchdown, 1.3, 1900, 700, 0.025, 0.02, 'sine');
      tone(t0 + touchdown + 0.02, 1.2, 2853, 1050, 0.015, 0.02, 'sine');
      break;
    case 'lower':
      // coming down the beam: the hum falls and softens, then a light settle as the feet touch
      tone(t0, touchdown + 0.4, 380, 95, 0.08, 0.05, 'triangle');
      tone(t0, touchdown + 0.35, 762, 191, 0.03, 0.05, 'sine');
      air(t0, touchdown + 0.3, 5200, 900, 3.0, 0.05, 0.05);
      body(t0 + touchdown + 0.25, 0.35, 90, 50, 0.14);
      air(t0 + touchdown + 0.25, 0.5, 600, 200, 0.6, 0.05, 0.02, 'lowpass');
      break;
  }
  window.setTimeout(() => {
    out.disconnect();
    send.disconnect();
  }, 7000);
};

/** True when a sound would actually be heard (a gesture has unlocked audio and sound is on). */
export const sfxReady = () => !!ctx && !!sfx && enabled && ctx.state === 'running';

/**
 * The roar of hyperspace, held until the returned function is called with a
 * fade time in seconds. Null when it cannot be heard right now.
 */
export const warpHum = (): ((fade: number) => void) | null => {
  if (!sfxReady() || !ctx || !sfx) return null;
  const c = ctx;
  const t0 = c.currentTime + 0.01;
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, t0);
  out.gain.exponentialRampToValueAtTime(1, t0 + 0.8);
  out.connect(sfx);
  const stops: AudioScheduledSourceNode[] = [];

  // a low rumble through the hull
  const rumble = c.createBufferSource();
  rumble.buffer = whiteNoise(c);
  rumble.loop = true;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 170;
  const rg = c.createGain();
  rg.gain.value = 0.32;
  rumble.connect(lp).connect(rg).connect(out);
  stops.push(rumble);

  // the rush of the tunnel, swelling slowly
  const rush = c.createBufferSource();
  rush.buffer = whiteNoise(c);
  rush.loop = true;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const sweep = c.createOscillator();
  sweep.frequency.value = 0.23;
  const sweepDepth = c.createGain();
  sweepDepth.gain.value = 350;
  sweep.connect(sweepDepth).connect(bp.frequency);
  const bg = c.createGain();
  bg.gain.value = 0.05;
  rush.connect(bp).connect(bg).connect(out);
  stops.push(rush, sweep);

  // the drive: two detuned saws beating under a lowpass, with a slow throb
  const drive = c.createBiquadFilter();
  drive.type = 'lowpass';
  drive.frequency.value = 380;
  const dg = c.createGain();
  dg.gain.value = 0.045;
  const throb = c.createOscillator();
  throb.frequency.value = 5.5;
  const throbDepth = c.createGain();
  throbDepth.gain.value = 0.015;
  throb.connect(throbDepth).connect(dg.gain);
  drive.connect(dg).connect(out);
  for (const f of [55, 55.6, 110.4]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.connect(drive);
    stops.push(o);
  }
  stops.push(throb);
  for (const n of stops) {
    if (n instanceof AudioBufferSourceNode) n.start(t0, Math.random());
    else n.start(t0);
  }

  return (fade: number) => {
    const now = c.currentTime;
    out.gain.cancelScheduledValues(now);
    out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
    out.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, fade));
    for (const n of stops) n.stop(now + fade + 0.1);
    window.setTimeout(() => out.disconnect(), (fade + 0.3) * 1000);
  };
};
