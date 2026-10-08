import type { ComponentChildren } from "preact";
import { Button } from "../../../../../../ui/Button";
/** A consistent escape and accessible prompt for drag, keyboard, and touch selection. */
export function AgendaSelectionStatus({
  title,
  resizing = false,
  busy = false,
  onCancel,
  children,
}: {
  title: string;
  resizing?: boolean;
  busy?: boolean;
  onCancel: () => void;
  children?: ComponentChildren;
}) {
  return (
    <div class="pk-cluster" role="status">
      <span>
        {resizing ? "Choose an end time" : "Choose a time and location"} for {title}.
      </span>
      {children}
      <Button variant="secondary" disabled={busy} onClick={onCancel}>
        Cancel selection
      </Button>
    </div>
  );
}
