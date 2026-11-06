/*
 * One music track per planet, written for how the planet looks, played by a
 * small step sequencer on synthesised instruments. Orbit keeps the ambient
 * pad in drone.ts; landing swaps it for the planet's track.
 *
 *   about     desert dunes at sunset: fingerpicked folk, a shaker, a warm drone
 *   projects  gas giant at night, jellyfish drifting: arpeggiated synths, sub bass, echoes
 *   awards    molten world: slow brass swells, taiko, bells in a bright Lydian key
 */

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** A chord for one bar: semitones above the key root, and its tones above the chord root */
interface Bar {
  root: number;
  tones: number[];
}

interface Ctx {
  c: BaseAudioContext;
  out: AudioNode;
  /** Echo send (tempo-synced delay into the hall) */
  echo: AudioNode;
  /** Hall send */
  verb: AudioNode;
  noise: AudioBuffer;
}

interface Step {
  /** Absolute step index since the track started (16 per bar) */
  i: number;
  /** Step inside the bar, 0..15 */
  s: number;
  /** Bar index inside the progression */
  bar: number;
  /** Bar index since the start */
  barCount: number;
  at: number;
  /** Seconds per step */
  dur: number;
  chord: Bar;
  /** MIDI note of the key root around C3 */
  key: number;
}

export interface Track {
  bpm: number;
  /** Key root as a MIDI note (around C3) */
  key: number;
  bars: Bar[];
  /** Echo time in steps (sixteenths) and feedback */
  echo: [number, number];
  play: (x: Ctx, st: Step) => void;
}

const MAJ = [0, 4, 7];
const MIN = [0, 3, 7];

/* ---------- instruments ---------- */

const env = (x: Ctx, at: number, peak: number, attack: number, decay: number, dest: AudioNode) => {
  const g = x.c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(peak, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
  g.connect(dest);
  return g;
};

const osc = (x: Ctx, type: OscillatorType, f: number, at: number, len: number, dest: AudioNode, detune = 0) => {
  const o = x.c.createOscillator();
  o.type = type;
  o.frequency.value = f;
  o.detune.value = detune;
  o.connect(dest);
  o.start(at);
  o.stop(at + len + 0.05);
  return o;
};

const sends = (x: Ctx, node: AudioNode, echo: number, verb: number) => {
  if (echo > 0) {
    const g = x.c.createGain();
    g.gain.value = echo;
    node.connect(g).connect(x.echo);
  }
  if (verb > 0) {
    const g = x.c.createGain();
    g.gain.value = verb;
    node.connect(g).connect(x.verb);
  }
};

/** Plucked string: bright saw and triangle through a lowpass that closes fast. */
const pluck = (x: Ctx, midi: number, at: number, vel: number, decay = 1.4, echo = 0.15) => {
  const lp = x.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1.2;
  lp.frequency.setValueAtTime(Math.min(9000, hz(midi) * 9), at);
  lp.frequency.exponentialRampToValueAtTime(hz(midi) * 1.6, at + 0.35);
  const g = env(x, at, 0.22 * vel, 0.004, decay, x.out);
  lp.connect(g);
  osc(x, 'sawtooth', hz(midi), at, decay, lp, -4);
  osc(x, 'triangle', hz(midi), at, decay, lp, 5);
  sends(x, g, echo, 0.25);
};

/** Kalimba or bell: sine with an inharmonic overtone that dies first. */
const mallet = (x: Ctx, midi: number, at: number, vel: number, decay = 1.8, echo = 0.3, bright = 0.35) => {
  const g = env(x, at, 0.16 * vel, 0.003, decay, x.out);
  osc(x, 'sine', hz(midi), at, decay, g);
  const og = env(x, at, 0.16 * vel * bright, 0.002, decay * 0.25, x.out);
  osc(x, 'sine', hz(midi) * 2.76, at, decay * 0.3, og);
  sends(x, g, echo, 0.45);
};

/** Synth pluck for arpeggios: saw through a resonant lowpass with a snappy envelope. */
const arp = (x: Ctx, midi: number, at: number, vel: number, cutoff: number) => {
  const lp = x.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 6;
  lp.frequency.setValueAtTime(cutoff, at);
  lp.frequency.exponentialRampToValueAtTime(260, at + 0.22);
  const g = env(x, at, 0.1 * vel, 0.003, 0.32, x.out);
  lp.connect(g);
  osc(x, 'sawtooth', hz(midi), at, 0.35, lp, -6);
  osc(x, 'sawtooth', hz(midi), at, 0.35, lp, 6);
  sends(x, g, 0.55, 0.25);
};

/** Round sub bass. */
const sub = (x: Ctx, midi: number, at: number, len: number, vel: number) => {
  const g = env(x, at, 0.32 * vel, 0.01, len, x.out);
  osc(x, 'sine', hz(midi), at, len, g);
  const h = env(x, at, 0.05 * vel, 0.01, len * 0.6, x.out);
  osc(x, 'triangle', hz(midi + 12), at, len, h);
};

/** Sustained chord: detuned saws through a lowpass, slow attack and release. */
const pad = (x: Ctx, notes: number[], at: number, len: number, level: number, cutoff: number, attack = 0.8) => {
  const lp = x.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  lp.Q.value = 0.5;
  const g = x.c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + attack);
  g.gain.setValueAtTime(level, at + len - 0.4);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len + 1.2);
  lp.connect(g).connect(x.out);
  for (const n of notes) for (const d of [-8, 7]) osc(x, 'sawtooth', hz(n), at, len + 1.2, lp, d);
  sends(x, g, 0, 0.6);
};

