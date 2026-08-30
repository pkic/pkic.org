/**
 * Promise-based confirmation dialog that replaces window.confirm portal-wide.
 * A confirmation is a decision, so the dialog states consequences as a list
 * the reader can scan, names the action on the confirm button (never "OK"),
 * and for irreversible operations demands the target's name be typed back.
 *
 * Mount <ConfirmDialogHost /> once near the app root; call confirmAction()
 * anywhere. Escape, the cancel button, and the backdrop all resolve false.
 */
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";

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

/** Ask the user to confirm an action; resolves false on cancel/Escape/backdrop. */
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
  const confirmButtonRef = useRef<HTMLButtonElement>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!request) {
      setTyped("");
      return;
    }
    // Focus the safe action first; confirming should be a deliberate move.
    const focusTarget = request.typedConfirmation
      ? document.getElementById("pkic-confirm-typed")
      : confirmButtonRef.current;
    focusTarget?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        settle(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [request]);

  if (!request) return null;
  const confirmDisabled = Boolean(request.typedConfirmation) && typed.trim() !== request.typedConfirmation;

  return (
    <div class="pkic-confirm-backdrop" onClick={() => settle(false)}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="pkic-confirm-title"
        class="pkic-confirm-dialog"
        onClick={(event) => event.stopPropagation()}
      >
        <h5 id="pkic-confirm-title" class="pkic-confirm-title">
          {request.title}
        </h5>
        {request.body && <p class="pkic-confirm-body">{request.body}</p>}
        {request.consequences && request.consequences.length > 0 && (
          <ul class="pkic-confirm-consequences">
            {request.consequences.map((consequence) => (
              <li key={consequence}>{consequence}</li>
            ))}
          </ul>
        )}
        {request.typedConfirmation && (
          <div class="pkic-confirm-typed">
            <label class="form-label small" for="pkic-confirm-typed">
              Type <strong>{request.typedConfirmation}</strong> to confirm
            </label>
            <input
              id="pkic-confirm-typed"
              class="form-control form-control-sm"
              value={typed}
              onInput={(event) => setTyped((event.target as HTMLInputElement).value)}
            />
          </div>
        )}
        <div class="pkic-confirm-actions">
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => settle(false)}>
            {request.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            class={`btn btn-sm ${request.tone === "primary" ? "btn-success" : "btn-danger"}`}
            disabled={confirmDisabled}
            onClick={() => settle(true)}
          >
            {request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
