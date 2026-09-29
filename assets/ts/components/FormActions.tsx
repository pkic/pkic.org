/**
 * The submit / cancel pair a management form ends with.
 *
 * The version this replaces sized and coloured its own buttons (`btn btn-sm
 * btn-success`) and reported the outcome in a `small text-muted` span. Both
 * are now the design system's: a primary Button for the affirmative action, a
 * secondary one for the way out, and an outcome that carries a role rather
 * than only a hue.
 */
import { Alert } from "../ui/Alert";
import { Button } from "../ui/Button";

export function FormActions({
  submitLabel,
  busyLabel = submitLabel,
  busy,
  onCancel,
  status,
  statusVariant = "muted",
  disabled = false,
}: {
  submitLabel: string;
  busyLabel?: string;
  busy: boolean;
  onCancel: () => void;
  status?: string;
  /**
   * Kept for its callers, and deliberately not read. Bootstrap's `success`
   * and `primary` were two fills for the same thing — the form's one
   * affirmative action — so the design system has a single variant for it and
   * both values resolve to that.
   */
  submitVariant?: "primary" | "success";
  statusVariant?: "muted" | "danger";
  disabled?: boolean;
}) {
  return (
    <div class="pk-cluster">
      {/* `loading` alongside `disabled`: the spinner and aria-busy say the
          save is in flight, and `disabled` still stops a second submit, which
          `loading` alone would not do on a submit button. */}
      <Button type="submit" variant="primary" size="sm" loading={busy} disabled={busy || disabled}>
        {busy ? busyLabel : submitLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
        Cancel
      </Button>
      {status &&
        (statusVariant === "danger" ? (
          // A failure is an Alert, so it is announced as one and is told apart
          // from a routine "Saved." by more than its colour.
          <Alert tone="danger">{status}</Alert>
        ) : (
          <span class="pk-small" role="status">
            {status}
          </span>
        ))}
    </div>
  );
}
