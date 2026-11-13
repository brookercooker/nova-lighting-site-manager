import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PagesTab from "../PagesTab";
import { PAGES_SYNCED } from "../manifestPageSync";

const state = vi.hoisted(() => ({ rows: [] as any[], load: vi.fn(), choose: vi.fn(), start: vi.fn(), notify: vi.fn(), error: null as null | { message: string } }));
vi.mock("@/prototype/client", () => ({ supabase: { from: () => ({
  select: () => ({ order: async () => { state.load(); return { data: state.rows }; } }),
  update: (patch: any) => ({ in: async (_field: string, ids: string[]) => {
    if (!state.error) state.rows = state.rows.map((row) => ids.includes(row.id) ? { ...row, ...patch } : row);
    return { error: state.error };
  } }),
}) } }));
vi.mock("../designChat/contentSync", () => ({ notifyContentEdited: state.notify }));
vi.mock("../manifestPageSync", () => ({ PAGES_SYNCED: "nova-pages-synced", syncManifestPages: vi.fn() }));
vi.mock("../designChat/DesignChatContext", () => ({ useDesignChatOptional: () => ({ selectPage: state.choose, startEditing: state.start, workingPage: null }) }));
vi.mock("../useThumbnailCapture", () => ({ useAutoCaptureThumbnails: vi.fn(), regenerateThumbnail: vi.fn() }));
vi.mock("../signedThumb", () => ({ SignedThumbImg: () => null }));
vi.mock("../LabelsCell", () => ({ default: () => null }));
vi.mock("../useAllLabels", () => ({ useInvalidateLabels: () => () => {}, registerLabelPath: vi.fn(), useLabelsForScope: () => ({ data: [] }) }));
vi.mock("../TagsPanel", () => ({ default: () => null }));
vi.mock("../CreatePageDialog", () => ({ default: () => null }));
vi.mock("../LandingPagesView", () => ({ default: () => null }));
vi.mock("../LinkAuditView", () => ({ default: () => null }));
vi.mock("../PagePreviewDialog", () => ({ default: () => null }));
vi.mock("../WorkStatusPopover", () => ({ default: () => null }));

beforeEach(() => { cleanup(); state.rows = []; state.error = null; state.notify.mockClear(); state.load.mockClear(); state.choose.mockClear(); state.start.mockClear(); });
describe("Pages list synchronization", () => {
  it("treats whitespace-only search as empty without removing pages", async () => {
    state.rows = [{ id: "home", name: "Homepage", path: "/", tags: [], build_status: "ready", archived_at: null }];
    render(<MemoryRouter><PagesTab /></MemoryRouter>);
    await screen.findByRole("button", { name: "Homepage" });
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pages" }), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "Homepage" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search Pages" }), { target: { value: " Homepage " } });
    expect(screen.getByRole("button", { name: "Homepage" })).toBeInTheDocument();
  });
  it("removes externally deleted rows when the window regains focus", async () => {
    state.rows = [{ id: "gone", name: "Deleted Outside Manager", path: "/external", tags: [], build_status: "ready", archived_at: null }];
    render(<MemoryRouter><PagesTab /></MemoryRouter>);
    await screen.findByRole("button", { name: "Deleted Outside Manager" });
    state.rows = [];
    act(() => window.dispatchEvent(new Event("focus")));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Deleted Outside Manager" })).toBeNull());
  });
  it("archives from the portalled menu without opening the page and queues its named change", async () => {
    state.rows = [{ id: "race", name: "Race Test Page", path: "/race-test-page", tags: [], build_status: "ready", archived_at: null }];
    render(<MemoryRouter initialEntries={["/manage/pages"]}><PagesTab /></MemoryRouter>);
    const menu = await screen.findByRole("button", { name: "Options for Race Test Page" });
    fireEvent.keyDown(menu, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(state.notify).toHaveBeenCalledWith(['Archived the page "Race Test Page" (/race-test-page)']));
    expect(state.choose).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Race Test Page" })).toBeNull());
  });
  it("does not queue a failed archive", async () => {
    state.rows = [{ id: "race", name: "Race Test Page", path: "/race-test-page", tags: [], build_status: "ready", archived_at: null }];
    state.error = { message: "Archive failed" };
    render(<MemoryRouter><PagesTab /></MemoryRouter>);
    fireEvent.keyDown(await screen.findByRole("button", { name: "Options for Race Test Page" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: "Archive" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Race Test Page" })).toBeInTheDocument());
    expect(state.notify).not.toHaveBeenCalled();
  });
  it("shows a new page and chooses it without starting manual editing", async () => {
    render(<MemoryRouter initialEntries={["/manage/pages"]}><PagesTab /></MemoryRouter>);
    await waitFor(() => expect(state.load).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("button", { name: "Fresh Code Page" })).toBeNull();
    state.rows = [{ id: "new", slug_id: "fresh-code-page-123abc", name: "Fresh Code Page", path: "/fresh-code-page", page_type: "static", build_status: "ready", tags: [], updated_at: "2026-10-22T06:30:00Z", archived_at: null }];
    act(() => { window.dispatchEvent(new Event(PAGES_SYNCED)); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Fresh Code Page" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Fresh Code Page" }));
    expect(state.choose).toHaveBeenCalledWith({ id: "new", name: "Fresh Code Page", path: "/fresh-code-page" });
    expect(state.start).not.toHaveBeenCalled();
    expect(screen.queryByText(/Edit It Myself/)).toBeNull();
    expect(state.load).toHaveBeenCalledTimes(2);
  });
});