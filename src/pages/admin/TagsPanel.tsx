import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Tag, Plus, Trash2, X, Search, Palette, ChevronRight, ChevronDown, Pencil,
} from "lucide-react";
import { toast } from "sonner";
import ConfirmDialog from "./ConfirmDialog";
import { colorFor, pickLeastUsedColor } from "./labelColors";
import {
  useLabelsForScope, useInvalidateLabels,
  registerLabelPath, setLabelColorById, renameLabel, reparentLabel,
  deleteLabelPromoteChildren, deleteLabelSubtree,
  type LabelScope, type LabelRow,
} from "./useAllLabels";
import { LABEL_SEP, MAX_DEPTH, isDescendantOrSelf, validateLeafName } from "./labelPath";
import ColorSwatchPicker from "./ColorSwatchPicker";

interface Props {
  scope: LabelScope;
  /** Usage counts keyed by exact label PATH (as stored on items). */
  usageCounts: Record<string, number>;
  activeFilters: string[];
  onToggleFilter: (path: string) => void;
  onClearFilters: () => void;
  selectedCount: number;
  selectedIds: string[];
  onApplyTag: (ids: string[], path: string) => Promise<void> | void;
  itemLabel: string;
  filteredCount?: number;
  onSelectAllFiltered?: () => void;
  /** Render without the outer "Labels" card and header, for embedding. */
  bare?: boolean;
}

interface TreeNode {
  row: LabelRow;
  children: TreeNode[];
}
const SCOPE_LABELS: Record<LabelScope, string> = {
  static: "Static Pages",
  landing: "Landing Pages",
  objects: "Objects",
  images: "Images",
  videos: "Videos",
  links: "Link Audit",
};


