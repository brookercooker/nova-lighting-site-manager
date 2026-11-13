import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
const call = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authGate", () => ({ REQUIRE_LOGIN: false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("../adminUsers", () => ({ callAdminUsers: call }));
vi.mock("@/prototype/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "me" } } }), signOut: vi.fn() },
  rpc: async () => ({ data: true }),
} }));
import UsersPage from "../UsersPage";
afterEach(() => { cleanup(); call.mockReset(); });

it("shows No Access for accounts without roles, grants access, loads once and sets the Manager title", async () => {
  call.mockImplementation(async (body?: { action: string }) => body ? { ok: true } : { users: [
    { id: "u1", email: "none@x.com", created_at: "", last_sign_in_at: null, is_admin: false, is_user: false },
  ] });
  render(<MemoryRouter><UsersPage /></MemoryRouter>);
  expect(await screen.findByText("No Access")).toBeVisible();
  expect(screen.queryByText("User")).toBeNull();
  expect(call.mock.calls.filter((c) => c[0] === undefined)).toHaveLength(1);
  expect(document.title).toBe("Users · Site Manager");
  fireEvent.keyDown(screen.getByRole("button",{name:"User Actions"}),{key:"ArrowDown"});
  expect(await screen.findByRole("menuitem",{name:"Copy ID"})).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole("menuitem",{name:"Copy ID"}),{key:"Escape"});
  fireEvent.click(screen.getByRole("button", { name: "Give Access" }));
  await waitFor(() => expect(call).toHaveBeenCalledWith({ action: "set_user", user_id: "u1", is_user: true }));
  expect(await screen.findByText("User")).toBeVisible();
  expect(screen.queryByText("No Access")).toBeNull();
});
