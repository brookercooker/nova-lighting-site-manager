import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ admin: false, fetch: vi.fn() }));
vi.mock("@/prototype/client", () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
  rpc: async () => ({ data: m.admin }),
} }));
vi.mock("../helper", () => ({ RELAY: "https://relay.example", relayHeaders: async () => ({}) }));

import { DismissErrorButton, ErrorDetails, dismissError, DISMISS_CAP, isErrorDismissed, resetErrorDismissals, useChatPerson, useErrorDismissals, type ErrorEntry } from "../chatErrors";

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
  it("normalizes numeric ids and survives a storage-only reload", () => {
    const e: ErrorEntry = { ...errA, id: 446 };
    dismissError("u1", e);
    expect(isErrorDismissed("u1", e)).toBe(true);
    act(() => resetErrorDismissals());
    expect(isErrorDismissed("u1", { ...e, id: "446" })).toBe(true);
  });
  it("accumulates dismissals and accepts legacy numeric lists including zero", () => {
    localStorage.setItem("nova:dismissed-errors:u1", "[446]");
    expect(isErrorDismissed("u1", { ...errA, id: 446 })).toBe(true);
    dismissError("u1", { ...errB, id: 394 });
    dismissError("u1", { ...errB, id: 0 });
    expect(isErrorDismissed("u1", { ...errA, id: 446 })).toBe(true);
    expect(isErrorDismissed("u1", { ...errB, id: 394 })).toBe(true);
    expect(isErrorDismissed("u1", { ...errB, id: 0 })).toBe(true);
    expect(JSON.parse(localStorage.getItem("nova:dismissed-errors:u1") ?? "null")).toEqual(["446", "394", "0"]);
  });
  it("keeps only the latest 200 ids", () => {
    for (let id = 0; id <= DISMISS_CAP; id++) dismissError("u1", { ...errA, id });
    expect(isErrorDismissed("u1", { ...errA, id: 0 })).toBe(false);
    expect(isErrorDismissed("u1", { ...errA, id: 1 })).toBe(true);
    expect(JSON.parse(localStorage.getItem("nova:dismissed-errors:u1") ?? "[]")).toHaveLength(200);
  });
  it("keeps id-less errors hidden across polling re-renders with the same timestamp/text", async () => {
    const view = wrap(<Chat entries={[old]} state={{ busy: false, blocked: false }} />);
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Error" }));
    view.rerender(<QueryClientProvider client={new QueryClient()}><Chat entries={[{ ...old }]} state={{ busy: false, blocked: false }} /></QueryClientProvider>);
    expect(screen.queryByText(old.text)).toBeNull();
  });
  it("retains an anonymous-window dismissal when the user key resolves and on reload", () => {
    function Identity({ person }: { person: string }) {
      const d = useErrorDismissals(person);
      return d.hidden({ ...errA, id: 446 }) ? null : <DismissErrorButton onDismiss={() => d.dismiss({ ...errA, id: 446 })} />;
    }
    const view = render(<Identity person="anon" />);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss Error" }));
    expect(screen.queryByRole("button", { name: "Dismiss Error" })).toBeNull();
    view.rerender(<Identity person="u1" />);
    expect(screen.queryByRole("button", { name: "Dismiss Error" })).toBeNull();
    act(() => resetErrorDismissals());
    expect(isErrorDismissed("u1", { ...errA, id: 446 })).toBe(true);
  });
  it("hides only that line and persists across reload", async () => {
    const state = { busy: true, blocked: true };
    wrap(<Chat entries={[errA, errB]} state={state} />);
    await ready();
    fireEvent.click(screen.getAllByRole("button", { name: "Dismiss Error" })[0]);
    expect(screen.queryByText("Couldn't finish")).toBeNull();
    expect(screen.getByText("Second problem")).toBeInTheDocument();
    expect(screen.getByTestId("state").textContent).toBe("busy|blocked");
    expect(JSON.parse(localStorage.getItem("nova:dismissed-errors:u1") ?? "null")).toEqual(["h1"]);
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
    act(() => resetErrorDismissals());
    expect(isErrorDismissed("u1", old)).toBe(false);
  });
});

describe("error details", () => {
  it("looks up numeric detail IDs using the same normalized key", async () => {
    m.admin = true;
    m.fetch.mockResolvedValue({ ok: true, json: async () => ({ details: { "446": "Numeric detail" } }) });
    wrap(<Chat entries={[{ ...errA, id: 446 }]} state={{ busy: false, blocked: false }} />);
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "Show Details" }));
    expect(await screen.findByText("Numeric detail")).toBeInTheDocument();
  });
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
