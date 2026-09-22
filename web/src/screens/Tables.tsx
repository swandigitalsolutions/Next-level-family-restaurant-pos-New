/**
 * Tables and their QR codes (admin and manager only).
 *
 * The QR code is a physical object — it gets printed, laminated and put on a
 * table — so the printable card is a real deliverable of this screen, not an
 * afterthought. Regenerating a token invalidates whatever is already on the
 * table, which is why that action says so in plain words before it runs.
 *
 * The QR itself is drawn locally (see ./qr.ts). The POS has to keep working
 * with the internet down, so fetching code images from a public QR service
 * was never an option.
 */
import { useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { callable } from "../lib/api";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Sheet, Spinner, Toast, Pill } from "../components/ui";
import { QrCode } from "../components/QrCode";
import type { QrAdminTable } from "../lib/types";
import "./Tables.css";

export function TablesScreen() {
  const { data, error, initial, reload } = useQuery<QrAdminTable[]>("queries", "qrAdminTables");
  const action = useAction();
  const [editing, setEditing] = useState<{ id?: string; table_no: string; seats: string } | null>(null);
  const [showQr, setShowQr] = useState<QrAdminTable | null>(null);
  const [printAll, setPrintAll] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const tables = data ?? [];

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2400);
  }

  function menuUrl(token: string) {
    return `${location.origin}/menu/${token}`;
  }

  async function save() {
    if (!editing) return;
    const payload = { id: editing.id, table_no: editing.table_no.trim(), seats: Number(editing.seats) || 4 };
    const out = await action.run(() =>
      editing.id ? callable("tablesAdmin", "updateTable", payload) : callable("tablesAdmin", "createTable", payload),
    );
    if (out) {
      flash("Saved");
      setEditing(null);
      reload();
    }
  }

  async function regenerate(table: QrAdminTable) {
    const ok = confirm(
      `Make a new QR code for table ${table.table_no}?\n\nThe code currently printed and sitting on that table will STOP WORKING immediately. You will need to print and place the new one.`,
    );
    if (!ok) return;
    await action.run(() => callable("tablesAdmin", "regenerateQrToken", { id: table.id }));
    flash(`New code for table ${table.table_no} — print it before service`);
    reload();
  }

  return (
    <div className="tbl">
      <header className="board-head">
        <h1>Tables &amp; QR codes</h1>
        <p>Each table has its own code. Guests scan it to see the menu and order.</p>
      </header>

      <div className="tbl-tools">
        <Button variant="primary" onClick={() => setEditing({ table_no: "", seats: "4" })}>
          + Table
        </Button>
        <Button onClick={() => setPrintAll(true)} disabled={tables.length === 0}>
          Print all codes
        </Button>
      </div>

      {action.error && <ErrorNote message={action.error} />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading tables" />
      ) : tables.length === 0 ? (
        <EmptyState icon="🪑" title="No tables yet" hint="Add your tables, then print a QR code for each one." />
      ) : (
        <div className="tbl-grid">
          {tables.map((t) => (
            <Card key={t.id} className="tbl-card">
              <div className="tbl-card-top">
                <strong>Table {t.table_no}</strong>
                {t.new_orders > 0 && <Pill tone="new">{t.new_orders} new</Pill>}
                {t.open_orders > 0 && t.new_orders === 0 && <Pill tone="working">{t.open_orders} open</Pill>}
              </div>
              <span className="tbl-seats">{t.seats} seats</span>

              <div className="tbl-card-actions">
                <Button onClick={() => setShowQr(t)}>Show QR</Button>
                <Button onClick={() => setEditing({ id: t.id, table_no: t.table_no, seats: String(t.seats) })}>Edit</Button>
                <Button variant="danger" onClick={() => regenerate(t)} disabled={action.busy}>
                  New code
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <Sheet
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? "Edit table" : "New table"}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button variant="primary" onClick={save} disabled={action.busy || !editing?.table_no.trim()}>
              Save
            </Button>
          </>
        }
      >
        {editing && (
          <>
            <Field label="Table number or name">
              <Input value={editing.table_no} onChange={(e) => setEditing({ ...editing, table_no: e.target.value })} />
            </Field>
            <Field label="Seats">
              <Input value={editing.seats} onChange={(e) => setEditing({ ...editing, seats: e.target.value })} inputMode="numeric" />
            </Field>
          </>
        )}
      </Sheet>

      {/* one printable card */}
      <Sheet
        open={showQr !== null}
        onClose={() => setShowQr(null)}
        title={`Table ${showQr?.table_no ?? ""}`}
        subtitle="Print this, laminate it, and put it on the table."
        footer={
          <Button variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        }
      >
        {showQr && <PrintableCard table={showQr} url={menuUrl(showQr.qr_token)} />}
      </Sheet>

      {/* all printable cards */}
      <Sheet
        open={printAll}
        onClose={() => setPrintAll(false)}
        title="Print all table codes"
        subtitle={`${tables.length} cards`}
        footer={
          <Button variant="primary" onClick={() => window.print()}>
            Print
          </Button>
        }
      >
        <div className="tbl-print-sheet">
          {tables.map((t) => (
            <PrintableCard key={t.id} table={t} url={menuUrl(t.qr_token)} />
          ))}
        </div>
      </Sheet>

      {toast && <Toast message={toast} />}
    </div>
  );
}

/** The physical card that ends up on the table. */
function PrintableCard({ table, url }: { table: QrAdminTable; url: string }) {
  return (
    <div className="tbl-print">
      <div className="tbl-print-rule" aria-hidden="true" />
      <strong className="tbl-print-brand">Next Level Family Restaurant</strong>
      <QrCode value={url} size={190} />
      <strong className="tbl-print-table">Table {table.table_no}</strong>
      <span className="tbl-print-hint">Scan to see the menu and order</span>
      <div className="tbl-print-rule" aria-hidden="true" />
    </div>
  );
}
