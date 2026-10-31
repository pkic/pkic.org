import { IDENTITY_NOTIFICATION_EMAIL_TEMPLATE } from "../../assets/shared/email-template-actions.ts";
// Operational messages seeded separately from schema migrations.
export const DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES = [
  IDENTITY_NOTIFICATION_EMAIL_TEMPLATE,
  {
    key: "event_proposal_verify",
    subjectTemplate: "Verify your email for {{eventName}}",
    content:
      "Use this short-lived link to verify your email address for {{eventName}}.\n\n{{verificationUrl}}\n\nIf you did not request this link, you can ignore this email.",
    contentType: "text",
    messageType: "transactional",
  },
  {
    key: "membership_join_verify",
    subjectTemplate: "Verify your email address to join the PKI Consortium",
    content:
      "Use the secure link below to verify your email address and continue joining the PKI Consortium. The link works for {{expiresInMinutes}} minutes.\n\n[Verify email and continue]({{verificationUrl}})\n\nIf you did not request this link, you can safely ignore this email.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "registration_email_verify",
    subjectTemplate: "Verify your email for {{eventName}}",
    content:
      'Verify your email address to continue your registration for **{{eventName}}**.\n\n<div class="cta-navy"><a href="{{verificationUrl}}">Verify email and continue &rarr;</a></div>\n\nIf you did not start a registration, you can ignore this email.',
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "user_email_verification",
    subjectTemplate: "Verify your email address",
    content:
      'Please confirm that **{{email}}** is your address for the **PKI Consortium portal**.\n\n<div class="cta-navy"><a href="{{verificationUrl}}">Verify this address &rarr;</a></div>\n\nThe link works once, for {{expiresInHours}} hours. Sign in to the account where you requested this address, then confirm linking it. Confirm only if both addresses belong to you. A verified work address links you to your organization.\n\nIf you did not add this address, you can ignore this email.',
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_reminder",
    subjectTemplate: "Starting soon: {{sessionTitle}}",
    content:
      "Your reserved session **{{sessionTitle}}** at **{{eventName}}** starts at {{sessionStart}}. Location: {{sessionLocation}}. Open your event agenda for the latest information.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_invitation",
    subjectTemplate: "Session invitation: {{sessionTitle}}",
    content:
      "You are invited to **{{sessionTitle}}** at **{{eventName}}**. Review the invitation in your event portal. An invitation does not register you for the event or reserve a seat.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_booking",
    subjectTemplate: "Session registration updated: {{sessionTitle}}",
    content:
      "Your registration for **{{sessionTitle}}** at **{{eventName}}** has changed to **{{participationStatus}}** ({{attendanceMode}}). Review your event portal for the current schedule and admission requirements. A preference or waitlist entry does not guarantee a seat.",
    contentType: "markdown",
    messageType: "transactional",
  },
];
