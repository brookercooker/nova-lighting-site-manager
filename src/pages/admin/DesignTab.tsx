import { objectRegistry } from "@/components/objects/registry";
import ScaledViewport from "./designChat/ScaledViewport";
import { DESKTOP_VIRTUAL_WIDTH } from "./designChat/previewScale";
import { useEditorSlot, type AddKind } from "./designChat/EditorSlot";
import { notifyContentEdited } from "./designChat/contentSync";
import { blockChangeLines, inlineChangeLines, mergeChangeLines, quote, type ElementLabel } from "./changeLines";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/prototype/client";
import { Button } from "@/components/ui/button";
import { useDesignChatOptional } from "./designChat/DesignChatContext";
import EmbeddedBox from "./designChat/EmbeddedBox";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ArrowDown, ArrowUp, Bold, Heading, Image as ImageIcon, Italic, AlignCenter, AlignLeft, AlignRight, Trash2, Pencil, Boxes,
  ChevronDown, ChevronRight, Film, PencilRuler } from "lucide-react";
import { DEVICE_WIDTH, type Device } from "@/components/DeviceFrame";
import CreatePageDialog from "./CreatePageDialog";
import ImagePickerDialog from "./ImagePickerDialog";
import VideoPickerDialog from "./VideoPickerDialog";
import ObjectPickerDialog from "./ObjectPickerDialog";
import { matchesLabelFilter } from "./labelPath";
import PageBlocks, { BlockView, newId, type Block as RenderBlock, type BlockAlign, type ImageBlock, type ObjectBlock, type TextBlock, type VideoBlock } from "@/components/PageBlocks";

import SharedObjectNotice from "./SharedObjectNotice";
import Header from "@/components/Header";
import { selectedImageDelete } from "./selectedImageEdit";
import Footer from "@/components/Footer";
import { type InsertType } from "./InsertGap";
import { readStyle, styleKey, type InlineChunk, type InlineEdits, type InlineScope, type InlineSelection } from "@/components/InlineEditSurface";
import InlineStylePanel from "./InlineStylePanel";
import InlineEditSafetyPanel from "./InlineEditSafetyPanel";
import InlineDestinationPanel from "./InlineDestinationPanel";
import { removeInlinePath as withoutPath, retainTextOrigins } from "./textEditOrigins";
import type { InlineReports } from "@/components/InlineEditSurface";
import { insertPickedBlock, pageInsertPosition } from "./pageInsertion";
import { objectFramePath, type ObjectEditTarget } from "./framedPageProtocol";
import SectionLayoutGroup from "./SectionLayoutGroup";
import SavedVideoOptions, { SavedVideoPreview, type SavedVideo } from "./SavedVideoOptions";
import MediaAlignment from "./MediaAlignment";
import { consumeContentHandoff } from "./designChat/savedContentHandoff";
import { saveRow } from "./saveRow";
import { imageSection, moveSection, sectionLabel, videoSection } from "./objectSectionsEdit";
import { parseSections, type Section } from "@/components/ObjectSections";
import FramedPageEditor, { type FramedEditorController } from "./FramedPageEditor";
import { isPageContent, movePageBlock, orderedPageContent, parsePageContent, type PageContentItem } from "./pageContentOrder";
type Block = PageContentItem;
import { editMap, stripHeldObjects, type HeldObjectData } from "./framedPageProtocol";
import { draftEmbedUrl } from "./siteManifest";
import { usePageEditorSurface } from "./usePageEditorSurface";
import { remoteSnapshot } from "./remoteSelection";
import { applySwap, copyName, objectClickKind, objectSwaps as swapsOf, unusedCopies, type ObjectClick } from "./objectClick";
import ObjectClickDialog, { type ObjectAsk } from "./ObjectClickDialog";
import ConfirmDialog from "./ConfirmDialog";
import ResetEditsAction from "./ResetEditsAction";
import type { FrameSection } from "./frameSections";
import { hasOwnSections } from "./pageSectionPresence";
import { findObjectUsages } from "./objectUsages";
import { frameObjectPaths } from "./frameObjectUsages";
import { pageKey } from "./designChat/registerPage";
import { cleanupObjectCopies } from "./objectCopyCleanup";
import { Save as SaveIcon, Trash2 as TrashIcon, Pencil as PencilIcon } from "lucide-react";
import { inlineEditAction, ManualEditHistory, sameEditState, type EditAction, type ManualEditSnapshot } from "./designChat/manualEditHistory";

interface PageRow { id: string; name: string; path: string; content: unknown; updated_at: string; tags?: string[] | null; inline_edits?: InlineEdits | null; build_status?: string | null }

const NO_BLOCKS: never[] = [];
export const previewSrc = (path: string) => (path === "/" ? "/home" : path);
export function InlinePagePreview({ name, blocks }: { name: string; blocks: RenderBlock[] }) {
  return <div><Header /><h1 className="font-serif text-3xl">{name}</h1><PageBlocks blocks={blocks} /><Footer /></div>;
}

const SIZES: TextBlock["size"][] = ["sm", "md", "lg", "xl"];
const SIZE_LABEL: Record<TextBlock["size"], string> = { sm: "S", md: "M", lg: "L", xl: "XL" };

function ToolButton({
  active, onClick, title, children,
}: { active?: boolean; onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={!!active}
      onClick={onClick}
      className={`h-8 min-w-8 px-2 inline-flex items-center justify-center rounded-md border text-xs transition-colors ${
        active ? "bg-primary text-primary-foreground border-primary" : "bg-background hover:bg-muted border-border"
      }`}
    >
      {children}
    </button>
  );
}

/** Height of the frame's sticky section bar (about 40 px), kept clear when scrolling a selection into view. */
const SECTION_BAR_INSET = 48;