/** Brass swell: saw stack whose filter opens as it swells, a little vibrato late in the note. */
const brass = (x: Ctx, notes: number[], at: number, len: number, level: number) => {
  const lp = x.c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 1;
  lp.frequency.setValueAtTime(300, at);
  lp.frequency.exponentialRampToValueAtTime(2200, at + 0.45);
  lp.frequency.exponentialRampToValueAtTime(900, at + len);
  const g = x.c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(level, at + 0.35);
  g.gain.setValueAtTime(level * 0.8, at + len - 0.3);
  g.gain.exponentialRampToValueAtTime(0.0001, at + len + 0.6);
  lp.connect(g).connect(x.out);
  for (const n of notes) for (const d of [-9, 0, 9]) osc(x, 'sawtooth', hz(n), at, len + 0.6, lp, d);
  sends(x, g, 0.1, 0.7);
};

const noiseHit = (x: Ctx, at: number, level: number, f: number, q: number, decay: number, type: BiquadFilterType, verb = 0.2) => {
  const src = x.c.createBufferSource();
  src.buffer = x.noise;
  const bp = x.c.createBiquadFilter();
  bp.type = type;
  bp.frequency.value = f;
  bp.Q.value = q;
  const g = env(x, at, level, 0.002, decay, x.out);
  src.connect(bp).connect(g);
  src.start(at, Math.random() * 1.5);
  src.stop(at + decay + 0.05);
  sends(x, g, 0, verb);
};

/** Soft kick: a sine that drops in pitch. */
const kick = (x: Ctx, at: number, vel: number) => {
  const o = x.c.createOscillator();
  o.frequency.setValueAtTime(130, at);
  o.frequency.exponentialRampToValueAtTime(42, at + 0.14);
  const g = env(x, at, 0.45 * vel, 0.003, 0.35, x.out);
  o.connect(g);
  o.start(at);
  o.stop(at + 0.4);
};

/** Taiko: a deep pitched body and the skin's slap. */
const taiko = (x: Ctx, at: number, vel: number) => {
  const o = x.c.createOscillator();
  o.frequency.setValueAtTime(95, at);
  o.frequency.exponentialRampToValueAtTime(52, at + 0.4);
  const g = env(x, at, 0.5 * vel, 0.004, 0.9, x.out);
  o.connect(g);
  o.start(at);
  o.stop(at + 1);
  sends(x, g, 0, 0.5);
  noiseHit(x, at, 0.08 * vel, 700, 0.8, 0.12, 'bandpass', 0.4);
};

/* ---------- helpers ---------- */

/** Chord tone k (0 = root, wrapping up octaves) at or above `floor` */
const tone = (st: Step, k: number, floor: number) => {
  const t = st.chord.tones;
  const n = t.length;
  const oct = Math.floor(k / n);
  const base = st.key + st.chord.root + t[((k % n) + n) % n] + 12 * oct;
  let m = base;
  while (m < floor) m += 12;
  return m;
};
const bassNote = (st: Step) => st.key - 12 + st.chord.root - (st.chord.root > 6 ? 12 : 0);
const chordNotes = (st: Step, floor: number) => st.chord.tones.map((_, k) => tone(st, k, floor)).sort((a, b) => a - b);
/** Gentle timing and level humanising */
const human = (seed: number) => {
  const r = Math.sin(seed * 12.9898) * 43758.5453;
  return r - Math.floor(r);
};

