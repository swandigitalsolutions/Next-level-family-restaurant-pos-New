/**
 * Tests for the alarm engine's decision logic — the parts that decide WHEN a
 * sound happens, which is where a silent failure would cost the restaurant an
 * order. Synthesis itself is not tested here; jsdom has no Web Audio, and
 * unlock() degrades to a no-op, which is exactly the path these exercise.
 */
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { AlarmEngine, DEFAULT_SETTINGS, loadSettings, saveSettings } from "./soundEngine";
import { TONES, getTone } from "./tones";

let engine: AlarmEngine;

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  engine = new AlarmEngine();
});

afterEach(() => {
  engine.acknowledgeAll();
  vi.useRealTimers();
});

describe("tone library", () => {
  test("every tone has a unique id, a name and at least one note", () => {
    const ids = TONES.map((t) => t.id);
    expect(new Set(ids).size).toBe(TONES.length);
    for (const tone of TONES) {
      expect(tone.name.length).toBeGreaterThan(0);
      expect(tone.notes.length).toBeGreaterThan(0);
      expect(tone.duration).toBeGreaterThan(0);
      for (const note of tone.notes) expect(note.partials.length).toBeGreaterThan(0);
    }
  });

  test("an unknown or missing tone id falls back rather than throwing", () => {
    expect(getTone("no-such-tone").id).toBe("soft-chime");
    expect(getTone(null).id).toBe("soft-chime");
    expect(getTone(undefined).id).toBe("soft-chime");
  });

  test("the three channels default to three different tones so they can be told apart", () => {
    const { qr, website, kitchen } = DEFAULT_SETTINGS.channels;
    expect(new Set([qr.tone, website.tone, kitchen.tone]).size).toBe(3);
  });
});

