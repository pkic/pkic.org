import { ZodError } from "zod";

export class EligibilityRefreshFailure extends Error {
  constructor(
    readonly code: "changed" | "invalid" | "http",
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export const SCANNER_PREPARATION_CLOSED_MESSAGE =
  "This scanner session has closed. Open Diagnostics and start the next scanner session.";

export const SCANNER_PREPARATION_CLOSING_MESSAGE =
  "This scanner session is closing. Open Diagnostics and retry closing it after pending scans upload.";

const stoppedPreparationMessages = new Map([
  ["SCANNER_PREPARATION_CLOSED", SCANNER_PREPARATION_CLOSED_MESSAGE],
  ["SCANNER_PREPARATION_CLOSING", SCANNER_PREPARATION_CLOSING_MESSAGE],
  [
    "SCANNER_CAPTURE_CLOSED",
    "Scanning has ended for this event. Contact the event organizer; pending scans remain on this device.",
  ],
  [
    "SCANNER_ENROLLMENT_REQUIRED",
    "Scanner enrollment changed. Check sign-in and reopen the scanner; pending scans remain on this device.",
  ],
]);

const refusalMessages = new Map([
  ["SCANNER_SIGNED_OUT", "Sign in again and reopen the scanner to refresh badge data."],
  ["SCANNER_PERMISSION_CHANGED", "Scanner access changed. Check sign-in and reopen the scanner."],
  ...stoppedPreparationMessages,
]);

export function eligibilityPreparationStopped(code: string | undefined): code is string {
  return code !== undefined && stoppedPreparationMessages.has(code);
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
  if (error instanceof EligibilityRefreshFailure && error.code === "changed")
    return "Badge data changed during refresh. Try again shortly.";
  if (error instanceof ZodError || (error instanceof EligibilityRefreshFailure && error.code === "invalid"))
    return "Badge data could not be verified. Reopen the scanner; if this continues, contact support.";
  if (error instanceof EligibilityRefreshFailure && error.code === "http") {
    const status = error.status ?? 0;
    return status === 429 || status >= 500
      ? `${message} Try again shortly.`
      : `${message} Reopen the scanner; if this continues, contact support.`;
  }
  return "Badge data could not be refreshed. Check your connection and try again.";
}
