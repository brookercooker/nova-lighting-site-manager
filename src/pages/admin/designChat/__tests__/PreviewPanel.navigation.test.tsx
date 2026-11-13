import { createRef } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import PreviewPanel from "../PreviewPanel";
import PreviewToolbar from "../PreviewToolbar";
import type { DesignChat } from "../DesignChatContext";
import { rememberScroll } from "../frameScroll";
import { walk } from "../submitWalkthroughStore";
import { SubmitWalkthroughPanel } from "../SubmitWalkthrough";

const context = vi.hoisted(() => ({ chat: null as unknown }));
vi.mock("../DesignChatContext", () => ({ useDesignChat: () => context.chat }));
vi.mock("../DrawLayer", () => ({ default: () => <div>Drawing</div> }));
vi.mock("../openReviewDestination", () => ({ openReviewDestination: vi.fn(() => true) }));
vi.mock("../pageSelection", () => ({ loadManualPages: async () => [] }));
vi.mock("../useWalkthroughData", () => ({ useWalkthroughData: () => ({ rows: [], pages: [{name:"Team",path:"/team",build_status:"ready"}], links: {status:"ok",unread:0,groups:[{label:"Homepage",page:{name:"Homepage",path:"/"},links:[{key:"team",href:"/team",kind:"internal",label:"Team",requestIds:[],status:null}]}]}}) }));
afterEach(() => { cleanup(); walk.reset(); });

function setup(overrides: Partial<DesignChat> = {}) {
  const chat = {
    device: "desktop", inFull: false, coverFull: false, toggleFull: vi.fn(),
    boxRef: createRef(),
    drawing: { capturing: false, on: false, areaRef: createRef(), setAvailable: vi.fn() },
    preview: { frames: [], loaded: true }, editing: false,
    previewNav: { back: vi.fn(), forward: vi.fn(), canBack: true, canForward: true },
    ...overrides,
  } as unknown as DesignChat;
  context.chat = chat;
  const view = () => <MemoryRouter initialEntries={["/manage/preview"]}><PreviewPanel /></MemoryRouter>;
  return { chat, view, ...render(view()) };
}

