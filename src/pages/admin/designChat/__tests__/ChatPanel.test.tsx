import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ChatPanel from "../ChatPanel";
import { useChatDraft } from "../useChatDraft";
import { useSaveProgress } from "../useSaveProgress";
import WaitProgress from "../WaitProgress";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
  refresh: vi.fn(),
  retryNow: vi.fn(),
  offline: false,
  stopVoice: vi.fn(),
  insert: vi.fn(),
  select: vi.fn(),
  start: vi.fn(),
  sync: vi.fn(),
  candidate: null as null | { name: string; path: string },
  location: null as null | string,
  page: null as null | { id: string; name: string; path: string },
  editing: false,
  phone: false,
  guard: vi.fn(),
  refs: { references: [] as any[], addReference: vi.fn(), removeReference: vi.fn(), clearReferences: vi.fn(), focusTick: 0 },
  history: [] as any[],
  previewLoaded: false,
  draft: undefined as ReturnType<typeof useChatDraft> | undefined,
  syncPending: false,
  syncFailed: false,
  busy: false,
  job: undefined as any,
  retry: undefined as any,
  wait: undefined as any,
}));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => ({
  state: { busy: mocks.busy, job: mocks.job, history: mocks.history }, offline: mocks.offline, refreshSoon: mocks.refresh, retryNow: mocks.retryNow,
  chatDraft: mocks.draft,
  requestRetry: mocks.retry, waitProgress: mocks.wait,
  workingPage: null, clearWorkingPage: vi.fn(), editing: mocks.editing,
  drawing: { strokes: [], on: false, available: false, cancel: vi.fn(), toggle: vi.fn() },
  preview: { loaded: mocks.previewLoaded }, startEditing: mocks.start, stopEditing: vi.fn(), selectPage: mocks.select,
  previewLocation: mocks.location ? { path: mocks.location, search: "" } : mocks.candidate ? { path: mocks.candidate.path, search: "" } : null,
  previewPage: mocks.page,
  refs: mocks.refs,
  previewRegistrable: mocks.candidate,
}) }));
vi.mock("../contentSync", () => ({ notifyContentEdited: mocks.sync, CONTENT_SYNC_CHANGED: "save-sync", contentSyncPending: () => mocks.syncPending, contentSyncFailed: () => mocks.syncFailed, contentSyncDeferred: () => false, contentSyncStartedAt: () => 10000 }));
vi.mock("../useManagerLayout", () => ({ useManagerLayout: () => ({ phone: mocks.phone }) }));
vi.mock("../ModeSwitchContext", () => ({ useModeSwitch: () => ({ requestChat: mocks.guard, requestManual: async (open: () => void) => open() }) }));
vi.mock("@/prototype/client", () => ({ supabase: {
  from: () => ({ insert: mocks.insert }),
} }));
vi.mock("../EditorSlot", () => ({ useEditorSlot: () => ({ saveAll: vi.fn() }) }));
vi.mock("../helper", () => ({
  DEFAULT_UPLOADS: { accept: ".png", maxFiles: 5, maxBytes: 1024 },
  postToHelper: mocks.post,
}));
vi.mock("../useAttachments", () => ({ useAttachments: () => ({
  files: [], uploading: false, ids: () => [], clear: vi.fn(),
}) }));
vi.mock("../useVoice", () => ({ useVoice: () => ({ supported: true, stop: mocks.stopVoice, toggle: vi.fn() }) }));
vi.mock("../ApprovalCard", () => ({ default: () => null }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.post.mockResolvedValue({ ok: true, data: {} });
  mocks.candidate = null;
  mocks.history = []; mocks.previewLoaded = false; mocks.draft = undefined;
  mocks.location = null;
  mocks.refs = { references: [], addReference: vi.fn(), removeReference: vi.fn(), clearReferences: vi.fn(), focusTick: 0 };
  mocks.page = null;
  mocks.editing = false;
  mocks.phone = false;
  mocks.offline = false;
  mocks.syncPending = false; mocks.syncFailed = false; mocks.busy = false; mocks.job = undefined; mocks.retry = undefined; mocks.wait = undefined;
  mocks.guard.mockResolvedValue(false);
  mocks.insert.mockReturnValue({ select: () => ({ single: async () => ({ data: { id: "registered", name: "Race Test Page", path: "/race-test-page" }, error: null }) }) });
});