describe("settings persistence", () => {
  test("settings survive a reload", () => {
    engine.setChannel("qr", { tone: "alert-siren", volume: 0.5 });
    expect(loadSettings().channels.qr).toEqual({ tone: "alert-siren", volume: 0.5 });
  });

  test("corrupted stored settings fall back to defaults instead of breaking the POS", () => {
    localStorage.setItem("nlfr.alarm.settings.v1", "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  test("a stored tone that no longer exists falls back, keeping the alarm audible", () => {
    saveSettings({ ...DEFAULT_SETTINGS, channels: { ...DEFAULT_SETTINGS.channels, qr: { tone: "deleted" as never, volume: 0.9 } } });
    expect(loadSettings().channels.qr.tone).toBe("soft-chime");
    expect(loadSettings().channels.qr.volume).toBe(0.9);
  });

  test("an out-of-range volume is clamped, never trusted", () => {
    saveSettings({ ...DEFAULT_SETTINGS, channels: { ...DEFAULT_SETTINGS.channels, qr: { tone: "doorbell", volume: 99 } } });
    expect(loadSettings().channels.qr.volume).toBe(1);
  });
});

describe("repeat until acknowledged", () => {
  test("a ring stays pending until it is acknowledged", () => {
    engine.ring("qr");
    expect(engine.getPending()).toEqual(["qr"]);
    engine.acknowledge("qr");
    expect(engine.getPending()).toEqual([]);
  });

  test("ringing the same channel twice does not stack two repeat loops", () => {
    engine.ring("qr");
    engine.ring("qr");
    expect(engine.getPending()).toEqual(["qr"]);
  });

  test("two different channels ring independently", () => {
    engine.ring("qr");
    engine.ring("kitchen");
    expect(engine.getPending().sort()).toEqual(["kitchen", "qr"]);
    engine.acknowledge("qr");
    expect(engine.getPending()).toEqual(["kitchen"]);
  });

  test("it gives up after the stop-after window, so a forgotten tablet does not ring all night", () => {
    engine.update({ repeat: { enabled: true, intervalSeconds: 10, stopAfterSeconds: 60 } });
    engine.ring("qr");
    expect(engine.getPending()).toEqual(["qr"]);

    vi.advanceTimersByTime(59_000);
    expect(engine.getPending()).toEqual(["qr"]);

    vi.advanceTimersByTime(11_000);
    expect(engine.getPending()).toEqual([]);
  });

  test("with repeat off a ring does not become pending at all", () => {
    engine.update({ repeat: { ...DEFAULT_SETTINGS.repeat, enabled: false } });
    engine.ring("qr");
    expect(engine.getPending()).toEqual([]);
  });
});

describe("mute", () => {
  test("a muted engine does not start ringing", () => {
    engine.update({ muted: true });
    engine.ring("qr");
    expect(engine.getPending()).toEqual([]);
  });

  test("muting silences something already ringing, not just future alarms", () => {
    engine.ring("qr");
    expect(engine.getPending()).toEqual(["qr"]);
    engine.update({ muted: true });
    expect(engine.getPending()).toEqual([]);
  });
});

describe("subscribers", () => {
  test("listeners are notified when state changes and stop after unsubscribe", () => {
    const seen = vi.fn();
    const off = engine.subscribe(seen);
    engine.ring("qr");
    expect(seen).toHaveBeenCalled();

    off();
    const before = seen.mock.calls.length;
    engine.acknowledge("qr");
    expect(seen.mock.calls.length).toBe(before);
  });
});

describe("every tone is individually playable", () => {
  /**
   * jsdom has no Web Audio, so this validates the synthesis parameters rather
   * than the waveform: every partial must be a real, audible frequency with a
   * sane gain and duration. A tone with a 0Hz partial or a negative duration
   * would throw inside AudioContext at the exact moment an order arrives.
   */
  for (const tone of TONES) {
    test(`${tone.name} has sane, audible synthesis parameters`, () => {
      expect(tone.duration).toBeGreaterThan(0);
      expect(tone.duration).toBeLessThan(10); // nothing should ring for ten seconds
      expect(tone.urgency).toBeGreaterThanOrEqual(0);
      expect(tone.urgency).toBeLessThanOrEqual(1);
      expect(tone.description.length).toBeGreaterThan(10);

      let last = -1;
      for (const note of tone.notes) {
        expect(note.at).toBeGreaterThanOrEqual(0);
        expect(note.dur).toBeGreaterThan(0);
        // Notes are declared in playing order, which keeps them readable.
        expect(note.at).toBeGreaterThanOrEqual(last);
        last = note.at;
        // Every note must finish inside the declared duration, or the repeat
        // timer would fire over the tail of the previous ring.
        expect(note.at + note.dur).toBeLessThanOrEqual(tone.duration + 0.001);

        if (note.attack !== undefined) expect(note.attack).toBeGreaterThan(0);
        if (note.decay !== undefined) expect(note.decay).toBeGreaterThan(0);

        expect(note.partials.length).toBeGreaterThan(0);
        for (const p of note.partials) {
          // Human hearing, with margin: below ~20Hz is inaudible on a tablet
          // speaker and above ~18kHz is inaudible to most adults.
          expect(p.freq).toBeGreaterThan(20);
          expect(p.freq).toBeLessThan(18000);
          expect(p.gain).toBeGreaterThan(0);
          expect(p.gain).toBeLessThanOrEqual(1);
          if (p.sweepTo !== undefined) {
            expect(p.sweepTo).toBeGreaterThan(20);
            expect(p.sweepTo).toBeLessThan(18000);
          }
          if (p.type !== undefined) {
            expect(["sine", "square", "sawtooth", "triangle"]).toContain(p.type);
          }
        }
      }
    });
  }

  test("the eight tones are meaningfully different in urgency, calm to loud", () => {
    // The whole point of the library is that a cook and a cashier can pick
    // sounds that do not blur together.
    const urgencies = TONES.map((t) => t.urgency);
    expect(Math.min(...urgencies)).toBeLessThan(0.3);
    expect(Math.max(...urgencies)).toBeGreaterThan(0.8);
    expect(new Set(urgencies).size).toBeGreaterThanOrEqual(6);
  });

  test("there are at least eight tones to choose from", () => {
    expect(TONES.length).toBeGreaterThanOrEqual(8);
  });

  test("previewing any tone never throws, even with no audio device", async () => {
    for (const tone of TONES) {
      await expect(engine.preview(tone.id, 0.8)).resolves.toBeUndefined();
    }
  });

  test("testAll walks every channel without throwing", async () => {
    await expect(engine.testAll()).resolves.toBeUndefined();
  });
});
