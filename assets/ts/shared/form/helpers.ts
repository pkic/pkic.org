/**
 * Common form-field and UI utilities shared across event-flow pages.
 */

/**
 * Shorthand for querySelector — reduces verbose selector calls across pages.
 */
export function q<T extends Element = Element>(selector: string, root: ParentNode = document): T | null {
  return root.querySelector<T>(selector);
}

/**
 * Finds the submit button inside a form.
 */
export function findSubmitButton(form: HTMLFormElement): HTMLButtonElement | null {
  return form.querySelector<HTMLButtonElement>("button[type='submit']");
}

/**
 * Shows a status message in a Bootstrap alert element.
 * Used by event-flow pages after form submissions or API calls.
 */
export function setStatus(target: HTMLElement, message: string, isError = false): void {
  target.textContent = message;
  target.dataset.state = isError ? "error" : "ok";
  target.classList.remove("visually-hidden", "alert-success", "alert-danger");
  target.classList.add(isError ? "alert-danger" : "alert-success");
}

/**
 * Reads the trimmed value of a named form element.
 * Returns an empty string if the element does not exist or is not a form control.
 */
export function readField(form: HTMLFormElement, name: string): string {
  const el = form.elements.namedItem(name);
  if (el instanceof RadioNodeList) {
    return el.value.trim();
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    return el.value.trim();
  }
  return "";
}

/**
 * Sets the value of a named form element, or no-ops if the element does not exist.
 */
export function setField(form: HTMLFormElement, name: string, value: string | null | undefined): void {
  const el = form.elements.namedItem(name);
  if (el instanceof RadioNodeList) {
    el.value = value ?? "";
    return;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    el.value = value ?? "";
  }
}

/**
 * Derives a high-level attendance type from per-day attendance selections.
 * Used by both registration and registration-manage flows.
 */
export function deriveEventAttendanceType(
  values: Array<{ attendanceType: string }>,
): "in_person" | "virtual" | "on_demand" | undefined {
  if (values.some((v) => v.attendanceType === "in_person")) return "in_person";
  if (values.some((v) => v.attendanceType === "virtual")) return "virtual";
  if (values.length > 0) return "on_demand";
  return undefined;
}

/**
 * Formats a workflow status value as a human-readable label.
 * E.g. "pending_email_confirmation" → "Pending Email Confirmation".
 */
export function formatStatusLabel(status: string): string {
  return status
    .replace(/_/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Returns a Bootstrap badge CSS class for a workflow status value.
 */
export function statusBadgeClass(status: string): string {
  switch (status) {
    case "invited":
      return "bg-warning text-dark";
    case "confirmed":
    case "accepted":
      return "bg-success";
    case "declined":
    case "rejected":
      return "bg-danger";
    case "submitted":
      return "bg-info text-dark";
    default:
      return "bg-secondary";
  }
}