afterEach(() => { cleanup(); vi.useRealTimers(); });
it.each([false, true])("offers connection retry without sending when phone=%s", (phone) => {
  mocks.phone = phone; mocks.offline = true;
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  expect(screen.getByText("Can't reach the design service right now. It will keep trying.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  expect(mocks.retryNow).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(mocks.post).not.toHaveBeenCalled();
});
it("keeps a working retry on the failed history message after the indicator disappears", () => {
  const retry = vi.fn().mockResolvedValue({ ok: true });
  mocks.retry = { canRetry: () => true, isReviewFailure: () => false, retry, disabled: false, localErrors: [] };
  mocks.history = [{ role: "user", text: "Make the lamp larger", ts: 1000 }, { role: "error", text: "Failed", ts: 1100 }];
  mocks.wait = { request: { error: true, label: "The change couldn't finish", value: 0 }, submit: null };
  const view = render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  mocks.wait = { request: null, submit: null };
  view.rerender(<MemoryRouter><ChatPanel /></MemoryRouter>);
  fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  expect(retry).toHaveBeenCalledWith(1100, expect.any(Function));
  expect(screen.getByRole("log")).toHaveTextContent("Failed");
});
it("renders contextual helper suggestions instead of unconditional phone and draft links", () => {
  mocks.busy = true; mocks.job = { id: "wait", kind: "change", status: "working", startedAt: Date.now() };
  mocks.history = [{ role: "user", text: "Replace the video", ts: Date.now() }];
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  expect(screen.getByRole("button", { name: "Add real videos to your library" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Look at other pages in your draft" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Write your next change" }));
  expect(screen.getByRole("textbox")).toHaveFocus();
});
it("offers an opt-in Manual Edit hand-off under saved-content replies without sending to the helper", async () => {
  mocks.page = { id: "experiment", name: "Experiment", path: "/draft/experiment" };
  mocks.history = [{ role: "assistant", text: "This video is saved in Site Manager. Remove it there.", ts: 10 }];
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Edit in Manual Edit Mode" }));
  await waitFor(() => expect(mocks.start).toHaveBeenCalledOnce());
  expect(mocks.select).toHaveBeenCalledWith(mocks.page); expect(mocks.post).not.toHaveBeenCalled();
});

describe("shared manual save feedback", () => {
  function Feedback({ saving, dirty = false }: { saving: boolean; dirty?: boolean }) {
    const progress = useSaveProgress(saving, dirty);
    return <MemoryRouter><WaitProgress progress={progress} /><ChatPanel saveProgress={progress} /></MemoryRouter>;
  }
  const paired = () => {
    const bar = screen.queryByRole("progressbar");
    const chat = screen.queryByRole("status");
    expect(Boolean(bar)).toBe(Boolean(chat));
    if (bar) expect(chat?.textContent).toBe(bar.getAttribute("aria-valuetext"));
  };
  it("starts, finishes, fades and clears both displays together despite a lingering content job", () => {
    vi.useFakeTimers(); vi.setSystemTime(15000);
    mocks.busy = true; mocks.job = { kind: "publish", status: "content", startedAt: 10000 };
    const view = render(<Feedback saving />); paired();
    mocks.syncPending = true; view.rerender(<Feedback saving={false} />); paired();
    mocks.syncFailed = true; act(() => window.dispatchEvent(new Event("save-sync"))); paired();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuetext")).toContain("couldn't reach the draft");
    mocks.syncFailed = false; mocks.syncPending = false;
    act(() => window.dispatchEvent(new Event("save-sync"))); paired();
    expect(screen.getByRole("status")).toHaveTextContent("Done");
    act(() => vi.advanceTimersByTime(1500)); paired();
    expect(screen.getByRole("status")).toHaveClass("opacity-0");
    act(() => vi.advanceTimersByTime(250)); paired();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });
  it("keeps save errors paired and clears them together when edits are cancelled", () => {
    vi.useFakeTimers(); vi.setSystemTime(15000);
    const view = render(<Feedback saving dirty />);
    view.rerender(<Feedback saving={false} dirty />); paired();
    expect(screen.getByRole("status")).toHaveTextContent("couldn't be saved");
    view.rerender(<Feedback saving={false} />); paired();
    act(() => vi.advanceTimersByTime(1750)); paired();
    expect(screen.queryByRole("status")).toBeNull();
  });
});
it("keeps the composer usable, queues through the normal payload and sends after reply during preview building", async () => {
  mocks.busy = true; mocks.job = { kind: "change", status: "working", startedAt: 100 };
  mocks.history = [{ role: "user", text: "First change", ts: 100 }];
  const view = render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  const input = screen.getByRole("textbox", { name: "Next change (sends when this one finishes)" });
  fireEvent.change(input, { target: { value: "Second change" } });
  fireEvent.click(screen.getByRole("button", { name: "Queue it" }));
  expect(mocks.post).not.toHaveBeenCalled(); expect(input).toHaveValue("");
  expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  mocks.history = [...mocks.history, { role: "assistant", text: "First replied", ts: 200 }];
  view.rerender(<MemoryRouter><ChatPanel /></MemoryRouter>);
  await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/send", { message: "Second change", uploadIds: [] }));
});

describe("composer autosizing", () => {
  it.each([
    { phone: false, height: 1024, minimum: 210, maximum: 512 },
    { phone: false, height: 800, minimum: 210, maximum: 400 },
    { phone: true, height: 844, minimum: 62, maximum: 150 },
  ])("uses $minimum–$maximum px when phone=$phone at height=$height", ({ phone, height, minimum, maximum }) => {
    mocks.phone = phone;
    const viewport = vi.spyOn(window, "innerHeight", "get").mockReturnValue(height);
    try {
      render(<MemoryRouter><ChatPanel /></MemoryRouter>);
      const input = screen.getByRole("textbox", { name: "Describe a Change" }) as HTMLTextAreaElement;
      expect(parseFloat(input.style.height)).toBe(minimum);
      Object.defineProperty(input, "scrollHeight", { configurable: true, value: 1000 });
      fireEvent.change(input, { target: { value: "A long draft\n".repeat(40) } });
      expect(parseFloat(input.style.height)).toBe(maximum);
      expect(input).toHaveValue("A long draft\n".repeat(40));
      expect(mocks.post).not.toHaveBeenCalled();
    } finally {
      viewport.mockRestore();
    }
  });
});

describe("mode-only entry and hidden chat controls", () => {
  it("has no manual entry in the chat or empty state and preserves hidden controls", () => {
    const view = render(<MemoryRouter><div hidden={mocks.editing}><ChatPanel /></div></MemoryRouter>);
    expect(screen.queryByText(/Edit It Myself/)).toBeNull();
    expect(screen.getByRole("button", { name: "Attach pictures or documents" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Speak your request" })).toBeVisible();
    mocks.editing = true;
    view.rerender(<MemoryRouter><div hidden={mocks.editing}><ChatPanel /></div></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "Attach pictures or documents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Speak your request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Draw on the preview" })).toBeNull();
    expect(screen.getByRole("button", { name: "Attach pictures or documents", hidden: true })).not.toBeVisible();
  });
});

function messageBox() {
  render(<MemoryRouter><ChatPanel /></MemoryRouter>);
  const input = screen.getByRole("textbox", { name: "Describe a Change" });
  fireEvent.change(input, { target: { value: "Make the headline larger" } });
  return input;
}

describe("chat sending shortcuts", () => {
  it("keeps draft, cursor, focus and the same box when a reply and preview arrive", () => {
    const view = render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    const input = screen.getByRole("textbox", { name: "Describe a Change" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep my next request" } });
    input.focus(); input.setSelectionRange(5, 7); fireEvent.select(input);
    mocks.history = [{ role: "assistant", text: "Finished", ts: 42 }]; mocks.previewLoaded = true;
    mocks.candidate = { name: "Home", path: "/" };
    view.rerender(<MemoryRouter><ChatPanel /></MemoryRouter>);
    expect(screen.getByRole("textbox", { name: "Describe a Change" })).toBe(input);
    expect(input).toHaveValue("Keep my next request");
    expect(document.activeElement).toBe(input); expect(input.selectionStart).toBe(5); expect(input.selectionEnd).toBe(7);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("keeps a provider-owned draft and cursor through composer replacement", () => {
    function Parent({ version }: { version: number }) {
      mocks.draft = useChatDraft();
      return <MemoryRouter><ChatPanel key={version} /></MemoryRouter>;
    }
    const view = render(<Parent version={1} />);
    const input = screen.getByRole("textbox", { name: "Describe a Change" }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "Keep this draft" } });
    input.focus(); input.setSelectionRange(2, 6); fireEvent.select(input);
    view.rerender(<Parent version={2} />);
    const restored = screen.getByRole("textbox", { name: "Describe a Change" }) as HTMLTextAreaElement;
    expect(restored).toHaveValue("Keep this draft"); expect(document.activeElement).toBe(restored);
    expect(restored.selectionStart).toBe(2); expect(restored.selectionEnd).toBe(6);
  });
  it("does not clear a next draft typed while Send is still finishing", async () => {
    let finish: ((result: any) => void) | undefined;
    mocks.post.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const input = messageBox();
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    fireEvent.change(input, { target: { value: "My next request" } });
    finish?.({ ok: true, data: {} });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(input).toHaveValue("My next request");
  });
  it("exposes an asynchronous send error even if the phone sheet was closed", async () => {
    const onAttention = vi.fn();
    mocks.post.mockResolvedValue({ ok: false, error: "The request could not be sent" });
    render(<MemoryRouter><ChatPanel onAttention={onAttention} /></MemoryRouter>);
    fireEvent.change(screen.getByRole("textbox", { name: "Describe a Change" }), { target: { value: "Update the heading" } });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(onAttention).toHaveBeenCalledTimes(1));
    expect(mocks.post).toHaveBeenCalledWith("/send", { message: "Update the heading", uploadIds: [] });
  });
  it("preserves an unsent draft across phone panel reopenings", () => {
    const view = render(<MemoryRouter><ChatPanel opening={1} /></MemoryRouter>);
    const input = screen.getByRole("textbox", { name: "Describe a Change" });
    fireEvent.change(input, { target: { value: "Keep my draft" } });
    view.rerender(<MemoryRouter><ChatPanel opening={0} /></MemoryRouter>);
    view.rerender(<MemoryRouter><ChatPanel opening={2} /></MemoryRouter>);
    expect(input).toHaveValue("Keep my draft"); expect(document.activeElement).toBe(input);
    expect(mocks.post).not.toHaveBeenCalled();
  });
  it("uses the shared switch guard before sending from Manual Mode", async () => {
    mocks.editing = true;
    const input = messageBox();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.guard).toHaveBeenCalledTimes(1));
    expect(mocks.post).not.toHaveBeenCalled();
    expect(input).toHaveValue("Make the headline larger");
    mocks.guard.mockResolvedValue(true);
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  });
  it("leaves Shift+Enter to the browser without sending", () => {
    const input = messageBox();
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(mocks.post).not.toHaveBeenCalled();
    expect(mocks.stopVoice).not.toHaveBeenCalled();
  });

  it("sends with Enter", async () => {
    const input = messageBox();
    expect(fireEvent.keyDown(input, { key: "Enter" })).toBe(false);
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith("/send", {
      message: "Make the headline larger", uploadIds: [],
    }));
    expect(mocks.post).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(input).toHaveValue(""));
  });

  it("does not send during IME composition", () => {
    const input = messageBox();
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(mocks.post).not.toHaveBeenCalled();
  });

  it("still sends with the Send button", async () => {
    messageBox();
    fireEvent.click(screen.getByRole("button", { name: /^Send$/ }));
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
  });
});