/* ---------- the tracks ---------- */

/** About: F major, a sunset over dunes. Mixolydian turns (the flat seventh) for a dusty, open feel. */
const ABOUT: Track = {
  bpm: 84,
  key: 53,
  echo: [3, 0.28],
  bars: [
    { root: 0, tones: MAJ },
    { root: 10, tones: MAJ },
    { root: 5, tones: MAJ },
    { root: 0, tones: MAJ },
    { root: 9, tones: MIN },
    { root: 5, tones: MAJ },
    { root: 10, tones: MAJ },
    { root: 7, tones: [0, 5, 7] },
  ],
  play: (x, st) => {
    const { s, at, dur } = st;
    const sw = s % 2 ? dur * 0.12 : 0;
    // a warm drone under each bar
    if (s === 0) pad(x, [st.key - 12 + st.chord.root % 12, ...chordNotes(st, st.key + 7)], at, dur * 16, 0.03, 900, 1.4);
    // fingerpicking: thumb on the beats, fingers rolling over the chord
    if (s % 4 === 0) pluck(x, bassNote(st) + (s === 8 ? 7 : 0), at, 0.9, 1.6, 0.05);
    const roll = [0, -1, 2, 1, 3, 2, 1, 2][(s >> 1) % 8];
    if (s % 2 === 1 || s === 2 || s === 10) pluck(x, tone(st, roll + 2, st.key + 12), at + sw, 0.55 + human(st.i) * 0.25, 1.2, 0.18);
    // shaker on the off sixteenths, accented on the and
    if (s % 2 === 1 || s % 4 === 2) noiseHit(x, at + sw, s % 4 === 2 ? 0.05 : 0.025, 6500, 0.9, 0.06, 'bandpass', 0.1);
    // a kalimba phrase every other bar, answering the guitar
    if (st.barCount % 2 === 1 && (s === 4 || s === 6 || s === 7 || s === 12)) {
      const k = s === 4 ? 4 : s === 6 ? 3 : s === 7 ? 2 : 1;
      mallet(x, tone(st, k + 3, st.key + 24), at + sw, 0.7, 2.2, 0.35, 0.3);
    }
  },
};

/** Projects: C# minor, a night sky over a gas giant. Pulsing arpeggios, a sub that breathes, long echoes. */
const PROJECTS: Track = {
  bpm: 100,
  key: 49,
  echo: [3, 0.42],
  bars: [
    { root: 0, tones: [0, 3, 7, 10] },
    { root: 8, tones: [0, 4, 7, 11] },
    { root: 3, tones: [0, 4, 7, 11] },
    { root: 10, tones: [0, 4, 7, 9] },
    { root: 0, tones: [0, 3, 7, 10] },
    { root: 8, tones: [0, 4, 7, 11] },
    { root: 5, tones: [0, 3, 7, 10] },
    { root: 7, tones: [0, 5, 7, 10] },
  ],
  play: (x, st) => {
    const { s, at, dur } = st;
    // the filter of the arpeggio breathes over two bars
    const breath = 0.5 - 0.5 * Math.cos(((st.barCount % 2) * 16 + s) / 32 * Math.PI * 2);
    if (s === 0) pad(x, chordNotes(st, st.key + 7), at, dur * 16, 0.022, 1400, 2.2);
    // sixteenth arpeggio up and down the chord over two octaves
    const shape = [0, 1, 2, 3, 4, 3, 2, 1, 0, 2, 4, 5, 6, 5, 4, 2][s];
    arp(x, tone(st, shape, st.key + 12), at, s % 4 === 0 ? 1 : 0.6, 900 + breath * 2600);
    // sub bass pulsing on the eighths, ducked off the beat like a pump
    if (s % 2 === 0) sub(x, bassNote(st), at, dur * 1.7, s % 4 === 0 ? 0.7 : 1);
    // a soft kick on the beats, a light tick between
    if (s % 4 === 0) kick(x, at, s === 0 ? 1 : 0.7);
    if (s % 4 === 2) noiseHit(x, at, 0.03, 9000, 0.7, 0.04, 'highpass', 0.05);
    // a glassy lead every fourth bar, drifting like the jellyfish
    if (st.barCount % 4 === 3 && (s === 0 || s === 6 || s === 10)) mallet(x, tone(st, s === 0 ? 3 : s === 6 ? 2 : 4, st.key + 24), at, 0.6, 2.8, 0.6, 0.15);
  },
};

