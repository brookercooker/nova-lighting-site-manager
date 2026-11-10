/** Marks an archived row next to its status so it can't be mistaken for a live one. */
export default function ArchivedBadge({ archived }: { archived: boolean }) {
  if (!archived) return null;
  return <span className="mt-1 inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Archived</span>;
}
