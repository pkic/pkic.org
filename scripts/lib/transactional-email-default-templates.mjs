import { IDENTITY_NOTIFICATION_EMAIL_TEMPLATE } from "../../assets/shared/email-template-actions.ts";
// Operational messages seeded separately from schema migrations.
export const DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES = [
  IDENTITY_NOTIFICATION_EMAIL_TEMPLATE,
  {
    key: "proposal_speaker_response",
    contentType: "markdown",
    messageType: "transactional",
    subjectTemplate:
      "{{#if withdrawn}}Late speaker response withdrawn{{else}}{{#if rejected}}Late speaker response declined{{else}}{{#if approved}}Late speaker response approved{{else}}{{#if late}}Late speaker response awaits review{{else}}Speaker confirmed{{/if}}{{/if}}{{/if}}{{/if}} — {{eventName}}",
    content: `{{> greeting}}

{{#if withdrawn}}{{#if recipientIsSpeaker}}You withdrew your late response{{else}}{{speakerName}} withdrew their late response{{/if}} to speak on **{{proposalTitle}}** at **{{eventName}}**. There is nothing left for an organizer to review.{{else}}{{#if rejected}}An organizer declined {{#if recipientIsSpeaker}}your late response{{else}}the late response from {{speakerName}}{{/if}} to speak on **{{proposalTitle}}** at **{{eventName}}**.{{else}}{{#if approved}}An organizer approved {{#if recipientIsSpeaker}}your late response{{else}}the late response from {{speakerName}}{{/if}} to speak on **{{proposalTitle}}** at **{{eventName}}**.{{else}}

{{#if recipientIsSpeaker}}You confirmed{{else}}{{speakerName}} confirmed{{/if}} speaking on **{{proposalTitle}}** at **{{eventName}}**.

{{#if late}}The response came in after the invitation deadline, and someone else may already have been invited. An organizer will review it; until then, the proposal's speakers stay as they are.{{/if}}{{/if}}{{/if}}{{/if}}

{{> speaker_confirmation_note}}

[{{#if recipientIsSpeaker}}View your participation{{else}}Review the proposal{{/if}}]({{proposalUrl}})
`,
  },

  {
    key: "event_proposal_verify",
    subjectTemplate: "Verify your email for {{eventName}}",
    content:
      "Verify your email address to continue your proposal for **{{eventName}}**.\n\n:::button\n[Verify my email →]({{verificationUrl}})\n:::\n\nThe link works for a short time. Didn't ask for it? You can ignore this email.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    // Starting an account from a flow. An address that already signs in gets user_account_found_link instead.
    key: "user_sign_up_link",
    subjectTemplate:
      "{{#if registration}}Confirm your email to register for {{eventName}}{{else}}{{#if proposal}}Confirm your email to submit a proposal for {{eventName}}{{else}}{{#if join}}Confirm your email to join the PKI Consortium{{else}}Confirm your email for the PKI Consortium{{/if}}{{/if}}{{/if}}",
    content:
      "Hello,\n\nConfirm that **{{email}}** is your email address to {{#if registration}}register for **{{eventName}}**{{else}}{{#if proposal}}submit a proposal for **{{eventName}}**{{else}}{{#if join}}apply to join the **PKI Consortium**{{else}}continue to the **PKI Consortium portal**{{/if}}{{/if}}{{/if}}.\n\n:::button\n[Confirm my email →]({{magicLinkUrl}})\n:::\n\nThe link sets up your PKI Consortium account and takes you straight back to {{#if registration}}your registration{{else}}{{#if proposal}}your proposal{{else}}{{#if join}}your membership application{{else}}the portal{{/if}}{{/if}}{{/if}}.\n\n{{> link_safety_notice}}",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "user_email_verification",
    subjectTemplate: "Verify your email address",
    content:
      "Hello,\n\nVerify that **{{email}}** is yours to add it to your **PKI Consortium** account.\n\n:::button\n[Verify this address →]({{verificationUrl}})\n:::\n\nOpen the link while you are signed in to the account you added it to, and verify it only if both addresses are yours. Once verified, you can sign in with this address too, and a work address connects you to your organization.\n\nThe link works once, for {{expiresInHours}} hours. Didn't add this address? You can ignore this email.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "account_security_notice",
    subjectTemplate:
      "{{#if address_added}}An email address was added to your PKI Consortium account{{/if}}{{#if address_removed}}An email address was removed from your PKI Consortium account{{/if}}{{#if primary_changed}}Your PKI Consortium primary email address changed{{/if}}{{#if first_sign_in}}New sign-in to your PKI Consortium account{{/if}}",
    content:
      "Hello,\n\n{{#if address_added}}**{{address}}** was added to your PKI Consortium account. You can now sign in with it.{{/if}}{{#if address_removed}}**{{address}}** was removed from your PKI Consortium account and can no longer be used to sign in.{{/if}}{{#if primary_changed}}**{{address}}** is now the primary email address of your PKI Consortium account. We'll send account email there from now on.{{/if}}{{#if first_sign_in}}Someone signed in to your PKI Consortium account with **{{address}}** for the first time.{{/if}}\n\nIf this was you, there's nothing else to do.\n\nIf it wasn't, sign in with another email address or a passkey right away and check the email addresses and passkeys on your account.\n\n:::button\n[Review my account →]({{baseUrl}}/portal/#/users/{{userId}})\n:::\n",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "user_sign_in_unavailable",
    subjectTemplate: "Sign in to the PKI Consortium another way",
    content:
      "Hello,\n\nWe received a request to sign in with **{{email}}**. This address can no longer be used to sign in, because your representation of its organization has ended, so we didn't send a link.\n\nSign in with a passkey or with another email address on your account instead. If you still work at the organization, you can reinstate your representation once you are signed in.\n\n:::button\n[Go to sign-in →]({{baseUrl}}/portal/)\n:::\n\nDidn't ask to sign in? You can ignore this email.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    // Starting an account with an address that already signs in: only that mailbox learns the account exists,
    // and its link signs in and returns to what the person came for, or to the registration they already hold.
    key: "user_account_found_link",
    subjectTemplate:
      "{{#if alreadyRegistered}}You're already registered for {{eventName}}{{else}}{{#if registration}}Continue your registration for {{eventName}}{{else}}{{#if proposal}}Continue your proposal for {{eventName}}{{else}}{{#if join}}Continue your membership application{{else}}Sign in to the PKI Consortium{{/if}}{{/if}}{{/if}}{{/if}}",
    content:
      "{{> greeting}}\n\n{{#if alreadyRegistered}}Good news: you're already registered for **{{eventName}}**, so there's nothing more to do. Your registration details are below.\n\n:::button\n[View or change my registration →]({{magicLinkUrl}})\n:::\n\n{{> reg_details}}{{else}}Welcome back! You already have a PKI Consortium account with **{{email}}**, so there's no need to create another one. Sign in to continue {{#if registration}}your registration for **{{eventName}}**{{else}}{{#if proposal}}your proposal for **{{eventName}}**{{else}}{{#if join}}your membership application{{else}}to the portal{{/if}}{{/if}}{{/if}}.\n\n:::button\n[Sign in and continue →]({{magicLinkUrl}})\n:::\n{{/if}}\n\n{{> link_safety_notice}}",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    // A sign-in request that cannot send a link still answers the mailbox it names, so nobody waits for nothing.
    key: "user_sign_in_help",
    subjectTemplate:
      "{{#if noAccount}}We couldn't find a PKI Consortium account for this address{{else}}We couldn't send you a sign-in link{{/if}}",
    content:
      "Hello,\n\n{{#if noAccount}}We received a request to sign in with **{{email}}**, but no PKI Consortium account uses this address.\n\nNew here? Create an account with this address. Already have an account? Sign in with the email address or passkey you use for it.\n\n:::button\n[Create an account →]({{startUrl}})\n:::\n{{else}}We received a request to sign in with **{{email}}**, but this address can't be used to sign in to its account, so we didn't send a link.\n\nThe secretariat can help you sign in: email [{{contactEmail}}](mailto:{{contactEmail}}).{{/if}}\n\nDidn't ask to sign in? You can ignore this email.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_invitation",
    subjectTemplate: "You're invited to {{sessionTitle}}",
    content:
      "Hello,\n\nYou're invited to the session **{{sessionTitle}}** at **{{eventName}}**. Open the event in the PKI Consortium portal to respond.\n\nThis invitation doesn't register you for the event or reserve you a seat.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_booking",
    subjectTemplate: "Your place in {{sessionTitle}} changed",
    content:
      "Hello,\n\nYour place in the session **{{sessionTitle}}** at **{{eventName}}** is now **{{participationStatus}}** ({{attendanceMode}}).\n\nCheck the event in the PKI Consortium portal for the latest schedule and what you need to get in. A preference or a waitlist place doesn't guarantee a seat.",
    contentType: "markdown",
    messageType: "transactional",
  },
];