/** Build a tree from a flat, path-sorted LabelRow list. */
function buildTree(rows: LabelRow[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const roots: TreeNode[] = [];
  for (const r of rows) byId.set(r.id, { row: r, children: [] });
  for (const r of rows) {
    const node = byId.get(r.id)!;
    if (r.parent_id && byId.has(r.parent_id)) byId.get(r.parent_id)!.children.push(node);
    else roots.push(node);
  }
  const sortRec = (arr: TreeNode[]) => {
    arr.sort((a, b) => a.row.name.localeCompare(b.row.name));
    arr.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

/** Sum of usage across a subtree (rolled up). */
function subtreeCount(node: TreeNode, counts: Record<string, number>): number {
  let n = counts[node.row.path] ?? 0;
  for (const c of node.children) n += subtreeCount(c, counts);
  return n;
}

export default function TagsPanel({
  scope, usageCounts, activeFilters, onToggleFilter, onClearFilters,
  selectedCount, selectedIds, onApplyTag, itemLabel,
  filteredCount, onSelectAllFiltered, bare,
}: Props) {
  const { data: rows = [] } = useLabelsForScope(scope);
  const invalidate = useInvalidateLabels(scope);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [drop, setDrop] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<LabelRow | null>(null);
  const [deleting, setDeleting] = useState<LabelRow | null>(null);

  const tree = useMemo(() => buildTree(rows), [rows]);

  // Auto-expand nodes whose subtree matches the filter or an active filter.
  useEffect(() => {
    if (!filter && activeFilters.length === 0) return;
    const next = new Set(expanded);
    const term = filter.toLowerCase();
    const walk = (n: TreeNode): boolean => {
      const selfMatch = term ? n.row.path.toLowerCase().includes(term) : false;
      const childMatch = n.children.some(walk);
      const activeInSubtree = activeFilters.some((f) => isDescendantOrSelf(f, n.row.path));
      if (childMatch || activeInSubtree) next.add(n.row.id);
      return selfMatch || childMatch || activeInSubtree;
    };
    tree.forEach(walk);
    setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, activeFilters, rows]);

  const totalCount = rows.length;


  const applyToSelection = async (path: string) => {
    if (selectedIds.length === 0) { toast.error(`Select ${itemLabel} first`); return; }
    await onApplyTag(selectedIds, path);
  };

  const handleDrop = async (e: React.DragEvent, path: string) => {
    e.preventDefault(); setDrop(null);
    try {
      const ids = JSON.parse(e.dataTransfer.getData("text/plain")) as string[];
      if (Array.isArray(ids) && ids.length) await onApplyTag(ids, path);
    } catch { /* noop */ }
  };

  // Match term against node OR any of its descendants.
  const nodeMatchesFilter = (n: TreeNode, term: string): boolean => {
    if (!term) return true;
    if (n.row.path.toLowerCase().includes(term)) return true;
    return n.children.some((c) => nodeMatchesFilter(c, term));
  };

  const renderNode = (n: TreeNode, depth: number) => {
    const term = filter.toLowerCase();
    if (!nodeMatchesFilter(n, term)) return null;
    const isOpen = expanded.has(n.row.id) || term.length > 0;
    const hasChildren = n.children.length > 0;
    const active = activeFilters.includes(n.row.path);
    const rollup = subtreeCount(n, usageCounts);
    const isDrop = drop === n.row.path;
    const color = colorFor(n.row.path, n.row.color_index);
    return (
      <div key={n.row.id}>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrop(n.row.path); e.dataTransfer.dropEffect = "copy"; }}
          onDragLeave={() => setDrop((d) => (d === n.row.path ? null : d))}
          onDrop={(e) => handleDrop(e, n.row.path)}
          className={`group relative flex items-center gap-1 pr-1 py-1 mx-1 rounded cursor-pointer transition-colors ${
            isDrop ? "bg-[hsl(38_50%_85%)] ring-1 ring-[hsl(38_31%_55%)]"
            : active ? "bg-[hsl(38_45%_88%)] text-[hsl(30_25%_20%)]"
            : "hover:bg-muted"
          }`}
          style={{ paddingLeft: 4 + depth * 12 }}
          onClick={() => onToggleFilter(n.row.path)}
          title={active ? `Filtering by "${n.row.path}" (rolls up children)` : `Filter by "${n.row.path}" (rolls up children)`}
        >
          {hasChildren ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setExpanded((s) => { const nx = new Set(s); if (nx.has(n.row.id)) nx.delete(n.row.id); else nx.add(n.row.id); return nx; }); }}
              className="w-4 h-4 flex items-center justify-center shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={isOpen ? "Collapse" : "Expand"}
            >
              {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            </button>
          ) : (
            <span className="w-4 h-4 shrink-0" />
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon"
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="h-11 w-11 shrink-0 focus:outline-none"
                title={`Change color — ${color.name}`}
                aria-label={`Change color for ${n.row.path}`}
              >
                <Tag className="w-4 h-4" style={{ color: color.iconStroke, fill: color.iconFill }} strokeWidth={2} />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-2" collisionPadding={16} onClick={(e) => e.stopPropagation()}>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5 flex items-center gap-1">
                <Palette className="w-3 h-3" /> Color for &ldquo;{n.row.name}&rdquo;
              </div>
              <ColorSwatchPicker
                value={(n.row.color_index ?? color.idx) as number}
                onChange={async (idx) => { await setLabelColorById(n.row.id, idx); invalidate(); }}
              />
            </PopoverContent>
          </Popover>

          <span title={n.row.path} className={`min-w-0 truncate text-xs flex-1 ${active ? "font-medium" : ""}`}>{n.row.name}</span>

          <div className="flex items-center gap-2 shrink-0">
            {selectedCount > 0 && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); applyToSelection(n.row.path); }}
                className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-primary hover:text-primary-foreground"
                title={`Apply "${n.row.path}" to ${selectedCount} selected`}
              >
                <Plus className="w-3 h-3" />
              </button>
            )}
            <Button variant="ghost" size="icon"
              type="button"
              onClick={(e) => { e.stopPropagation(); setEditing(n.row); }}
              className="h-11 w-11 rounded hover:bg-muted-foreground/20"
              title="Edit Label"
              aria-label={`Edit ${n.row.path}`}
            >
              <Pencil className="w-3 h-3" />
            </Button>
            <Button variant="ghost" size="icon"
              type="button"
              onClick={(e) => { e.stopPropagation(); setDeleting(n.row); }}
              className="h-11 w-11 rounded hover:bg-destructive hover:text-destructive-foreground"
              title="Delete Label"
              aria-label={`Delete ${n.row.path}`}
            >
              <Trash2 className="w-3 h-3" />
            </Button>
            <span className="order-first text-[10px] tabular-nums text-muted-foreground">
              {hasChildren ? rollup : (usageCounts[n.row.path] ?? 0)}
            </span>
          </div>
        </div>
        {hasChildren && isOpen && (
          <div>{n.children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <aside className={bare ? "w-full" : "w-72 max-w-full shrink-0 sticky top-0 self-start max-h-[calc(100vh-9rem)]"}>
      <div className={bare ? "flex flex-col max-h-[45vh]" : "border rounded-lg bg-muted/20 flex flex-col max-h-[calc(100vh-9rem)]"}>
        {!bare && (
          <div className="px-3 pt-3 pb-2 flex items-center gap-2">
            <Tag className="w-4 h-4 text-[hsl(38_31%_45%)]" />
            <div className="text-sm font-medium">Labels</div>
            <span className="text-xs text-muted-foreground ml-auto">{totalCount}</span>
          </div>
        )}


        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search labels…"
              aria-label="Search Labels"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-7 pl-6 text-xs"
            />
          </div>
        </div>

        {activeFilters.length > 0 && (
          <div className="px-3 pb-2 space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center justify-between">
              <span>Active Filters</span>
              <button onClick={onClearFilters} className="text-[10px] normal-case tracking-normal text-primary hover:underline">
                Clear All
              </button>
            </div>
            <div className="flex flex-wrap gap-1">
              {activeFilters.map((t) => (
                <button
                  key={t}
                  onClick={() => onToggleFilter(t)}
                  className="group inline-flex items-center gap-1 max-w-full text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                  title={`Remove "${t}" from filters`}
                >
                  <span className="truncate">{t.split(LABEL_SEP).join(" › ")}</span>
                  <X className="w-2.5 h-2.5 shrink-0 opacity-70 group-hover:opacity-100" />
                </button>
              ))}
            </div>
            {activeFilters.length > 1 && (
              <p className="text-[10px] text-muted-foreground leading-tight">
                Showing {itemLabel} with <strong>all {activeFilters.length}</strong> selected labels (parents include children).
              </p>
            )}
            {onSelectAllFiltered && (filteredCount ?? 0) > 0 && (
              <button
                onClick={onSelectAllFiltered}
                className="w-full text-[11px] px-2 py-1 rounded border border-primary/30 bg-primary/5 hover:bg-primary/10 text-primary font-medium"
              >
                Select All {filteredCount} {itemLabel}
              </button>
            )}
          </div>
        )}

        {selectedCount > 0 && (
          <div className="mx-3 mb-2 text-[11px] px-2 py-1 rounded bg-primary/5 border border-primary/20 text-muted-foreground">
            {selectedCount} selected — click <Plus className="inline w-2.5 h-2.5" /> on a label to apply
          </div>
        )}

        <div className="flex-1 overflow-y-auto pb-1">
          {tree.length === 0 && (
            <div className="px-3 py-4 text-xs text-muted-foreground italic text-center">
              No labels yet
            </div>
          )}
          {rows.map(row => renderNode({ row, children: [] }, 0))}
        </div>

        <div className="border-t p-2">
          <button
            onClick={() => setCreating(true)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            Create New Label
          </button>
        </div>

      </div>

      {creating && (
        <CreateLabelDialog
          rows={rows}
          scope={scope}
          selectedCount={selectedCount}
          onClose={() => setCreating(false)}
          onCreated={async (path) => {
            invalidate();
            setCreating(false);
            if (selectedIds.length > 0) {
              await onApplyTag(selectedIds, path);
              toast.success(`Created "${path}" and applied to ${selectedIds.length}`);
            } else {
              toast.success(`Created label "${path}"`);
            }
          }}
        />
      )}

      {editing && (
        <EditLabelDialog
          row={editing}
          rows={rows}
          scope={scope}
          onClose={() => setEditing(null)}
          onSaved={() => { invalidate(); setEditing(null); }}
        />
      )}

      {deleting && (
        <DeleteLabelDialog
          row={deleting}
          rows={rows}
          scope={scope}
          usageCounts={usageCounts}
          itemLabel={itemLabel}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            if (activeFilters.includes(deleting.path)) onToggleFilter(deleting.path);
            invalidate();
            setDeleting(null);
          }}
        />
      )}
    </aside>
  );
}