/** Awards: E major with a raised fourth, a world of fire. Brass, taiko, bells; slow and proud. */
const AWARDS: Track = {
  bpm: 72,
  key: 52,
  echo: [6, 0.3],
  bars: [
    { root: 0, tones: MAJ },
    { root: 2, tones: MAJ },
    { root: 0, tones: MAJ },
    { root: 2, tones: MAJ },
    { root: 9, tones: MIN },
    { root: 5, tones: MAJ },
    { root: 7, tones: MAJ },
    { root: 7, tones: [0, 5, 7] },
  ],
  play: (x, st) => {
    const { s, at, dur } = st;
    if (s === 0) brass(x, chordNotes(st, st.key), at, dur * 15, 0.028);
    if (s === 0) sub(x, bassNote(st), at, dur * 14, 0.8);
    // taiko: a heartbeat with a pickup into each bar
    const hits: Record<number, number> = { 0: 1, 6: 0.55, 8: 0.85, 14: 0.4, 15: 0.5 };
    if (hits[s]) taiko(x, at, hits[s]);
    // embers: quiet crackle
    if (human(st.i * 3.1) > 0.82) noiseHit(x, at + dur * human(st.i), 0.02, 3000, 3, 0.03, 'bandpass', 0.15);
    // a bell melody that climbs through the bar, brightest on the raised fourth
    const tune: Record<number, number> = { 0: 2, 4: 3, 8: 4, 10: 5, 12: 4 };
    if (st.barCount % 2 === 0 && tune[s] !== undefined) mallet(x, tone(st, tune[s], st.key + 19), at, 0.75, 3, 0.45, 0.5);
  },
};

export const TRACKS: Record<string, Track> = { about: ABOUT, projects: PROJECTS, awards: AWARDS };

/* ---------- the sequencer ---------- */

export interface Sequencer {
  /** Schedules every step that starts before `until` (seconds, context time) */
  fill: (until: number) => void;
  stop: (fade: number) => void;
  out: GainNode;
}

/** A tempo-synced echo with a dark feedback loop. */
const makeEcho = (c: BaseAudioContext, seconds: number, feedback: number, dest: AudioNode) => {
  const input = c.createGain();
  const d = c.createDelay(2);
  d.delayTime.value = seconds;
  const fb = c.createGain();
  fb.gain.value = feedback;
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  input.connect(d);
  d.connect(lp).connect(fb).connect(d);
  lp.connect(dest);
  return input;
};

export const startTrack = (
  c: BaseAudioContext,
  track: Track,
  dest: AudioNode,
  verb: AudioNode,
  noise: AudioBuffer,
  at: number,
  fadeIn: number,
): Sequencer => {
  const out = c.createGain();
  out.gain.setValueAtTime(0.0001, at);
  out.gain.exponentialRampToValueAtTime(1, at + fadeIn);
  out.connect(dest);
  const verbSend = c.createGain();
  verbSend.connect(verb);
  const dur = 60 / track.bpm / 4;
  const echo = makeEcho(c, dur * track.echo[0], track.echo[1], out);
  const x: Ctx = { c, out, echo, verb: verbSend, noise };
  let i = 0;
  let stopped = false;
  return {
    out,
    fill: (until) => {
      while (!stopped) {
        const t = at + i * dur;
        if (t >= until) break;
        // steps the clock already passed (a suspended tab) are skipped, not played in a burst
        if (c instanceof AudioContext && t < c.currentTime - 0.05) {
          i += 1;
          continue;
        }
        const barCount = Math.floor(i / 16);
        const bar = barCount % track.bars.length;
        track.play(x, { i, s: i % 16, bar, barCount, at: t, dur, chord: track.bars[bar], key: track.key });
        i += 1;
      }
    },
    stop: (fade) => {
      stopped = true;
      const now = c.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + fade);
      verbSend.gain.setTargetAtTime(0, now, fade / 3);
      window.setTimeout(() => {
        out.disconnect();
        verbSend.disconnect();
      }, fade * 1000 + 4000);
    },
  };
};