describe("floating preview navigation", () => {
  it("removes Design Check shielding for Step 2 and accepts clicks without preview navigation", () => {
    walk.update(w => ({...w,open:true,step:"pages",checking:{key:"page:/",kind:"page",name:"Homepage"}}));
    const {chat,view,rerender,container} = setup({state:{publish:{open:1},review:{enabled:true}} as any,preview:{frames:[{id:1,url:"https://public.example/"}],shownId:1,loaded:true,finish:vi.fn()} as any,showPreviewPath:vi.fn(),setReviewOpen:vi.fn()});
    const frame = container.querySelector("iframe");
    if (!frame?.contentWindow) throw new Error("Missing preview");
    const win = frame.contentWindow;
    const post = vi.spyOn(win,"postMessage");
    expect(frame).toHaveAttribute("inert");
    expect(screen.getByRole("region",{name:"Design Check Preview"})).toBeInTheDocument();
    act(() => walk.update(w => ({...w,step:"links",checking:{key:"team",kind:"link",name:"Team"}})));
    rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
    expect(frame).not.toHaveAttribute("inert");
    expect(frame).not.toHaveAttribute("tabindex","-1");
    expect(screen.queryByRole("region",{name:"Design Check Preview"})).toBeNull();
    expect(post).toHaveBeenCalledWith(expect.objectContaining({type:"link-check",enabled:true,interceptAll:true}),"https://public.example");
    render(<SubmitWalkthroughPanel onKeepEditing={() => {}} />);
    const scroll = vi.fn(); HTMLElement.prototype.scrollIntoView = scroll;
    const send = (match: string | null) => act(() => window.dispatchEvent(new MessageEvent("message",{origin:"https://public.example",source:win,data:{source:"nova-site",type:"link-click",v:2,match,raw:match ?? "/unchanged",href:"https://public.example"+(match ?? "/unchanged"),kind:"internal",label:"Team",path:"/"}})));
    send("/team");
    expect(walk.get().selectedLink?.key).toBe("team");
    expect(scroll).toHaveBeenCalledWith({block:"nearest"});
    expect(screen.getByRole("link",{name:"Open link to verify Team"})).toHaveFocus();
    send(null);
    expect(walk.get().linkNote).toBe("This link wasn't changed, so it doesn't need checking.");
    expect(chat.showPreviewPath).not.toHaveBeenCalled();
    expect(frame.src).toBe("https://public.example/");
  });
  it("records Homepage scrolling without a path-bearing ready and restores after bare preview-ready", () => {
    const { chat, view, rerender, container } = setup({ preview: { frames: [{ id: 1, url: "https://public.example/" }], shownId: 1, loaded: true, finish: vi.fn() } as any });
    const frame = container.querySelector("iframe"); const win = frame?.contentWindow;
    if (!win) throw new Error("Missing preview");
    const post = vi.spyOn(win, "postMessage");
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://public.example", source: win, data: { type: "preview-ready" } })));
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://public.example", source: win, data: { source: "nova-site", type: "page-scroll", path: "/home", y: 1200 } })));
    chat.editing = true; rerender(view());
    rememberScroll("/", 1700);
    chat.editing = false; rerender(view());
    post.mockClear();
    act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://public.example", source: win, data: { type: "preview-ready" } })));
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "restore-scroll", path: "/", y: 1700 }, "https://public.example");
  });
  it("records visible page-scroll before readiness while rejecting another page", () => {
    const { chat, view, rerender, container } = setup({ preview: { frames: [{ id: 1, url: "https://public.example/early-scroll" }], shownId: 1, loaded: true, finish: vi.fn() } as any });
    const win = container.querySelector("iframe")?.contentWindow;
    if (!win) throw new Error("Missing preview");
    const post = vi.spyOn(win, "postMessage");
    for (const [path, y] of [["/early-scroll", 950], ["/wrong-page", 0]]) act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://public.example", source: win, data: { source: "nova-site", type: "page-scroll", path, y } })));
    chat.editing = true; rerender(view()); chat.editing = false; rerender(view());
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "restore-scroll", path: "/early-scroll", y: 950 }, "https://public.example");
  });
  it("keeps the preview mounted across manual mode and restores the last matching position", () => {
    const { chat, view, rerender, container } = setup({ preview: { frames: [{ id: 1, url: "https://public.example/scroll-check" }], shownId: 1, loaded: true, finish: vi.fn() } as any });
    const frame = container.querySelector("iframe"); const win = frame?.contentWindow;
    if (!frame || !win) throw new Error("Missing preview");
    const post = vi.spyOn(win, "postMessage");
    const receive = (type: string, y?: number) => act(() => window.dispatchEvent(new MessageEvent("message", { origin: "https://public.example", source: win, data: { source: "nova-site", type, path: "/scroll-check", y } })));
    receive("preview-ready"); receive("page-scroll", 800);
    chat.editing = true; rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
    receive("page-scroll", 0);
    chat.editing = false; rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
    expect(post).toHaveBeenCalledWith({ source: "nova-manager", type: "restore-scroll", path: "/scroll-check", y: 800 }, "https://public.example");
  });
  it("never draws Back/Forward over the site", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Forward" })).toBeNull();
  });
  it("retains the shown frame during navigation and clears the subtle cue on arrival", () => {
    const { chat, view, rerender, container } = setup({ preview: { frames: [{ id: 1, url: "https://public.example/" }], shownId: 1, loaded: true, finish: vi.fn() } as any });
    const frame = container.querySelector("iframe");
    chat.previewNavigating = true; rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
    expect(screen.queryByLabelText("Preview Loading")).toBeNull();
    chat.previewNavigating = false; rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
  });
  it("puts Back/Forward in the toolbar with the existing callbacks and disabled states", () => {
    const { chat } = setup();
    cleanup();
    const view = () => <PreviewToolbar onManualNavigate={vi.fn()} />;
    const { rerender } = render(view());
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(chat.previewNav?.back).toHaveBeenCalledTimes(1);
    expect(chat.previewNav?.forward).toHaveBeenCalledTimes(1);
    if (chat.previewNav) { chat.previewNav.canBack = false; chat.previewNav.canForward = false; }
    rerender(view());
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Forward" })).toBeDisabled();
  });
  it("keeps manual toolbar navigation guarded and disabled without a valid page", () => {
    setup({ editing: true }); cleanup();
    render(<PreviewToolbar onManualNavigate={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Back" })).toBeDisabled();
  });
  it("keeps the same shown frame interactive and undimmed while waiting, with no covering update layer", () => {
    const { chat, view, rerender, container } = setup({ preview: { frames: [{ id: 1, url: "https://public.example/" }], shownId: 1, loaded: true, finish: vi.fn() } as any });
    const frame = container.querySelector("iframe");
    chat.preview.progressStage = 2;
    chat.waitProgress = { submit: null, request: { value: .4, label: "Making your change · about 40 sec left", ribbon: { received: true, changed: false, built: false, ready: false, current: 0, partial: .4, elapsed: 10 } } };
    rerender(view());
    expect(container.querySelector("iframe")).toBe(frame);
    expect(frame?.className).not.toMatch(/pointer-events-none|opacity/);
    expect(screen.queryByText("Updating Preview")).toBeNull();
    expect(container.querySelector('[aria-label="Preview Loading"]')).toBeNull();
    expect(screen.getByRole("progressbar").compareDocumentPosition(frame as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
