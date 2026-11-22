/**
 * Shared blocks any email template can include with `{{> name}}`. Each one is stored as the
 * `partial_<name>` template, so wording that several emails repeat is edited in one place.
 */
export const EMAIL_PARTIALS = [
  { name: "greeting", description: "Greeting by first name" },
  { name: "reg_details", description: "Registration summary (name, attendance, custom answers)" },
  { name: "sponsors_block", description: "Sponsors section" },
  { name: "about_pkic", description: "About PKIC blurb" },
  { name: "donation_request", description: "Donation request block" },
  { name: "donation_tax_notice", description: "Donation tax notice" },
  { name: "link_safety_notice", description: "Keep-this-link-private notice for sign-in links" },
  { name: "speaker_confirmation_note", description: "Confirming as a speaker isn't acceptance" },
  { name: "budget_waitlist_notice", description: "In-person waitlist and sponsorship notice" },
] as const;

export type EmailPartial = (typeof EMAIL_PARTIALS)[number];
export const EMAIL_PARTIAL_NAMES = EMAIL_PARTIALS.map((partial) => partial.name);
