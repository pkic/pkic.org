import { IDENTITY_NOTIFICATION_EMAIL_TEMPLATE } from "../../assets/shared/email-template-actions.ts";
// Operational messages seeded separately from schema migrations.
export const DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES = [
  IDENTITY_NOTIFICATION_EMAIL_TEMPLATE,
  {
    key: "proposal_speaker_response",
    contentType: "markdown",
    messageType: "transactional",
    subjectTemplate:
      "{{#if withdrawn}}Late speaker response withdrawn{{else}}{{#if rejected}}Late speaker participation declined{{else}}{{#if approved}}Late speaker participation approved{{else}}{{#if late}}Late speaker response awaits review{{else}}Speaker willingness confirmed{{/if}}{{/if}}{{/if}}{{/if}} — {{eventName}}",
    content: `{{#if firstName}}Hello {{firstName}},{{else}}Hello,{{/if}}

{{#if withdrawn}}{{#if recipientIsSpeaker}}You withdrew your late response{{else}}{{speakerName}} withdrew their late response{{/if}} for the proposal **{{proposalTitle}}** at **{{eventName}}**. It no longer awaits organizer review.{{else}}{{#if rejected}}{{#if recipientIsSpeaker}}An organizer declined your late participation{{else}}An organizer declined late participation by {{speakerName}}{{/if}} in the proposal **{{proposalTitle}}** for **{{eventName}}**.{{else}}{{#if approved}}{{#if recipientIsSpeaker}}An organizer approved your late participation{{else}}An organizer approved late participation by {{speakerName}}{{/if}} in the proposal **{{proposalTitle}}** for **{{eventName}}**.{{else}}

{{#if recipientIsSpeaker}}You are willing to participate{{else}}{{speakerName}} is willing to participate{{/if}} in the proposal **{{proposalTitle}}** for **{{eventName}}**.

{{#if late}}The response arrived after the invitation deadline. A replacement may already exist. Participation awaits an authorized organizer's approval; existing participation reservations remain until review, and this response adds no agenda credit.{{else}}{{#if recipientIsSpeaker}}Your willingness{{else}}Their willingness{{/if}} to participate in the proposal is confirmed.{{/if}}{{/if}}{{/if}}{{/if}}

Speaker participation does not accept the proposal or guarantee inclusion in the program. Committee acceptance and scheduling are separate decisions.

[{{#if recipientIsSpeaker}}View your participation{{else}}Review the proposal{{/if}}]({{proposalUrl}})
`,
  },

  {
    key: "event_proposal_verify",
    subjectTemplate: "Verify your email for {{eventName}}",
    content:
      'Verify your email address to continue your proposal for **{{eventName}}**.\n\n<div class="cta-navy"><a href="{{verificationUrl}}">Verify your email &rarr;</a></div>\n\nThe link works for a short time. If you did not request it, you can ignore this email.',
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    // Starting an account from a flow. An address that already has an account gets this same message, so it
    // never says which addresses have one; the link signs that account in instead.
    key: "user_sign_up_link",
    subjectTemplate:
      "{{#if registration}}Confirm your email to register for {{eventName}}{{else}}{{#if proposal}}Confirm your email to submit a proposal for {{eventName}}{{else}}{{#if join}}Confirm your email to join the PKI Consortium{{else}}Confirm your email for the PKI Consortium{{/if}}{{/if}}{{/if}}",
    content:
      'Confirm that **{{email}}** is yours to {{#if registration}}register for **{{eventName}}**{{else}}{{#if proposal}}submit a proposal for **{{eventName}}**{{else}}{{#if join}}join the **PKI Consortium**{{else}}continue to the **PKI Consortium portal**{{/if}}{{/if}}{{/if}}.\n\n<div class="cta-navy"><a href="{{magicLinkUrl}}">Confirm my email &rarr;</a></div>\n\nThe link creates your PKI Consortium account, or signs you in if you already have one, and takes you straight back to {{#if registration}}your registration{{else}}{{#if proposal}}your proposal{{else}}{{#if join}}your membership application{{else}}the portal{{/if}}{{/if}}{{/if}}.\n\n<div class="notice notice-warning">&#9888;&#65039; <strong>Security notice</strong><br>&bull; This link is valid for <strong>{{expiresInMinutes}} minutes</strong> only.<br>&bull; It can only be used <strong>once</strong> and is tied to <code>{{email}}</code>.<br>&bull; If you did not request this link, ignore this email.</div>',
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
    key: "account_security_notice",
    subjectTemplate:
      "{{#if address_added}}An email address was added to your PKI Consortium account{{/if}}{{#if address_removed}}An email address was removed from your PKI Consortium account{{/if}}{{#if primary_changed}}Your PKI Consortium primary email address changed{{/if}}{{#if first_sign_in}}New sign-in with an email address on your PKI Consortium account{{/if}}",
    content:
      '{{#if address_added}}**{{address}}** was added to your PKI Consortium account. You can now sign in with it.{{/if}}{{#if address_removed}}**{{address}}** was removed from your PKI Consortium account. It no longer signs in.{{/if}}{{#if primary_changed}}**{{address}}** is now the primary email address of your PKI Consortium account. Account email goes there from now on.{{/if}}{{#if first_sign_in}}Someone signed in to your PKI Consortium account with **{{address}}** for the first time.{{/if}}\n\nIf this was you, there is nothing to do.\n\nIf it was not, sign in with another address or your passkey and review your email addresses and passkeys.\n\n<div class="cta-navy"><a href="{{baseUrl}}/portal/#/users/{{userId}}">Review your account &rarr;</a></div>',
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "user_sign_in_unavailable",
    subjectTemplate: "Sign in to the PKI Consortium another way",
    content:
      'Someone asked for a sign-in link for **{{email}}**. This address stopped signing in when the organization representation it belongs to ended, so we did not send a link.\n\nSign in with your passkey or with another email address on your account instead.\n\n<div class="cta-navy"><a href="{{baseUrl}}/portal/">Go to sign-in &rarr;</a></div>\n\nIf you did not ask for a link, you can ignore this email.',
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
