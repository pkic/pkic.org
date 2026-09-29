/**
 * Shows a Bootstrap spinner inside a button and disables it.
 * The button's original content is saved so it can be restored with resetButton.
 *
 * Usage:
 *   setButtonLoading(btn);
 *   try { ... } catch { ... } finally { resetButton(btn); }
 */
import { render } from "preact";

import "../../ui/Spinner.css";
import "./button-loading.css";

const savedNodes = new WeakMap<HTMLButtonElement, Node[]>();

export function setButtonLoading(btn: HTMLButtonElement): void {
  savedNodes.set(
    btn,
    Array.from(btn.childNodes).map((n) => n.cloneNode(true)),
  );
  btn.disabled = true;
  const label = btn.textContent?.trim() ?? "";
  render(
    <>
      {/* The design system's spinner. This ran on ten public flows, so a
          Bootstrap spinner here put the framework back into markup those
          surfaces had already migrated away from — after render, where no
          source-level check could see it. `role="status"` stays on the
          button's own text, which is what actually changes. */}
      <span class="pk-spinner pk-spinner--sm pk-button-spinner" aria-hidden="true">
        <span class="pk-spinner__circle" />
      </span>
      {label}
    </>,
    btn,
  );
}

/**
 * Restores a button that was put into loading state by setButtonLoading.
 * Re-enables the button and restores its original DOM content.
 */
export function resetButton(btn: HTMLButtonElement): void {
  const nodes = savedNodes.get(btn);
  if (nodes) {
    render(null, btn);
    btn.replaceChildren(...nodes);
    savedNodes.delete(btn);
  }
  btn.disabled = false;
}