export default function DesignTab({ embedded = false, pageId, onNavigate, objectId, returnTo, onObjectInfo }: {
  embedded?: boolean; pageId?: string; onNavigate?: (path: string) => void;
  /** Edit this one object alone in the same framed editor (object scope) instead of the page. */
  objectId?: string;
  /** Coming back from the object editor: the page frame scrolls to this object. */
  returnTo?: { slot: string | null; objectId: string } | null;
  /** Object scope: the opened object's name and kind, for the left-panel header. */
  onObjectInfo?: (info: ObjectEditTarget & { usedOn: string[] } | null) => void;
} = {}) {
  const blockCanvasRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // Embedded in the Site Manager's edit mode, the page comes from the working page, not the address.
  const selectedId = embedded ? pageId ?? "" : params.get("page") ?? "";
  const { slot, registerSave, saveAll, registerDiscard, registerHasChanges, registerAdd, registerHistory, discardAll } = useEditorSlot();
  // Page-only object copies made this session; deleted again unless a save keeps them in use.
  const pendingCopies = useRef(new Set<string>());
  const dropCopies = async (ids: string[]) => {
    if (!ids.length) return;
    await cleanupObjectCopies(ids);
    ids.forEach((id) => pendingCopies.current.delete(id));
  };
  useEffect(() => () => {
    void cleanupObjectCopies([...pendingCopies.current]).catch(() => toast.error("Couldn't remove the unused copies. Try discarding again."));
  }, []);
  const history = useRef(new ManualEditHistory());
  const editState = useRef<ManualEditSnapshot>({ blocks: [], inlineEdits: {}, objectEdits: {} });
  const cleanState = useRef<ManualEditSnapshot>(structuredClone(editState.current));
  const [historyRevision, setHistoryRevision] = useState(0);
  const savingHistory = useRef(false);
  const resetHistory = () => { history.current.reset(); setHistoryRevision(n => n + 1); };
  const recordEdit = (patch: Partial<ManualEditSnapshot>, action: EditAction) => {
    const next = { ...editState.current, ...patch };
    if (embedded && history.current.record(editState.current, next, action)) setHistoryRevision(n => n + 1);
    editState.current = next;
  };
  // Embedded, nothing auto-saves: changes are held here until the Site Manager's Save changes saves them all.
  const pendingInline = useRef<{ pageId: string; next: InlineEdits } | null>(null);
  const pendingObjects = useRef<Record<string, InlineEdits>>({});
  const [tweaksPending, setTweaksPending] = useState(false);

  const [pages, setPages] = useState<PageRow[]>([]);
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [sectionRevision, setSectionRevision] = useState(0);
  // Batch a held section change with exactly one explicit public-frame reload.
  const changeBlocks = (next: Block[] | ((current: Block[]) => Block[]), label = "changed a section", mergeKey?: string) => {
    const result = typeof next === "function" ? next(editState.current.blocks) : next;
    if (sameEditState(result, editState.current.blocks)) return;
    updateSectionRows(result);
    recordEdit({ blocks: result }, { label, mergeKey });
    setBlocks(result);
    setSectionRevision((revision) => revision + 1);
    setDirty(true);
  };
  const [activeId, setActiveId] = useState<string>("");
  const [heldInFrame, setHeldInFrame] = useState(false);
  const [frameSections, setFrameSections] = useState<FrameSection[] | null>(null);
  const [activeSection, setActiveSection] = useState("");
  const [removeAsk, setRemoveAsk] = useState<{ name: string; video?: boolean; confirm: () => void } | null>(null);
  const sectionTemplates = useRef(new Map<string, FrameSection>());
  const receiveSections = (sections: FrameSection[] | null) => {
    if (sections) sections.forEach(section => sectionTemplates.current.set(section.key, section));
    setFrameSections(sections);
  };
  const updateSectionRows = (next: Block[]) => {
    const oldHeld = new Set([...editState.current.blocks, ...next].map(b => b.id));
    setFrameSections(previous => {
      if (!previous) return previous;
      const fixed = previous.filter(section => !oldHeld.has(section.key));
      const rows = (list: Block[]) => list.filter(b => !isPageContent(b)).map(b => sectionTemplates.current.get(b.id) ?? { key: b.id, name: b.type === "object" ? b.name ?? "Object" : b.type === "heading" || b.type === "text" ? b.text : b.type, kind: "held" as const, collapsed: false, movable: true, deletable: true, ...(b.type === "object" ? { objectId: b.objectId } : {}) });
      if (objectId) return [...fixed.filter(s => s.kind === "site" && s.key === "site-header"), ...rows(next), ...fixed.filter(s => s.kind !== "site"), ...fixed.filter(s => s.kind === "site" && s.key !== "site-header")];
      const ordered = orderedPageContent(next);
      const marker = ordered.findIndex(isPageContent);
      const header = fixed.filter(s => s.key === "site-header"), footer = fixed.filter(s => s.key === "site-footer");
      return [...header, ...rows(ordered.slice(0, marker)), ...fixed.filter(s => s.key !== "site-header" && s.key !== "site-footer"), ...rows(ordered.slice(marker + 1)), ...footer];
    });
  };
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const [videoFor, setVideoFor] = useState<string | null>(null);
  const [imageAt, setImageAt] = useState<number | null>(null);
  const [videoAt, setVideoAt] = useState<number | null>(null);
  const scrollToNew = useRef<string | null>(null);
  // block id waiting for an object choice, or "new" when adding one
  const [objectFor, setObjectFor] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [tagFilters, setTagFilters] = useState<string[]>([]);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [listOpen, setListOpen] = useState(() => !new URLSearchParams(window.location.search).get("page"));
  const [dragId, setDragId] = useState<string>("");
  const [dropAt, setDropAt] = useState<{ id: string; before: boolean } | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [objectAt, setObjectAt] = useState<number | null>(null);
  const discarded = useRef(false);
  const opening = useRef<PageRow | null>(null);
  const originalObjects = useRef<Record<string, InlineEdits>>({});
  const persistedPage = useRef(false);
  const persistedObjects = useRef(new Set<string>());
  const [closed, setClosed] = useState(false);
  // In-place editing of a coded page: type over text, click pictures to swap.
  const [inlineEdits, setInlineEdits] = useState<InlineEdits>({});
  const framedApi = useRef<FramedEditorController | null>(null);
  const sheetSelection = useRef<{ scope: string; key: string } | null>(null);
  useEffect(() => {
    // Phone: when the editing sheet opens, scroll the selected element into view above it (existing scrollTo query).
    const on = (event: Event) => {
      // The frame already ends at the sheet's top edge; topInset keeps the element clear of its sticky section bar.
      const sel = sheetSelection.current; void event;
      if (sel) void framedApi.current?.query("scrollTo", sel.scope, sel.key, { topInset: SECTION_BAR_INSET });
    };
    window.addEventListener("nova-manager-sheet", on);
    return () => window.removeEventListener("nova-manager-sheet", on);
  }, []);
  const [framedReports, setFramedReports] = useState<InlineReports>({});
  const [resetKey, setResetKey] = useState(0);
  // Embedded pages not in the coded list: what loading their code found, and a counter that re-runs the load.
  const [inlineSel, setInlineSel] = useState<InlineSelection | null>(null);
  sheetSelection.current = inlineSel ? { scope: inlineSel.scope, key: inlineSel.key } : null;
  const [foldedChunks, setFoldedChunks] = useState<Set<string>>(new Set());
  // Edits on shared objects, keyed by object; saved on the object so every page shows them.
  const [objectEdits, setObjectEdits] = useState<Record<string, InlineEdits>>({});
  const objectRows = useRef<Record<string, string>>({});
  const [heldObjects, setHeldObjects] = useState<Record<string, HeldObjectData>>();
  const siteWideIds = useRef(new Set<string>());
  const objectTarget = useMemo<ObjectEditTarget | null>(() => {
    const o = objectId ? heldObjects?.[objectId] : undefined;
    return objectId && o ? { objectId, name: o.name, status: o.status, component_key: o.component_key, siteWide: siteWideIds.current.has(objectId), content: o.content, inline_edits: o.inline_edits } : null;
  }, [objectId, heldObjects]);
  /** Designed objects (not a registered coded component, even if they keep a component_key) edit their sections as held blocks; coded objects have none. */
  const designedObject = !!objectTarget && !(objectTarget.component_key && objectRegistry[objectTarget.component_key]);
  const orderedList = <T extends { id: string; type: string }>(list: readonly T[]) => (objectId ? [...list] : orderedPageContent(list as never)) as T[];
  const originalContent = useRef<unknown>(null);
  const persistedContent = useRef(false);
  const objectTimers = useRef<Record<string, number>>({});
  /** What each edited element looked like when first touched (scope|path), for plain change lines on save. */
  const elementLabels = useRef<Record<string, ElementLabel>>({});
  const swapNames = useRef<Record<string, string>>({});
  useEffect(() => { elementLabels.current = {}; swapNames.current = {}; }, [selectedId]);
  useEffect(() => {
    (supabase as any).from("object_registry").select("id,status,name,component_key,content,inline_edits,site_wide").then(({ data, error }: any) => {
      if (error) return;
      const snapshots: Record<string, HeldObjectData> = {};
      const edits: Record<string, InlineEdits> = {};
      (data ?? []).forEach((r: any) => {
        snapshots[r.id] = { status: r.status, name: r.name, component_key: r.component_key ?? null, content: r.content, inline_edits: r.inline_edits ?? {} };
        if (r.site_wide) siteWideIds.current.add(r.id);
        // Opened on its own, every object edits under `object:<id>`.
        objectRows.current[`object:${r.id}`] = r.id;
        if (r.id === objectId && r.inline_edits) edits[`object:${r.id}`] = r.inline_edits;
        if (!r.component_key) return;
        objectRows.current[r.component_key] = r.id;
        if (r.inline_edits) edits[r.component_key] = r.inline_edits;
      });
      originalObjects.current = structuredClone(edits);
      editState.current = { ...editState.current, objectEdits: edits };
      cleanState.current = { ...cleanState.current, objectEdits: structuredClone(edits) };
      setHeldObjects(snapshots);
      setObjectEdits(edits);
    });
  }, []);
  const changeScope = (scope: InlineScope, next: InlineEdits, remote = false) => {
    // Fingerprints alone must not turn a rejected/no-op frame command into an Undo step.
    const meaningful = (map: InlineEdits) => Object.fromEntries(Object.entries(map).filter(([key]) => !key.startsWith("fp:")));
    const previous = scope === "page" ? editState.current.inlineEdits : editState.current.objectEdits[scope] ?? {};
    const reported = inlineSel && remoteSnapshot(inlineSel.el);
    next = retainTextOrigins(previous, next, reported?.scope === scope && reported.originalText !== undefined ? { [reported.key]: reported.originalText } : {});
    if (sameEditState(meaningful(previous), meaningful(next)) && !Object.keys(next).some(key => key.startsWith("fp:") && previous[key] !== next[key])) return;
    remote = remote || !!(inlineSel && remoteSnapshot(inlineSel.el));
    const snapshot = inlineSel && remoteSnapshot(inlineSel.el);
    if (inlineSel) {
      const labelKey = `${scope}|${snapshot?.key ?? inlineSel.key}`;
      if (!elementLabels.current[labelKey]) {
        const el = inlineSel.el;
        elementLabels.current[labelKey] = snapshot
          ? { tag: snapshot.tag, kind: snapshot.kind, text: snapshot.text, style: snapshot.style }
          : { tag: el.tagName, kind: inlineSel.kind, text: el.textContent ?? "", style: (() => { const c = getComputedStyle(el); return { fontSize: c.fontSize, fontFamily: c.fontFamily, color: c.color, fontWeight: c.fontWeight }; })() };
      }
    }
    if (snapshot && scope === snapshot.scope && snapshot.fingerprint && Object.keys(next).some(k => { const parsed = k.includes(":") ? k.slice(k.indexOf(":") + 1) : k; return parsed === snapshot.key && !k.startsWith("fp:"); })) next = { ...next, [`fp:${snapshot.key}`]: JSON.stringify(snapshot.fingerprint) };
    if (snapshot?.link?.fingerprint && scope === snapshot.link.scope && next[`link:${snapshot.link.key}`]) next = { ...next, [`fp:${snapshot.link.key}`]: JSON.stringify(snapshot.link.fingerprint) };
    if (scope === "page") {
      return changeInline(next, remote);
    }
    recordEdit({ objectEdits: { ...editState.current.objectEdits, [scope]: next } }, inlineEditAction(scope, editState.current.objectEdits[scope] ?? {}, next));
    setObjectEdits(editState.current.objectEdits);
    const id = objectRows.current[scope];
    if (!id) return;
    if (embedded) { pendingObjects.current[scope] = next; setTweaksPending(true); return; }
    window.clearTimeout(objectTimers.current[scope]);
    objectTimers.current[scope] = window.setTimeout(() => {
      (supabase as any).from("object_registry").update({ inline_edits: next, updated_at: new Date().toISOString() }).eq("id", id).then(({ error }: any) => { if (!error) notifyContentEdited(); });
    }, 800);
  };
  const scopeEdits = (scope: InlineScope) => scope === "page" ? inlineEdits : objectEdits[scope] ?? {};
  /** Reorder sections among siblings, using order styles on the page's own edits. */
  const reorderChunks = (from: InlineChunk, to: InlineChunk, after: boolean, all: InlineChunk[]) => {
    const sibs = all.filter((c) => c.parent === from.parent);
    const orderOf = (c: InlineChunk, i: number) => {
      const o = parseInt(readStyle(inlineEdits, c.key).order ?? "");
      return Number.isFinite(o) ? o : i;
    };
    const list = sibs.map((c, i) => ({ c, o: orderOf(c, i) })).sort((a, b) => a.o - b.o).map((x) => x.c).filter((c) => c.key !== from.key);
    const at = list.findIndex((c) => c.key === to.key);
    list.splice(after ? at + 1 : at, 0, from);
    const out = { ...inlineEdits };
    const patch = (key: string, props: Record<string, string>) => { out[styleKey(key)] = JSON.stringify({ ...readStyle(out, key), ...props }); };
    patch(from.parent, { display: "flex", "flex-direction": "column" });
    list.forEach((c, i) => patch(c.key, { order: String(i) }));
    changeInline(out, !!framedApi.current);
  };
  const [imgAsk, setImgAsk] = useState<((url: string | null) => void) | null>(null);
  const pickImage = () => new Promise<string | null>((resolve) => setImgAsk(() => resolve));
  const inlineTimer = useRef<number>();
  const changeInline = (next: InlineEdits, remote = false) => {
    recordEdit({ inlineEdits: next }, inlineEditAction("page", editState.current.inlineEdits, next));
    setInlineEdits(next);
    const id = selectedId;
    if (embedded) { pendingInline.current = { pageId: id, next }; setTweaksPending(true); return; }
    window.clearTimeout(inlineTimer.current);
    inlineTimer.current = window.setTimeout(async () => {
      const updated_at = new Date().toISOString();
      const { error } = await (supabase as any).from("pages").update({ inline_edits: next, updated_at }).eq("id", id);
      if (!error) notifyContentEdited();
      setPages((cur) => cur.map((x) => (x.id === id ? { ...x, inline_edits: next, updated_at } : x)));
    }, 800);
  };


  const load = async () => {
    const { data } = await (supabase as any)
      .from("pages")
      .select("id,name,path,content,updated_at,tags,inline_edits,build_status")
      .is("archived_at", null)
      .order("name", { ascending: true });
    setPages(data ?? []);
    return (data ?? []) as PageRow[];
  };

  useEffect(() => { load(); }, []);

  const page = useMemo(() => pages.find((p) => p.id === selectedId) ?? null, [pages, selectedId]);
  const surface = usePageEditorSurface(page);
  // Escape (outside text fields and dialogs) clears the selection, back to the hint.
  useEffect(() => {
    if (!embedded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable=true],[role=dialog],[role=listbox],[role=menu]")) return;
      setInlineSel(null); setActiveId(""); setActiveSection("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [embedded]);
  const infoRef = useRef(onObjectInfo); infoRef.current = onObjectInfo;
  useEffect(() => {
    if (!objectTarget) { infoRef.current?.(null); return; }
    let cancelled = false;
    const fromSaved = pages.filter((p) => JSON.stringify([p.content ?? null, p.inline_edits ?? null]).includes(objectTarget.objectId)).map((p) => p.name);
    const paths = frameObjectPaths(objectTarget.objectId);
    const observed = paths.map(path => pages.find(p => pageKey(p.path) === path)?.name ?? path);
    const publish = (site: string[]) => { if (!cancelled) infoRef.current?.({ ...objectTarget, usedOn: [...new Set([...fromSaved, ...observed, ...site])] }); };
    publish([]);
    if (!objectTarget.siteWide && objectTarget.component_key) void findObjectUsages(objectTarget.component_key).then(usages => publish(usages.map(u => u.name))).catch(() => {});
    return () => { cancelled = true; };
  }, [objectTarget, pages]);
  const framed = surface === "framed";
  useEffect(() => {
    // Wait for the page to load so a "mode=edit" link isn't used up early.
    if (!page) return;
    const parsed = parsePageContent(page?.content);
    opening.current = structuredClone(page);
    discarded.current = false;
    setClosed(false);
    persistedPage.current = false;
    persistedObjects.current.clear();
    setBlocks(parsed);
    setActiveId(consumeContentHandoff(page.id, parsed) ?? "");
    setDirty(false);
    setInlineSel(null);
    setFoldedChunks(new Set());
    setInlineEdits(page?.inline_edits ?? {});
    editState.current = { blocks: parsed, inlineEdits: page.inline_edits ?? {}, objectEdits: editState.current.objectEdits };
    cleanState.current = structuredClone(editState.current);
    resetHistory();
  }, [page?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Object scope: the object's own sections replace the page's held blocks, loaded once per opening.
  const sectionsLoaded = useRef<string | null>(null);
  useEffect(() => {
    if (!objectTarget || !page || sectionsLoaded.current === objectTarget.objectId) return;
    sectionsLoaded.current = objectTarget.objectId;
    originalContent.current = objectTarget.content ?? null;
    const sections = (designedObject ? parseSections(objectTarget.content) : []) as unknown as Block[];
    setBlocks(sections); setActiveId(""); setDirty(false);
    editState.current = { ...editState.current, blocks: sections };
    cleanState.current = { ...cleanState.current, blocks: structuredClone(sections) };
    resetHistory();
  }, [objectTarget, page?.id]); // eslint-disable-line react-hooks/exhaustive-deps


  const [sortBy, setSortBy] = useState<"name" | "recent" | "label">("name");
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = pages.filter((p) => {
      if (tagFilters.length && !tagFilters.every((t) => matchesLabelFilter(p.tags ?? [], t))) return false;
      if (!term) return true;
      return `${p.name} ${p.path} ${(p.tags ?? []).join(" ")}`.toLowerCase().includes(term);
    });
    if (sortBy === "recent") {
      list.sort((a, b) => String((b as any).updated_at ?? "").localeCompare(String((a as any).updated_at ?? "")));
    }
    return list;
  }, [pages, q, tagFilters, sortBy]);



  const [deleting, setDeleting] = useState<PageRow | null>(null);

  const select = (id: string) => {
    if (embedded) return;
    const next = new URLSearchParams(params);
    next.set("page", id);
    setParams(next, { replace: true });
  };

  const update = (id: string, patch: Partial<Block>) => {
    const wording = Object.keys(patch).length === 1 && "text" in patch;
    changeBlocks((prev) => prev.map((b) => (b.id === id ? ({ ...b, ...patch } as Block) : b)), wording ? "text change" : "changed section settings", wording ? `block|${id}|text` : undefined);
  };

  const addSection = (section: Section) => {
    if (discarded.current) return;
    changeBlocks((prev) => [...prev, section as unknown as Block], `added ${sectionLabel(section).toLowerCase()}`);
    setActiveId(section.id); setInlineSel(null);
  };
  const updateSection = (section: Section) => changeBlocks((prev) => prev.map((b) => b.id === section.id ? section as unknown as Block : b), "changed section layout", `layout|${section.id}`);
  const addPickedBlock = (block: Block, at: number) => {
    if (discarded.current) return;
    const next = insertPickedBlock(blocks, block, blocks.length);
    if (page) pendingSave.current = { pageId: page.id, snapshot: next };
    changeBlocks(next, `added ${block.type === "object" ? block.name ?? "an object" : block.type}`);
    scrollToNew.current = block.id;
    setActiveId(block.id);
  };

  useEffect(() => {
    if (!scrollToNew.current) return;
    const el = blockCanvasRef.current?.querySelector<HTMLElement>(`[data-page-block="${scrollToNew.current}"]`);
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    scrollToNew.current = null;
  }, [blocks]);

  const addBlock = (type: Block["type"], at?: number) => {
    const position = pageInsertPosition(blocks, activeId, at);
    if (type === "image") { setImageAt(position); setPickerFor("new"); return; }
    if (type === "video") { setVideoAt(position); setVideoFor("new"); return; }
    const base = { id: newId(), align: "left" as BlockAlign };
    const block: Block =
      type === "heading"
          ? { ...base, type: "heading", text: "New heading", size: "lg" } as TextBlock
          : { ...base, type: "text", text: "Write something here.", size: "md" } as TextBlock;
    addPickedBlock(block, position);
  };

  const insertAt = (type: InsertType, at: number) => {
    if (type === "object") { setObjectAt(pageInsertPosition(blocks, activeId, at)); setObjectFor("new"); return; }
    addBlock(type, at);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = orderedList(blocks).findIndex(b => b.id === id);
    if (i < 0) return;
    moveHeldBlock(id, i + dir);
    setActiveId(id); setInlineSel(null);
  };

  // Pointer-based dragging: see-through copy follows the pointer, the wheel keeps
  // working, and the page scrolls near the top or bottom edge.
  const grabRef = useRef({ x: 0, y: 0 });
  const dropRef = useRef<{ id: string; before: boolean } | null>(null);
  const [localDevice, setDevice] = useState<Device>("desktop");
  // Embedded, use the same virtual device width as Chat; transform the frame as a whole.
  const chat = useDesignChatOptional();
  const device: Device = embedded ? "desktop" : localDevice;
  const previewDevice = chat?.device ?? "desktop";
  const firstPreviewDevice = useRef(previewDevice);
  const [desktopChosen, setDesktopChosen] = useState(false);
  useEffect(() => {
    if (previewDevice !== firstPreviewDevice.current) {
      firstPreviewDevice.current = previewDevice;
      setDesktopChosen(previewDevice === "desktop");
    }
  }, [previewDevice]);
  const deviceStyle = !embedded && DEVICE_WIDTH[device] ? { width: DEVICE_WIDTH[device], maxWidth: "100%", margin: "0 auto" } : undefined;
  useEffect(() => {
    if (!dragId) return;
    let speed = 0, raf = 0;
    let lastX = grabRef.current.x, lastY = grabRef.current.y;
    const locate = () => {
      const el = (document.elementFromPoint(lastX, lastY) as HTMLElement | null)?.closest("[data-page-block]") as HTMLElement | null;
      let next: { id: string; before: boolean } | null = null;
      if (el && el.dataset.pageBlock !== dragId) {
        const r = el.getBoundingClientRect();
        next = { id: el.dataset.pageBlock ?? "", before: lastY < r.top + r.height / 2 };
      }
      const cur = dropRef.current;
      if (cur?.id !== next?.id || cur?.before !== next?.before) { dropRef.current = next; setDropAt(next); }
    };
    const src = document.querySelector(`[data-page-block="${dragId}"]`) as HTMLElement | null;
    let ghost: HTMLElement | null = null;
    let offX = 0, offY = 0;
    if (src) {
      const r = src.getBoundingClientRect();
      offX = lastX - r.left; offY = lastY - r.top;
      ghost = src.cloneNode(true) as HTMLElement;
      ghost.removeAttribute("data-page-block");
      ghost.setAttribute("data-editor-drag-ghost", "");
      Object.assign(ghost.style, {
        position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`,
        maxHeight: "320px", overflow: "hidden", opacity: "0.6", pointerEvents: "none", zIndex: "1000",
        margin: "0", background: "hsl(var(--background))", borderRadius: "0.5rem",
        boxShadow: "0 20px 40px -12px hsl(var(--foreground) / 0.35)",
      });
      document.body.appendChild(ghost);
    }
    const place = () => { if (ghost) { ghost.style.left = `${lastX - offX}px`; ghost.style.top = `${lastY - offY}px`; } };
    const tick = () => { if (speed) { window.scrollBy(0, speed); locate(); } raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    const moveH = (e: MouseEvent) => {
      lastX = e.clientX; lastY = e.clientY;
      const edge = 120, h = window.innerHeight;
      if (e.clientY < edge) speed = -Math.ceil(((edge - e.clientY) / edge) * 24);
      else if (e.clientY > h - edge) speed = Math.ceil(((e.clientY - (h - edge)) / edge) * 24);
      else speed = 0;
      place(); locate();
    };
    const wheel = () => requestAnimationFrame(locate);
    const up = () => {
      const d = dropRef.current;
      if (d) moveTo(dragId, d.id, d.before);
      dropRef.current = null; setDropAt(null); setDragId("");
    };
    const prevSel = document.body.style.userSelect, prevCur = document.body.style.cursor;
    document.body.style.userSelect = "none"; document.body.style.cursor = "grabbing";
    window.addEventListener("mousemove", moveH);
    window.addEventListener("wheel", wheel, { passive: true });
    window.addEventListener("mouseup", up, { once: true });
    return () => {
      cancelAnimationFrame(raf); ghost?.remove();
      document.body.style.userSelect = prevSel; document.body.style.cursor = prevCur;
      window.removeEventListener("mousemove", moveH);
      window.removeEventListener("wheel", wheel);
      window.removeEventListener("mouseup", up);
    };
  }, [dragId]);

  /** Drag a block to a new position in the page. */
  const moveTo = (id: string, targetId: string, before: boolean) => {
    if (id === targetId) return;
    const full = orderedList(blocks);
    const from = full.findIndex(b => b.id === id);
    let to = full.findIndex(b => b.id === targetId);
    if (from < 0 || to < 0) return;
    if (!before) to++;
    if (from < to) to--;
    moveHeldBlock(id, to);
    setActiveId(id); setInlineSel(null);
  };

  const removeNow = (id: string) => {
    if (id === "page-content") return;
    const block = editState.current.blocks.find(b => b.id === id);
    if (!block) return;
    const name = frameSections?.find(s => s.key === id)?.name ?? (block.type === "object" ? block.name ?? "Object" : block.type === "heading" || block.type === "text" ? block.text : block.type);
    changeBlocks((prev) => { const next = prev.filter(b => b.id !== id); return isPageContent(next[0]) ? next.slice(1) : next; }, "removed a section");
    setFrameSections(prev => prev?.filter(s => s.key !== id) ?? null);
    toast(`${name} removed.`, { action: { label: "Undo", onClick: () => historyHandlers.current.undo() } });
  };
  const remove = (id: string) => {
    const block = editState.current.blocks.find(b => b.id === id);
    if (!block || isPageContent(block)) return;
    const name = frameSections?.find(s => s.key === id)?.name ?? (block.type === "object" ? block.name ?? "Object" : block.type === "heading" || block.type === "text" ? block.text : block.type);
    setRemoveAsk({ name, video: block.type === "video", confirm: () => removeNow(id) });
  };
  const moveHeldBlock = (id: string, to: number) => {
    const block = editState.current.blocks.find(b => b.id === id);
    changeBlocks(prev => objectId ? moveSection(prev, id, to) : movePageBlock(prev, id, to), `moved ${block?.type === "object" ? block.name ?? "an object" : block?.type ?? "a section"}`);
  };


  // Unsaved block changes waiting for auto-save; flushed if the editor closes or the page changes.
  const pendingSave = useRef<{ pageId: string; snapshot: Block[] } | null>(null);

  // Auto-save: quietly store changes shortly after the user stops editing.
  useEffect(() => {
    if (!dirty || !page || discarded.current) return;
    const pageId = page.id;
    const snapshot = blocks;
    pendingSave.current = { pageId, snapshot };
    if (embedded) return;
    const t = setTimeout(async () => {
      setSaving(true);
      const { error } = await (supabase as any)
        .from("pages")
        .update({ content: stripHeldObjects(snapshot) })
        .eq("id", pageId);
      setSaving(false);
      if (error) { toast.error(error.message ?? "Could not save the page"); return; }
      if (pendingSave.current?.snapshot === snapshot) pendingSave.current = null;
      notifyContentEdited();
      setPages((cur) => cur.map((x) => (x.id === pageId ? { ...x, content: snapshot, updated_at: new Date().toISOString() } as any : x)));
      setBlocks((cur) => { if (cur === snapshot) setDirty(false); return cur; });
    }, 800);
    return () => clearTimeout(t);
  }, [blocks, dirty, page?.id]);

  // On unmount or page change, save any pending changes right away (a safety net; embedded, Save changes normally saves first).
  useEffect(() => {
    return () => {
      if (embedded || discarded.current) {
        pendingSave.current = null; pendingInline.current = null; pendingObjects.current = {};
        return;
      }
      const p = pendingSave.current;
      const inl = pendingInline.current;
      const objs = pendingObjects.current;
      pendingSave.current = null;
      pendingInline.current = null;
      pendingObjects.current = {};
      const writes: Promise<any>[] = [];
      if (p) writes.push((supabase as any).from("pages").update({ content: stripHeldObjects(p.snapshot) }).eq("id", p.pageId));
      if (inl) writes.push((supabase as any).from("pages").update({ inline_edits: inl.next, updated_at: new Date().toISOString() }).eq("id", inl.pageId));
      Object.entries(objs).forEach(([scope, next]) => {
        const id = objectRows.current[scope];
        if (id) writes.push((supabase as any).from("object_registry").update({ inline_edits: next, updated_at: new Date().toISOString() }).eq("id", id));
      });
      if (!writes.length) return;
      Promise.all(writes).then((rs) => { if (rs.some((x: any) => !x?.error)) notifyContentEdited(); });
    };
  }, [page?.id]);

  /** Embedded: write everything held in memory. False (after a message) if any write failed; failed parts stay held. */
  const saveAllRef = useRef<() => Promise<boolean>>(async () => true);
  saveAllRef.current = async () => {
    if (discarded.current) return false;
    savingHistory.current = true;
    try {
    let wrote = false;
    let failed: string | null = null;
    const lines = describeSave();
    const p = pendingSave.current;
    if (p && objectId) {
      // Object scope: the held sections are the object's content.
      const { error } = await saveRow("object_registry", { content: p.snapshot, updated_at: new Date().toISOString() }, objectId);
      if (error) failed = error.message ?? "Could not save the object";
      else {
        wrote = true; persistedContent.current = true;
        cleanState.current = { ...cleanState.current, blocks: structuredClone(p.snapshot) };
        if (pendingSave.current === p) pendingSave.current = null;
        setBlocks((cur) => { if (cur === p.snapshot) setDirty(false); return cur; });
      }
    } else if (p) {
      const { error } = await saveRow("pages", { content: stripHeldObjects(p.snapshot) }, p.pageId);
      if (error) failed = error.message ?? "Could not save the page";
      else {
        wrote = true;
        persistedPage.current = true;
        cleanState.current = { ...cleanState.current, blocks: structuredClone(p.snapshot) };
        if (pendingSave.current === p) pendingSave.current = null;
        setPages((cur) => cur.map((x) => (x.id === p.pageId ? { ...x, content: p.snapshot, updated_at: new Date().toISOString() } as any : x)));
        setBlocks((cur) => { if (cur === p.snapshot) setDirty(false); return cur; });
      }
    }
    const inl = pendingInline.current;
    if (inl) {
      const updated_at = new Date().toISOString();
      const { error } = await saveRow("pages", { inline_edits: inl.next, updated_at }, inl.pageId);
      if (error) failed = failed ?? (error.message ?? "Could not save your changes");
      else {
        wrote = true;
        persistedPage.current = true;
        cleanState.current = { ...cleanState.current, inlineEdits: structuredClone(inl.next) };
        if (pendingInline.current === inl) pendingInline.current = null;
        setPages((cur) => cur.map((x) => (x.id === inl.pageId ? { ...x, inline_edits: inl.next, updated_at } : x)));
      }
    }
    for (const [scope, next] of Object.entries(pendingObjects.current)) {
      const id = objectRows.current[scope];
      if (!id) { failed = failed ?? "This shared object couldn't be found. Your changes haven't been saved. Try again."; continue; }
      const { error } = await saveRow("object_registry", { inline_edits: next, updated_at: new Date().toISOString() }, id);
      if (error) failed = failed ?? (error.message ?? "Could not save the shared section");
      else { wrote = true; persistedObjects.current.add(scope); cleanState.current = { ...cleanState.current, objectEdits: { ...cleanState.current.objectEdits, [scope]: structuredClone(next) } }; if (pendingObjects.current[scope] === next) delete pendingObjects.current[scope]; }
    }
    setTweaksPending(!!pendingInline.current || Object.keys(pendingObjects.current).length > 0);
    if (wrote) { notifyContentEdited(lines); }
    if (failed) { toast.error(failed); return false; }
    cleanState.current = structuredClone(editState.current);
    resetHistory();
    // Copies the saved page still uses are kept for good; the rest (undone swaps) are removed.
    const unused = unusedCopies(pendingCopies.current, editState.current as any);
    try { await dropCopies(unused); } catch (error) { toast.error(error instanceof Error ? error.message : "Couldn't remove the unused copies."); return false; }
    pendingCopies.current.clear();
    return true;
    } catch (error) {
      toast.error(error instanceof Error ? `Your changes couldn't be saved. ${error.message}` : "Your changes couldn't be saved. You are still in the editor. Try again.");
      return false;
    } finally { savingHistory.current = false; }
  };
  /** Plain lines for everything this save writes (clean state → current state). */
  const describeSave = () => {
    const subject = objectTarget ? `Object ${quote(objectTarget.name)}` : page?.name ?? "This page";
    const before = cleanState.current, after = editState.current;
    const labelsFor = (scope: string) => Object.fromEntries(Object.entries(elementLabels.current).filter(([k]) => k.startsWith(`${scope}|`)).map(([k, v]) => [k.slice(scope.length + 1), v]));
    const named = (list: Block[]) => list.map((b: any) => b.type === "object" && !b.name && heldObjects?.[b.objectId]?.name ? { ...b, name: heldObjects[b.objectId].name } : b);
    const objectLines = Object.keys(pendingObjects.current).flatMap((scope) => {
      const name = heldObjects?.[objectRows.current[scope]]?.name ?? scope;
      return inlineChangeLines(`Object ${quote(name)}`, before.objectEdits[scope] ?? {}, after.objectEdits[scope] ?? {}, labelsFor(scope));
    });
    return mergeChangeLines(
      pendingSave.current ? blockChangeLines(subject, named(before.blocks), named(after.blocks)) : [],
      pendingInline.current ? inlineChangeLines(subject, before.inlineEdits, after.inlineEdits, labelsFor("page"), swapNames.current) : [],
      objectLines,
    );
  };
  const hasChangesRef = useRef<() => boolean>(() => false);
  hasChangesRef.current = () => !discarded.current && !sameEditState(editState.current, cleanState.current);
  const restoreHistory = (kind: "undo" | "redo") => {
    if (!embedded || savingHistory.current || discarded.current) return;
    const snapshot = history.current[kind]();
    if (!snapshot) return;
    const blockChange = !sameEditState(editState.current.blocks, snapshot.blocks);
    if (blockChange) updateSectionRows(snapshot.blocks);
    editState.current = snapshot;
    setBlocks(snapshot.blocks); setInlineEdits(snapshot.inlineEdits); setObjectEdits(snapshot.objectEdits);
    pendingSave.current = sameEditState(snapshot.blocks, cleanState.current.blocks) ? null : { pageId: selectedId, snapshot: snapshot.blocks };
    pendingInline.current = sameEditState(snapshot.inlineEdits, cleanState.current.inlineEdits) ? null : { pageId: selectedId, next: snapshot.inlineEdits };
    pendingObjects.current = {};
    for (const scope of new Set([...Object.keys(snapshot.objectEdits), ...Object.keys(cleanState.current.objectEdits)])) {
      if (!sameEditState(snapshot.objectEdits[scope] ?? {}, cleanState.current.objectEdits[scope] ?? {})) pendingObjects.current[scope] = snapshot.objectEdits[scope] ?? {};
    }
    setDirty(!!pendingSave.current); setTweaksPending(!!pendingInline.current || Object.keys(pendingObjects.current).length > 0);
    if (blockChange) setSectionRevision(n => n + 1);
    setInlineSel(null); setFramedReports({});
    if (!snapshot.blocks.some(b => b.id === activeId)) setActiveId("");
    setHistoryRevision(n => n + 1);
  };
  const historyHandlers = useRef({ undo: () => {}, redo: () => {} });
  historyHandlers.current = { undo: () => restoreHistory("undo"), redo: () => restoreHistory("redo") };
  useEffect(() => {
    if (!embedded || !registerHistory) return;
    registerHistory({ undoLabel: history.current.undoLabel, redoLabel: history.current.redoLabel, changeCount: hasChangesRef.current() ? Math.max(1, history.current.changeCount) : 0,
      undo: () => historyHandlers.current.undo(), redo: () => historyHandlers.current.redo() });
    return () => registerHistory(null);
  }, [embedded, registerHistory, historyRevision]);
  useEffect(() => {
    if (!embedded) return;
    registerSave(() => saveAllRef.current());
    registerDiscard(async () => {
      discarded.current = true;
      window.clearTimeout(inlineTimer.current);
      Object.values(objectTimers.current).forEach(window.clearTimeout);
      pendingSave.current = null; pendingInline.current = null; pendingObjects.current = {};
      const baseline = opening.current;
      const writes: Promise<any>[] = [];
      if (objectId && persistedContent.current) writes.push((supabase as any).from("object_registry").update({ content: originalContent.current }).eq("id", objectId));
      if (baseline && persistedPage.current) writes.push((supabase as any).from("pages").update({ content: baseline.content, inline_edits: baseline.inline_edits, updated_at: baseline.updated_at }).eq("id", baseline.id));
      for (const scope of persistedObjects.current) {
        const id = objectRows.current[scope];
        if (id) writes.push((supabase as any).from("object_registry").update({ inline_edits: originalObjects.current[scope] ?? {} }).eq("id", id));
      }
      const results = await Promise.all(writes);
      if (results.some((r) => r.error)) { discarded.current = false; toast.error("Couldn't restore your original page. Try discarding again."); throw new Error("Discard failed"); }
      try { await dropCopies([...pendingCopies.current]); } catch (error) { discarded.current = false; toast.error(error instanceof Error ? error.message : "Couldn't remove the unused copies."); throw error; }
      if (baseline) {
        setPages((cur) => cur.map((p) => p.id === baseline.id ? baseline : p));
        setBlocks(objectId ? parseSections(originalContent.current) as unknown as Block[] : parsePageContent(baseline.content)); setInlineEdits(baseline.inline_edits ?? {});
      }
      setObjectEdits(structuredClone(originalObjects.current));
      editState.current = { blocks: objectId ? parseSections(originalContent.current) as unknown as Block[] : parsePageContent(baseline?.content), inlineEdits: baseline?.inline_edits ?? {}, objectEdits: structuredClone(originalObjects.current) };
      cleanState.current = structuredClone(editState.current); resetHistory();
      framedApi.current?.exit();
      setTweaksPending(false); setDirty(false); setActiveId("");
      setInlineSel(null); setFoldedChunks(new Set()); setResetKey((k) => k + 1); setClosed(true);
      if (writes.length) notifyContentEdited();
    });
    registerHasChanges(() => hasChangesRef.current());
    return () => { registerSave(null); registerDiscard(null); registerHasChanges(null); };
  }, [embedded, registerSave, registerDiscard, registerHasChanges]);

  // Embedded: ask before the browser leaves while changes are still held.
  const hasUnsaved = embedded && hasChangesRef.current();
  useEffect(() => {
    if (!hasUnsaved) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsaved]);


  const addButtons = (
    <>
              <Button variant="outline" size="sm" className="gap-2" title="Add an Object" onClick={() => insertAt("object", pageInsertPosition(blocks, activeId))}>
                <Boxes className="w-4 h-4" /> Object
              </Button>
              <Button variant="outline" size="sm" className="gap-2" title="Add an Image" onClick={() => addBlock("image")}>
                <ImageIcon className="w-4 h-4" /> Image
              </Button>
              <Button variant="outline" size="sm" className="gap-2" title="Add a Video" onClick={() => addBlock("video")}>
                <Film className="w-4 h-4" /> Video
              </Button>
    </>
  );

  // Manual Edit Mode: the top bar's Objects / Images / Videos open these pickers; choices go beneath the original.
  const addFromTopBar = useRef<(kind: AddKind) => void>(() => {});
  addFromTopBar.current = (kind) => {
    if (objectId) {
      if (kind === "objects") { toast("Objects can't be placed inside an object."); return; }
      if (kind === "images") setPickerFor("new"); else setVideoFor("new");
      return;
    }
    if (kind === "objects") insertAt("object", pageInsertPosition(blocks, activeId));
    else addBlock(kind === "images" ? "image" : "video");
  };
  useEffect(() => {
    if (!embedded || !registerAdd || (objectId && !designedObject)) return;
    registerAdd((kind) => addFromTopBar.current(kind));
    return () => registerAdd(null);
  }, [embedded, registerAdd, objectId, designedObject]);

  function resetEdits() {
    if (objectId) {
      changeScope(`object:${objectId}`, {});
    } else {
      if (opening.current) changeBlocks(parsePageContent(opening.current.content));
      changeInline({});
    }
    setInlineSel(null); setActiveId(""); setActiveSection(""); resetHistory();
  }
  function sectionAction(section: FrameSection, action: "up" | "down" | "delete") {
    if (section.kind === "site" || (action === "delete" ? !section.deletable && !blocks.some(b => b.id === section.key && b.type === "video") : !section.movable)) return;
    // Held sections remain Manager-owned; code sections report their resulting inline edits back.
    if (blocks.some(b => b.id === section.key)) {
      if (action === "delete") remove(section.key);
      else if (!objectId) moveHeldBlock(section.key, action === "up" ? 0 : orderedList(blocks).length - 1);
      else move(section.key, action === "up" ? -1 : 1);
    } else if (action === "delete") setRemoveAsk({ name: section.name, confirm: () => {
      framedApi.current?.sectionAction?.(section.key, "delete");
      setFrameSections(previous => previous?.filter(s => s.key !== section.key) ?? null);
      toast(`${section.name} removed.`, { action: { label: "Undo", onClick: () => historyHandlers.current.undo() } });
    } });
    else framedApi.current?.sectionAction?.(section.key, action);
  }
  const stylePanel = (
    <>
                    {inlineSel && inlineSel.scope !== "page" && !objectId && (
                      <p className="mb-4 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
                        Part of the shared object <span className="font-medium text-foreground">{inlineSel.scope}</span>. Changes apply everywhere it's used.
                        <span className="mt-1 flex items-center gap-1"><PencilRuler className="h-3.5 w-3.5" aria-hidden />Edit in Object Editor</span>
                      </p>
                    )}
                    {inlineSel?.scope === "Header" && <>
                      <SharedObjectNotice componentKey="Header" />
                      <Button variant="outline" size="sm" onClick={async () => { const id = objectRows.current.Header; if (!id) return; if (embedded) { if (await saveAll()) chat?.openObject(id, inlineSel.key, { slot: "site-header" }); } else navigate(`/manage/objects/design?object=${id}&returnPage=${selectedId}&section=${encodeURIComponent(inlineSel.key)}`); }}>Edit Object</Button>
                    </>}
                    <InlineStylePanel
                      key={`style:${inlineSel?.scope}:${inlineSel?.key}`}
                      sel={inlineSel}
                      edits={inlineSel ? scopeEdits(inlineSel.scope) : inlineEdits}
                      onChange={(next) => changeScope(inlineSel?.scope ?? "page", next)}
                      editsFor={scopeEdits}
                      onScopeChange={changeScope}
                      pages={pages}
                      onReplaceImage={async () => {
                        if (!inlineSel) return;
                        const url = await pickImage();
                        if (url) changeScope(inlineSel.scope, { ...scopeEdits(inlineSel.scope), [`img:${inlineSel.key}`]: url });
                      }}
                    />
                    {inlineSel?.kind !== "text" && <InlineDestinationPanel key={`destination:${inlineSel?.scope}:${inlineSel?.key}`} selection={inlineSel} editsFor={scopeEdits} onChange={changeScope} pages={pages} />}
                    {/* Framed pages replay in the public frame; local reports would be stale, so show none until the frame reports. */}
                    <InlineEditSafetyPanel hideReset objectName={objectTarget?.name} reports={framed ? framedReports : {}} selection={inlineSel?.kind === "image" ? null : inlineSel} editsFor={scopeEdits}
                      discard={(scope, path) => changeScope(scope, withoutPath(scopeEdits(scope), path))}
                      record={async () => { if (!framed) return; const maps = await recordFramed(); if (maps) for (const [scope, next] of Object.entries(maps)) if (JSON.stringify(next) !== JSON.stringify(scopeEdits(scope))) changeScope(scope, next); if (embedded) void saveAllRef.current(); }}
                      resetAll={resetEdits} />
    </>
  );
  const blockTools = (b: RenderBlock, i: number, showActions = true) => (
    <>
                          {b.type === "code" ? <span className="text-xs">{b.name}{b.locked ? " · Built in Code" : ""}</span> : b.type === "object" ? (
                            <>
                              <button
                                type="button"
                                title={collapsed[b.id] ? "Expand Object" : "Collapse Object"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsed((c) => ({ ...c, [b.id]: !c[b.id] }));
                                }}
                                className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                              >
                                {collapsed[b.id] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                <span>{b.name ?? "Saved Object"}</span><span className="text-muted-foreground">Shared</span>
                              </button>
                              <ToolButton title="Replace" onClick={() => setObjectFor(b.id)}>
                                <Boxes className="w-4 h-4" />
                                <span className="ml-1 text-xs">Replace</span>
                              </ToolButton>
                              <ToolButton
                                title="Edit"
                                onClick={async () => { if (embedded) { if (await saveAll()) chat?.openObject(b.objectId, undefined, { slot: b.id }); return; } navigate(`/manage/objects/design?object=${b.objectId}&returnPage=${selectedId}`); }}
                              >
                                <Pencil className="w-4 h-4" />
                                <span className="ml-1 text-xs">Edit</span>
                              </ToolButton>
                            </>
                          ) : b.type === "heading" || b.type === "text" ? (
                            <>
                              <ToolButton
                                title={b.type === "heading" ? "Turn into Text" : "Turn into Heading"}
                                active={b.type === "heading"}
                                onClick={() => update(b.id, { type: b.type === "heading" ? "text" : "heading" } as Partial<Block>)}
                              >
                                <Heading className="w-4 h-4" />
                              </ToolButton>
                              <ToolButton title="Bold" active={!!b.bold} onClick={() => update(b.id, { bold: !b.bold } as Partial<Block>)}>
                                <Bold className="w-4 h-4" />
                              </ToolButton>
                              <ToolButton title="Italic" active={!!b.italic} onClick={() => update(b.id, { italic: !b.italic } as Partial<Block>)}>
                                <Italic className="w-4 h-4" />
                              </ToolButton>
                              <span className="mx-1 h-5 w-px bg-border" />
                              {SIZES.map((s) => (
                                <ToolButton key={s} title={`Size ${SIZE_LABEL[s]}`} active={b.size === s} onClick={() => update(b.id, { size: s } as Partial<Block>)}>
                                  {SIZE_LABEL[s]}
                                </ToolButton>
                              ))}
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                title={collapsed[b.id] ? "Expand" : "Collapse"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setCollapsed((c) => ({ ...c, [b.id]: !c[b.id] }));
                                }}
                                className="flex items-center gap-1 rounded px-1 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                              >
                                {collapsed[b.id] ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                <span>{b.type === "video" ? "Video" : "Image"}</span>
                              </button>
                              {b.type === "video" ? (
                                <ToolButton title="Replace Video" onClick={() => setVideoFor(b.id)}>
                                  <Film className="w-4 h-4" />
                                  <span className="ml-1 text-xs">Replace</span>
                                </ToolButton>
                              ) : (
                                <ToolButton title="Replace Image" onClick={() => setPickerFor(b.id)}>
                                  <ImageIcon className="w-4 h-4" />
                                  <span className="ml-1 text-xs">Replace</span>
                                </ToolButton>
                              )}
                              <span className="mx-1 h-5 w-px bg-border" />
                              {([50, 75, 100] as const).map((w) => (
                                <ToolButton key={w} title={`Width ${w}%`} active={(b as ImageBlock).width === w} onClick={() => update(b.id, { width: w } as Partial<Block>)}>
                                  {w}%
                                </ToolButton>
                              ))}
                            </>
                          )}
                          {b.type === "image" ? <div className="w-full"><MediaAlignment value={b.align} onChange={align => update(b.id, { align } as Partial<Block>)} /></div> : b.type !== "object" && b.type !== "code" && (
                            <>
                              <span className="mx-1 h-5 w-px bg-border" />
                              {(["left", "center", "right"] as BlockAlign[]).map((a) => (
                                <ToolButton key={a} title={`Align ${a}`} active={b.align === a} onClick={() => update(b.id, { align: a } as Partial<Block>)}>
                                  {a === "left" ? <AlignLeft className="w-4 h-4" /> : a === "center" ? <AlignCenter className="w-4 h-4" /> : <AlignRight className="w-4 h-4" />}
                                </ToolButton>
                              ))}
                            </>
                          )}
                          <span className="mx-1 h-5 w-px bg-border" />
                          {showActions && i > 0 && (
                            <ToolButton title={objectId ? "Move Up" : "Move to Top"} onClick={() => objectId ? move(b.id, -1) : moveHeldBlock(b.id, 0)}><ArrowUp className="w-4 h-4" /></ToolButton>
                          )}
                          {showActions && i < orderedPageContent(blocks).length - 1 && (
                            <ToolButton title={objectId ? "Move Down" : "Move to Bottom"} onClick={() => objectId ? move(b.id, 1) : moveHeldBlock(b.id, orderedPageContent(blocks).length - 1)}><ArrowDown className="w-4 h-4" /></ToolButton>
                          )}
                          {showActions && <ToolButton title={b.type === "video" ? "Delete Video" : "Delete Block"} onClick={() => remove(b.id)}><Trash2 className="w-4 h-4" /></ToolButton>}
    </>
  );

  const savedVideos: { selectionId: string; parentId: string; index?: number; video: SavedVideo }[] = blocks.flatMap(b => {
    if (b.type === "video") return [{ selectionId: b.id, parentId: b.id, video: b as SavedVideo }];
    const videos = (b as unknown as { videos?: SavedVideo[] }).videos ?? [];
    return videos.map((video, index) => ({ selectionId: `${b.id}:video:${index}`, parentId: b.id, index, video }));
  });
  const selectedVideo = savedVideos.find(v => v.selectionId === activeId);
  const videoParent = selectedVideo ? blocks.find(b => b.id === selectedVideo.parentId) : undefined;
  const deleteSavedVideo = (id: string) => {
    const target = savedVideos.find(v => v.selectionId === id);
    if (!target) return;
    if (target.index === undefined) { remove(target.parentId); return; }
    setRemoveAsk({ name: "Video", video: true, confirm: () => {
      changeBlocks(prev => prev.map(b => b.id !== target.parentId ? b : { ...b, videos: ((b as unknown as { videos: SavedVideo[] }).videos ?? []).filter((_, index) => index !== target.index) } as unknown as Block), "removed a video");
      setActiveId(""); setInlineSel(null);
    } });
  };
  const selectSavedBlock = (id: string) => { setActiveId(id); setActiveSection(id); setInlineSel(null); framedApi.current?.scrollToSection?.(id); };
  const resetSavedVideo = () => {
    if (!selectedVideo) return;
    const baseline = cleanState.current.blocks.find(b => b.id === selectedVideo.parentId);
    if (!baseline) return;
    if (selectedVideo.index !== undefined) {
      const original = (baseline as unknown as { videos?: SavedVideo[] }).videos?.[selectedVideo.index];
      if (original && !isPageContent(baseline)) changeBlocks(prev => prev.map(b => b.id !== selectedVideo.parentId ? b : { ...b, align: baseline.align, videos: ((b as unknown as { videos: SavedVideo[] }).videos ?? []).map((v, i) => i === selectedVideo.index ? original : v) } as unknown as Block), "reset video settings");
    } else changeBlocks(prev => prev.map(b => b.id === baseline.id ? structuredClone(baseline) : b), "reset video settings");
  };
  // A stale/missing frame section report must never hide a saved video from staff.
  const visibleFrameSections: FrameSection[] | null = frameSections === null ? null : [...frameSections, ...blocks.filter(b => b.type === "video" && !frameSections.some(s => s.key === b.id)).map(b => ({ key: b.id, name: "Video", kind: "held" as const, collapsed: false, movable: true, deletable: true }))];
  const blockLabel = (b: RenderBlock) => b.type === "object" ? b.name ?? "Saved Object" : b.type === "code" ? b.name : b.type === "text" || b.type === "heading" ? b.text : b.type === "image" ? "Image" : "Video";
  /** Shared site chrome in the Sections list: fixed first/last, no move or delete; selecting scrolls the frame to it. */
  const chromeRow = (slot: "site-header" | "site-footer", label: string) => <li key={slot} data-section-row={slot} className="flex items-center px-2 py-2">
    <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate" onClick={() => { setActiveId(""); setInlineSel(null); framedApi.current?.scrollToSlot?.(slot); }}>{label}</Button>
    <span className="flex max-w-24 items-center gap-1 text-[10px] text-muted-foreground"><PencilRuler className="h-3 w-3 shrink-0" aria-hidden />Edit in Object Editor</span>
  </li>;
  const tools = <div className="space-y-4 p-3">
    {!selectedVideo && stylePanel}
    {selectedVideo && <SavedVideoOptions video={selectedVideo.video} onDelete={() => deleteSavedVideo(selectedVideo.selectionId)} onReset={resetSavedVideo} layout={{
      align: videoParent && !isPageContent(videoParent) ? videoParent.align : undefined,
      width: (selectedVideo.video as SavedVideo & { width?: number }).width,
      pixels: selectedVideo.index !== undefined,
      onAlign: align => update(selectedVideo.parentId, { align } as Partial<Block>),
      onWidth: width => { if (selectedVideo.index === undefined) update(selectedVideo.parentId, { width: width ?? 100 } as Partial<Block>);
        else changeBlocks(prev => prev.map(b => b.id !== selectedVideo.parentId ? b : { ...b, videos: ((b as unknown as { videos: SavedVideo[] }).videos ?? []).map((video, index) => index === selectedVideo.index ? { ...video, width } : video) } as unknown as Block), "changed video width"); },
    }} />}
    {savedVideos.filter(v => v.index !== undefined).map(v => <div key={v.selectionId} data-section-row={v.selectionId} className="space-y-2 border-b pb-2"><SavedVideoPreview compact video={v.video} /><Button variant="ghost" size="sm" onClick={() => selectSavedBlock(v.selectionId)}>Video</Button><Button variant="ghost" size="sm" className="gap-2 text-destructive" onClick={() => deleteSavedVideo(v.selectionId)}><Trash2 className="h-4 w-4" />Delete Video</Button></div>)}
    {frameSections !== null && <>
      <p className="text-xs font-medium">Sections</p>
      <ol className="divide-y rounded-md border">
        {visibleFrameSections?.map((section, i) => <li key={section.key} data-section-row={section.key} aria-current={activeSection === section.key || undefined} className={`flex items-center gap-1 px-2 py-2 ${activeSection === section.key ? "bg-accent" : ""}`}>
          {blocks.find(b => b.id === section.key)?.type === "video" && <SavedVideoPreview compact video={blocks.find(b => b.id === section.key) as VideoBlock} />}
          {section.collapsed && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-label="Collapsed" />}
          <Button variant="ghost" size="sm" className="h-auto min-w-0 flex-1 justify-start whitespace-normal text-left" onClick={() => { setActiveSection(section.key); setActiveId(blocks.some(b => b.id === section.key) ? section.key : ""); setInlineSel(null); framedApi.current?.scrollToSection?.(section.key); }}>{section.name}</Button>
          {!objectId && (section.kind === "object" || section.objectId || section.kind === "site") && <span className="flex max-w-24 flex-col text-[10px] text-muted-foreground">Shared<span className="flex items-center gap-1"><PencilRuler className="h-3 w-3 shrink-0" aria-hidden />Edit in Object Editor</span></span>}
          {section.movable && i > 0 && visibleFrameSections?.[i-1]?.kind !== "site" && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={!objectId && blocks.some(b => b.id === section.key) ? "Move to Top" : "Move Up"} aria-label={!objectId && blocks.some(b => b.id === section.key) ? "Move to Top" : "Move Up"} onClick={() => sectionAction(section, "up")}><ArrowUp className="h-3.5 w-3.5" /></Button>}
          {section.movable && i < (visibleFrameSections?.length ?? 0)-1 && visibleFrameSections?.[i+1]?.kind !== "site" && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={!objectId && blocks.some(b => b.id === section.key) ? "Move to Bottom" : "Move Down"} aria-label={!objectId && blocks.some(b => b.id === section.key) ? "Move to Bottom" : "Move Down"} onClick={() => sectionAction(section, "down")}><ArrowDown className="h-3.5 w-3.5" /></Button>}
          {(section.deletable || blocks.find(b => b.id === section.key)?.type === "video") && <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title={blocks.find(b => b.id === section.key)?.type === "video" ? "Delete Video" : "Delete Section"} aria-label={blocks.find(b => b.id === section.key)?.type === "video" ? "Delete Video" : "Delete Section"} onClick={() => sectionAction(section, "delete")}><Trash2 className="h-3.5 w-3.5" /></Button>}
        </li>)}
      </ol>
    </>}
    {designedObject && frameSections === null && <>
    <p className="text-xs font-medium">Sections</p>
    {blocks.length === 0 ? <p className="text-xs text-muted-foreground">No sections yet. Add a picture or video from the top bar.</p> :
    <ol className="divide-y border rounded-md">
      {blocks.map((b, i) => <li key={b.id} data-section-row={b.id} aria-current={activeId === b.id || undefined} className={`flex items-center gap-1 px-2 py-2 ${activeId === b.id ? "bg-accent" : ""}`}>
        {b.type === "video" && <SavedVideoPreview compact video={b} />}
        <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate" onClick={() => { setInlineSel(null); setActiveId(b.id); setInlineSel(null); void framedApi.current?.query("scrollTo", "held", b.id); }}>{sectionLabel(b as unknown as Section)}</Button>
        {i > 0 && <ToolButton title="Move Up" onClick={() => move(b.id,-1)}><ArrowUp className="h-4 w-4" /></ToolButton>}
        {i < blocks.length-1 && <ToolButton title="Move Down" onClick={() => move(b.id,1)}><ArrowDown className="h-4 w-4" /></ToolButton>}
        <ToolButton title={b.type === "video" ? "Delete Video" : "Delete Section"} onClick={() => remove(b.id)}><Trash2 className="h-4 w-4" /></ToolButton>
      </li>)}
    </ol>}
    {(() => { const b = blocks.find(x => x.id === activeId); return b ? <SectionLayoutGroup section={b as unknown as Section} onChange={updateSection} /> : null; })()}
    </>}
    {designedObject && frameSections !== null && (() => { const b = blocks.find(x => x.id === activeId); return b ? <SectionLayoutGroup section={b as unknown as Section} onChange={updateSection} /> : null; })()}
    {!objectId && frameSections === null && <>
    <p className="text-xs font-medium">Sections</p>
    <ol className="divide-y border rounded-md">
      {chromeRow("site-header", "Site Header")}
      {orderedPageContent(blocks).map((b,i) => isPageContent(b) ? <li key={b.id} data-section-row={b.id} className="px-2 py-2 text-xs">Page Content</li> : <li key={b.id} data-section-row={b.id} aria-current={activeId === b.id || undefined} className={`flex items-center gap-1 px-2 py-2 ${activeId === b.id ? "bg-accent" : ""}`}>
        {b.type === "video" && <SavedVideoPreview compact video={b} />}
        <Button variant="ghost" size="sm" className="min-w-0 flex-1 justify-start truncate" onClick={() => { setInlineSel(null); setActiveId(b.id); if (heldInFrame) { void framedApi.current?.query("scrollTo", "held", b.id); return; } blockCanvasRef.current?.querySelector(`[data-page-block="${b.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }); }}>{blockLabel(b)}</Button>{b.type === "object" && <span className="flex max-w-24 flex-col text-[10px] text-muted-foreground">Shared<span className="flex items-center gap-1"><PencilRuler className="h-3 w-3 shrink-0" aria-hidden />Edit in Object Editor</span></span>}
        {i > 0 && <ToolButton title="Move to Top" onClick={() => moveHeldBlock(b.id,0)}><ArrowUp className="h-4 w-4" /></ToolButton>}
        {i < orderedPageContent(blocks).length-1 && <ToolButton title="Move to Bottom" onClick={() => moveHeldBlock(b.id,orderedPageContent(blocks).length-1)}><ArrowDown className="h-4 w-4" /></ToolButton>}
        <ToolButton title={b.type === "video" ? "Delete Video" : "Delete Block"} onClick={() => remove(b.id)}><Trash2 className="h-4 w-4" /></ToolButton>
      </li>)}
      {chromeRow("site-footer", "Site Footer")}
    </ol>
    {(() => { const list=orderedPageContent(blocks); const i=list.findIndex(b=>b.id===activeId); const b=list[i]; return !b || isPageContent(b) ? null : <div className="flex flex-wrap gap-1">{blockTools(b,i)}</div>; })()}
    </>}
    {!designedObject && !hasOwnSections(blocks.some(b => !isPageContent(b)), visibleFrameSections) && <p className="text-xs text-muted-foreground">No sections yet. Add a picture or video from the top bar.</p>}
    {designedObject && (
      <p className="rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground">
        Each section's layout is under Section Layout when you select it. A few settings are still only in the{" "}
        <a className="underline" href={`/manage/objects/design?object=${objectTarget.objectId}&legacy=1`}>full designer</a>.
      </p>
    )}
    {!objectId && frameSections !== null && (() => { const list = orderedPageContent(blocks); const i = list.findIndex(b => b.id === activeId); const b = list[i]; return !b || isPageContent(b) ? null : <div className="flex flex-wrap gap-1">{blockTools(b,i,false)}</div>; })()}
    <ResetEditsAction name={objectTarget?.name ?? page?.name ?? "this page"} object={!!objectId} onReset={resetEdits} />
  </div>;

  /** Framed pages: the public frame records fingerprints (withFingerprints per scope); invalid maps are dropped. */
  const recordFramed = async (): Promise<Record<string, InlineEdits>> => {
    const result = await framedApi.current?.query("record", "page", "");
    const out: Record<string, InlineEdits> = {};
    if (result && typeof result === "object") for (const [scope, map] of Object.entries(result as Record<string, unknown>)) { const ok = editMap(map); if (ok) out[scope] = ok; }
    return out;
  };
  const [objectAsk, setObjectAsk] = useState<ObjectAsk | null>(null);
  const [copying, setCopying] = useState(false);
  const [openAsk, setOpenAsk] = useState<string | null>(null);
  const swaps = useMemo(() => swapsOf(inlineEdits), [inlineEdits]);
  const askObject = (click: ObjectClick) => {
    const kind = objectClickKind(click, editState.current.inlineEdits, !!click.objectId && siteWideIds.current.has(click.objectId));
    const here = page?.name ?? "";
    if (kind === "site") { setObjectAsk({ ...click, kind, usedOn: [] }); return; }
    // Every object click asks first (ObjectClickDialog), so it's clear objects are edited separately from the page.
    if (kind === "copy") { setObjectAsk({ ...click, kind, usedOn: here ? [here] : [] }); return; }
    // Every page that uses it: saved page content and swaps, plus code placements in the public manifest.
    const fromPages = pages.filter((p) => click.objectId && JSON.stringify([p.content ?? null, p.inline_edits ?? null]).includes(click.objectId)).map((p) => p.name);
    const key = click.componentKey ?? (click.objectId ? heldObjects?.[click.objectId]?.component_key : null);
    const observed = click.objectId ? frameObjectPaths(click.objectId).map(path => pages.find(p => pageKey(p.path) === path)?.name ?? path) : [];
    const fromSite = key ? findObjectUsages(key).then((u) => u.map((x) => x.name)).catch(() => null) : Promise.resolve(null);
    void fromSite.then((site) => {
      const usedOn = site === null && ![...fromPages, ...observed].some((n) => n !== here) ? null : [...new Set([...(site ?? []), ...fromPages, ...observed, here].filter(Boolean))];
      setObjectAsk({ ...click, kind, usedOn });
    });
  };
  /** The page slot the object was opened from, so Save can scroll the page back to it. */
  const openSlot = useRef<string | undefined>(undefined);
  const openObjectEditor = (id: string, slot?: string) => {
    openSlot.current = slot;
    if (!embedded) { navigate(`/manage/objects/design?object=${id}&returnPage=${selectedId}`); return; }
    if (hasChangesRef.current()) { setOpenAsk(id); return; }
    chat?.openObject(id, undefined, { slot: openSlot.current });
  };
  const makeCopy = async () => {
    const ask = objectAsk; if (!ask?.objectId || !page || discarded.current) return;
    setCopying(true);
    try {
      const { data: original, error } = await (supabase as any).from("object_registry").select("name,component_key,content,inline_edits,labels").eq("id", ask.objectId).maybeSingle();
      if (error || !original) throw new Error("missing");
      const { data: row, error: insertError } = await (supabase as any).from("object_registry").insert({
        name: copyName(original.name || ask.name, page.name), component_key: original.component_key, content: original.content,
        inline_edits: original.inline_edits ?? {}, labels: original.labels ?? [], status: "Ready",
      }).select("id,name,status,component_key,content,inline_edits").single();
      if (insertError || !row) throw new Error("insert");
      pendingCopies.current.add(row.id);
      swapNames.current[ask.slot] = original.name || ask.name;
      setHeldObjects((cur) => ({ ...(cur ?? {}), [row.id]: { status: row.status, name: row.name, component_key: row.component_key ?? null, content: row.content, inline_edits: row.inline_edits ?? {} } }));
      const next = applySwap(editState.current.blocks as any[], editState.current.inlineEdits, ask.slot, row.id);
      recordEdit({ blocks: next.blocks as Block[], inlineEdits: next.edits }, { label: `copied ${ask.name} for this page` });
      setInlineEdits(next.edits);
      pendingInline.current = { pageId: page.id, next: next.edits }; setTweaksPending(true);
      if (next.changedBlocks) { setBlocks(next.blocks as Block[]); pendingSave.current = { pageId: page.id, snapshot: next.blocks as Block[] }; setSectionRevision((n) => n + 1); setDirty(true); }
      setObjectAsk(null);
      toast.success(`This copy is only used on ${page.name}. Click it on the page to open it in the object editor.`);
    } catch {
      toast.error("Couldn't make a copy. Try again.");
    } finally { setCopying(false); }
  };
  const openInlineObject = async (key: string, section: string) => {
    const id = objectRows.current[key]; if (!id) return;
    if (embedded) { if (await saveAll()) chat?.openObject(id, section); }
    else navigate(`/manage/objects/design?object=${id}&returnPage=${selectedId}&section=${encodeURIComponent(section)}`);
  };
  if (closed) return null;
  return (<div className={embedded ? "h-full min-h-0" : "grid gap-4 lg:grid-cols-[240px_1fr]"}>
    {!embedded && <aside><Input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pages" />{filtered.map(p=><Button key={p.id} variant="ghost" className="w-full justify-start" onClick={()=>select(p.id)}>{p.name}</Button>)}{tools}</aside>}
    {surface === "loading" && selectedId && <div role="status" className="flex items-center justify-center bg-muted p-6 text-sm text-muted-foreground">Loading the page editor…</div>}
    {page && surface !== "loading" && <EmbeddedBox chat={embedded ? chat : null}>
      <div ref={blockCanvasRef} className={`relative isolate h-full w-full ${heldInFrame && !deviceStyle ? "overflow-hidden" : "overflow-y-auto"} bg-background`} style={deviceStyle}>
        {!embedded && <div className="flex gap-2">{addButtons}</div>}
        <ScaledViewport virtualWidth={previewDevice === "mobile" ? 390 : previewDevice === "tablet" ? 768 : DESKTOP_VIRTUAL_WIDTH} what={previewDevice === "mobile" ? "phone" : previewDevice} fallbackWidth={previewDevice === "desktop" ? 768 : undefined} explicit={desktopChosen} fill={embedded && heldInFrame && !deviceStyle} enabled={previewDevice !== "desktop" || window.innerWidth >= 640}>
        <FramedPageEditor key={objectId ? `object-${objectId}` : `public-${page.id}`} base={draftEmbedUrl()} path={objectId ? objectFramePath(objectId) : page.path} edits={inlineEdits} objectEdits={objectEdits}
          objectScope={objectTarget} scrollToSlot={objectId ? null : returnTo ?? null}
          sectionRevision={sectionRevision} heldBlocks={objectId && !designedObject ? NO_BLOCKS : blocks} heldObjects={heldObjects} activeBlockId={activeId || null}
          onSections={receiveSections}
          onBlockSelect={(id) => { const video = savedVideos.find(v => v.video.id === id); setActiveId(video?.selectionId ?? id); setActiveSection(id); setInlineSel(null); requestAnimationFrame(() => document.querySelector(`[data-section-row="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" })); }} onHeldInFrame={setHeldInFrame} onBlockMove={(id, toIndex) => { moveHeldBlock(id, toIndex); setActiveId(id); setActiveSection(id); setInlineSel(null); }} fill={!deviceStyle}
          onUndo={() => restoreHistory("undo")} onRedo={() => restoreHistory("redo")}
          collapsed={foldedChunks} selectedKey={inlineSel ? `${inlineSel.scope}|${inlineSel.key}` : null} apiRef={framedApi}
          onImageDelete={() => { if (!inlineSel) return; const next = selectedImageDelete(inlineSel, scopeEdits(inlineSel.scope)); if (next) changeScope(inlineSel.scope, next); }}
          onChange={(scope, next) => changeScope(scope, next, true)} onSelect={selection => {
            if (!objectId && selection?.scope === "Footer") { setInlineSel(null); askObject({ objectId: objectRows.current.Footer ?? null, componentKey: "Footer", name: "Site Footer", slot: "site-footer", siteWide: true }); }
            else setInlineSel(selection);
          }}
          onToggle={k => setFoldedChunks(cur => { const next = new Set(cur); if (next.has(k)) next.delete(k); else next.add(k); return next; })}
          onReorder={reorderChunks} onOpenObject={openInlineObject} onReport={setFramedReports} onNavigate={objectId ? undefined : onNavigate}
          onObjectClick={objectId ? undefined : askObject} objectSwaps={swaps} />
        </ScaledViewport>
        {/* Held sections: full pane width, selected (never played or opened) until saved into the public page. */}
        {!heldInFrame && !objectId && <div data-held-sections className="w-full">
          {blocks.filter((b): b is RenderBlock => !isPageContent(b)).map((b)=><section key={b.id} data-page-block={b.id} data-active={activeId === b.id || undefined}
            className={`relative ${embedded ? "cursor-pointer [&_iframe]:pointer-events-none [&_video]:pointer-events-none" : ""}`}
            onClickCapture={embedded ? (e) => { if ((e.target as HTMLElement).closest("[contenteditable=true],input,textarea,select")) return; e.preventDefault(); setActiveId(b.id); setInlineSel(null); } : undefined}>
            {/* The bar takes its own row above the section (like the public frame's reserved space), never covering content. */}
            {embedded && <div data-section-bar className={`flex h-7 items-center px-3 text-xs ${activeId === b.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>{blockLabel(b)}</div>}
            <>{b.type === "video" ? <SavedVideoPreview video={b} /> : <BlockView block={b} />}</>
          </section>)}
        </div>}
      </div>
    </EmbeddedBox>}
    {embedded && slot && createPortal(tools,slot)}
      <ObjectClickDialog ask={objectAsk} pageName={page?.name ?? "this page"} busy={copying}
        onCancel={() => setObjectAsk(null)} onCopy={() => void makeCopy()}
        onOpen={async () => {
          const ask = objectAsk; if (!ask) return;
          let id = ask.objectId;
          if (!id && ask.siteWide && (ask.componentKey === "Header" || ask.componentKey === "Footer")) {
            const { data, error } = await supabase.from("object_registry").select("id").eq("component_key", ask.componentKey).eq("site_wide", true).is("archived_at", null).maybeSingle();
            if (error || !data) { toast.error("Couldn't find this object. Try again."); return; }
            id = data.id;
          }
          setObjectAsk(null); if (id) openObjectEditor(id, ask.slot);
        }} />
      <ConfirmDialog open={!!openAsk} onOpenChange={(open) => { if (!open) setOpenAsk(null); }} title="You have unsaved changes"
        description="Save your edits to this page before opening the object editor?" destructive={false} primaryFirst
        confirmLabel="Save Changes" confirmIcon={<SaveIcon className="h-4 w-4" aria-hidden />}
        secondaryLabel="Discard Changes" secondaryIcon={<TrashIcon className="h-4 w-4" aria-hidden />}
        cancelLabel="Return to Edit" cancelIcon={<PencilIcon className="h-4 w-4" aria-hidden />}
        onConfirm={async () => { const id = openAsk; setOpenAsk(null); if (id && await saveAll()) chat?.openObject(id, undefined, { slot: openSlot.current }); }}
        onSecondary={async () => { const id = openAsk; setOpenAsk(null); if (!id) return; try { await discardAll(); chat?.openObject(id, undefined, { slot: openSlot.current }); } catch { /* stays on the page */ } }} />
      <CreatePageDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (p) => { await load(); select(p.id); }}
      />
      <ObjectPickerDialog
        open={!!objectFor}
        onPickMany={objectFor === "new" ? choices => {
          const additions: ObjectBlock[] = choices.map(({ id, name }) => ({ id: newId(), type: "object", objectId: id, name, align: "left" }));
          if (!additions.length) return;
          changeBlocks([...editState.current.blocks, ...additions], `added ${additions.length} objects`);
          setActiveId(additions.at(-1)?.id ?? ""); setObjectFor(null); setObjectAt(null);
        } : undefined}
        onOpenChange={(v) => { if (!v) { setObjectFor(null); setObjectAt(null); } }}
        onPick={({ id, name }) => {
          if (objectFor === "new") {
            const block: ObjectBlock = { id: newId(), type: "object", objectId: id, name, align: "left" };
            addPickedBlock(block, pageInsertPosition(blocks, activeId, objectAt));
          } else if (objectFor) {
            update(objectFor, { objectId: id, name } as Partial<Block>);
          }
          setObjectFor(null);
          setObjectAt(null);
        }}
      />
      <ConfirmDialog open={!!removeAsk} onOpenChange={open => { if (!open) setRemoveAsk(null); }} title={`Remove ${removeAsk?.name ?? "This Section"}?`} description="The section will be removed from this page. You can undo it before saving." confirmLabel={removeAsk?.video ? "Delete Video" : "Delete Section"} onConfirm={() => { const ask = removeAsk; setRemoveAsk(null); ask?.confirm(); }} />
      <VideoPickerDialog
        open={!!videoFor}
        onOpenChange={(v) => { if (!v) { setVideoFor(null); setVideoAt(null); } }}
        onPick={({ url, poster }) => {
          if (videoFor === "new" && objectId) addSection(videoSection(url, poster));
          else if (videoFor === "new") {
            addPickedBlock({ id: newId(), type: "video", align: "left", width: 100, url, poster: poster ?? undefined } as VideoBlock, pageInsertPosition(blocks, activeId, videoAt));
          } else if (videoFor) update(videoFor, { url, poster: poster ?? undefined } as Partial<Block>);
          setVideoFor(null);
          setVideoAt(null);
        }}
      />
      <ImagePickerDialog
        open={!!imgAsk}
        onOpenChange={(v) => { if (!v && imgAsk) { imgAsk(null); setImgAsk(null); } }}
        onPick={({ url }) => { imgAsk?.(url); setImgAsk(null); }}
      />
      <ImagePickerDialog
        open={!!pickerFor}
        onOpenChange={(v) => { if (!v) { setPickerFor(null); setImageAt(null); } }}
        onPick={({ url, alt }) => {
          if (pickerFor === "new" && objectId) addSection(imageSection(url, alt || ""));
          else if (pickerFor === "new") {
            addPickedBlock({ id: newId(), type: "image", align: "left", width: 100, url, alt: alt || "" } as ImageBlock, pageInsertPosition(blocks, activeId, imageAt));
          } else if (pickerFor) update(pickerFor, { url, alt: alt || "" } as Partial<Block>);
          setPickerFor(null);
          setImageAt(null);
        }}
      />
    </div>
  );
}

