/**
 * Outbound customer messaging — WhatsApp (Meta WhatsApp Cloud API) and SMS
 * (Twilio). Used only by lib/thankYou.ts.
 *
 * Credentials come from the environment and stay on the server: they are put
 * on the outgoing request and nowhere else — never returned to the browser,
 * never logged, never stored with the delivery record.
 *
 *   WhatsApp  WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN
 *             WHATSAPP_TEMPLATE_NAME   optional, see below
 *             WHATSAPP_TEMPLATE_LANG   default "en"
 *             WHATSAPP_API_VERSION     default "v21.0"
 *   SMS       TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 *             TWILIO_FROM              sender number (+1...) or Messaging Service SID (MG...)
 *
 * WhatsApp only delivers free-form text inside a 24-hour window the CUSTOMER
 * opened. A thank-you after a meal is business-initiated, so in production it
 * needs an approved template: set WHATSAPP_TEMPLATE_NAME and the message goes
 * out as that template with three body parameters —
 *   {{1}} restaurant name, {{2}} feedback link, {{3}} review / maps link.
 * Without a template name it is sent as plain text, which is fine for testing
 * against your own number and will be refused by Meta for everyone else.
 *
 * Indian SMS additionally needs DLT registration of the sender and the message
 * text; that is configured with the SMS provider, not here.
 */

export type Channel = "whatsapp" | "sms";

export interface OutboundMessage {
  /** Digits with country code, no "+": 919876543210. */
  to: string;
  text: string;
  /** Values for a WhatsApp template's {{1}}..{{n}}, in order. */
  templateParams: string[];
}

export type SendResult =
  | { status: "SENT"; messageId: string | null }
  | { status: "FAILED"; error: string }
  | { status: "SKIPPED"; error: string };

export type Sender = (msg: OutboundMessage) => Promise<SendResult>;

export interface MessageTransport {
  whatsapp: Sender;
  sms: Sender;
}

/** How long one provider call may take. The till is not waiting on it, but a
 * hung connection must not hold the request (and its DB row at PENDING) open. */
const TIMEOUT_MS = Number(process.env.MESSAGING_TIMEOUT_MS) || 10_000;

/** Provider error bodies can be long, and are stored and shown to staff. */
function short(s: unknown): string {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error";
}

async function readJson(res: Response): Promise<any> {
  const text = await res.text().catch(() => "");
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text };
  }
}

function failure(e: any): SendResult {
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return { status: "FAILED", error: `timed out after ${TIMEOUT_MS} ms` };
  return { status: "FAILED", error: short(e?.message ?? e) };
}

export function whatsappSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Sender {
  return async (msg) => {
    const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID;
    const token = env.WHATSAPP_ACCESS_TOKEN;
    if (!phoneNumberId || !token) return { status: "SKIPPED", error: "WhatsApp is not configured" };
    const version = env.WHATSAPP_API_VERSION || "v21.0";
    const template = env.WHATSAPP_TEMPLATE_NAME;
    const payload = template
      ? {
          messaging_product: "whatsapp",
          to: msg.to,
          type: "template",
          template: {
            name: template,
            language: { code: env.WHATSAPP_TEMPLATE_LANG || "en" },
            components: [
              { type: "body", parameters: msg.templateParams.map((text) => ({ type: "text", text: text || "-" })) },
            ],
          },
        }
      : { messaging_product: "whatsapp", to: msg.to, type: "text", text: { preview_url: true, body: msg.text } };
    try {
      const res = await fetchImpl(
        `https://graph.facebook.com/${encodeURIComponent(version)}/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        },
      );
      const body = await readJson(res);
      if (!res.ok) return { status: "FAILED", error: short(body?.error?.message ?? `HTTP ${res.status}`) };
      return { status: "SENT", messageId: body?.messages?.[0]?.id ?? null };
    } catch (e) {
      return failure(e);
    }
  };
}

export function twilioSmsSender(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Sender {
  return async (msg) => {
    const sid = env.TWILIO_ACCOUNT_SID;
    const authToken = env.TWILIO_AUTH_TOKEN;
    const from = env.TWILIO_FROM;
    if (!sid || !authToken || !from) return { status: "SKIPPED", error: "SMS is not configured" };
    const form = new URLSearchParams({ To: `+${msg.to}`, Body: msg.text });
    // A Messaging Service SID picks the sender itself (and handles DLT senders).
    if (/^MG[0-9a-f]{32}$/i.test(from)) form.set("MessagingServiceSid", from);
    else form.set("From", from);
    try {
      const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: "Basic " + Buffer.from(`${sid}:${authToken}`).toString("base64"),
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      const body = await readJson(res);
      if (!res.ok) return { status: "FAILED", error: short(body?.message ?? `HTTP ${res.status}`) };
      return { status: "SENT", messageId: body?.sid ?? null };
    } catch (e) {
      return failure(e);
    }
  };
}

export function isChannelConfigured(channel: Channel, env: NodeJS.ProcessEnv = process.env): boolean {
  return channel === "whatsapp"
    ? Boolean(env.WHATSAPP_PHONE_NUMBER_ID && env.WHATSAPP_ACCESS_TOKEN)
    : Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
}

let override: MessageTransport | null = null;

/** Replace the real providers (tests). Pass null to restore them. */
export function setMessageTransport(t: MessageTransport | null): void {
  override = t;
}

export function messageTransport(): MessageTransport {
  return override ?? { whatsapp: whatsappSender(), sms: twilioSmsSender() };
}
