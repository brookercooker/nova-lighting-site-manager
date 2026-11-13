import { Button } from "@/components/ui/button";
import { useLabelsForScope, type LabelScope } from "./useAllLabels";
import { colorFor } from "./labelColors";
import { cardLabelSummary, shortLabelName } from "./libraryLabels";

export default function LibraryCardLabels({ scope, paths, onFilter }: { scope: LabelScope; paths: string[]; onFilter: (path: string) => void }) {
  const { data: rows = [] } = useLabelsForScope(scope);
  const { visible, remaining } = cardLabelSummary(paths, rows);
  if (!visible.length) return null;
  return <div className="nova-library-card-labels" aria-label="Labels">
    {visible.map(label => { const c = colorFor(label.path, label.colorIndex); return <Button key={label.path} variant="ghost" className="nova-library-label-hit" title={label.path} aria-label={`Filter by ${label.path}`} onClick={e => { e.stopPropagation(); onFilter(label.path); }} style={{ "--nova-label-bg": c.bg, "--nova-label-border": c.border, "--nova-label-text": c.text, "--nova-label-dot": c.swatch } as React.CSSProperties}><span className="nova-library-label-chip"><span className="nova-filter-label-dot" /><span className="truncate">{shortLabelName(label.name)}</span></span></Button>; })}
    {remaining > 0 && <span className="nova-library-label-overflow" title={`${remaining} more labels`} aria-label={`${remaining} more labels`}>+{remaining}</span>}
  </div>;
}