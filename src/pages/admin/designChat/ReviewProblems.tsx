import { useDesignChat } from "./DesignChatContext";
import { problemsModel } from "./logic";
import { DismissErrorButton, useChatPerson, useErrorDismissals, type ErrorEntry } from "./chatErrors";
import { useManagerLayout } from "./useManagerLayout";

/** The review result in the chat and the review view. Blocked changes only say a developer will review them; fixing is done on the Developer Review page. */
export default function ReviewProblems() {
  const { state } = useDesignChat();
  const problems = problemsModel(state);
  const { person } = useChatPerson();
  const dismissals = useErrorDismissals(person);
  const { phone } = useManagerLayout();
  if (!problems) return null;
  const entry: ErrorEntry = { role: "error", text: `review-problems|${problems.title}|${problems.sub}|${problems.devNote ?? ""}` };
  if (dismissals.hidden(entry)) return null;
  return (
    <div role="status" className="self-stretch rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
      <div className="flex items-start gap-2"><h3 className="min-w-0 flex-1 text-sm font-semibold text-destructive">{problems.title}</h3><DismissErrorButton phone={phone} onDismiss={() => dismissals.dismiss(entry)} /></div>
      <p className="text-xs">{problems.sub}</p>
      {problems.devNote && <p className="text-xs">{problems.devNote}</p>}
    </div>
  );
}
