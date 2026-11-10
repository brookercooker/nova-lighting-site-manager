import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageSquare, Pencil } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useDesignChat, type WorkingPage } from "./DesignChatContext";
import { useModeSwitch } from "./ModeSwitchContext";
import { registerPreviewPage } from "./usePreviewPage";
import { workingPageFrom } from "./pageSelection";
import ModePageChooser from "./ModePageChooser";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";

/** Phone overflow entry for the mode switch; render ModePageChooser with the same actions outside the menu. */
export function ModeSwitchMenuItem({ actions }: { actions: Pick<ReturnType<typeof useModeSwitchActions>, "mode" | "change"> }) {
  return <DropdownMenuItem className="min-h-[44px]" data-mode-switch onSelect={() => void actions.change(actions.mode === "manual" ? "chat" : "manual")}><Pencil className="mr-2 h-4 w-4" aria-hidden />{actions.mode === "manual" ? "Done Editing" : "Edit"}</DropdownMenuItem>;
}

/** Shared Chat/Manual switching (guards, viewed-page lookup and chooser state) for every mode control. */
export function useModeSwitchActions(onChat: () => void) {
  const chat = useDesignChat();
  const { mode, selectPage, startEditing } = chat;
  const latest = useRef(chat);
  latest.current = chat;
  const guard = useModeSwitch();
  const navigate = useNavigate();
  const [chooser, setChooser] = useState(false);
  const switching = useRef(false);
  const enter = async (chosenPage?: WorkingPage) => {
    if (switching.current) return;
    switching.current = true;
    try {
      let page = chosenPage;
      if (!page) {
        const deadline = Date.now() + 3000;
        while (true) {
          const current = latest.current;
          if (current.previewLocation && !current.previewLocation.notFound) {
            if (current.previewPage) { page = current.previewPage; break; }
            if (current.previewPageLoading) {
              if (Date.now() >= deadline) break;
              await new Promise<void>((resolve) => setTimeout(resolve, 50));
              continue;
            }
            if (current.previewRegistrable) { page = current.previewRegistrable; break; }
          }
          page = current.workingPage ?? undefined;
          break;
        }
      }
      if (!page) { setChooser(true); return; }
      const selectedPage = page;
      await guard?.requestManual(async () => {
        const target = selectedPage.id ? selectedPage : await registerPreviewPage(selectedPage);
        selectPage(workingPageFrom(target)); navigate("/manage/preview"); startEditing();
      });
    } catch { toast.error("Couldn't open this page for editing. Try again."); }
    finally { switching.current = false; }
  };
  const change = async (next: string) => {
    if (!next || next === mode || switching.current) return;
    if (next === "chat") { if (await guard?.requestChat()) { onChat(); navigate("/manage/preview"); } }
    else await enter();
  };
  const chooserProps = { open: chooser, onOpenChange: setChooser, onChoose: (page: WorkingPage) => { setChooser(false); void enter(page); } };
  return { mode, change, chooserProps };
}

export default function ModeToggle({ collapsed = false, onChat, compact = false }: { collapsed?: boolean; onChat: () => void; compact?: boolean }) {
  const { mode, change, chooserProps } = useModeSwitchActions(onChat);
  return <>
    {compact ? <Button type="button" variant={mode === "manual" ? "secondary" : "outline"} size="sm" className="h-11 shrink-0 gap-1 px-2 text-xs" data-mode-switch aria-pressed={mode === "manual"} onClick={() => void change(mode === "manual" ? "chat" : "manual")}><Pencil className="h-4 w-4" aria-hidden />{mode === "manual" ? "Done Editing" : "Edit"}</Button> : <ToggleGroup type="single" value={mode} onValueChange={(next) => void change(next)} aria-label="Editing Mode" data-mode-switch
      className={cn("shrink-0 gap-1 border-b bg-background p-2", collapsed ? "flex-col" : "grid w-full grid-cols-2")}>
      {([{ value: "chat", label: "Chat Mode", Icon: MessageSquare }, { value: "manual", label: "Manual Edit Mode", Icon: Pencil }] as const).map(({ value, label, Icon }) => <ToggleGroupItem key={value} value={value} aria-label={label} title={label}
        onKeyDown={(event) => {
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            const next = value === "chat" ? "manual" : "chat";
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-mode="${next}"]`)?.focus();
            void change(next);
          }
        }} data-mode={value}
        className={cn("gap-1.5 text-xs leading-tight focus-visible:ring-2 focus-visible:ring-ring", collapsed ? "h-8 w-8 p-0" : "h-11 min-w-0 px-1",
          "data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:hover:bg-primary data-[state=on]:hover:text-primary-foreground data-[state=on]:font-semibold")}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />{!collapsed && <span>{label}</span>}
      </ToggleGroupItem>)}
    </ToggleGroup>}
    <ModePageChooser {...chooserProps} />
  </>;
}