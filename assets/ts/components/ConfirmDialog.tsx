/**
 * Promise-based confirmation that replaces window.confirm portal-wide.
 *
 * A confirmation is a decision, so the dialog states consequences as a list
 * the reader can scan, names the action on the confirm button (never "OK"),
 * and for irreversible operations demands the target's name be typed back.
 *
 * Mount <ConfirmDialogHost /> once near the app root; call confirmAction()
 * anywhere. Cancel and Escape resolve false.
 *
 * The dialog itself is the design system's `Dialog`, which is a native
 * <dialog> opened with showModal(). That is not a cosmetic swap. The version
 * this replaces was a positioned <div> with `role="alertdialog"`, which meant
 * it looked modal and was not: focus could tab straight out of it into the
 * page behind, the rest of the document stayed reachable to a screen reader,
 * and Escape only worked because of a document-level key listener. The
 * platform gives all three away for free, correctly, and takes the focus
 * trap with it.
 *
 * One behaviour is deliberately gone: clicking the backdrop no longer
 * dismisses. For a dialog that exists to confirm something irreversible, a
 * stray click outside it should not be a way to answer.
 */
import { signal } from "@preact/signals";

import { Dialog } from "../ui/Dialog";

export interface ConfirmActionRequest {
  title: string;
  /** One short sentence of context shown under the title. */
  body?: string;
  /** What will actually happen, one clause per line. */
  consequences?: readonly string[];
  /** Names the action, e.g. "Remove from organization" — never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  /**
   * For irreversible operations: the exact string the user must type back
   * (usually the target's name or email) before confirm enables.
   */
  typedConfirmation?: string;
}

interface ActiveConfirm extends ConfirmActionRequest {
  resolve: (confirmed: boolean) => void;
}

const activeConfirm = signal<ActiveConfirm | null>(null);

/** Ask the user to confirm an action; resolves false on cancel or Escape. */
export function confirmAction(request: ConfirmActionRequest): Promise<boolean> {
  return new Promise((resolve) => {
    // A second request while one is open cancels the first rather than
    // silently stacking two decisions.
    activeConfirm.value?.resolve(false);
    activeConfirm.value = { ...request, resolve };
  });
}

function settle(confirmed: boolean): void {
  const current = activeConfirm.value;
  activeConfirm.value = null;
  current?.resolve(confirmed);
}

export function ConfirmDialogHost() {
  const request = activeConfirm.value;

  // Rendered only while a decision is pending, so a closed host leaves nothing
  // in the accessibility tree for a test — or a screen reader — to find.
  if (!request) return null;

  return (
    <div class="pk">
      <Dialog
        open
        title={request.title}
        description={request.body}
        consequences={request.consequences}
        confirmPhrase={request.typedConfirmation}
        confirmPrompt={request.typedConfirmation ? `Type ${request.typedConfirmation} to confirm` : undefined}
        confirmLabel={request.confirmLabel}
        cancelLabel={request.cancelLabel}
        // Confirmations default to destructive: the ones that are not are the
        // exception, and treating a removal as routine is the worse mistake.
        destructive={request.tone !== "primary"}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </div>
  );
}
