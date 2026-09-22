/**
 * The realtime client: holds the WebSocket to the in-restaurant server and
 * turns the events it pushes into alarms and screen refreshes.
 *
 * This is the browser half of the two-stage alarm:
 *
 *   qr_order.created   -> reception rings   (the guest just ordered)
 *   order.confirmed    -> reception rings   (a website pre-order was paid)
 *   ticket.created     -> kitchen rings     (reception accepted it)
 *
 * The server decides who is subscribed to what (see wsHub.ts), so a kitchen
 * tablet never even receives the first two. This file only decides what a
 * received event sounds like.
 */
import { alarmEngine, type AlarmChannel } from "../alarm/soundEngine";

export type ServerChannel = "live_orders" | "website_orders" | "kitchen";

export interface RealtimeEvent {
  channel: ServerChannel;
  type: string;
  serverTime?: string;
  [key: string]: unknown;
}

export type ConnectionState = "connecting" | "connected" | "offline";

/**
 * Which incoming events are worth waking someone for. Everything else is a
 * state change that should refresh a board quietly — a ticket moving to
 * PREPARING must not make a noise, or the kitchen would ring all service.
 */
const ALARM_FOR: Record<string, AlarmChannel> = {
  "qr_order.created": "qr",
  "order.confirmed": "website",
  "ticket.created": "kitchen",
};

/** A stable identity for an event, so a reconnect replay does not re-ring. */
function eventKey(event: RealtimeEvent): string {
  const id =
    (event.ref as string) ??
    (event.id as string) ??
    ((event.ticket as { id?: string } | undefined)?.id ?? "");
  return `${event.type}:${id}`;
}

type EventListener = (event: RealtimeEvent) => void;
type StateListener = (state: ConnectionState) => void;

export class RealtimeClient {
  private socket: WebSocket | null = null;
  private token: string | null = null;
  private state: ConnectionState = "offline";
  private eventListeners = new Set<EventListener>();
  private stateListeners = new Set<StateListener>();
  private retry = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private closedByUs = false;

  /**
   * Events already seen. On reconnect the boards re-fetch their state, and a
   * server that replays anything must not set every alarm off again — a
   * kitchen tablet that drops wifi for ten seconds would otherwise come back
   * and scream about twelve orders the cooks are already working on.
   */
  private seen = new Set<string>();

  connect(token: string): void {
    this.token = token;
    this.closedByUs = false;
    this.open();
  }

  private open(): void {
    if (!this.token) return;
    this.setState(this.retry === 0 ? "connecting" : "connecting");

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws?token=${encodeURIComponent(this.token)}`;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.retry = 0;
      this.setState("connected");
    };

    this.socket.onmessage = (raw) => {
      let event: RealtimeEvent;
      try {
        event = JSON.parse(raw.data);
      } catch {
        return;
      }
      if (event.type === "connected") return; // the hub's greeting

      const key = eventKey(event);
      const isNew = !this.seen.has(key);
      if (isNew) this.seen.add(key);

      const channel = ALARM_FOR[event.type];
      if (channel && isNew) alarmEngine.ring(channel);

      for (const listener of this.eventListeners) listener(event);
    };

    this.socket.onclose = (ev) => {
      // 4401/4403 mean the session is no longer valid; retrying would just
      // hammer the server with a token that will never work again.
      if (this.closedByUs || ev.code === 4401 || ev.code === 4403) {
        this.setState("offline");
        return;
      }
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      try {
        this.socket?.close();
      } catch {
        /* already closing */
      }
    };
  }

  private scheduleReconnect(): void {
    this.setState("offline");
    if (this.reconnectTimer) return;
    // Back off to 15s, with jitter so a dozen terminals coming back after a
    // router reboot do not all reconnect on the same tick.
    const delay = Math.min(15000, 500 * 2 ** this.retry) * (0.75 + Math.random() * 0.5);
    this.retry += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
  }

  disconnect(): void {
    this.closedByUs = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    try {
      this.socket?.close();
    } catch {
      /* ignore */
    }
    this.socket = null;
    this.setState("offline");
  }

  onEvent(listener: EventListener): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onState(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  getState(): ConnectionState {
    return this.state;
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    for (const listener of this.stateListeners) listener(next);
  }
}

export const realtime = new RealtimeClient();
