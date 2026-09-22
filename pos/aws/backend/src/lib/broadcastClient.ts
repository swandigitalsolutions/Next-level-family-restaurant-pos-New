/**
 * Fan a realtime event out to every WebSocket connection subscribed to a
 * channel ("kitchen" | "live_orders" | "website_orders") — the direct
 * replacement for Firestore onSnapshot pushing document changes to
 * listening clients. Called by the write-path handlers (kitchen.ts,
 * qrOrdersAdmin.ts, websiteOrdersAdmin.ts) after their transaction commits.
 *
 * Looks up subscribed connections in `ws_connections`, posts to each via
 * ApiGatewayManagementApi, and prunes any connection that reports GONE
 * (410) — the same cleanup API Gateway's own $disconnect route does for a
 * clean close, this catches the ones that dropped without one.
 */
import { ApiGatewayManagementApiClient, PostToConnectionCommand, GoneException } from "@aws-sdk/client-apigatewaymanagementapi";
import { getPool } from "./db";

export type BroadcastChannel = "kitchen" | "live_orders" | "website_orders";

/**
 * Where a broadcast actually goes. Default is the API Gateway path below.
 * The self-hosted server (src/server/) installs its own sink at boot so the
 * same write-path handlers push to an in-process WebSocket hub instead —
 * no API Gateway, no `ws_connections` table round-trip. Nothing else about
 * the handlers changes, which is why they stay byte-identical between the
 * two deployment targets.
 */
export type BroadcastSink = (channel: BroadcastChannel, payload: unknown) => Promise<void> | void;

let sink: BroadcastSink | null = null;

/** Install (or clear, with null) the process-wide broadcast sink. */
export function setBroadcastSink(fn: BroadcastSink | null): void {
  sink = fn;
}

let client: ApiGatewayManagementApiClient | undefined;
function getClient(): ApiGatewayManagementApiClient | null {
  const endpoint = process.env.WS_API_ENDPOINT;
  if (!endpoint) return null; // not configured (e.g. local/offline testing) — broadcast becomes a no-op
  return (client ??= new ApiGatewayManagementApiClient({ endpoint }));
}

export async function broadcast(channel: BroadcastChannel, payload: unknown): Promise<void> {
  if (sink) {
    await sink(channel, payload);
    return;
  }
  const cli = getClient();
  if (!cli) return; // never throws in an environment with no WebSocket API deployed yet
  const pool = await getPool();
  const res = await pool.query("SELECT connection_id FROM ws_connections WHERE channel = $1", [channel]);
  const data = Buffer.from(JSON.stringify(payload));
  await Promise.all(res.rows.map(async (row) => {
    try {
      await cli.send(new PostToConnectionCommand({ ConnectionId: row.connection_id, Data: data }));
    } catch (e) {
      if (e instanceof GoneException) {
        await pool.query("DELETE FROM ws_connections WHERE connection_id = $1", [row.connection_id]).catch(() => undefined);
      } else {
        console.error("broadcast: post to connection failed (non-fatal)", row.connection_id, e);
      }
    }
  }));
}
