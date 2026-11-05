import type { ComponentChildren } from "preact";
import { Dialog } from "../../ui/Dialog";
import { Spinner } from "../../ui/Spinner";
import { Button } from "../../ui/Button";
import { ErrorAlert } from "../ErrorAlert";

/** Output commands keep the registration list in place; layout editing has its own destination. */
export function BadgeOutputProgress({
  title,
  progress,
  error,
  empty,
  onRetry,
  onClose,
  children,
}: {
  title: string;
  progress: string;
  error?: string;
  empty?: boolean;
  onRetry?: () => void;
  onClose: () => void;
  children?: ComponentChildren;
}) {
  return (
    <Dialog
      open
      title={title}
      confirmLabel={error || empty ? "Close" : "Cancel"}
      cancelLabel={null}
      onConfirm={onClose}
      onCancel={onClose}
    >
      {error ? <ErrorAlert error={error} /> : empty ? <p>No matching attendees.</p> : <Spinner label={progress} />}
      {error && onRetry && <Button onClick={onRetry}>Try again</Button>}
      {children}
    </Dialog>
  );
}
