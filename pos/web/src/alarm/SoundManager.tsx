/**
 * The alert-sound manager.
 *
 * Bottom sheet on a phone, centred dialog from 720px up. Its promise, stated
 * in the subtitle because it is the whole reason the screen exists: staff
 * should be able to tell what just happened by ear, without looking up.
 *
 * Settings are per device. The kitchen tablet and the cashier's phone are
 * different rooms with different noise floors and want different answers.
 */
import { useId, useState } from "react";
import { ALARM_CHANNELS, CHANNEL_LABELS, type AlarmChannel } from "./soundEngine";
import { TONES, type ToneId } from "./tones";
import { useAlarm } from "./useAlarm";
import "./SoundManager.css";

/** A cheap static waveform so the list can be scanned by eye as well as by ear. */
function Waveform({ urgency }: { urgency: number }) {
  const bars = 14;
  return (
    <span className="sm-wave" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        // A decaying pluck for calm tones, a flatter sustained shape for urgent
        // ones — so the picture matches what the ear is about to hear.
        const decay = Math.exp(-i / (2 + urgency * 9));
        const height = 14 + decay * (10 + urgency * 60);
        return <i key={i} style={{ height: `${Math.round(height)}%` }} />;
      })}
    </span>
  );
}

function PlayIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  );
}

export interface SoundManagerProps {
  open: boolean;
  onClose: () => void;
}

export function SoundManager({ open, onClose }: SoundManagerProps) {
  const alarm = useAlarm();
  const [active, setActive] = useState<AlarmChannel>("qr");
  const titleId = useId();

  if (!open) return null;

  const channel = alarm.settings.channels[active];

  return (
    <div className="sm-backdrop" role="presentation" onClick={onClose}>
      <div
        className="sm-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="sm-head">
          <div>
            <h2 id={titleId}>Order sounds</h2>
            <p>Give each kind of order its own sound, so you know what arrived without looking.</p>
          </div>
          <button type="button" className="sm-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        {!alarm.unlocked && (
          <button type="button" className="sm-unlock" onClick={() => void alarm.unlock()}>
            <span className="sm-unlock-icon" aria-hidden="true">
              🔔
            </span>
            <span>
              <strong>Tap to enable order sounds</strong>
              <small>
                Phones and tablets stay silent until someone touches the screen. One tap now and this
                device will chime for the rest of the shift.
              </small>
            </span>
          </button>
        )}

        {alarm.settings.muted && (
          <p className="sm-muted-warning" role="status">
            <strong>All order sounds are muted on this device.</strong> New orders will arrive silently —
            someone must watch the screen.
          </p>
        )}

        {/* which channel is being configured */}
        <div className="sm-tabs" role="tablist" aria-label="Sound channel">
          {ALARM_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              role="tab"
              aria-selected={active === ch}
              className={active === ch ? "is-active" : ""}
              onClick={() => setActive(ch)}
            >
              {CHANNEL_LABELS[ch].title}
            </button>
          ))}
        </div>
        <p className="sm-channel-hint">{CHANNEL_LABELS[active].hint}</p>

        {/* tone library */}
        <ul className="sm-tones">
          {TONES.map((tone) => {
            const selected = channel.tone === tone.id;
            return (
              <li key={tone.id}>
                <label className={selected ? "sm-tone is-selected" : "sm-tone"}>
                  <input
                    type="radio"
                    name={`tone-${active}`}
                    checked={selected}
                    onChange={() => {
                      alarm.setChannel(active, { tone: tone.id as ToneId });
                      alarm.preview(tone.id as ToneId, channel.volume);
                    }}
                  />
                  <Waveform urgency={tone.urgency} />
                  <span className="sm-tone-text">
                    <strong>{tone.name}</strong>
                    <small>{tone.description}</small>
                  </span>
                  <button
                    type="button"
                    className="sm-play"
                    aria-label={`Preview ${tone.name}`}
                    onClick={(e) => {
                      e.preventDefault();
                      alarm.preview(tone.id as ToneId, channel.volume);
                    }}
                  >
                    <PlayIcon />
                  </button>
                </label>
              </li>
            );
          })}
        </ul>

        {/* volume */}
        <div className="sm-row">
          <label className="sm-label" htmlFor={`vol-${active}`}>
            Volume
            <span className="num">{Math.round(channel.volume * 100)}%</span>
          </label>
          <div className="sm-volume">
            <span aria-hidden="true">🔈</span>
            <input
              id={`vol-${active}`}
              type="range"
              min={0}
              max={100}
              value={Math.round(channel.volume * 100)}
              onChange={(e) => alarm.setChannel(active, { volume: Number(e.target.value) / 100 })}
              onPointerUp={() => alarm.preview(channel.tone, channel.volume)}
            />
            <span aria-hidden="true">🔊</span>
          </div>
        </div>

        {/* repeat until acknowledged */}
        <div className="sm-block">
          <label className="sm-toggle">
            <input
              type="checkbox"
              checked={alarm.settings.repeat.enabled}
              onChange={(e) => alarm.setRepeat({ enabled: e.target.checked })}
            />
            <span>
              <strong>Keep ringing until someone taps it</strong>
              <small>So an order cannot be missed during a rush.</small>
            </span>
          </label>

          {alarm.settings.repeat.enabled && (
            <div className="sm-repeat">
              <label>
                Repeat every
                <select
                  value={alarm.settings.repeat.intervalSeconds}
                  onChange={(e) => alarm.setRepeat({ intervalSeconds: Number(e.target.value) })}
                >
                  <option value={10}>10 seconds</option>
                  <option value={20}>20 seconds</option>
                  <option value={30}>30 seconds</option>
                </select>
              </label>
              <label>
                Give up after
                <select
                  value={alarm.settings.repeat.stopAfterSeconds}
                  onChange={(e) => alarm.setRepeat({ stopAfterSeconds: Number(e.target.value) })}
                >
                  <option value={60}>1 minute</option>
                  <option value={180}>3 minutes</option>
                  <option value={300}>5 minutes</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <footer className="sm-foot">
          <button type="button" className="sm-btn sm-btn-ghost" onClick={() => alarm.testAll()}>
            Test all sounds
          </button>
          <button
            type="button"
            className={alarm.settings.muted ? "sm-btn sm-btn-primary" : "sm-btn sm-btn-ghost"}
            onClick={() => alarm.setMuted(!alarm.settings.muted)}
          >
            {alarm.settings.muted ? "Unmute" : "Mute all"}
          </button>
          <button type="button" className="sm-btn sm-btn-primary" onClick={onClose}>
            Done
          </button>
        </footer>

        <p className="sm-scope">These settings apply to this device only.</p>
      </div>
    </div>
  );
}

/**
 * The persistent bar shown on every screen while something is ringing.
 * Tapping it is what "acknowledged" means.
 */
export function AlarmBar() {
  const alarm = useAlarm();
  if (alarm.pending.length === 0) return null;

  const label =
    alarm.pending.length === 1
      ? `${CHANNEL_LABELS[alarm.pending[0]].title} — waiting`
      : `${alarm.pending.length} alerts waiting`;

  return (
    <button type="button" className="sm-alarm-bar" onClick={() => alarm.acknowledgeAll()}>
      <span className="sm-alarm-dot" aria-hidden="true" />
      <span>{label}</span>
      <span className="sm-alarm-action">Tap to silence</span>
    </button>
  );
}
