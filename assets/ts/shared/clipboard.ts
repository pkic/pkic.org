/**
 * The one way the frontend copies text to the clipboard.
 *
 * The asynchronous Clipboard API is missing in insecure contexts and is
 * refused by some browsers and permission policies, so a refusal falls back
 * to the selection-based copy every browser still honors. Only when both
 * fail does the copy report a failure, and the caller's feedback then tells
 * the reader how to copy it by hand instead of leaving them wondering.
 */
import type { ToastType } from "./toast";

export interface CopyTextFeedback {
  /** Said when the text reached the clipboard. */
  copied: string;
  /** Said when it did not: how to copy it by hand. */
  failed: string;
  /** Where the outcome is said: the portal's `toast`, or a row's own status line. */
  notify: (message: string, type: ToastType) => void;
}

/** Copies through a temporary, visually hidden field, for browsers that refuse the Clipboard API. */
function copyThroughSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.className = "pk-sr-only";
  field.setAttribute("aria-hidden", "true");
  const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.append(field);
  try {
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    focused?.focus();
  }
}

async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Refused: fall through to the selection-based copy.
  }
  return copyThroughSelection(text);
}

/** Copies `text`; resolves whether it reached the clipboard and reports the outcome when asked. */
export async function copyText(text: string, feedback?: CopyTextFeedback): Promise<boolean> {
  const copied = await writeToClipboard(text);
  if (feedback) feedback.notify(copied ? feedback.copied : feedback.failed, copied ? "success" : "error");
  return copied;
}
