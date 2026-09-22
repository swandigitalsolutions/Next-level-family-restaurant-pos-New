/**
 * The built-in alert tones, synthesised in the browser with the Web Audio API.
 *
 * Nothing here loads an audio file, on purpose. The POS runs on a Raspberry Pi
 * inside the restaurant and has to keep ringing when the internet is down, so a
 * tone that depends on fetching an mp3 — from a CDN or even from the Pi — is a
 * tone that can fail silently at exactly the wrong moment. Oscillators cost
 * nothing, start instantly, and cannot 404.
 *
 * Each tone is a declarative list of notes; each note is a stack of partials
 * (the harmonics that give an instrument its character) with an amplitude
 * envelope. The engine in ./soundEngine renders them.
 *
 * They are ordered calm -> urgent. That ordering is the point: the staff pick
 * a different tone per channel so they can tell, without looking up, whether
 * the sound they just heard was a table order, a website order, or food going
 * cold on the kitchen pass.
 */

export type ToneId =
  | "soft-chime"
  | "temple-bell"
  | "marimba"
  | "doorbell"
  | "two-tone"
  | "kitchen-bell"
  | "alert-siren"
  | "classic-beep";

export interface Partial {
  /** Frequency in Hz, or a multiple of the note's base when `ratio` is used. */
  freq: number;
  /** Peak gain of this partial, relative to the note. */
  gain: number;
  type?: OscillatorType;
  /** Sweep to this frequency across the note (sirens, doorbell fall). */
  sweepTo?: number;
}

export interface Note {
  /** Seconds after the tone starts. */
  at: number;
  /** Seconds the note rings for, including its decay. */
  dur: number;
  partials: Partial[];
  /** Attack in seconds. Short = percussive, longer = soft. */
  attack?: number;
  /** Exponential decay shape: higher = snappier. */
  decay?: number;
}

export interface Tone {
  id: ToneId;
  name: string;
  /** Shown under the name in the picker, so staff choose by behaviour. */
  description: string;
  notes: Note[];
  /** Total length in seconds — used to schedule repeats and previews. */
  duration: number;
  /**
   * A coarse 0-1 loudness/urgency rating, drawn as the waveform bars in the
   * picker so the list can be scanned visually as well as by ear.
   */
  urgency: number;
}

/** A bell-like stack: an inharmonic set of partials with a long decay. */
function bell(base: number, ratios: number[], gains: number[]): Partial[] {
  return ratios.map((r, i) => ({ freq: base * r, gain: gains[i] ?? 0.2, type: "sine" as OscillatorType }));
}

