import { describe, expect, it } from "vitest";
import { PREVIEW_DEFAULTS } from "../../assets/ts/shared/email-template-helpers";

/**
 * Variables the Worker passes to templates sent outside an event (see
 * wg-chair-digest.ts and the speaker decline notices). Preview renders these
 * from PREVIEW_DEFAULTS, so a missing key shows up as a literal `{{name}}` in
 * the editor.
 */
const TEMPLATE_VARIABLES = {
  "wg-chair-membership-digest": [
    "workingGroupName",
    "recipientName",
    "recipientRole",
    "windowStart",
    "windowEnd",
    "joined",
    "left",
    "hasJoined",
    "hasLeft",
  ],
  proposal_speaker_declined: ["speakerName", "declineReason", "proposalTitle", "eventName"],
} as const;

describe("email template preview defaults", () => {
  for (const [templateKey, variables] of Object.entries(TEMPLATE_VARIABLES)) {
    it(`has sample data for every variable of ${templateKey}`, () => {
      const missing = variables.filter((name) => PREVIEW_DEFAULTS[name] === undefined);
      expect(missing).toEqual([]);
    });
  }
});
