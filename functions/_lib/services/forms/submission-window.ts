/**
 * The service side of the shared submission-window rule: how a write outside
 * the window is refused, and how a read expresses the same rule in SQL.
 *
 * The rule itself lives in `assets/shared/form-submission-window.ts` because
 * the portal answers the same question when it decides what to offer a reader.
 */
import {
  deriveFormSubmissionWindowState,
  type FormSubmissionWindow,
} from "../../../../assets/shared/form-submission-window";
import { AppError } from "../../errors";

export {
  deriveFormSubmissionWindowState,
  isFormSubmissionWindowOpen,
  type FormSubmissionWindow,
  type FormSubmissionWindowState,
} from "../../../../assets/shared/form-submission-window";

/**
 * Refuses a write outside the window in words the submitter can act on.
 *
 * The message names the instant in UTC, because a service refusal carries no
 * viewer's clock; `details` repeats the window so a presentation boundary can
 * render it on the reader's own.
 */
export function requireOpenFormSubmissionWindow(window: FormSubmissionWindow, now: string): void {
  const state = deriveFormSubmissionWindowState(window, now);
  if (state === "scheduled") {
    throw new AppError(409, "FORM_NOT_OPEN_YET", `This form opens on ${window.opensAt}`, {
      state,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    });
  }
  if (state === "closed") {
    throw new AppError(409, "FORM_CLOSED", `This form closed on ${window.closesAt}`, {
      state,
      opensAt: window.opensAt,
      closesAt: window.closesAt,
    });
  }
}

/**
 * SQL form of the same rule, for the reads that hide a form outside its
 * window. `alias` is a trusted internal table or alias name, never caller
 * input.
 *
 * The current instant comes from SQLite in the same format the columns are
 * stored in, so the fragment carries no placeholder and no call site can bind
 * a different "now" than another. Comparing the column directly rather than
 * through `unixepoch()` also leaves it usable by
 * `idx_form_placements_owner_active`, which indexes both columns.
 */
export function formSubmissionWindowOpenSql(alias: string): string {
  const now = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
  return `(${alias}.opens_at IS NULL OR ${alias}.opens_at <= ${now})
    AND (${alias}.closes_at IS NULL OR ${alias}.closes_at > ${now})`;
}
