/** Canonical invitation-bearing lifecycle template, shared by seeding and delivery tests. */
export const IDENTITY_NOTIFICATION_EMAIL_TEMPLATE = {
  key: "organization-identity-changed",
  subjectTemplate: "Your organization identity changed",
  content:
    "Hello {{recipientName}},\n\n{{changeMessage}}\n\n{{#if invitationToken}}[Review and accept this identity]({{baseUrl}}/portal/#/identity-invitations?token={{invitationToken}})\n\nThe link works for seven days. Opening it doesn't activate the identity; you confirm on the page.{{/if}}\n\nWhile this identity is active, what you do as this identity is attributed to {{organizationName}}. Didn't expect this change? Contact an authorized contact at the organization.",
  contentType: "markdown",
  messageType: "transactional",
} as const;

/** Action fields whose values must survive template rendering as usable email links. */
export const EMAIL_TEMPLATE_ACTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // The same lifecycle template also sends notices without an invitation action.
  [IDENTITY_NOTIFICATION_EMAIL_TEMPLATE.key]: ["invitationToken"],
};
