/**
 * Staff accounts. Admin only — this is where the owner hands out access.
 *
 * The role picker is the heart of the screen, and it is written for a
 * restaurant owner rather than an administrator: each role is a card that
 * says, in plain words, what that person will and will not be able to do. The
 * consequence of the choice has to be obvious without a manual.
 *
 * Accounts are deactivated, never deleted, because settled bills record who
 * created them and that trail must not break.
 */
import { useState } from "react";
import { useQuery, useAction } from "../lib/useQuery";
import { callable } from "../lib/api";
import { useSession } from "../lib/session";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Pill, Sheet, Spinner, Toast } from "../components/ui";
import type { Role, Staff } from "../lib/types";
import "./Staff.css";

const ROLE_CARDS: Array<{ role: Role; title: string; can: string; cannot: string }> = [
  {
    role: "admin",
    title: "Admin",
    can: "Everything, including staff accounts and the audit log.",
    cannot: "Nothing is hidden from this role.",
  },
  {
    role: "manager",
    title: "Manager",
    can: "All tills, the menu, tables and reports.",
    cannot: "Cannot manage staff accounts or read the audit log.",
  },
  {
    role: "owner",
    title: "Owner",
    can: "Look at the dashboard and the audit log.",
    cannot: "Cannot bill, settle, or change anything at all.",
  },
  {
    role: "billing",
    title: "Reception / billing",
    can: "Food and bar tills, tables, and the QR and website order boards.",
    cannot: "Cannot edit the menu, manage tables, or see the kitchen screen.",
  },
  {
    role: "kitchen",
    title: "Kitchen",
    can: "The kitchen screen only.",
    cannot: "Never sees prices, bills, or any money at all.",
  },
  {
    role: "cafe_billing",
    title: "Cafe billing",
    can: "Cafe billing only.",
    cannot: "Cannot touch restaurant billing or the menu.",
  },
];

interface Draft {
  /** Sent to the API as `uid`; comes back from it as `id`. */
  uid?: string;
  username: string;
  full_name: string;
  phone: string;
  role: Role;
  password: string;
}

