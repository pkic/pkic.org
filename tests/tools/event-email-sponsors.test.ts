/**
 * Sponsors help fund the events, so an email about an event shows the event's sponsors.
 * Sign-in and verification emails, a cancellation of a registration someone never made,
 * and notices to organizers leave them out. Delivery fills the event's sponsor image, and
 * the block hides itself when the site build published none.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";

const SPONSORS = "{{> sponsors_block}}";
const WITHOUT_SPONSORS = new Set([
  "event_proposal_verify",
  "user_sign_up_link",
  "user_account_found_link",
  "registration_unauthorized",
  "agenda_speaker_declined",
]);

function namesTheEvent(template: { content?: string | null; subjectTemplate?: string | null }): boolean {
  return /\{\{\s*(eventName|event_name)\b/.test(`${template.subjectTemplate ?? ""}${template.content ?? ""}`);
}

describe("event email sponsors", () => {
  it("shows the sponsors in every email about an event", () => {
    const missing = DEFAULT_TEMPLATES.filter(
      (template) =>
        namesTheEvent(template) && !WITHOUT_SPONSORS.has(template.key) && !template.content?.includes(SPONSORS),
    ).map((template) => template.key);
    expect(missing).toEqual([]);
  });

  it("leaves the sponsors out of sign-in, verification and organizer emails", () => {
    const shown = DEFAULT_TEMPLATES.filter(
      (template) => WITHOUT_SPONSORS.has(template.key) && template.content?.includes(SPONSORS),
    ).map((template) => template.key);
    expect(shown).toEqual([]);
    for (const key of ["user_magic_link", "user_email_verification", "account_security_notice"]) {
      const template = DEFAULT_TEMPLATES.find((candidate) => candidate.key === key);
      expect(template?.content ?? "").not.toContain(SPONSORS);
    }
  });
});
