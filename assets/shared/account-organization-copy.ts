/** Account setup's organization step, said at sign-in before the portal opens. */
export const ACCOUNT_ORGANIZATION_COPY = {
  title: "Add your organization",
  /** An organization has claimed the domain: it cannot be a personal address. */
  claimedIntro: (domain: string) => `@${domain} belongs to an organization. Choose the one you represent.`,
  /** No organization has claimed the domain: it may still be a personal address. */
  unclaimedIntro: (domain: string) =>
    `If you use @${domain} for work, add the organization you represent. If it's your own domain, use it as a personal email.`,
  finish: "Finish signing in",
  /** The server still asks, such as after a domain was claimed while the step was open. */
  stillRequired: "Choose your organization to finish signing in.",
  failed: "Your sign-in could not be finished. Try again.",
  /** A passkey carries no mailbox proof, so the step is answered through an email link. */
  passkeyRefused: "Sign in with an email link this time to add your organization.",
} as const;
