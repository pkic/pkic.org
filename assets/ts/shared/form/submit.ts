/**
 * Form submission utilities — eliminates repeated try/catch/finally
 * boilerplate across event-flow pages.
 */

import { clearButtonBusy, setButtonBusy } from "./button-busy";
import { applyFieldErrors, normalizeValidation } from "./validation-map";
import { setStatus } from "./helpers";

/**
 * Wraps an async action with button loading state management.
 * Marks the button busy while the action runs and restores the button afterwards,
 * regardless of success or failure.
 *
 *   await withLoadingButton(findSubmitButton(form), async () => { ... });
 */
export async function withLoadingButton(
  btn: HTMLButtonElement | null | undefined,
  action: () => Promise<void>,
): Promise<void> {
  if (btn) setButtonBusy(btn);
  try {
    await action();
  } finally {
    if (btn) clearButtonBusy(btn);
  }
}

/**
 * Handles a form submission error:
 * 1. Normalizes the error (Zod / ApiClientError / generic)
 * 2. Shows the global message in the status element
 * 3. Applies per-field errors to the form
 *
 *   } catch (error) {
 *     handleSubmitError(error, form, statusEl);
 *   }
 */
export function handleSubmitError(error: unknown, form: HTMLFormElement | null, statusEl: HTMLElement | null): void {
  const normalized = normalizeValidation(error);
  if (statusEl) setStatus(statusEl, normalized.globalMessage, true);
  if (form) applyFieldErrors(form, normalized.fields);
}
