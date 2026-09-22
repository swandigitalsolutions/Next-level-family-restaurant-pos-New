/**
 * Staff management. The thing that must not be got wrong: the role picker has
 * to tell a restaurant owner, in plain words, what each role can and cannot
 * do — and deactivation must be explained as "kept, not deleted".
 */
import { describe, test, expect, beforeEach, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderScreen, makeCallable, sessionUser } from "../test/render";
import type { Staff } from "../lib/types";

const callable = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../lib/api", () => ({
  callable: (...args: unknown[]) => callable.fn(...args),
  getToken: () => "t",
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  ApiError: class extends Error {},
}));
vi.mock("../lib/session", async () => {
  const actual = await vi.importActual<typeof import("../lib/session")>("../lib/session");
  return {
    ...actual,
    useSession: () => ({
      user: sessionUser("admin"),
      role: "admin",
      connection: "connected",
      loading: false,
      signIn: vi.fn(),
      signOut: vi.fn(),
      refresh: vi.fn(),
    }),
    useRealtime: () => {},
  };
});

import { StaffScreen } from "./Staff";

const member = (over: Partial<Staff> = {}): Staff => ({
  // The real staffAdmin.listStaff returns `id`, not `uid`. Getting this wrong
  // in the mock is what let a broken screen pass its own tests.
  id: "u_1",
  username: "reception1",
  full_name: "Anita",
  phone: "9000000000",
  role: "billing",
  status: "active",
  ...over,
});

beforeEach(() => {
  callable.fn = makeCallable({ "staffAdmin.listStaff": { staff: [member()] } });
});

describe("staff list", () => {
  test("shows each person, their username and their role", async () => {
    renderScreen(<StaffScreen />);
    expect(await screen.findByText("Anita")).toBeInTheDocument();
    expect(screen.getByText("@reception1")).toBeInTheDocument();
    expect(screen.getByText("Reception / billing")).toBeInTheDocument();
  });

  test("a deactivated account is marked, not hidden", async () => {
    callable.fn = makeCallable({ "staffAdmin.listStaff": { staff: [member({ status: "inactive" })] } });
    renderScreen(<StaffScreen />);
    expect(await screen.findByText("Deactivated")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reactivate/i })).toBeInTheDocument();
  });

  test("an admin cannot deactivate their own account and lock themselves out", async () => {
    callable.fn = makeCallable({ "staffAdmin.listStaff": { staff: [member({ id: "u_admin", username: "admin", role: "admin" })] } });
    renderScreen(<StaffScreen />);
    await screen.findByText("You");
    expect(screen.getByRole("button", { name: /deactivate/i })).toBeDisabled();
  });
});

describe("the role picker", () => {
  test("every role is offered, described in plain words", async () => {
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /add a staff member/i }));

    for (const title of ["Admin", "Manager", "Owner", "Reception / billing", "Kitchen", "Cafe counter"]) {
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/never sees prices, bills, or any money at all/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot bill, settle, or change anything at all/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot manage staff accounts or read the audit log/i)).toBeInTheDocument();
  });

  test("says a role change takes effect immediately, with no re-login", async () => {
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /add a staff member/i }));
    expect(screen.getByText(/takes effect on their very next tap/i)).toBeInTheDocument();
  });

  test("creating an account sends the chosen role and password", async () => {
    const spy = makeCallable({ "staffAdmin.listStaff": { staff: [member()] }, "staffAdmin.createStaff": { id: "u_2" } });
    callable.fn = spy;

    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /add a staff member/i }));

    await userEvent.type(screen.getByLabelText(/full name/i), "Suresh");
    await userEvent.type(screen.getByLabelText(/username/i), "cook1");
    await userEvent.type(screen.getByLabelText(/^password/i), "Kitchen#2026");
    await userEvent.click(screen.getByText("Kitchen").closest("label")!);
    await userEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        "staffAdmin",
        "createStaff",
        expect.objectContaining({ username: "cook1", full_name: "Suresh", role: "kitchen", password: "Kitchen#2026" }),
      ),
    );
  });

  test("a new account cannot be saved without a password", async () => {
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /add a staff member/i }));
    await userEvent.type(screen.getByLabelText(/username/i), "cook1");
    expect(screen.getByRole("button", { name: /^save$/i })).toBeDisabled();
  });

  test("a username cannot be changed once the account exists", async () => {
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /^edit$/i }));
    expect(screen.getByLabelText(/username/i)).toBeDisabled();
  });
});

describe("passwords", () => {
  test("resetting a password sends only the new password", async () => {
    const spy = makeCallable({ "staffAdmin.listStaff": { staff: [member()] }, "staffAdmin.updateStaff": { ok: true } });
    callable.fn = spy;

    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /^password$/i }));
    await userEvent.type(screen.getByLabelText(/new password/i, { selector: "input" }), "Fresh#2026");
    await userEvent.click(screen.getByRole("button", { name: /set password/i }));

    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith("staffAdmin", "updateStaff", { uid: "u_1", password: "Fresh#2026" }),
    );
  });

  test("makes clear nobody is emailed — the manager tells them directly", async () => {
    renderScreen(<StaffScreen />);
    await userEvent.click(await screen.findByRole("button", { name: /^password$/i }));
    expect(screen.getByText(/nobody is emailed/i)).toBeInTheDocument();
  });
});
