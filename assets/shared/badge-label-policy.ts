import type { BadgePrintingContext } from "./schemas/route-contracts-event-badges";

/** Labels contain live attendee details only; changes to preprinted artwork cannot invalidate them. */
export const BADGE_LABEL_PRINTING_CONTEXT: BadgePrintingContext = {
  revision: "0".repeat(64),
  template: null,
  branding: [],
};

export const BADGE_LABEL_COPY_OPTIONS = [1, 2, 3, 4] as const;
export const BADGE_LABEL_DEFAULT_COPIES = 2;