export function StaffScreen() {
  const { user } = useSession();
  const { data, error, initial, reload } = useQuery<Staff[] | { staff: Staff[] }>("staffAdmin", "listStaff");
  const action = useAction();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [resetting, setResetting] = useState<{ staff: Staff; password: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const staff: Staff[] = Array.isArray(data) ? data : (data?.staff ?? []);

  function flash(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 2600);
  }

  async function save() {
    if (!draft) return;
    const payload: Record<string, unknown> = {
      uid: draft.uid,
      username: draft.username.trim().toLowerCase(),
      full_name: draft.full_name.trim(),
      phone: draft.phone.trim(),
      role: draft.role,
    };
    if (draft.password) payload.password = draft.password;

    const out = await action.run(() =>
      draft.uid ? callable("staffAdmin", "updateStaff", payload) : callable("staffAdmin", "createStaff", payload),
    );
    if (out) {
      flash(draft.uid ? "Saved" : `${draft.full_name || draft.username} can now sign in`);
      setDraft(null);
      reload();
    }
  }

  async function resetPassword() {
    if (!resetting) return;
    const out = await action.run(() =>
      callable("staffAdmin", "updateStaff", { uid: resetting.staff.id, password: resetting.password }),
    );
    if (out) {
      flash(`New password set for ${resetting.staff.username}`);
      setResetting(null);
    }
  }

  async function toggleActive(member: Staff) {
    const active = (member.status || "active") === "active";
    if (active) {
      const ok = confirm(
        `Deactivate ${member.full_name || member.username}?\n\nThey will be signed out immediately, on their next tap. The account is kept, not deleted, because their past bills refer to it.`,
      );
      if (!ok) return;
      // Toast only on success — a failed deactivation must not tell the owner
      // that someone who still has access "can no longer sign in".
      const out = await action.run(() => callable("staffAdmin", "deactivateStaff", { uid: member.id }));
      if (out) flash(`${member.username} can no longer sign in`);
    } else {
      const out = await action.run(() => callable("staffAdmin", "updateStaff", { uid: member.id, status: "active" }));
      if (out) flash(`${member.username} can sign in again`);
    }
    reload();
  }

  return (
    <div className="stf">
      <header className="board-head">
        <h1>Staff</h1>
        <p>Who can sign in, and what each person is allowed to do.</p>
      </header>

      <Button variant="primary" onClick={() => setDraft({ username: "", full_name: "", phone: "", role: "billing", password: "" })}>
        + Add a staff member
      </Button>

      {action.error && <ErrorNote message={action.error} />}
      {error && <ErrorNote message={error} onRetry={reload} />}

      {initial ? (
        <Spinner label="Loading staff" />
      ) : staff.length === 0 ? (
        <EmptyState icon="👥" title="No staff accounts yet" hint="Add your first account to let someone sign in." />
      ) : (
        <ul className="stf-list">
          {staff.map((member) => {
            const active = (member.status || "active") === "active";
            const isSelf = member.id === user?.id;
            return (
              <li key={member.id}>
                <Card className={active ? "stf-card" : "stf-card is-off"}>
                  <div className="stf-card-main">
                    <strong>{member.full_name || member.username}</strong>
                    <span className="stf-username">@{member.username}</span>
                    <div className="stf-tags">
                      <Pill tone={member.role === "admin" ? "new" : "neutral"}>
                        {ROLE_CARDS.find((r) => r.role === member.role)?.title ?? member.role}
                      </Pill>
                      {!active && <Pill tone="danger">Deactivated</Pill>}
                      {isSelf && <Pill tone="warn">You</Pill>}
                    </div>
                  </div>
                  <div className="stf-card-actions">
                    <Button
                      onClick={() =>
                        setDraft({
                          uid: member.id,
                          username: member.username,
                          full_name: member.full_name ?? "",
                          phone: member.phone ?? "",
                          role: member.role,
                          password: "",
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button onClick={() => setResetting({ staff: member, password: "" })}>Password</Button>
                    <Button
                      variant={active ? "danger" : "secondary"}
                      onClick={() => toggleActive(member)}
                      disabled={action.busy || (isSelf && active)}
                      title={isSelf && active ? "You cannot deactivate your own account" : undefined}
                    >
                      {active ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.uid ? "Edit staff member" : "New staff member"}
        subtitle="Changing someone's role takes effect on their very next tap — they do not need to sign in again."
        footer={
          <>
            <Button onClick={() => setDraft(null)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={save}
              disabled={action.busy || !draft?.username.trim() || (!draft?.uid && !draft?.password)}
            >
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <>
            <Field label="Full name">
              <Input value={draft.full_name} onChange={(e) => setDraft({ ...draft, full_name: e.target.value })} />
            </Field>
            <Field label="Username" hint="What they type to sign in.">
              <Input
                value={draft.username}
                onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                autoCapitalize="none"
                disabled={!!draft.uid}
              />
            </Field>
            <Field label="Phone (optional)">
              <Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} inputMode="tel" />
            </Field>
            {!draft.uid && (
              <Field label="Password" hint="Tell them this password directly. They can keep using it.">
                <Input value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} />
              </Field>
            )}

            <span className="ui-field-label">What can this person do?</span>
            <div className="stf-roles">
              {ROLE_CARDS.map((card) => (
                <label key={card.role} className={draft.role === card.role ? "stf-role is-selected" : "stf-role"}>
                  <input
                    type="radio"
                    name="role"
                    checked={draft.role === card.role}
                    onChange={() => setDraft({ ...draft, role: card.role })}
                  />
                  <strong>{card.title}</strong>
                  <span className="stf-can">{card.can}</span>
                  <span className="stf-cannot">{card.cannot}</span>
                </label>
              ))}
            </div>
          </>
        )}
      </Sheet>

      <Sheet
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={`New password for ${resetting?.staff.username ?? ""}`}
        subtitle="Tell them the new password directly. Nobody is emailed."
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="primary" onClick={resetPassword} disabled={action.busy || !resetting?.password}>
              Set password
            </Button>
          </>
        }
      >
        {resetting && (
          <Field label="New password">
            <Input value={resetting.password} onChange={(e) => setResetting({ ...resetting, password: e.target.value })} />
          </Field>
        )}
      </Sheet>

      {toast && <Toast message={toast} />}
    </div>
  );
}
