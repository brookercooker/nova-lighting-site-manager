import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ admin: false, fetch: vi.fn() }));
vi.mock("@/prototype/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  rpc: async () => ({ data: m.admin }),
} }));
vi.mock("../helper", () => ({ RELAY: "https://relay.example", relayHeaders: async () => ({}) }));

import { DismissErrorButton, ErrorDetails, isErrorDismissed, resetErrorDismissals, useChatPerson, useErrorDismissals, type ErrorEntry } from "../chatErrors";

const errA: ErrorEntry = { id: "h1", role: "error", text: "Couldn't finish", ts: 1, hasDetail: true };
const errB: ErrorEntry = { id: "h2", role: "error", text: "Second problem", ts: 2 };
const old: ErrorEntry = { role: "error", text: "Old relay error", ts: 3 };

function Chat({ entries, state }: { entries: ErrorEntry[]; state: { busy: boolean; blocked: boolean } }) {
  const { person, isAdmin } = useChatPerson();
  const d = useErrorDismissals(person);
  return <div>
    <p data-testid="state">{state.busy ? "busy" : "idle"}|{state.blocked ? "blocked" : "open"}</p>
    {entries.filter(e => !d.hidden(e)).map(e => <div key={e.text}><span>{e.text}</span><DismissErrorButton onDismiss={() => d.dismiss(e)} />{isAdmin && e.hasDetail && <ErrorDetails id={e.id} />}</div>)}
  </div>;
}
const wrap = (ui: JSX.Element) => render(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>);
const ready = () => act(async () => { await new Promise(r => setTimeout(r, 0)); });

beforeEach(() => { localStorage.clear(); resetErrorDismissals(); m.admin = false; m.fetch.mockReset(); vi.stubGlobal("fetch", m.fetch); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("dismissing chat errors", () => {
  it("hides only that line and persists across reload", async () => {
    const state = { busy: true, blocked: true };
    wrap(<Chat entries={[errA, errB]} state={state} />);
    await ready();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss Error" })[0]);
    expect(screen.queryByText("Couldn't finish")).toBeNull();
    expect(screen.getByText("Second problem")).toBeInTheDocument();
    expect(screen.getByTestId("state").textContent).toBe("busy|blocked");
    expect(JSON.parse(localStorage.getItem("nova:dismissed-errors:u1")!)).toEqual(["h1"]);
    cleanup(); resetErrorDismissals(); // simulated reload: in-memory state gone, storage kept
    wrap(<Chat entries={[errA, errB]} state={state} />);
    await ready();
    expect(screen.queryByText("Couldn't finish")).toBeNull();
  });
  it("dismisses lines without an id for this session only", async () => {
    wrap(<Chat entries={[old]} state={{ busy: false, blocked: false }} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Error" }));
    expect(screen.queryByText("Old relay error")).toBeNull();
    expect(localStorage.getItem("nova:dismissed-errors:u1")).toBeNull();
    resetErrorDismissals();
    expect(isErrorDismissed("u1", old)).toBe(false);
  });
});

describe("error details", () => {
  it("non-admins never see Show Details and the route is never called", async () => {
    wrap(<Chat entries={[errA]} state={{ busy: false, blocked: false }} />);
    await ready();
    expect(screen.queryByRole("button", { name: "Show Details" })).toBeNull();
    expect(m.fetch).not.toHaveBeenCalled();
  });
  it("admins see the details as plain text", async () => {
    m.admin = true;
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ details: { h1: "<b>Stack</b> at line 4" } }) });
    wrap(<Chat entries={[errA]} state={{ busy: false, blocked: false }} />);
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Show Details" }));
    expect(await screen.findByText("<b>Stack</b> at line 4")).toBeInTheDocument();
    expect(document.querySelector("[data-error-details] b")).toBeNull();
    expect(m.fetch).toHaveBeenCalledWith("https://relay.example/api/admin/error-details", expect.anything());
    expect(screen.getByRole("button", { name: "Copy Details" })).toBeInTheDocument();
  });
  it("shows No Further Details when the fetch fails", async () => {
    m.admin = true;
    m.fetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    wrap(<Chat entries={[errA]} state={{ busy: false, blocked: false }} />);
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Show Details" }));
    await waitFor(() => expect(screen.getByText("No Further Details")).toBeInTheDocument());
  });
});
