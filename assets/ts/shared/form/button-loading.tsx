/**
 * Shows a Bootstrap spinner inside a button and disables it.
 * The button's original content is saved so it can be restored with resetButton.
 *
 * Usage:
 *   setButtonLoading(btn);
 *   try { ... } catch { ... } finally { resetButton(btn); }
 */
import { render } from "preact";

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
      <span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
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
