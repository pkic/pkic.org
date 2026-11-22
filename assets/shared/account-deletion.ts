/**
 * Deleting an account removes the person's own records with it, and only
 * those. Anything that is also somebody else's record (an organization's
 * contact, a membership, a decided proposal, event participation, a vote,
 * work they did on other records) keeps the account: staff anonymize it
 * instead, or resolve that record first.
 *
 * The backend decides which rows fall in which kind; this module names the
 * kinds and words them, so the preview staff confirm and the refusal they
 * get say the same thing.
 */

/** What is deleted with the account. */
export const ACCOUNT_DELETION_REMOVED_KINDS = [
  "email_address",
  "sign_in",
  "identity",
  "registration",
  "proposal",
  "form_response",
  "promotion",
  "group_history",
  "ended_role",
  "affiliation_review",
  "consent",
  "email",
  "referral_code",
  "personal_setting",
  "activity",
] as const;
export type AccountDeletionRemovedKind = (typeof ACCOUNT_DELETION_REMOVED_KINDS)[number];

/**
 * A proposal goes with its proposer only when it never reached a decision:
 * withdrawn, or set aside as spam, a duplicate, or deleted. A review, a
 * decision, feedback, slides, an agenda entry, or another speaker still keeps it.
 */
export const ACCOUNT_DELETION_REMOVABLE_PROPOSAL_STATUSES = ["withdrawn", "spam", "duplicate", "deleted"] as const;

/** What keeps the account. */
export const ACCOUNT_DELETION_BLOCKER_KINDS = [
  "role",
  "staff_access",
  "member_application",
  "membership",
  "proposal",
  "event_participation",
  "ticket_payment",
  "vote",
  "mailing_list",
  "promotion_render",
  "recognition",
  "authored_record",
] as const;
export type AccountDeletionBlockerKind = (typeof ACCOUNT_DELETION_BLOCKER_KINDS)[number];

export interface AccountDeletionCount<Kind extends string> {
  kind: Kind;
  count: number;
}

/** An account can be deleted when nothing keeps it. */
export function isAccountDeletable(blockers: readonly AccountDeletionCount<AccountDeletionBlockerKind>[]): boolean {
  return blockers.every((blocker) => blocker.count === 0);
}

function counted(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const REMOVED_LABELS: Record<AccountDeletionRemovedKind, (count: number) => string> = {
  email_address: (n) => counted(n, "additional email address", "additional email addresses"),
  sign_in: (n) => counted(n, "sign-in session or passkey", "sign-in sessions and passkeys"),
  identity: (n) => counted(n, "identity", "identities"),
  registration: (n) => counted(n, "event registration", "event registrations"),
  proposal: (n) => counted(n, "withdrawn or spam proposal", "withdrawn or spam proposals"),
  form_response: (n) => counted(n, "form response", "form responses"),
  promotion: (n) => counted(n, "speaker or attendee promotion kit", "speaker and attendee promotion kits"),
  group_history: (n) =>
    counted(n, "ended group or mailing list membership", "ended group and mailing list memberships"),
  ended_role: (n) => counted(n, "ended role", "ended roles"),
  affiliation_review: (n) => counted(n, "affiliation review", "affiliation reviews"),
  consent: (n) => counted(n, "recorded consent", "recorded consents"),
  email: (n) => counted(n, "email sent to them", "emails sent to them"),
  referral_code: (n) => counted(n, "referral link", "referral links"),
  personal_setting: (n) => counted(n, "personal setting", "personal settings"),
  activity: (n) => counted(n, "activity record", "activity records"),
};

const BLOCKER_LABELS: Record<AccountDeletionBlockerKind, (count: number) => string> = {
  role: (n) =>
    `Holds ${counted(n, "current role", "current roles")}, such as an organization contact. Assign someone else or end the role first.`,
  staff_access: (n) => `${counted(n, "staff permission grant", "staff permission grants")}, current or past`,
  member_application: (n) => counted(n, "membership application", "membership applications"),
  membership: (n) => counted(n, "membership", "memberships"),
  proposal: (n) =>
    n === 1
      ? "1 proposal that is still open, decided, or shared with other speakers"
      : `${n} proposals that are still open, decided, or shared with other speakers`,
  event_participation: (n) =>
    counted(n, "session role, check-in, or question", "session roles, check-ins, and questions"),
  ticket_payment: (n) => counted(n, "ticket with a payment record", "tickets with payment records"),
  vote: (n) => counted(n, "vote or ballot", "votes and ballots"),
  mailing_list: (n) =>
    `Still on ${counted(n, "group or mailing list", "groups or mailing lists")}. Deactivate the account, then delete it once Google Groups has removed them.`,
  promotion_render: (n) =>
    `${counted(n, "promotion image", "promotion images")} still being created. Try again in a few minutes.`,
  recognition: (n) => counted(n, "recognition or award", "recognitions and awards"),
  authored_record: (n) => `${counted(n, "record", "records")} they created or decided for others`,
};

export function accountDeletionRemovedLabel(item: AccountDeletionCount<AccountDeletionRemovedKind>): string {
  return REMOVED_LABELS[item.kind](item.count);
}

export function accountDeletionBlockerLabel(item: AccountDeletionCount<AccountDeletionBlockerKind>): string {
  return BLOCKER_LABELS[item.kind](item.count);
}
