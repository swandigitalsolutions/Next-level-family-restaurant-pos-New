/**
 * Dashboard rollups — Lambda port of the read/rebuild surface from
 * firebase/functions/src/triggers/stats.ts. The Firestore version let the
 * frontend `getDoc(stats/rolling)` directly; Postgres has no client-readable
 * surface, so `getRollingStats` is the read endpoint every ops role can call
 * (mirrors Firestore rules: staff/owner readable). `rebuildStats` stays
 * admin-only, for after a data migration or to force a resync.
 */
import { dispatch } from "../../lib/callable";
import { assertRole } from "../../lib/authz";
import { DASHBOARD_ROLES, RESTAURANT_TZ } from "../../lib/config";
import { dateKey } from "../../lib/money";
import { getPool } from "../../lib/db";
import { computeRolling } from "../../lib/statsService";

export const handler = dispatch({
  async getRollingStats(_body, event) {
    // The Dashboard's audience (owner view-only, admin, manager, billing).
    // Not the kitchen, which never sees money, and not the cafe till.
    assertRole(event as any, DASHBOARD_ROLES);
    const pool = await getPool();
    const res = await pool.query("SELECT * FROM stats_rolling WHERE id='rolling'");
    const row = res.rows[0];
    // Rebuilt only on a bill write, so after midnight the stored "today" is
    // yesterday's until the first sale. Another day's snapshot is rebuilt.
    if (!row || dateKey(new Date(row.updated_at), RESTAURANT_TZ) !== dateKey(new Date(), RESTAURANT_TZ)) return computeRolling();
    return { today: row.today, trend: row.trend, paymentMix: row.payment_mix, topItems: row.top_items, hourlyFlow: row.hourly_flow, menuSummary: row.menu_summary, updatedAt: row.updated_at };
  },

  async rebuildStats(_body, event) {
    assertRole(event as any, ["admin"]);
    const rolling = await computeRolling();
    return { ok: true, updatedAt: rolling.updatedAt };
  },
});
