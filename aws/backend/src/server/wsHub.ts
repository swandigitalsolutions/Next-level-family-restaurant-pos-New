/**
 * In-process WebSocket hub — the self-hosted replacement for the API Gateway
 * WebSocket API plus the `ws_connections` table.
 *
 * On AWS, a broadcast had to be persisted and fanned out across many Lambda
 * containers, so connections lived in Postgres. Here the whole POS is one Node
 * process on one Raspberry Pi, so connections live in memory: no table, no
 * round-trip, and a dead connection is noticed directly rather than lazily
 * pruned on a 410.
 *
 * WHO HEARS WHAT — this is the alarm chain the restaurant actually runs on:
 *
 *   guest places a QR / website order
 *        -> broadcast("live_orders" | "website_orders")
 *        -> RECEPTION terminals ring          (roles: billing, manager, admin)
 *
 *   reception presses "Accept to Kitchen"
 *        -> broadcast("kitchen", ticket.created)
 *        -> KITCHEN screen rings             (roles: kitchen, manager, admin)
 *
 * A cook is never subscribed to `live_orders`, so the kitchen cannot ring for
 * an order nobody has accepted yet — the separation is enforced here on the
 * server, not by the browser choosing to ignore a message.
 */
import type { WebSocket } from "ws";
import type { Role } from "../lib/config";
import type { BroadcastChannel } from "../lib/broadcastClient";

/** Which realtime channels each role is allowed to receive. */
const CHANNELS_BY_ROLE: Record<Role, BroadcastChannel[]> = {
  admin: ["live_orders", "website_orders", "kitchen"],
  manager: ["live_orders", "website_orders", "kitchen"],
  billing: ["live_orders", "website_orders"],
  kitchen: ["kitchen"],
  // The cafe till has no order feed — walk-up trade only, no tickets.
  cafe_billing: [],
  // Strictly view-only. The owner watches the dashboard; they are not an
  // operator and must never be pulled into an operational alarm.
  owner: [],
};

export function channelsForRole(role: Role): BroadcastChannel[] {
  return CHANNELS_BY_ROLE[role] ?? [];
}

interface Client {
  socket: WebSocket;
  uid: string;
  role: Role;
  channels: Set<BroadcastChannel>;
  alive: boolean;
}

export class RealtimeHub {
  private clients = new Set<Client>();
  private heartbeat: NodeJS.Timeout | null = null;

  /** Register an authenticated socket. Returns an unsubscribe function. */
  add(socket: WebSocket, uid: string, role: Role): () => void {
    const client: Client = { socket, uid, role, channels: new Set(channelsForRole(role)), alive: true };
    this.clients.add(client);

    socket.on("pong", () => {
      client.alive = true;
    });
    const drop = () => this.clients.delete(client);
    socket.on("close", drop);
    socket.on("error", drop);

    this.send(client, {
      type: "connected",
      role,
      channels: [...client.channels],
      serverTime: new Date().toISOString(),
    });

    return drop;
  }

  /** The sink installed into lib/broadcastClient. */
  publish = (channel: BroadcastChannel, payload: unknown): void => {
    const frame = JSON.stringify({ channel, ...(payload as object), serverTime: new Date().toISOString() });
    for (const client of this.clients) {
      if (!client.channels.has(channel)) continue;
      this.sendRaw(client, frame);
    }
  };

  private send(client: Client, payload: unknown): void {
    this.sendRaw(client, JSON.stringify(payload));
  }

  private sendRaw(client: Client, frame: string): void {
    // readyState 1 === OPEN. Writing to a closing socket throws synchronously
    // in ws, and one dead terminal must never break the fan-out to the others.
    try {
      if (client.socket.readyState === 1) client.socket.send(frame);
    } catch {
      this.clients.delete(client);
    }
  }

  /**
   * Ping every client periodically and drop any that missed the last round.
   * A tablet that loses wifi does not send a TCP FIN, so without this the hub
   * would keep "broadcasting" an alarm to a screen nobody can hear.
   */
  startHeartbeat(intervalMs = 30_000): void {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => {
      for (const client of this.clients) {
        if (!client.alive) {
          try {
            client.socket.terminate();
          } catch {
            /* already gone */
          }
          this.clients.delete(client);
          continue;
        }
        client.alive = false;
        try {
          client.socket.ping();
        } catch {
          this.clients.delete(client);
        }
      }
    }, intervalMs);
    this.heartbeat.unref?.();
  }

  stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** Observability for the /api/health endpoint. */
  stats(): { total: number; byChannel: Record<string, number> } {
    const byChannel: Record<string, number> = { live_orders: 0, website_orders: 0, kitchen: 0 };
    for (const c of this.clients) for (const ch of c.channels) byChannel[ch] = (byChannel[ch] ?? 0) + 1;
    return { total: this.clients.size, byChannel };
  }

  closeAll(): void {
    for (const c of this.clients) {
      try {
        c.socket.close();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
  }
}
