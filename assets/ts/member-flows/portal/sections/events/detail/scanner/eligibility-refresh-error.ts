import { ZodError } from "zod";

export const SCANNER_PREPARATION_CLOSED_MESSAGE =
  "This scanner session has closed. Open Diagnostics and start the next scanner session.";

const refusalMessages = new Map([
  ["SCANNER_SIGNED_OUT", "Sign in again and reopen the scanner to refresh badge data."],
  ["SCANNER_PERMISSION_CHANGED", "Scanner access changed. Check sign-in and reopen the scanner."],
  ["SCANNER_PREPARATION_CLOSED", SCANNER_PREPARATION_CLOSED_MESSAGE],
]);

export function eligibilityPreparationClosed(error: unknown): boolean {
  return error instanceof Error && error.message === "SCANNER_PREPARATION_CLOSED";
}

export function eligibilityRefreshRefused(error: unknown): boolean {
  return error instanceof Error && refusalMessages.has(error.message);
}

/** Both a failed refresh and a retained snapshot explain the same recovery action. */
export function eligibilityRefreshError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  const refusal = refusalMessages.get(message);
  if (refusal) return refusal;
  if (message === "SESSION_ROOM_REQUIRED") return "Choose the room this scanner is in to prepare badge data.";
  if (message === "SESSION_ROOM_INVALID" || message === "SCANNER_ROOM_CONTEXT_CHANGED")
    return "Badge data does not match the scanner room. Check the selected room or reopen the scanner.";
  if (message === "Eligibility revision changed" || message === "Eligibility snapshot expired during preparation")
    return "Badge data changed during refresh. Try again shortly.";
  if (error instanceof ZodError || message.startsWith("Eligibility "))
    return "Badge data could not be verified. Reopen the scanner; if this continues, contact support.";
  if (/^Badge refresh failed \(HTTP \d{3}\)\.$/.test(message)) {
    const status = Number(message.match(/\d{3}/)?.[0]);
    return status === 429 || status >= 500
      ? `${message} Try again shortly.`
      : `${message} Reopen the scanner; if this continues, contact support.`;
  }
  return "Badge data could not be refreshed. Check your connection and try again.";
}