/* ---------------------------- Edit dialog ---------------------------- */

function EditLabelDialog({
  row, rows, scope, onClose, onSaved,
}: { row: LabelRow; rows: LabelRow[]; scope: LabelScope; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(row.name);
  const [parentId, setParentId] = useState<string | null>(row.parent_id);
  const [colorIdx, setColorIdx] = useState<number>(row.color_index ?? colorFor(row.path, row.color_index).idx);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Valid parents: any row that is not a descendant of `row` (and not itself),
  // AND whose new depth + subtree height fits within MAX_DEPTH.
  const validParents = useMemo(() => {
    return rows.filter((r) => !isDescendantOrSelf(r.path, row.path));
  }, [rows, row.path]);

  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const trimmed = name.trim().toLowerCase();
      if (trimmed !== row.name) {
        const res = await renameLabel(scope, row, trimmed);
        if (!res.ok) throw new Error((res as { ok: false; error: string }).error);
      }
      if (parentId !== row.parent_id) {
        const freshRow = { ...row, name: name.trim().toLowerCase() };
        const res = await reparentLabel(scope, freshRow, parentId, rows);
        if (!res.ok) throw new Error((res as { ok: false; error: string }).error);
      }
      if (colorIdx !== row.color_index) {
        await setLabelColorById(row.id, colorIdx);
      }
      onSaved();
    } catch (e: any) {
      setErr(e?.message ?? "Could not save");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Label</DialogTitle>
          <DialogDescription>
            This label will only apply to <strong className="font-semibold text-foreground">{SCOPE_LABELS[scope]}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div>
            <label htmlFor="lbl-name" className="text-xs font-medium">Name</label>
            <Input id="lbl-name" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 h-8 text-sm" />
          </div>
          <div>
            <label htmlFor="lbl-parent" className="text-xs font-medium">Nest Label Under:</label>
            <select
              id="lbl-parent"
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="mt-1 w-full h-8 border rounded px-2 text-sm bg-background"
            >
              <option value="">— Top level —</option>
              {validParents.map((r) => (
                <option key={r.id} value={r.id}>{r.path.split(LABEL_SEP).join(" › ")}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Max nesting depth is {MAX_DEPTH}. Moving a label moves its whole subtree.
            </p>
          </div>
          <div>
            <div className="text-xs font-medium mb-1 flex items-center gap-1"><Palette className="w-3 h-3" /> Color</div>
            <ColorSwatchPicker value={colorIdx} onChange={setColorIdx} size="md" />
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------- Delete dialog --------------------------- */

function DeleteLabelDialog({
  row, rows, scope, usageCounts, itemLabel, onClose, onDeleted,
}: {
  row: LabelRow; rows: LabelRow[]; scope: LabelScope;
  usageCounts: Record<string, number>; itemLabel: string;
  onClose: () => void; onDeleted: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const descendants = rows.filter((r) => r.path.startsWith(row.path + LABEL_SEP));
  const hasChildren = descendants.some((r) => r.parent_id === row.id);
  const subtreePaths = [row.path, ...descendants.map((r) => r.path)];
  const subtreeUsage = subtreePaths.reduce((n, p) => n + (usageCounts[p] ?? 0), 0);
  const [mode, setMode] = useState<"promote" | "subtree">(hasChildren ? "promote" : "subtree");

  const run = async () => {
    setBusy(true); setErr(null);
    try {
      if (mode === "promote") {
        await deleteLabelPromoteChildren(scope, row, rows);
      } else {
        await deleteLabelSubtree(scope, row, rows);
      }
      onDeleted();
    } catch (e: any) {
      setErr(e?.message ?? "Could not delete");
    } finally {
      setBusy(false);
    }
  };

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Delete label "${row.path.split(LABEL_SEP).join(" › ")}"?`}
      confirmLabel={busy ? "Deleting…" : (mode === "promote" ? "Promote children & delete" : "Delete subtree")}
      onConfirm={run}
      description={
        <div className="space-y-3">
          <div className="text-sm">
            This label is used on <strong>{usageCounts[row.path] ?? 0}</strong> {itemLabel}.
            {" "}
            {hasChildren ? (
              <>Has <strong>{descendants.length}</strong> descendant label{descendants.length === 1 ? "" : "s"}.</>
            ) : "This label has no children."}
            {" "}Applied across the subtree to{" "}
            <strong>{subtreeUsage}</strong> {itemLabel}.
          </div>
          {hasChildren && (
            <div className="space-y-1.5 border rounded p-2">
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio" className="mt-0.5"
                  checked={mode === "promote"} onChange={() => setMode("promote")}
                />
                <span>
                  <strong>Promote children up one level</strong>
                  <div className="text-xs text-muted-foreground">
                    Children move to <code>{row.parent_id ? rows.find((r) => r.id === row.parent_id)?.path.split(LABEL_SEP).join(" › ") : "top level"}</code>.
                    Items tagged with the deleted label lose only that tag.
                  </div>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio" className="mt-0.5"
                  checked={mode === "subtree"} onChange={() => setMode("subtree")}
                />
                <span>
                  <strong>Delete the whole subtree</strong>
                  <div className="text-xs text-muted-foreground">
                    Removes this label and every descendant. Items lose every matching tag.
                  </div>
                </span>
              </label>
            </div>
          )}
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>
      }
    />
  );
}

/* --------------------------- Create dialog --------------------------- */

function CreateLabelDialog({
  rows, scope, selectedCount, onClose, onCreated,
}: {
  rows: LabelRow[]; scope: LabelScope; selectedCount: number;
  onClose: () => void; onCreated: (path: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [colorIdx, setColorIdx] = useState<number>(() => pickLeastUsedColor(rows.map((r) => r.color_index)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const validParents = useMemo(
    () => rows.filter((r) => r.depth < MAX_DEPTH - 1),
    [rows],
  );

  const save = async () => {
    setErr(null);
    const trimmed = name.trim().toLowerCase();
    const nameErr = validateLeafName(trimmed);
    if (nameErr) { setErr(nameErr); return; }
    const parent = parentId ? rows.find((r) => r.id === parentId) : null;
    if (parent && parent.depth + 1 > MAX_DEPTH - 1) {
      setErr(`Max nesting depth is ${MAX_DEPTH}.`); return;
    }
    const siblingClash = rows.some(
      (r) => (r.parent_id ?? null) === (parentId ?? null) && r.name === trimmed,
    );
    if (siblingClash) { setErr(`A sibling label named "${trimmed}" already exists.`); return; }
    const path = parent ? parent.path + LABEL_SEP + trimmed : trimmed;
    setBusy(true);
    try {
      await registerLabelPath(path, scope, colorIdx);
      await onCreated(path);
    } catch (e: any) {
      setErr(e?.message ?? "Could not create label");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Label</DialogTitle>
          <DialogDescription>
            This label will only apply to <strong className="font-semibold text-foreground">{SCOPE_LABELS[scope]}</strong>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          <div>
            <label htmlFor="new-lbl-name" className="text-xs font-medium">
              Name <span className="text-destructive">*</span>
            </label>
            <Input
              id="new-lbl-name"
              autoFocus
              required
              value={name}
              placeholder="Label name"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) save(); }}
              className="mt-1 h-8 text-sm"
            />
          </div>
          <div>
            <label htmlFor="new-lbl-parent" className="text-xs font-medium">Nest Label Under:</label>
            <select
              id="new-lbl-parent"
              value={parentId ?? ""}
              onChange={(e) => setParentId(e.target.value || null)}
              className="mt-1 w-full h-8 border rounded px-2 text-sm bg-background"
            >
              <option value="">— Top level —</option>
              {validParents.map((r) => (
                <option key={r.id} value={r.id}>{r.path.split(LABEL_SEP).join(" › ")}</option>
              ))}
            </select>
            <p className="text-[11px] text-muted-foreground mt-1">
              Max nesting depth is {MAX_DEPTH}.
            </p>
          </div>
          <div>
            <div className="text-xs font-medium mb-1 flex items-center gap-1"><Palette className="w-3 h-3" /> Color</div>
            <ColorSwatchPicker value={colorIdx} onChange={setColorIdx} size="md" />
          </div>
          {err && <div className="text-xs text-destructive">{err}</div>}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={save} disabled={busy || !name.trim()}>
            {selectedCount > 0 ? `Create + apply (${selectedCount})` : "Create Label"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
