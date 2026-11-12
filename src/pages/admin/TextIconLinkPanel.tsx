import { Smile, Link as LinkIcon, icons } from "lucide-react";
import { Button } from "@/components/ui/button";
import { originalLink, type InlineEdits, type LinkEdit } from "@/lib/inlineEditCore";
import { LINK_ICONS, readStyle, type InlineSelection } from "@/components/InlineEditSurface";
import { ToolField, ToolGroup, ToolSegment } from "./designChat/ToolPanel";
import InlineDestinationPanel from "./InlineDestinationPanel";
import MaterialIconField from "./MaterialIconField";
import { iconPositionKey } from "./textAdornment";
import { selectionComputedStyle } from "./remoteSelection";

export default function TextIconLinkPanel({ sel, edits, onChange, editsFor, onScopeChange, pages = [] }: {
  sel: InlineSelection; edits: InlineEdits; onChange: (next: InlineEdits) => void;
  editsFor?: (scope: string) => InlineEdits; onScopeChange?: (scope: string, next: InlineEdits) => void;
  pages?: { id: string; name: string; path: string }[];
}) {
  const originalIcon = sel.el.querySelector("[data-inline-icon],svg");
  const icon = edits[`icon:${sel.key}`] ?? originalIcon?.getAttribute("data-inline-icon") ?? (originalIcon ? "original" : "none");
  const position = edits[iconPositionKey(sel.key)] ?? "after";
  const fontSize = readStyle(edits, sel.key)["font-size"] || selectionComputedStyle(sel.el).fontSize || "16px";
  const PreviewIcon = LINK_ICONS.includes(icon as typeof LINK_ICONS[number]) ? icons[icon as keyof typeof icons] : undefined;
  const target = sel.link ?? { key: sel.key, scope: sel.scope, el: sel.el };
  const targetEdits = editsFor?.(target.scope) ?? edits;
  let link: LinkEdit | undefined;
  try { link = targetEdits[`link:${target.key}`] ? JSON.parse(targetEdits[`link:${target.key}`]) : undefined; } catch { /* Editable invalid value. */ }
  const hasLink = link?.unlinked ? false : !!(link?.href ?? originalLink(target.el).href);
  const hasIcon = icon !== "none" && !!icon;
  const iconSummary = hasIcon ? (icon === "original" ? "Original" : icon.startsWith("material:") ? icon.split(":")[2] : icon.replace(/([a-z])([A-Z])/g, "$1 $2")) : "None";
  const setIcon = (value: string) => {
    const next = { ...edits, [`icon:${sel.key}`]: value };
    if (value === "none") delete next[iconPositionKey(sel.key)];
    onChange(next);
  };
  return <><ToolGroup title="Icon" icon={Smile} summary={iconSummary} initiallyCollapsed>
    <div className="grid grid-cols-6 gap-1">
      <Button type="button" variant="outline" size="sm" className="h-8 min-w-0 px-1 text-[10px]" aria-label="No Icon" aria-pressed={!hasIcon} onMouseDown={e => e.preventDefault()} onClick={() => setIcon("none")}>None</Button>
      {LINK_ICONS.filter(name => name !== "Sparkles").map(name => {
        const Icon = icons[name];
        const label = name.replace(/([a-z])([A-Z])/g, "$1 $2");
        return <Button key={name} type="button" variant={icon === name ? "secondary" : "outline"} size="icon" className="h-8 w-full min-w-0" aria-label={label} title={label} aria-pressed={icon === name} onMouseDown={e => e.preventDefault()} onClick={() => setIcon(name)}><Icon className="h-4 w-4" /></Button>;
      })}
    </div>
    {PreviewIcon && <span aria-label="Selected Icon Preview" style={{ fontSize }} className="inline-flex"><PreviewIcon className="h-[1em] w-[1em]" aria-hidden /></span>}
    <MaterialIconField nameOnly fontSize={fontSize} value={icon === "none" || icon === "original" ? "" : icon} onChange={setIcon} />
    <ToolField label="Icon Position">
      <ToolSegment className="flex w-full" onMouseDown={e => e.preventDefault()}>
        {(["before", "after"] as const).map(value => <Button key={value} type="button" size="sm" className="flex-1" aria-label={value === "before" ? "Before Text" : "After Text"} variant={position === value ? "default" : "ghost"} aria-pressed={position === value} disabled={!hasIcon} onClick={() => onChange({ ...edits, [iconPositionKey(sel.key)]: value })}>{value === "before" ? "Before Text" : "After Text"}</Button>)}
      </ToolSegment>
    </ToolField>
    {edits[`icon:${sel.key}`] !== undefined && <Button type="button" variant="ghost" size="sm" onClick={() => { const next = { ...edits }; delete next[`icon:${sel.key}`]; delete next[iconPositionKey(sel.key)]; onChange(next); }}>Use Original Icon</Button>}
  </ToolGroup><ToolGroup title="Link" icon={LinkIcon} summary={hasLink ? link?.href ?? originalLink(target.el).href : "None"} initiallyCollapsed>
    <InlineDestinationPanel embedded linkKnown={!!sel.link} selection={{ ...sel, link: target }} editsFor={scope => editsFor?.(scope) ?? edits} onChange={(scope, next) => onScopeChange ? onScopeChange(scope, next) : onChange(next)} pages={pages} />
  </ToolGroup></>;
}