export const TONES: Tone[] = [
  {
    id: "soft-chime",
    name: "Soft Chime",
    description: "Two gentle notes. Good for a quiet dining room.",
    urgency: 0.2,
    duration: 1.5,
    notes: [
      { at: 0, dur: 1.1, attack: 0.012, decay: 3.2, partials: bell(880, [1, 2.01, 3.02], [0.5, 0.16, 0.07]) },
      { at: 0.18, dur: 1.2, attack: 0.012, decay: 3.2, partials: bell(1174.7, [1, 2.01, 2.99], [0.42, 0.13, 0.06]) },
    ],
  },
  {
    id: "temple-bell",
    name: "Temple Bell",
    description: "One deep strike with a long tail.",
    urgency: 0.3,
    duration: 3.2,
    notes: [
      {
        at: 0,
        dur: 3.0,
        attack: 0.006,
        decay: 1.7,
        // Inharmonic ratios are what make a bell sound like metal rather than
        // an organ — the partials deliberately do not land on the harmonic series.
        partials: bell(261.6, [1, 2.76, 5.4, 8.9], [0.55, 0.22, 0.12, 0.06]),
      },
    ],
  },
  {
    id: "marimba",
    name: "Marimba",
    description: "Warm wooden notes rising. Carries without being sharp.",
    urgency: 0.35,
    duration: 1.4,
    notes: [
      { at: 0, dur: 0.5, attack: 0.004, decay: 7, partials: bell(523.3, [1, 4.0], [0.6, 0.12]) },
      { at: 0.14, dur: 0.5, attack: 0.004, decay: 7, partials: bell(659.3, [1, 4.0], [0.6, 0.12]) },
      { at: 0.28, dur: 0.8, attack: 0.004, decay: 6, partials: bell(784, [1, 4.0], [0.65, 0.14]) },
    ],
  },
  {
    id: "doorbell",
    name: "Doorbell",
    description: "The familiar ding-dong. Instantly recognisable.",
    urgency: 0.45,
    duration: 1.9,
    notes: [
      { at: 0, dur: 0.75, attack: 0.008, decay: 4, partials: bell(659.3, [1, 2.0, 3.01], [0.55, 0.18, 0.07]) },
      { at: 0.42, dur: 1.25, attack: 0.008, decay: 3.2, partials: bell(523.3, [1, 2.0, 3.01], [0.55, 0.18, 0.07]) },
    ],
  },
  {
    id: "two-tone",
    name: "Two-Tone",
    description: "A clear back-and-forth pair. Cuts through chatter.",
    urgency: 0.55,
    duration: 1.6,
    notes: [
      { at: 0, dur: 0.32, attack: 0.006, decay: 6, partials: [{ freq: 987.8, gain: 0.5, type: "triangle" }] },
      { at: 0.3, dur: 0.32, attack: 0.006, decay: 6, partials: [{ freq: 739.99, gain: 0.5, type: "triangle" }] },
      { at: 0.6, dur: 0.32, attack: 0.006, decay: 6, partials: [{ freq: 987.8, gain: 0.5, type: "triangle" }] },
      { at: 0.9, dur: 0.5, attack: 0.006, decay: 5, partials: [{ freq: 739.99, gain: 0.5, type: "triangle" }] },
    ],
  },
  {
    id: "kitchen-bell",
    name: "Kitchen Bell",
    description: "The metal counter bell. Built to be heard over extractors.",
    urgency: 0.7,
    duration: 2.2,
    notes: [
      {
        at: 0,
        dur: 2.0,
        attack: 0.002,
        decay: 2.4,
        partials: bell(1318.5, [1, 2.4, 4.1, 6.8], [0.5, 0.26, 0.15, 0.08]),
      },
      {
        at: 0.32,
        dur: 1.6,
        attack: 0.002,
        decay: 2.6,
        partials: bell(1318.5, [1, 2.4, 4.1], [0.35, 0.18, 0.1]),
      },
    ],
  },
  {
    id: "alert-siren",
    name: "Alert Siren",
    description: "A rising sweep, repeated. Hard to ignore or sleep through.",
    urgency: 0.9,
    duration: 2.4,
    notes: [
      { at: 0, dur: 0.6, attack: 0.02, decay: 1.2, partials: [{ freq: 660, sweepTo: 1180, gain: 0.42, type: "sawtooth" }] },
      { at: 0.7, dur: 0.6, attack: 0.02, decay: 1.2, partials: [{ freq: 660, sweepTo: 1180, gain: 0.42, type: "sawtooth" }] },
      { at: 1.4, dur: 0.75, attack: 0.02, decay: 1.2, partials: [{ freq: 660, sweepTo: 1180, gain: 0.45, type: "sawtooth" }] },
    ],
  },
  {
    id: "classic-beep",
    name: "Classic Beep",
    description: "Three flat electronic beeps. Plain and unmistakable.",
    urgency: 0.75,
    duration: 1.3,
    notes: [
      { at: 0, dur: 0.16, attack: 0.003, decay: 10, partials: [{ freq: 1046.5, gain: 0.45, type: "square" }] },
      { at: 0.26, dur: 0.16, attack: 0.003, decay: 10, partials: [{ freq: 1046.5, gain: 0.45, type: "square" }] },
      { at: 0.52, dur: 0.3, attack: 0.003, decay: 8, partials: [{ freq: 1046.5, gain: 0.45, type: "square" }] },
    ],
  },
];

export const TONES_BY_ID: Record<ToneId, Tone> = Object.fromEntries(TONES.map((t) => [t.id, t])) as Record<ToneId, Tone>;

export function getTone(id: string | null | undefined): Tone {
  return (id && TONES_BY_ID[id as ToneId]) || TONES_BY_ID["soft-chime"];
}