describe("library items in the chat", () => {
  const image = { kind: "image" as const, id: "img1", name: 'Hero "lamp"', url: "https://cdn.example/hero.webp", labels: ["Lobby"] };
  const box = () => screen.getByRole("textbox", { name: "Describe a Change" });
  it("shows a removable chip for each item", () => {
    mocks.refs.references = [image];
    render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    fireEvent.click(screen.getByRole("button", { name: 'Remove Hero "lamp"' }));
    expect(mocks.refs.removeReference).toHaveBeenCalledWith("image:img1");
  });
  it("uses yellow reference chips with inherited black labels and working remove controls", () => {
    mocks.refs.references = [image, { kind: "object", id: "o", name: "Object Name" }, { kind: "video", id: "v", name: "Video Name", url: "/clip.mp4" }];
    render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    for (const ref of mocks.refs.references) {
      const remove = screen.getByRole("button", { name: `Remove ${ref.name}` });
      const chip = remove.parentElement;
      expect(chip).toHaveClass("bg-tag-selected", "text-tag-selected-foreground", "border-tag-selected");
      expect(chip?.querySelector(".text-muted-foreground")).toBeNull();
      expect(remove).toHaveClass("text-tag-selected-foreground", "hover:bg-tag-selected-foreground/10");
      fireEvent.click(remove);
    }
    expect(mocks.refs.removeReference.mock.calls).toEqual([["image:img1"], ["object:o"], ["video:v"]]);
  });
  it("sends the reference block after the words, without putting it in the box, and clears chips on success", async () => {
    mocks.refs.references = [image];
    render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: "Put this in the About hero" } });
    expect(box()).toHaveValue("Put this in the About hero");
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledTimes(1));
    const sent = mocks.post.mock.calls[0][1].message as string;
    expect(sent).toBe('Put this in the About hero\n\nReferences from the library:\n- Image "Hero \\"lamp\\"": https://cdn.example/hero.webp, labels: Lobby');
    expect(Object.keys(mocks.post.mock.calls[0][1]).sort()).toEqual(["message", "uploadIds"]);
    await waitFor(() => expect(mocks.refs.clearReferences).toHaveBeenCalled());
  });
  it("keeps chips after a failed send", async () => {
    mocks.refs.references = [image];
    mocks.post.mockResolvedValue({ ok: false, error: "nope" });
    render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    fireEvent.change(box(), { target: { value: "Use it" } });
    fireEvent.keyDown(box(), { key: "Enter" });
    await waitFor(() => expect(mocks.post).toHaveBeenCalled());
    expect(mocks.refs.clearReferences).not.toHaveBeenCalled();
  });
  it("asks for words when only items are attached", () => {
    mocks.refs.references = [image];
    render(<MemoryRouter><ChatPanel /></MemoryRouter>);
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(mocks.post).not.toHaveBeenCalled();
    expect(screen.getByText("Say what you'd like done with the attached item(s).")).toBeInTheDocument();
  });
});
