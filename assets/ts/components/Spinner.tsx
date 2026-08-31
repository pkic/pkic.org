/**
 * Loading indicator; give it a label so the wait names what is loading.
 *
 * A thin wrapper over the design system's Spinner that keeps the portal's
 * convention: the label is announced either way, and shown as text only when
 * the caller supplies one. The version this replaces put the label in a
 * `visually-hidden` span AND repeated it as visible text below, so a screen
 * reader heard it twice.
 */
import { Spinner as UiSpinner } from "../ui/Spinner";

export function Spinner({ label }: { label?: string } = {}) {
  return (
    <div class="pk pk-center pk-section">
      <UiSpinner size="sm" label={label ?? "Loading…"} labelHidden={!label} />
    </div>
  );
}
