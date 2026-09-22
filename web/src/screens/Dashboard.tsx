/**
 * The owner's dashboard. Read-only for everyone, by design — there is not a
 * single write control on this screen.
 *
 * Ordered by what the owner actually asks: how much today, split by which
 * till, how are we paying, how does this week look, when are the peaks, what
 * is selling.
 */
import { useCallback } from "react";
import { useQuery } from "../lib/useQuery";
import { useRealtime } from "../lib/session";
import { money, titleCase } from "../lib/format";
import { Card, ErrorNote, Spinner, EmptyState } from "../components/ui";
import type { DashboardStats } from "../lib/types";
import "./Dashboard.css";

const TILL_COLORS: Record<string, string> = {
  Food: "var(--cardinal)",
  Bar: "var(--ink)",
  Cafe: "var(--marigold)",
};

export function DashboardScreen() {
  const { data, error, initial, reload } = useQuery<DashboardStats>("queries", "dashboard");

  // Any settled bill changes these numbers; refresh quietly rather than
  // making the owner pull to refresh.
  useRealtime(useCallback(() => reload(), [reload]));

  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (initial || !data) return <Spinner label="Loading today" />;

  const tills = [
    { label: "Food", value: data.food_sales_today, bills: data.food_bills_today },
    { label: "Bar", value: data.alcohol_sales_today, bills: data.alcohol_bills_today },
    { label: "Cafe", value: data.cafe_sales_today, bills: data.cafe_bills_today },
  ];
  const tillTotal = tills.reduce((a, t) => a + t.value, 0) || 1;
  const avgBill = data.total_bills_today ? data.total_sales_today / data.total_bills_today : 0;

  const trend = (data.trend ?? []).map((t) => ({
    label: String(t.date ?? t.day ?? ""),
    value: Number(t.total ?? t.sales ?? 0),
  }));
  const trendMax = Math.max(1, ...trend.map((t) => t.value));

  const hourly = (data.hourly_flow ?? []).map((h) => ({
    hour: Number(h.hour ?? 0),
    value: Number(h.total ?? h.sales ?? h.count ?? 0),
  }));
  const hourlyMax = Math.max(1, ...hourly.map((h) => h.value));

  const mixTotal = (data.payment_mix ?? []).reduce((a, m) => a + Number(m.total ?? 0), 0) || 1;

  return (
    <div className="dash">
      <section className="dash-tiles">
        <Card className="dash-tile is-lead">
          <span className="dash-tile-label">Sales today</span>
          <strong className="num">{money(data.total_sales_today)}</strong>
        </Card>
        <Card className="dash-tile">
          <span className="dash-tile-label">Bills</span>
          <strong className="num">{data.total_bills_today}</strong>
        </Card>
        <Card className="dash-tile">
          <span className="dash-tile-label">Average bill</span>
          <strong className="num">{money(avgBill)}</strong>
        </Card>
      </section>

      <Card>
        <h2 className="dash-h">Where it came from</h2>
        <div className="dash-split" role="img" aria-label="Sales split by till">
          {tills.map((t) => (
            <span
              key={t.label}
              style={{ width: `${(t.value / tillTotal) * 100}%`, background: TILL_COLORS[t.label] }}
              title={`${t.label} ${money(t.value)}`}
            />
          ))}
        </div>
        <ul className="dash-legend">
          {tills.map((t) => (
            <li key={t.label}>
              <i style={{ background: TILL_COLORS[t.label] }} aria-hidden="true" />
              <span>{t.label}</span>
              <strong className="num">{money(t.value)}</strong>
              <em className="num">{t.bills} bills</em>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <h2 className="dash-h">How they paid</h2>
        {data.payment_mix?.length ? (
          <ul className="dash-bars">
            {data.payment_mix.map((m) => (
              <li key={m.method}>
                <span className="dash-bar-label">{titleCase(m.method)}</span>
                <span className="dash-bar-track">
                  <span className="dash-bar-fill" style={{ width: `${(Number(m.total) / mixTotal) * 100}%` }} />
                </span>
                <strong className="num">{money(Number(m.total))}</strong>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon="💳" title="No payments yet today" />
        )}
      </Card>

      <Card>
        <h2 className="dash-h">Last 7 days</h2>
        {trend.length ? (
          <div className="dash-chart" role="img" aria-label="Daily sales, last 7 days">
            {trend.map((t) => (
              <span key={t.label} className="dash-chart-col" title={`${t.label}: ${money(t.value)}`}>
                <span className="dash-chart-bar" style={{ height: `${Math.max(3, (t.value / trendMax) * 100)}%` }} />
                <em>{t.label.slice(5)}</em>
              </span>
            ))}
          </div>
        ) : (
          <EmptyState icon="📈" title="Not enough history yet" hint="This fills in as the week goes on." />
        )}
      </Card>

      <Card>
        <h2 className="dash-h">Busiest hours today</h2>
        {hourly.length ? (
          <div className="dash-chart is-hours" role="img" aria-label="Sales by hour">
            {hourly.map((h) => (
              <span key={h.hour} className="dash-chart-col" title={`${h.hour}:00 — ${money(h.value)}`}>
                <span className="dash-chart-bar is-hour" style={{ height: `${Math.max(3, (h.value / hourlyMax) * 100)}%` }} />
                <em>{h.hour}</em>
              </span>
            ))}
          </div>
        ) : (
          <EmptyState icon="🕐" title="Quiet so far" hint="Peaks appear once service starts." />
        )}
      </Card>

      <Card>
        <h2 className="dash-h">Top items today</h2>
        {data.top_items?.length ? (
          <ol className="dash-top">
            {data.top_items.slice(0, 8).map((it, i) => (
              <li key={`${it.name}-${i}`}>
                <span className="dash-top-rank num">{i + 1}</span>
                <span className="dash-top-name">{it.name}</span>
                <span className="dash-top-qty num">{it.qty}×</span>
                <strong className="num">{money(Number(it.revenue ?? it.total ?? 0))}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState icon="🍽️" title="Nothing sold yet today" hint="The kitchen has not sent anything out." />
        )}
      </Card>
    </div>
  );
}
