/**
 * Shows a Bootstrap spinner inside a button and disables it.
 * The button's original HTML is saved so it can be restored with resetButton.
 *
 * Usage:
 *   setButtonLoading(btn);
 *   try { ... } catch { ... } finally { resetButton(btn); }
 */
export function setButtonLoading(btn: HTMLButtonElement): void {
  btn.dataset.originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML =
    `<span class="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>` +
    (btn.textContent?.trim() ?? "");
}

/**
 * Restores a button that was put into loading state by setButtonLoading.
 * Re-enables the button and restores its original HTML content.
 */
export function resetButton(btn: HTMLButtonElement): void {
  const original = btn.dataset.originalHtml;
  if (original !== undefined) {
    btn.innerHTML = original;
    delete btn.dataset.originalHtml;
  }
  btn.disabled = false;
}
