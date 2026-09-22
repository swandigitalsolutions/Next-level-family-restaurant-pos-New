/**
 * The alarm engine: renders the tones in ./tones, holds the per-device
 * settings, and runs the repeat-until-acknowledged loop.
 *
 * Deliberately framework-free so it can be driven from a React hook, from the
 * settings sheet's preview buttons, or from a plain script. It is a singleton
 * because the browser permits only a handful of AudioContexts per page and
 * because two engines would ring over each other.
 *
 * Settings are per DEVICE, not per account. The kitchen tablet wants the
 * loudest tone in the set; the cashier's phone in a quiet dining room does
 * not. Both are used by staff who share logins across a shift, so storing
 * this against the user would give the wrong result on both screens.
 */
import { getTone, type Tone, type ToneId } from "./tones";

/** The three things that can demand attention, each with its own voice. */
export type AlarmChannel = "qr" | "website" | "kitchen";

export const ALARM_CHANNELS: AlarmChannel[] = ["qr", "website", "kitchen"];

export const CHANNEL_LABELS: Record<AlarmChannel, { title: string; hint: string }> = {
  qr: { title: "QR table orders", hint: "A guest at a table scanned the code and ordered" },
  website: { title: "Website orders", hint: "A pre-order was paid for online" },
  kitchen: { title: "Kitchen — new ticket", hint: "Reception accepted an order and the cooks need to start it" },
};

export interface ChannelSettings {
  tone: ToneId;
  /** 0..1 */
  volume: number;
}

export interface AlarmSettings {
  muted: boolean;
  channels: Record<AlarmChannel, ChannelSettings>;
  repeat: {
    enabled: boolean;
    /** Seconds between repeats while an alarm is unacknowledged. */
    intervalSeconds: number;
    /** Give up after this many seconds so a forgotten tablet does not ring all night. */
    stopAfterSeconds: number;
  };
}

/** Distinct voices by default, so the three channels are told apart by ear. */
export const DEFAULT_SETTINGS: AlarmSettings = {
  muted: false,
  channels: {
    qr: { tone: "doorbell", volume: 0.8 },
    website: { tone: "marimba", volume: 0.8 },
    kitchen: { tone: "kitchen-bell", volume: 1 },
  },
  repeat: { enabled: true, intervalSeconds: 20, stopAfterSeconds: 180 },
};

const STORAGE_KEY = "nlfr.alarm.settings.v1";

function clamp01(n: unknown, fallback: number): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback;
}

export function loadSettings(): AlarmSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    const merged = structuredClone(DEFAULT_SETTINGS);
    merged.muted = Boolean(parsed?.muted);
    for (const ch of ALARM_CHANNELS) {
      const incoming = parsed?.channels?.[ch];
      if (!incoming) continue;
      merged.channels[ch] = {
        tone: getTone(incoming.tone).id,
        volume: clamp01(incoming.volume, DEFAULT_SETTINGS.channels[ch].volume),
      };
    }
    if (parsed?.repeat) {
      merged.repeat = {
        enabled: Boolean(parsed.repeat.enabled),
        intervalSeconds: [10, 20, 30].includes(Number(parsed.repeat.intervalSeconds))
          ? Number(parsed.repeat.intervalSeconds)
          : DEFAULT_SETTINGS.repeat.intervalSeconds,
        stopAfterSeconds: [60, 180, 300].includes(Number(parsed.repeat.stopAfterSeconds))
          ? Number(parsed.repeat.stopAfterSeconds)
          : DEFAULT_SETTINGS.repeat.stopAfterSeconds,
      };
    }
    return merged;
  } catch {
    // A private window, cleared storage, or corrupted JSON must never stop the
    // POS from ringing — fall back to defaults rather than throwing.
    return structuredClone(DEFAULT_SETTINGS);
  }
}

export function saveSettings(settings: AlarmSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* storage unavailable — settings stay in memory for this session */
  }
}

type Listener = () => void;

