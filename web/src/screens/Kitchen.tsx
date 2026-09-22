/**
 * The kitchen display.
 *
 * Designed for its environment, not for a phone: a tablet or monitor on a
 * wall, read from one to two metres, in steam and glare, by cooks who glance
 * at it between tasks and may have wet hands.
 *
 * Two rules are absolute here:
 *   1. NO MONEY. No price, no total, no payment state. The server does not
 *      even send it (see the alarm-chain test that asserts this), and there is
 *      nowhere on this screen it could go.
 *   2. Oldest first. The opposite of every other board — the oldest ticket is
 *      the most urgent, because someone has been waiting for it longest.
 *
 * The whole card is the button. A cook advances a ticket by hitting a large
 * target, not by finding a small one.
 */
import { useCallback, useState } from "react";
import { useQuery, useTicker, useAction } from "../lib/useQuery";
import { useRealtime, useSession } from "../lib/session";
import { callable } from "../lib/api";
import { elapsed, minutesSince } from "../lib/format";
import { useAlarm, useAudioUnlockOnFirstGesture } from "../alarm/useAlarm";
import { SoundManager } from "../alarm/SoundManager";
import { EmptyState, ErrorNote, Spinner } from "../components/ui";
import type { KitchenTicket, TicketStatus } from "../lib/types";
import "./Kitchen.css";

const NEXT: Record<TicketStatus, TicketStatus | null> = {
  QUEUED: "PREPARING",
  PREPARING: "READY",
  READY: "DONE",
  DONE: null,
};

const ACTION_LABEL: Record<TicketStatus, string> = {
  QUEUED: "Start cooking",
  PREPARING: "Mark ready",
  READY: "Hand over",
  DONE: "Done",
};

/** Ageing thresholds, in minutes. Tuned to a dhaba kitchen's own sense of late. */
function ageClass(createdAt: string | null, now: number): string {
  const mins = minutesSince(createdAt, now);
  if (mins >= 15) return "is-late";
  if (mins >= 8) return "is-ageing";
  return "is-fresh";
}

export function KitchenScreen() {
  const { signOut, connection } = useSession();
  const { data, error, initial, reload } = useQuery<{ tickets: KitchenTicket[] }>("queries", "listKitchenTickets", { scope: "open" });
  const now = useTicker(1000);
  const action = useAction();
  const alarm = useAlarm();
  const [soundOpen, setSoundOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  useAudioUnlockOnFirstGesture();

  // A new ticket refreshes the board and flashes the screen edge — a cook may
  // be across the room with their back to it, where a sound alone is not enough.
  useRealtime(
    useCallback(
      (event) => {
        reload();
        if (event.type === "ticket.created") {
          setFlash(true);
          setTimeout(() => setFlash(false), 2500);
        }
      },
      [reload],
    ),
  );

  const tickets = data?.tickets ?? [];
  const counts = {
    QUEUED: tickets.filter((t) => t.status === "QUEUED").length,
    PREPARING: tickets.filter((t) => t.status === "PREPARING").length,
    READY: tickets.filter((t) => t.status === "READY").length,
  };

  async function advance(ticket: KitchenTicket) {
    const next = NEXT[ticket.status];
    if (!next) return;
    alarm.acknowledgeAll(); // touching the board is acknowledgement
    await action.run(() => callable("kitchen", "setKitchenTicketStatus", { id: ticket.id, status: next }));
    reload();
  }

  return (
    <div className={`kds theme-kitchen${flash ? " is-flashing" : ""}`}>
      <header className="kds-top">
        <div className="kds-counts">
          <span className="kds-count is-queued">
            <em className="num">{counts.QUEUED}</em> queued
          </span>
          <span className="kds-count is-prep">
            <em className="num">{counts.PREPARING}</em> cooking
          </span>
          <span className="kds-count is-ready">
            <em className="num">{counts.READY}</em> ready
          </span>
        </div>

        <span className="kds-clock num">
          {new Date(now).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true })}
        </span>

        {connection !== "connected" && <span className="kds-offline">Reconnecting…</span>}

        <button
          type="button"
          className={alarm.settings.muted ? "kds-sound is-muted" : "kds-sound"}
          onClick={() => setSoundOpen(true)}
        >
          {alarm.settings.muted ? "🔕 Sound off" : "🔔 Sound on"}
        </button>

        <button type="button" className="kds-out" onClick={signOut}>
          Sign out
        </button>
      </header>

      {alarm.settings.muted && (
        <p className="kds-muted-warning" role="status">
          Sound is OFF — new tickets will arrive silently. Someone must watch this screen.
        </p>
      )}

      {action.error && <ErrorNote message={action.error} />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading tickets" />
      ) : tickets.length === 0 ? (
        <EmptyState icon="🍵" title="No tickets" hint="Nothing to cook right now. Orders appear here the moment reception accepts them." />
      ) : (
        <div className="kds-grid">
          {tickets.map((ticket) => {
            const next = NEXT[ticket.status];
            return (
              <button
                key={ticket.id}
                type="button"
                className={`kds-ticket ${ageClass(ticket.created_at, now)} is-${ticket.status.toLowerCase()}`}
                onClick={() => advance(ticket)}
                disabled={!next || action.busy}
              >
                <span className="kds-ticket-head">
                  <span className="kds-ticket-where">
                    {ticket.source === "website" ? "WEBSITE PICKUP" : ticket.table_label ? `TABLE ${ticket.table_label}` : "COUNTER"}
                  </span>
                  <span className="kds-ticket-age num">{elapsed(ticket.created_at, now)}</span>
                </span>

                <span className="kds-ticket-ref">{ticket.ref}</span>

                <ul className="kds-items">
                  {ticket.items.map((item, i) => (
                    <li key={`${item.name}-${i}`}>
                      <span className="kds-qty num">{item.qty}</span>
                      <span className="kds-name">{item.name}</span>
                      {item.note && <span className="kds-note">{item.note}</span>}
                    </li>
                  ))}
                </ul>

                {ticket.note && <span className="kds-ticket-note">{ticket.note}</span>}

                <span className="kds-ticket-action">{ACTION_LABEL[ticket.status]}</span>
              </button>
            );
          })}
        </div>
      )}

      <SoundManager open={soundOpen} onClose={() => setSoundOpen(false)} />
    </div>
  );
}
