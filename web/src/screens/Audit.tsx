/**
 * The audit log. Admin and owner only — the manager role is deliberately
 * excluded, so the person running the floor cannot review the record of their
 * own price changes.
 *
 * Append-only: the database revokes UPDATE and DELETE on this table, so there
 * is nothing to edit here even in principle. It reads like a ledger rather
 * than a feed, because it gets opened when something has gone wrong and the
 * job is to scan, find, and copy a reference out.
 */
import { useState } from "react";
import { useQuery } from "../lib/useQuery";
import { dateTime, titleCase } from "../lib/format";
import { Button, EmptyState, ErrorNote, Field, Input, Pill, Select, Spinner } from "../components/ui";
import type { AuditEntry } from "../lib/types";
import "./Audit.css";

const ENTITY_TYPES = ["", "bill", "table_session", "user", "catalog_item", "category", "kitchen_ticket", "website_order", "restaurant_table"];

export function AuditScreen() {
  const [entityType, setEntityType] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const limit = 50;

  const { data, error, initial, reload } = useQuery<{ entries: AuditEntry[]; total: number }>("queries", "auditLog", {
    entity_type: entityType,
    action: actionFilter.trim(),
    limit,
    offset: page * limit,
  });

  const entries = data?.entries ?? [];
  const total = data?.total ?? 0;

  // Group by day so a long ledger stays scannable.
  const days = entries.reduce<Array<{ day: string; rows: AuditEntry[] }>>((acc, entry) => {
    const day = (entry.created_at ?? "").slice(0, 10);
    const last = acc[acc.length - 1];
    if (last && last.day === day) last.rows.push(entry);
    else acc.push({ day, rows: [entry] });
    return acc;
  }, []);

  return (
    <div className="aud">
      <header className="board-head">
        <h1>Audit log</h1>
        <p>Every privileged change, in order. Nothing here can be edited or removed.</p>
      </header>

      <div className="aud-filters">
        <Field label="Entity">
          <Select
            value={entityType}
            onChange={(e) => {
              setEntityType(e.target.value);
              setPage(0);
            }}
          >
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>
                {t ? titleCase(t) : "Everything"}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Action starts with">
          <Input
            value={actionFilter}
            onChange={(e) => {
              setActionFilter(e.target.value);
              setPage(0);
            }}
            placeholder="e.g. bill. or staff."
          />
        </Field>
      </div>

      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading the log" />
      ) : entries.length === 0 ? (
        <EmptyState icon="🔒" title="Nothing recorded for this filter" hint="Try clearing the entity or action filter." />
      ) : (
        <>
          {days.map(({ day, rows }) => (
            <section key={day} className="aud-day">
              <h2>{day}</h2>
              <ul className="aud-list">
                {rows.map((entry) => {
                  const id = String(entry.id);
                  const open = expanded === id;
                  return (
                    <li key={id}>
                      <button type="button" className="aud-row" onClick={() => setExpanded(open ? null : id)} aria-expanded={open}>
                        <span className="aud-time num">{dateTime(entry.created_at).split(", ")[1] ?? dateTime(entry.created_at)}</span>
                        <span className="aud-action">{entry.action}</span>
                        <span className="aud-actor">
                          {entry.actor_username}
                          <Pill tone="neutral">{entry.actor_role}</Pill>
                        </span>
                        <span className="aud-entity num">{entry.entity_id}</span>
                      </button>
                      {open && (
                        <pre className="aud-detail">{JSON.stringify(entry.details ?? {}, null, 2)}</pre>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <div className="aud-pager">
            <Button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0}>
              Newer
            </Button>
            <span className="num">
              {page * limit + 1}–{Math.min((page + 1) * limit, total)} of {total}
            </span>
            <Button onClick={() => setPage((p) => p + 1)} disabled={(page + 1) * limit >= total}>
              Older
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
