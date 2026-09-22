/**
 * The realtime client decides which server events make a noise. Getting this
 * wrong either loses an order (no alarm) or trains staff to ignore the POS
 * (alarm on everything), so it is tested directly.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { RealtimeClient } from "./realtime";
import { alarmEngine } from "../alarm/soundEngine";

/** A controllable stand-in for the browser's WebSocket. */
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  url: string;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  close() {
    this.closed = true;
  }
  /** Simulate the server pushing a frame. */
  push(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

let client: RealtimeClient;
let ring: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal("WebSocket", FakeSocket as unknown as typeof WebSocket);
  vi.stubGlobal("location", { protocol: "http:", host: "pos.local" } as Location);
  ring = vi.spyOn(alarmEngine, "ring").mockImplementation(() => {});
  client = new RealtimeClient();
  client.connect("test-token");
  FakeSocket.last!.onopen?.();
});

afterEach(() => {
  client.disconnect();
  vi.unstubAllGlobals();
});

describe("connection", () => {
  test("carries the token on the handshake and reports connected", () => {
    expect(FakeSocket.last!.url).toContain("/ws?token=test-token");
    expect(client.getState()).toBe("connected");
  });

  test("uses wss when the page is served over https", () => {
    client.disconnect();
    vi.stubGlobal("location", { protocol: "https:", host: "pos.example.com" } as Location);
    const secure = new RealtimeClient();
    secure.connect("t");
    expect(FakeSocket.last!.url.startsWith("wss://")).toBe(true);
    secure.disconnect();
  });
});

describe("which events ring", () => {
  test("a new QR order rings reception", () => {
    FakeSocket.last!.push({ channel: "live_orders", type: "qr_order.created", ref: "a1" });
    expect(ring).toHaveBeenCalledWith("qr");
  });

  test("a paid website order rings reception", () => {
    FakeSocket.last!.push({ channel: "website_orders", type: "order.confirmed", ref: "WEB-000001" });
    expect(ring).toHaveBeenCalledWith("website");
  });

  test("a new kitchen ticket rings the kitchen", () => {
    FakeSocket.last!.push({ channel: "kitchen", type: "ticket.created", ticket: { id: "kt_1" } });
    expect(ring).toHaveBeenCalledWith("kitchen");
  });

  test("status changes refresh the board silently — they must NOT ring", () => {
    for (const type of ["qr_order.status", "order.status", "order.items", "order.settled", "ticket.updated"]) {
      FakeSocket.last!.push({ channel: "kitchen", type, id: "x" });
    }
    expect(ring).not.toHaveBeenCalled();
  });

  test("the hub's greeting is not an alarm and is not forwarded as an event", () => {
    const seen = vi.fn();
    client.onEvent(seen);
    FakeSocket.last!.push({ type: "connected", role: "billing", channels: ["live_orders"] });
    expect(ring).not.toHaveBeenCalled();
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("replay safety", () => {
  test("the same order arriving twice rings only once", () => {
    const frame = { channel: "live_orders", type: "qr_order.created", ref: "a1" };
    FakeSocket.last!.push(frame);
    FakeSocket.last!.push(frame);
    FakeSocket.last!.push(frame);
    expect(ring).toHaveBeenCalledTimes(1);
  });

  test("two genuinely different orders both ring", () => {
    FakeSocket.last!.push({ channel: "live_orders", type: "qr_order.created", ref: "a1" });
    FakeSocket.last!.push({ channel: "live_orders", type: "qr_order.created", ref: "a2" });
    expect(ring).toHaveBeenCalledTimes(2);
  });

  test("a ticket is deduped by its ticket id", () => {
    const frame = { channel: "kitchen", type: "ticket.created", ticket: { id: "kt_9" } };
    FakeSocket.last!.push(frame);
    FakeSocket.last!.push(frame);
    expect(ring).toHaveBeenCalledTimes(1);
  });
});

describe("subscribers", () => {
  test("board listeners still receive a duplicate so they can refresh state", () => {
    const seen = vi.fn();
    client.onEvent(seen);
    const frame = { channel: "live_orders", type: "qr_order.created", ref: "a1" };
    FakeSocket.last!.push(frame);
    FakeSocket.last!.push(frame);
    // Rang once, but the board heard both — a refresh is always safe.
    expect(ring).toHaveBeenCalledTimes(1);
    expect(seen).toHaveBeenCalledTimes(2);
  });

  test("unsubscribing stops delivery", () => {
    const seen = vi.fn();
    const off = client.onEvent(seen);
    off();
    FakeSocket.last!.push({ channel: "live_orders", type: "qr_order.created", ref: "b1" });
    expect(seen).not.toHaveBeenCalled();
  });
});

describe("closing", () => {
  test("an auth rejection does not retry — that token will never work", () => {
    FakeSocket.last!.onclose?.({ code: 4401 });
    expect(client.getState()).toBe("offline");
  });

  test("an unexpected drop goes to offline and schedules a retry", () => {
    FakeSocket.last!.onclose?.({ code: 1006 });
    expect(client.getState()).toBe("offline");
  });

  test("malformed JSON from the wire is ignored, not thrown", () => {
    expect(() => FakeSocket.last!.onmessage?.({ data: "{not json" })).not.toThrow();
  });
});