export class AlarmEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private settings: AlarmSettings = loadSettings();
  private listeners = new Set<Listener>();

  /** Channels currently ringing and not yet acknowledged. */
  private pending = new Map<AlarmChannel, { since: number; timer: ReturnType<typeof setTimeout> | null }>();

  /* ── audio unlock ─────────────────────────────────────────────────────── */

  /**
   * Browsers refuse to produce sound until the user has interacted with the
   * page, and a tablet left on the kitchen wall overnight comes back locked.
   * Call this from a real click/tap.
   */
  async unlock(): Promise<boolean> {
    try {
      if (!this.ctx) {
        const Ctor = window.AudioContext || (window as any).webkitAudioContext;
        if (!Ctor) return false;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 1;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === "suspended") await this.ctx.resume();
      const ok = this.ctx.state === "running";
      if (ok) this.emit();
      return ok;
    } catch {
      return false;
    }
  }

  get isUnlocked(): boolean {
    return this.ctx?.state === "running";
  }

  /* ── settings ─────────────────────────────────────────────────────────── */

  getSettings(): AlarmSettings {
    return structuredClone(this.settings);
  }

  update(patch: Partial<AlarmSettings>): void {
    this.settings = { ...this.settings, ...patch, channels: { ...this.settings.channels, ...(patch.channels ?? {}) } };
    saveSettings(this.settings);
    // Muting must silence anything already ringing, not just future alarms.
    if (this.settings.muted) this.acknowledgeAll();
    this.emit();
  }

  setChannel(channel: AlarmChannel, patch: Partial<ChannelSettings>): void {
    this.settings.channels[channel] = { ...this.settings.channels[channel], ...patch };
    saveSettings(this.settings);
    this.emit();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  /* ── playback ─────────────────────────────────────────────────────────── */

  /** Play a tone once, ignoring mute. Used by the preview buttons. */
  async preview(toneId: ToneId, volume: number): Promise<void> {
    if (!(await this.unlock())) return;
    this.render(getTone(toneId), volume);
  }

  /** Play every channel's tone in turn, so a manager can check the volume. */
  async testAll(): Promise<void> {
    if (!(await this.unlock())) return;
    let offset = 0;
    for (const ch of ALARM_CHANNELS) {
      const cfg = this.settings.channels[ch];
      const tone = getTone(cfg.tone);
      setTimeout(() => this.render(tone, cfg.volume), offset * 1000);
      offset += tone.duration + 0.35;
    }
  }

  /**
   * Something needs attention on this channel. Plays immediately and, if
   * repeat is on, keeps playing until acknowledged or the give-up time passes.
   */
  ring(channel: AlarmChannel): void {
    if (this.settings.muted) return;
    const cfg = this.settings.channels[channel];
    void this.unlock().then((ok) => {
      if (!ok) return;
      this.render(getTone(cfg.tone), cfg.volume);
    });

    if (!this.settings.repeat.enabled) return;
    if (this.pending.has(channel)) return; // already ringing; don't stack timers
    const entry = { since: Date.now(), timer: null as ReturnType<typeof setTimeout> | null };
    this.pending.set(channel, entry);
    this.scheduleRepeat(channel);
    this.emit();
  }

  private scheduleRepeat(channel: AlarmChannel): void {
    const entry = this.pending.get(channel);
    if (!entry) return;
    const { intervalSeconds, stopAfterSeconds } = this.settings.repeat;
    entry.timer = setTimeout(() => {
      const current = this.pending.get(channel);
      if (!current) return;
      if (Date.now() - current.since >= stopAfterSeconds * 1000) {
        this.acknowledge(channel);
        return;
      }
      if (!this.settings.muted) {
        const cfg = this.settings.channels[channel];
        this.render(getTone(cfg.tone), cfg.volume);
      }
      this.scheduleRepeat(channel);
    }, intervalSeconds * 1000);
  }

  /** The staff member has seen it. Stop ringing this channel. */
  acknowledge(channel: AlarmChannel): void {
    const entry = this.pending.get(channel);
    if (entry?.timer) clearTimeout(entry.timer);
    this.pending.delete(channel);
    this.emit();
  }

  acknowledgeAll(): void {
    for (const ch of [...this.pending.keys()]) this.acknowledge(ch);
  }

  /** Channels currently ringing — drives the "tap to silence" bar. */
  getPending(): AlarmChannel[] {
    return [...this.pending.keys()];
  }

  /* ── synthesis ────────────────────────────────────────────────────────── */

  private render(tone: Tone, volume: number): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime + 0.02;

    for (const note of tone.notes) {
      const noteGain = ctx.createGain();
      noteGain.connect(master);

      const start = t0 + note.at;
      const attack = note.attack ?? 0.01;
      const decay = note.decay ?? 4;

      // Envelope: quick ramp up, then an exponential fall. exponentialRampTo
      // cannot reach exactly 0, hence the small floor before the hard stop.
      noteGain.gain.setValueAtTime(0.0001, start);
      noteGain.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume), start + attack);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, start + note.dur * (1 / Math.max(0.5, decay / 4)));
      noteGain.gain.setValueAtTime(0, start + note.dur);

      for (const partial of note.partials) {
        const osc = ctx.createOscillator();
        osc.type = partial.type ?? "sine";
        osc.frequency.setValueAtTime(partial.freq, start);
        if (partial.sweepTo) osc.frequency.linearRampToValueAtTime(partial.sweepTo, start + note.dur);

        const pGain = ctx.createGain();
        pGain.gain.value = partial.gain;
        osc.connect(pGain);
        pGain.connect(noteGain);

        osc.start(start);
        osc.stop(start + note.dur + 0.05);
        // Free the nodes once they have finished; a busy Friday would otherwise
        // accumulate thousands of dead oscillators on a long-lived tablet page.
        osc.onended = () => {
          try {
            osc.disconnect();
            pGain.disconnect();
          } catch {
            /* already torn down */
          }
        };
      }
    }
  }

  /** Test seam — lets a headless test drive the engine without Web Audio. */
  _setContextForTest(ctx: AudioContext | null, master: GainNode | null): void {
    this.ctx = ctx;
    this.master = master;
  }
}

export const alarmEngine = new AlarmEngine();
