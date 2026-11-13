import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  cancelLabel?: string;
  secondaryLabel?: string;
  onSecondary?: () => void;
  busy?: boolean;
  confirmDisabled?: boolean;
  keepOpenOnConfirm?: boolean;
  confirmIcon?: ReactNode;
  secondaryIcon?: ReactNode;
  cancelIcon?: ReactNode;
  /** Show the confirm button first (left), then secondary, then cancel. */
  primaryFirst?: boolean;
}

export default function ConfirmDialog({
  open, onOpenChange, title, description,
  confirmLabel = "Confirm", destructive = true, onConfirm,
  cancelLabel = "Cancel", secondaryLabel, onSecondary, busy = false, confirmDisabled = false, keepOpenOnConfirm = false, confirmIcon, secondaryIcon, cancelIcon, primaryFirst = false,
}: Props) {
  const cancel = <AlertDialogCancel className="mt-0 h-11 gap-2" disabled={busy}>{cancelIcon}{cancelLabel}</AlertDialogCancel>;
  const secondary = secondaryLabel ? <Button type="button" variant="outline" className="h-11 gap-2" disabled={busy} onClick={onSecondary}>{secondaryIcon}{secondaryLabel}</Button> : null;
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className={secondaryLabel ? "max-w-[calc(100vw-32px)] sm:max-w-2xl" : undefined}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="text-sm text-muted-foreground">{description}</div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className={primaryFirst ? "flex-col gap-2 sm:flex-row sm:flex-nowrap sm:justify-start sm:space-x-0" : "flex-wrap gap-2 sm:space-x-0"}>
          {!primaryFirst && cancel}
          {!primaryFirst && secondary}
          <AlertDialogAction
            disabled={busy || confirmDisabled}
            onClick={(event) => { if (secondaryLabel || busy || keepOpenOnConfirm) event.preventDefault(); onConfirm(); }}
            className={cn("h-11 gap-2", destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : "")}
          >
            {confirmIcon}{confirmLabel}
          </AlertDialogAction>
          {primaryFirst && secondary}
          {primaryFirst && cancel}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
