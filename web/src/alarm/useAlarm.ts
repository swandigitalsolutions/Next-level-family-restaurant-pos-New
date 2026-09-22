/**
 * React bindings for the alarm engine.
 *
 * The engine itself is a framework-free singleton (see ./soundEngine); this
 * file only subscribes React to it. Keeping the split means the settings sheet,
 * the "tap to silence" bar and the realtime client all read the same state
 * without prop-drilling an engine instance through the tree.
 */
import { useCallback, useEffect, useState } from "react";
import {
  alarmEngine,
  type AlarmChannel,
  type AlarmSettings,
  type ChannelSettings,
} from "./soundEngine";
import type { ToneId } from "./tones";

export interface UseAlarm {
  settings: AlarmSettings;
  /** Channels ringing right now and not yet acknowledged. */
  pending: AlarmChannel[];
  /** False until the browser has let us make a sound on this device. */
  unlocked: boolean;

  unlock: () => Promise<boolean>;
  preview: (tone: ToneId, volume: number) => void;
  testAll: () => void;
  setChannel: (channel: AlarmChannel, patch: Partial<ChannelSettings>) => void;
  setMuted: (muted: boolean) => void;
  setRepeat: (patch: Partial<AlarmSettings["repeat"]>) => void;
  acknowledge: (channel: AlarmChannel) => void;
  acknowledgeAll: () => void;
}

export function useAlarm(): UseAlarm {
  const [settings, setSettings] = useState<AlarmSettings>(() => alarmEngine.getSettings());
  const [pending, setPending] = useState<AlarmChannel[]>(() => alarmEngine.getPending());
  const [unlocked, setUnlocked] = useState<boolean>(() => alarmEngine.isUnlocked);

  useEffect(() => {
    const sync = () => {
      setSettings(alarmEngine.getSettings());
      setPending(alarmEngine.getPending());
      setUnlocked(alarmEngine.isUnlocked);
    };
    sync();
    return alarmEngine.subscribe(sync);
  }, []);

  const unlock = useCallback(async () => {
    const ok = await alarmEngine.unlock();
    setUnlocked(ok);
    return ok;
  }, []);

  return {
    settings,
    pending,
    unlocked,
    unlock,
    preview: useCallback((tone: ToneId, volume: number) => void alarmEngine.preview(tone, volume), []),
    testAll: useCallback(() => void alarmEngine.testAll(), []),
    setChannel: useCallback((channel: AlarmChannel, patch: Partial<ChannelSettings>) => {
      alarmEngine.setChannel(channel, patch);
    }, []),
    setMuted: useCallback((muted: boolean) => alarmEngine.update({ muted }), []),
    setRepeat: useCallback((patch: Partial<AlarmSettings["repeat"]>) => {
      alarmEngine.update({ repeat: { ...alarmEngine.getSettings().repeat, ...patch } });
    }, []),
    acknowledge: useCallback((channel: AlarmChannel) => alarmEngine.acknowledge(channel), []),
    acknowledgeAll: useCallback(() => alarmEngine.acknowledgeAll(), []),
  };
}

/**
 * Unlock audio on the first real user gesture anywhere in the app.
 *
 * Browsers block sound until someone touches the page, and a kitchen tablet
 * that has been sitting on a wall since this morning comes back locked. Rather
 * than making staff hunt for a settings screen, we take the first tap they make
 * for any reason and use it. The explicit "Tap to enable order sounds" card
 * stays as the visible fallback for a screen nobody has touched yet.
 */
export function useAudioUnlockOnFirstGesture(): void {
  useEffect(() => {
    if (alarmEngine.isUnlocked) return;
    const handler = () => void alarmEngine.unlock();
    const opts = { once: true, passive: true } as const;
    window.addEventListener("pointerdown", handler, opts);
    window.addEventListener("keydown", handler, opts);
    return () => {
      window.removeEventListener("pointerdown", handler);
      window.removeEventListener("keydown", handler);
    };
  }, []);
}
