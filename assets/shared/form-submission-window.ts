/**
 * When a form accepts responses.
 *
 * A form's submission window is the optional pair of instants on its
 * placement: `opens_at` and `closes_at`, either or both of which may be
 * absent. The rule used to exist only as a SQL fragment repeated at every read
 * that had to hide a form outside its window, which meant a reader who arrived
 * too early or too late was told the form did not exist. It is a question
 * about time with one right answer, so the answer lives here and both runtimes
 * ask it.
 *
 * Every instant compared here is an ISO-8601 UTC string with millisecond
 * precision and an explicit `Z` — the only shape the shared contract admits —
 * so the lexicographic order of the strings is their chronological order and
 * no parsing is needed to compare them.
 */

export interface FormSubmissionWindow {
  opensAt: string | null;
  closesAt: string | null;
}

export type FormSubmissionWindowState = "scheduled" | "open" | "closed";

/**
 * The opening instant is inside the window and the closing instant is outside
 * it, so a window closing at noon takes a response at 11:59:59.999 and refuses
 * one at noon exactly. A half-open interval is what lets one window close
 * where the next opens without an instant belonging to both.
 */
export function deriveFormSubmissionWindowState(window: FormSubmissionWindow, now: string): FormSubmissionWindowState {
  if (window.closesAt !== null && window.closesAt <= now) return "closed";
  if (window.opensAt !== null && window.opensAt > now) return "scheduled";
  return "open";
}

/** The only correct answer to "may a response be submitted right now". */
export function isFormSubmissionWindowOpen(window: FormSubmissionWindow, now: string): boolean {
  return deriveFormSubmissionWindowState(window, now) === "open";
}
