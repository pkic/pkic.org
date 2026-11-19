/** Account setup's organization step, said at sign-in before the portal opens. */
export const ACCOUNT_ORGANIZATION_COPY = {
  title: "Add your organization",
  /** An organization has claimed the domain: it cannot be a personal address. */
  claimedIntro: (domain: string) => `@${domain} belongs to an organization. Choose the one you represent.`,
  /** No organization has claimed the domain: it may still be a personal address. */
  unclaimedIntro: (domain: string) =>
    `If you use @${domain} for work, add the organization you represent. If it's your own domain, use it as a personal email.`,
  finish: "Finish signing in",
  /**
   * Asked once more before a domain that is not a known free mailbox is kept
   * as a personal address: a work address belongs with its organization.
   */
  personalConfirm: {
    title: (domain: string) => `Use @${domain} as a personal email?`,
    body: (domain: string) =>
      `Choose this only if @${domain} is your own domain and no organization uses it. If you use it for work, add your organization instead.`,
    consequences: (domain: string) => [
      "Your account isn't connected to an organization",
      `If an organization adds @${domain} later, you'll be asked to choose it the next time you sign in`,
    ],
    confirm: "Use as personal email",
    cancel: "Add my organization",
  },
  /** The server still asks, such as after a domain was claimed while the step was open. */
  stillRequired: "Choose your organization to finish signing in.",
  failed: "Your sign-in could not be finished. Try again.",
  /** A passkey carries no mailbox proof, so the step is answered through an email link. */
  passkeyRefused: "Sign in with an email link this time to add your organization.",
} as const;
