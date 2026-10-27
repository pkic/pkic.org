/** Canonical invitation-bearing lifecycle template, shared by seeding and delivery tests. */
export const IDENTITY_NOTIFICATION_EMAIL_TEMPLATE = {
  key: "organization-identity-changed",
  subjectTemplate: "Your organization identity changed",
  content:
    "Hi {{recipientName}},\n\n{{changeMessage}}\n\n{{#if invitationToken}}[Review and accept this identity]({{baseUrl}}/portal/#/identity-invitations?token={{invitationToken}})\n\nThe link expires after seven days. Opening it does not activate the identity; confirm on the page.{{/if}}\n\nWhen this identity is active, actions taken in that capacity are attributed to {{organizationName}}. If this change is unexpected, contact an authorized contact for the organization.",
  contentType: "markdown",
  messageType: "transactional",
} as const;

/** Action fields whose values must survive template rendering as usable email links. */
export const EMAIL_TEMPLATE_ACTION_FIELDS: Readonly<Record<string, readonly string[]>> = {
  // The same lifecycle template also sends notices without an invitation action.
  [IDENTITY_NOTIFICATION_EMAIL_TEMPLATE.key]: ["invitationToken"],
};
