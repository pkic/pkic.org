import { ZodError } from "zod";

const refusalMessages = new Map([
  ["SCANNER_SIGNED_OUT", "Sign in again and reopen the scanner to refresh badge data."],
  ["SCANNER_PERMISSION_CHANGED", "Scanner access changed. Check sign-in and reopen the scanner."],
  ["SCANNER_PREPARATION_CLOSED", "This scanner session has closed. Reopen the scanner to prepare badge data."],
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
