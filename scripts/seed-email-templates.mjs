import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import YAML from "yaml";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "scripts", "seed-event.yaml");
const DEFAULT_BUCKET = process.env.ASSETS_BUCKET_NAME ?? "pkic-assets";
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@pkic.org";
const DEFAULT_LAYOUT_HTML = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light dark">
  <meta name="supported-color-schemes" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    body,table,td,a{-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}
    table,td{mso-table-lspace:0pt;mso-table-rspace:0pt}
    img{-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none}
    table{border-collapse:collapse!important}
    body{height:100%!important;margin:0!important;padding:0!important;width:100%!important;background-color:#f0f4f8}
    a[x-apple-data-detectors]{color:inherit!important;text-decoration:none!important;font-size:inherit!important;font-family:inherit!important;font-weight:inherit!important;line-height:inherit!important}
    u+#body a{color:inherit!important;text-decoration:none!important}
    .eb h1{font-size:24px;font-weight:700;color:#0d1b2a;margin:0 0 20px;line-height:1.3;letter-spacing:-0.01em}
    .eb h2{font-size:18px;font-weight:700;color:#0d1b2a;margin:28px 0 10px;line-height:1.35;padding-bottom:8px;border-bottom:2px solid #f0f4f8}
    .eb h3{font-size:14px;font-weight:700;color:#198754;margin:20px 0 8px;text-transform:uppercase;letter-spacing:0.04em}
    .eb p{margin:0 0 16px;color:#374151;line-height:1.75}
    .eb p:last-child{margin-bottom:0}
    .eb a{color:#198754;text-decoration:underline;font-weight:500}
    .eb strong{color:#0d1b2a;font-weight:700}
    .eb em{color:#4b5563;font-style:italic}
    .eb ul,.eb ol{margin:0 0 16px;padding-left:22px;color:#374151}
    .eb li{margin-bottom:6px;line-height:1.65}
    .eb blockquote li{font-size:13px;margin-bottom:3px;line-height:1.55}
    .eb hr{border:none;border-top:1px solid #e5e9ef;margin:28px 0}
    .eb blockquote{margin:20px 0;padding:14px 20px;background:#f8fafc;border-left:4px solid #198754;border-radius:0 6px 6px 0;color:#4b5563}
    .eb blockquote p{margin:0;color:#4b5563;font-style:italic}
    .eb blockquote strong{color:#374151}
    .eb blockquote a{color:#374151;text-decoration:underline}
    .eb code{font-family:'Courier New',Courier,monospace;font-size:13px;background:#f1f5f9;padding:2px 7px;border-radius:4px;color:#0d1b2a;border:1px solid #e5e9ef}
    .eb pre{background:#f8fafc;border:1px solid #e5e9ef;border-radius:6px;padding:16px;font-size:13px;overflow:auto;margin:0 0 16px}
    .eb table{width:100%;border-collapse:collapse;margin:0 0 20px}
    .eb th{background:#f8fafc;border-bottom:2px solid #e5e9ef;color:#0d1b2a;font-size:13px;font-weight:700;padding:10px 14px;text-align:left}
    .eb td{border-bottom:1px solid #f0f4f8;color:#374151;font-size:14px;padding:10px 14px;vertical-align:top}
    .eb tr:last-child td{border-bottom:none}
    .notice{margin:16px 0;padding:14px 18px;border-radius:6px;border-left:4px solid;font-size:14px;line-height:1.65}
    .notice-success{background:#f0f7f4;border-color:#198754;color:#14532d}
    .notice-warning{background:#fffbeb;border-color:#d97706;color:#92400e}
    .notice-info{background:#eff6ff;border-color:#3b82f6;color:#1e40af}
    .notice-danger{background:#fef2f2;border-color:#ef4444;color:#991b1b}
    .notice a,.notice strong{color:inherit}
    .cta,.cta-navy{text-align:center;margin:28px 0}
    .cta a,.cta-navy a{display:inline-block;color:#ffffff!important;text-decoration:none!important;font-size:15px;font-weight:700;padding:14px 36px;border-radius:6px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif}
    .cta a{background:#198754}
    .cta-navy a{background:#0d1b2a}
    .cta-secondary{text-align:center;margin:12px 0 28px}
    .cta-secondary a{display:inline-block;color:#6b7280!important;text-decoration:none!important;font-size:13px;font-weight:400;padding:8px 20px;border-radius:6px;border:1px solid #d1d5db;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;background:#ffffff}
    @media only screen and (max-width:680px){
      .ew{width:100%!important;border-radius:0!important}
      .ep{padding:28px 24px!important}
      .ef{padding:20px 24px!important}
      .eh{padding:24px!important}
    }
    @media (prefers-color-scheme:dark){
      body,.ow{background-color:#0f172a!important}
      .eb{background-color:#1e2235!important;color:#d1d5db!important}
      .eb h1{color:#f9fafb!important}
      .eb h2{color:#f9fafb!important;border-bottom-color:#374151!important}
      .eb h3{color:#4ade80!important}
      .eb p{color:#d1d5db!important}
      .eb a{color:#4ade80!important}
      .eb strong{color:#f9fafb!important}
      .eb em{color:#9ca3af!important}
      .eb ul,.eb ol,.eb li{color:#d1d5db!important}
      .eb hr{border-top-color:#374151!important}
      .eb blockquote{background:#1a2744!important;border-left-color:#4ade80!important}
      .eb blockquote p{color:#9ca3af!important}
      .eb blockquote strong{color:#d1d5db!important}
      .eb blockquote a{color:#9ca3af!important}
      .eb code{background:#0f172a!important;color:#e2e8f0!important;border-color:#374151!important}
      .eb pre{background:#0f172a!important;border-color:#374151!important}
      .eb th{background:#263148!important;color:#f9fafb!important;border-bottom-color:#374151!important}
      .eb td{border-bottom-color:#374151!important;color:#d1d5db!important}
      .notice-success{background:#0f2a1c!important;color:#86efac!important}
      .notice-warning{background:#2a1f0f!important;color:#fbbf24!important}
      .notice-info{background:#0f1f3a!important;color:#93c5fd!important}
      .notice-danger{background:#2a0f0f!important;color:#fca5a5!important}
    }
  </style>
</head>
<body id="body" style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">PKI Consortium &zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="ow" style="background-color:#f0f4f8;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="660" class="ew" style="max-width:660px;width:100%;border-radius:10px;overflow:hidden;box-shadow:0 2px 4px rgba(0,0,0,0.05),0 8px 32px rgba(0,0,0,0.08);">
          <tr>
            <td class="eh" align="center" style="background-color:#000000;padding:28px 40px;text-align:center;">
              <a href="{{baseUrl}}" target="_blank" style="text-decoration:none;display:inline-block;line-height:1;">
                <img src="{{baseUrl}}/img/logo-white.png" width="160" alt="PKI Consortium" style="display:block;width:160px;max-width:160px;height:auto;border:0;">
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:0;font-size:0;line-height:0;background:linear-gradient(to right,#198754,#20c997,#5a9bd5,#ffc107,#ed7d31,#dc3545);height:5px;line-height:5px;">&nbsp;</td>
          </tr>
          {{#if heroImageUrl}}<tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <img src="{{baseUrl}}/{{heroImageUrl}}" width="660" alt="" style="display:block;width:100%;max-width:660px;height:auto;border:0;">
            </td>
          </tr>{{/if}}
          <tr>
            <td class="ep eb" style="background-color:#ffffff;padding:40px 40px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:16px;line-height:1.75;color:#374151;">
              {{{body_html}}}
            </td>
          </tr>
          <tr>
            <td class="ef" style="background-color:#0d1b2a;padding:24px 40px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td align="center" style="font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:12px;line-height:1.6;color:#6b7280;text-align:center;">
                    <p style="margin:0 0 8px;">
                      <a href="{{baseUrl}}" target="_blank" style="color:#4ade80;text-decoration:none;font-weight:600;">pkic.org</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="{{baseUrl}}/privacy/" target="_blank" style="color:#6b7280;text-decoration:none;">Privacy Policy</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="{{baseUrl}}/join/" target="_blank" style="color:#6b7280;text-decoration:none;">Become a Member</a>
                    </p>
                    <p style="margin:0;color:#4b5563;font-size:11px;">&copy; PKI Consortium &mdash; Advancing trust and security in digital infrastructure.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

// NOTE: shared email partials are seeded here and managed via the admin UI.
// Keep these in sync with the editor labels and the partial loader.
const DEFAULT_TEMPLATES = [
  {
    key: "email_layout",
    subjectTemplate: null,
    contentType: "html",
    content: DEFAULT_LAYOUT_HTML,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared donation request block
  // Variables: baseUrl
  // Partials:  {{> donation_request}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_donation_request",
    subjectTemplate: null,
    contentType: "markdown",
    content: `---

**Help to keep the PKI Consortium Membership, Conferences, and Resources free**

If what we do is valuable to you or your organization, please consider a voluntary contribution — any amount helps us keep membership, conferences, and resources open to the widest possible audience.

<div class="cta-secondary"><a href="{{baseUrl}}/donate/">Support the PKI Consortium &rarr;</a></div>

<div class="notice notice-info">Contributions to the PKI Consortium are <strong>entirely voluntary</strong> and are not a ticket, fee, or payment for goods or services. The PKI Consortium is a <strong>501(c)(6) nonprofit business league</strong> — donations are <strong>not deductible as charitable contributions</strong> for U.S. federal income tax purposes. Consult your tax advisor regarding any applicable treatment in your jurisdiction.<br><br>Does your organization want to make a bigger impact? Sponsors directly fund free, open events for the global PKI and security community — <a href="{{baseUrl}}/sponsors/">explore sponsorship opportunities at pkic.org/sponsors/</a>.</div>
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Email confirmation request
  // Variables: eventName, firstName, lastName, email, organizationName,
  //            jobTitle, attendanceSummary, confirmationUrl, manageUrl, shareUrl,
  //            sponsorsImageUrl, heroImageUrl, customAnswerRows, acceptedTermsText
  // Partials:  {{> reg_details}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_confirm_email",
    subjectTemplate: "Please confirm your registration for {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

Thank you for registering for **{{eventName}}**! Please confirm your email address to activate your registration.

<div class="cta"><a href="{{confirmationUrl}}">Confirm my registration &rarr;</a></div>

<div class="notice notice-warning">&#9201; This link expires in <strong>24 hours</strong>. If you did not request this registration, <a href="{{manageUrl}}">click here to cancel it and remove your data</a>.</div>

---

{{> reg_details}}

Use your [registration management link]({{manageUrl}}) to review, update, or cancel this registration at any time.

Know someone who should attend? Share your personal referral link: [{{shareUrl}}]({{shareUrl}})

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Registration confirmed
  // Variables: eventName, eventUrl, firstName, lastName, email, organizationName,
  //            jobTitle, attendanceType, venue, status, manageUrl, shareUrl,
  //            sponsorsImageUrl, heroImageUrl, customAnswerRows, acceptedTermsText
  // Partials:  {{> reg_details}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_confirmed",
    subjectTemplate: `{{#if eq status "waitlisted"}}Waitlisted: registration received — {{eventName}}{{else}}Your registration is confirmed — {{eventName}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

{{#if eq status "waitlisted"}}
<div class="notice notice-warning"><strong>Waitlisted:</strong> your registration for <strong>{{eventName}}</strong> has been received. {{#if dayAttendance}}Your overall registration is still pending, and the day-by-day details below show which days are confirmed and which are waitlisted.{{else}}Your entire registration is waitlisted, so no seat has been confirmed yet.{{/if}}</div>
{{else}}
We are delighted to confirm that **your registration for {{eventName}} has been successfully processed**.
{{/if}}

{{#if eq attendanceType "in_person"}}
<div class="notice notice-success">&#128197; A <strong>calendar invitation</strong> is attached to this email — please add it to your calendar.</div>
{{/if}}
{{#if venue}}
<div class="notice notice-info">&#128205; The conference will be held at <strong>{{venue}}</strong>. Enhance your conference experience by staying at the official venue hotel(s), see the <a href="{{eventUrl}}">event website</a> for more details.</div>
{{/if}}

{{#if eq attendanceType "virtual"}}
<div class="notice notice-info">&#128187; You are registered for <strong>virtual / online</strong> attendance. Livestream access details will be shared closer to the event.</div>
{{/if}}
{{#if eq status "waitlisted"}}
<div class="notice notice-warning">&#9203; Your registration is currently <strong>waitlisted</strong>, which means the event has not yet fully confirmed your attendance. One of the limiting factors for in-person capacity is the event budget — we will be able to admit more attendees as sponsors commit to the conference. If {{#if organizationName}}<strong>{{organizationName}}</strong>{{else}}your organization{{/if}} is willing and able to sponsor this conference, please <a href="mailto:contact@pkic.org">contact us</a>. We will notify you as soon as the remaining seats become available.</div>
{{/if}}

---

{{> reg_details}}

[Manage your registration &rarr;]({{manageUrl}})

Know someone who should attend? Share your personal referral link and use the attached personal image to help grow the community:
[{{shareUrl}}]({{shareUrl}})

We look forward to seeing you at the *{{eventName}}**!

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Registration updated
  // Variables: eventName, firstName, lastName, email, organizationName,
  //            jobTitle, attendanceSummary, statusLabel, manageUrl,
  //            customAnswerRows, acceptedTermsText
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_updated",
    subjectTemplate: `{{#if waitlistOfferNotice}}Waitlist availability update — {{eventName}}{{else}}{{#if eq status "waitlisted"}}Waitlisted registration updated — {{eventName}}{{else}}Registration updated — {{eventName}}{{/if}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

This email confirms that your registration for **{{eventName}}** has been successfully updated.

{{#if eq status "waitlisted"}}
  <div class="notice notice-warning"><strong>Waitlisted:</strong> your attendance is not yet confirmed. You can use your registration management link to review, update, or cancel this registration.</div>
{{/if}}
{{#if waitlistOfferNotice}}
<div class="notice notice-info"><strong>A seat is available:</strong> we have sent a waitlist availability notification for your registration. Please open your management link below to review the latest status and take the next step.</div>
{{/if}}

---

## Your updated details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}  
> {{/if}}{{#if email}}**Email:** {{email}}  
> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}  
> {{/if}}{{#if jobTitle}}**Title / Role:** {{jobTitle}}  
> {{/if}}{{#if attendanceSummary}}**Attendance:** {{attendanceSummary}}  
> {{/if}}{{#if statusLabel}}**Status:** {{statusLabel}}  
> {{/if}}{{#each customAnswerRows}}**{{label}}:** {{displayValue}}  
> {{/each}}{{#if acceptedTermsText}}**Terms agreed:**  
> - {{acceptedTermsText}}{{/if}}

{{#if eq status "waitlisted"}}
<div class="notice notice-warning">&#9203; Your registration is currently <strong>waitlisted</strong> for in-person attendance. One of the limiting factors for in-person capacity is the event budget — we will be able to admit more attendees as sponsors commit to the conference. If {{#if organizationName}}<strong>{{organizationName}}</strong>{{else}}your organization{{/if}} is willing and able to sponsor this conference, please <a href="mailto:contact@pkic.org">contact us</a>. We will notify you as soon as a seat becomes available.</div>
{{/if}}
{{#if eq status "cancelled"}}
<div class="notice notice-danger">Your registration has been <strong>cancelled</strong>. If this was a mistake, please re-register through the event page.</div>
{{/if}}

If the details above don't look right, use your [registration management link]({{manageUrl}}) to review or edit your registration.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Registration — unauthorized report confirmation
  // Sent when a registrant reports they did not request the registration.
  // Variables: eventName, firstName
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_unauthorized",
    subjectTemplate: "Registration cancelled and data removed — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

We have received your report that you did not request a registration for **{{eventName}}**.

<div class="notice notice-success">&#10003; Your registration has been <strong>cancelled</strong> and your personal data has been <strong>removed</strong> from our records.</div>

No further action is required on your part. If you receive any further emails regarding this event that you believe are in error, please [contact us](mailto:contact@pkic.org).

We apologise for any inconvenience.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Confirmation reminder (for unconfirmed registrations)
  // Sent automatically when a registration remains pending confirmation.
  // Variables: eventName, firstName, confirmationUrl, manageUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_confirmation_reminder",
    subjectTemplate: "Reminder: please confirm your registration for {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

This is a friendly reminder that your registration for **{{eventName}}** is not yet confirmed.

<div class="cta"><a href="{{confirmationUrl}}">Confirm my registration &rarr;</a></div>

<div class="notice notice-warning">&#9201; Please confirm as soon as possible to secure your spot. If you did not request this registration, <a href="{{manageUrl}}">click here to cancel it and remove your data</a>.</div>
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 4. Attendee invite
  // Variables: eventName, firstName, lastName, inviterName, registrationUrl, declineUrl,
  //            sponsorsImageUrl, heroImageUrl
  // Partials:  {{> about_pkic}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "attendee_invite",
    subjectTemplate: `{{#if isReminder}}{{#if lte daysUntilExpiry "2"}}Last chance to join peers at {{eventName}}{{else}}Still considering {{eventName}}?{{/if}}{{else}}You're invited to {{eventName}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Colleague,{{/if}}

{{#if isReminder}}
<div class="notice notice-warning">A quick follow-up on your personal invitation to <strong>{{eventName}}</strong>.{{#if daysUntilExpiry}}{{#if lte daysUntilExpiry "2"}} Access closes in {{daysUntilExpiry}} day(s).{{else}} We'd love to have you in the room for this one.{{/if}}{{/if}}</div>
{{/if}}

{{#if inviterName}}You have been personally invited by **{{inviterName}}** to attend **{{eventName}}**, an event organized by the [PKI Consortium](https://pkic.org).{{else}}You have been personally invited to attend **{{eventName}}**, an event organized by the [PKI Consortium](https://pkic.org).{{/if}}

Join security experts, researchers, and industry leaders to explore the latest developments in public key infrastructure and post-quantum cryptography.

<div class="cta"><a href="{{registrationUrl}}">Register now &rarr;</a></div>

{{#if declineUrl}}<div class="cta-secondary"><a href="{{declineUrl}}">No thanks, decline this invitation</a></div>{{/if}}

{{#if isReminder}}If this is relevant to your work, this is a good moment to secure your place before capacity tightens.{{else}}Seats are limited — please register at your earliest convenience.{{/if}}

---

{{> about_pkic}}

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Speaker invite
  // Variables: eventName, firstName, lastName, inviterName, proposalUrl, declineUrl,
  //            sponsorsImageUrl, heroImageUrl
  // Partials:  {{> about_pkic}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "speaker_invite",
    subjectTemplate: `{{#if isReminder}}{{#if lte daysUntilExpiry "2"}}Last call to speak at {{eventName}}{{else}}Opportunity to speak at {{eventName}}{{/if}}{{else}}Invitation to speak at {{eventName}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

{{#if isReminder}}
<div class="notice notice-warning">A quick follow-up on your speaker invitation for <strong>{{eventName}}</strong>.{{#if daysUntilExpiry}}{{#if lte daysUntilExpiry "2"}} This opportunity closes in {{daysUntilExpiry}} day(s).{{else}} We'd be excited to feature your perspective in this programme.{{/if}}{{/if}}</div>
{{/if}}

{{#if inviterName}}You have been personally nominated by **{{inviterName}}** to speak at **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).{{else}}We would be honoured to have you present at **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).{{/if}}

We believe your expertise would be a valuable contribution to the programme. We invite you to submit a proposal for a session, workshop, or roundtable.

{{#if isReminder}}If this topic matters to you, we'd hate for you to miss the chance to help shape the conversation on stage.{{/if}}

<div class="cta"><a href="{{proposalUrl}}">Submit a proposal &rarr;</a></div>

{{#if declineUrl}}<div class="cta-secondary"><a href="{{declineUrl}}">No thanks, decline this invitation</a></div>{{/if}}

<div class="notice notice-info">&#128274; This invitation link is <strong>personal</strong> and pre-filled with your details. Please do not share it with others.</div>

If you have any questions or would like to discuss your proposal first, please [contact us](mailto:contact@pkic.org).

---

{{> about_pkic}}

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Campaign message templates (admin Send Email)
  // Variables: firstName, message
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "msg_dear_firstname",
    subjectTemplate: "Message from PKI Consortium",
    content: `{{#if firstName}}Dear {{firstName}},{{/if}}

{{message}}
`,
  },
  {
    key: "msg_message_only",
    subjectTemplate: "Message from PKI Consortium",
    content: `{{message}}`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Proposal submitted
  // Variables: eventName, proposalTitle, manageUrl, shareUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "proposal_submitted",
    subjectTemplate: "Proposal received: {{proposalTitle}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Proposer,{{/if}}

Thank you for submitting your proposal to **{{eventName}}**. We have successfully received it and our programme committee will begin reviewing submissions shortly.

---

## Your submission

> **Title:** {{proposalTitle}}  
> **Event:** {{eventName}}

## What happens next?

1. **Review** — Our programme committee will evaluate all submissions.
2. **Decision** — You will receive an email with the outcome once a decision has been made.
3. **Preparation** *(if accepted)* — We will be in touch with scheduling and logistical details.

You can view or edit your proposal at any time: [Manage my proposal &rarr;]({{manageUrl}})

Encourage colleagues to attend by sharing your referral link: [{{shareUrl}}]({{shareUrl}})

Thank you for contributing to **{{eventName}}** and the broader PKI community!

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Proposal decision
  // Variables: eventName, proposalTitle, finalStatus, decisionNote
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "proposal_decision",
    subjectTemplate: "Update on your proposal: {{proposalTitle}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Proposer,{{/if}}

We have completed our review of your proposal submitted to **{{eventName}}**.

---

## Decision: {{proposalTitle}}

{{#if eq finalStatus "accepted"}}
<div class="notice notice-success">&#127881; <strong>Congratulations — your proposal has been accepted!</strong><br>We are pleased to include <strong>{{proposalTitle}}</strong> in the programme for {{eventName}}. Our team will be in touch with scheduling, AV requirements, and speaker logistics.</div>
{{/if}}
{{#if eq finalStatus "rejected"}}
<div class="notice notice-danger">Thank you for your submission. After careful consideration, we regret to inform you that <strong>{{proposalTitle}}</strong> was not selected for this event's programme.<br>We truly appreciate the time and effort you invested, and we hope you will consider submitting again for a future event.</div>
{{/if}}
{{#if eq finalStatus "waitlisted"}}
<div class="notice notice-warning">&#9203; Your proposal <strong>{{proposalTitle}}</strong> has been placed on the <strong>waitlist</strong>. We may still be able to include it if a slot becomes available, and will keep you informed.</div>
{{/if}}

{{#if decisionNote}}

**Note from the programme committee:**

> {{decisionNote}}

{{/if}}

---

If you have any questions, please [contact us](mailto:contact@pkic.org).

Thank you for your interest in contributing to **{{eventName}}**.

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Co-speaker / added-speaker invite
  // Sent when a speaker is added to a proposal (not the original proposer).
  // Variables: eventName, firstName, lastName, proposerFirstName,
  //            proposalTitle, manageUrl, sponsorsImageUrl, heroImageUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "co_speaker_invite",
    subjectTemplate: `{{#if isReminder}}Reminder: please confirm speaker participation — {{eventName}}{{else}}You have been added as a speaker — {{eventName}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

{{#if isReminder}}
<div class="notice notice-warning">A quick follow-up: we still need your confirmation for this speaker invitation.</div>
{{/if}}

{{#if invitedByDisplay}}
**{{invitedByDisplay}}** invited you as a speaker for **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).
{{else}}
{{proposerFirstName}} has listed you as a speaker on their proposal for **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).
{{/if}}

> **Proposal:** {{proposalTitle}}

{{#if proposalAbstract}}
## Proposal abstract

{{proposalAbstract}}
{{/if}}

{{#if speakerLineupText}}
## Speakers on this proposal

{{speakerLineupText}}
{{/if}}

Please review the proposal and **confirm or decline your participation**. You will also be prompted to review your speaker profile (bio and headshot) so we can promote the session.

<div class="cta"><a href="{{manageUrl}}">Review proposal &amp; confirm participation &rarr;</a></div>

<div class="notice notice-info">&#128274; This link is <strong>personal</strong> — please do not share it. It gives access to your speaker profile and participation management.</div>

If you have questions, please [contact us](mailto:contact@pkic.org).

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 12. Speaker profile request
  // Sent to all speakers when a proposal is accepted. Asks them to review
  // their bio and upload a high-resolution headshot.
  // Variables: eventName, firstName, proposalTitle, profileUrl,
  //            hasHeadshot, hasBio
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "speaker_profile_request",
    subjectTemplate: "Action required: complete your speaker profile — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

Great news — your session **{{proposalTitle}}** has been accepted for **{{eventName}}**!

To help us promote your session, please take a moment to complete your speaker profile.

{{#unless hasBio}}<div class="notice notice-warning">&#9997;&#65039; Your <strong>biography</strong> is missing. Please add a short speaker bio so we can introduce you properly.</div>{{/unless}}
{{#unless hasHeadshot}}<div class="notice notice-warning">&#128247; No <strong>headshot</strong> on file. Please upload a high-resolution photo (JPEG / PNG / WebP, min 1000 &times; 1000 px, max 20 MB).</div>{{/unless}}
{{#if and hasBio hasHeadshot}}<div class="notice notice-success">&#10003; Your profile looks complete — but you can update it at any time before the event.</div>{{/if}}

<div class="cta"><a href="{{profileUrl}}">Review &amp; update my speaker profile &rarr;</a></div>

Your profile can be updated at any time up until the event.

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Presentation upload request
  // Sent to all speakers when a proposal is accepted.
  // Variables: eventName, firstName, proposalTitle, uploadUrl, deadline
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "presentation_upload_request",
    subjectTemplate: `{{#if isReminder}}{{#if lte daysUntilDeadline "1"}}Final call: upload your presentation today — {{eventName}}{{else}}{{#if lte daysUntilDeadline "3"}}Urgent: upload your presentation — {{eventName}}{{else}}Reminder: upload your presentation — {{eventName}}{{/if}}{{/if}}{{else}}Please upload your presentation — {{eventName}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

{{#if isReminder}}
<div class="notice notice-warning">This is reminder #{{reminderCount}} that we still need your slides for <strong>{{proposalTitle}}</strong>.{{#if daysUntilDeadline}} {{#if lte daysUntilDeadline "3"}}Only {{daysUntilDeadline}} day(s) left.{{/if}}{{/if}}</div>
{{/if}}

We are looking forward to your session **{{proposalTitle}}** at **{{eventName}}**!

Please upload your presentation slides by the deadline below so our team can prepare the AV setup and programme materials.

{{#if deadline}}<div class="notice notice-warning">&#128197; <strong>Upload deadline: {{deadline}}</strong></div>{{/if}}

**Accepted formats:** PDF, PPTX, PPT, PPTM, ODP (max 200 MB)

<div class="cta"><a href="{{uploadUrl}}">Upload my presentation &rarr;</a></div>

You can replace your file at any time before the deadline.

If you have any questions, please [contact us](mailto:contact@pkic.org).

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 14. Presentation upload reminder
  // Sent to speakers who have not yet uploaded their presentation.
  // Variables: eventName, firstName, proposalTitle, uploadUrl, deadline, daysRemaining
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "presentation_upload_reminder",
    subjectTemplate: "Reminder: upload your presentation — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

This is a friendly reminder that we have not yet received your presentation slides for **{{proposalTitle}}** at **{{eventName}}**.

{{#if daysRemaining}}<div class="notice notice-warning">&#9201; <strong>{{daysRemaining}} {{#if eq daysRemaining "1"}}day{{else}}days{{/if}} remaining</strong> — deadline: {{deadline}}</div>{{else}}{{#if deadline}}<div class="notice notice-danger">&#128680; <strong>Deadline: {{deadline}}</strong> — please upload as soon as possible.</div>{{/if}}{{/if}}

**Accepted formats:** PDF, PPTX, PPT, PPTM, ODP (max 200 MB)

<div class="cta"><a href="{{uploadUrl}}">Upload my presentation &rarr;</a></div>

If you have any issues uploading or need to request an extension, please [contact us](mailto:contact@pkic.org).
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Admin magic link
  // Variables: email, magicLinkUrl, expiresInMinutes
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "admin_magic_link",
    subjectTemplate: "Your PKI Consortium admin sign-in link",
    content: `A sign-in link was requested for the **PKI Consortium** administration panel.

<div class="cta-navy"><a href="{{magicLinkUrl}}">Sign in to admin panel &rarr;</a></div>

<div class="notice notice-warning">&#9888;&#65039; <strong>Security notice</strong><br>&bull; This link is valid for <strong>{{expiresInMinutes}} minutes</strong> only.<br>&bull; It can only be used <strong>once</strong> and is tied to <code>{{email}}</code>.<br>&bull; If you did not request this link, ignore this email immediately.</div>

If the button above does not work, copy and paste the following URL into your browser:

\`{{magicLinkUrl}}\`
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 15. Donation thank-you
  // Sent when the Stripe webhook confirms a completed donation.
  // Variables: firstName, name, email, organizationName,
  //            currency, formattedAmount, donateUrl, shareUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "donation_thank_you",
    subjectTemplate: "You just helped secure the internet — thank you, {{firstName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear supporter,{{/if}}

Your **{{formattedAmount}}** donation just landed — and it means more than you might think.

Every dollar we raise lets us keep our conferences **free and open** to security engineers, researchers, policymakers, and open-source contributors who otherwise couldn't attend. You didn't just write a cheque — you opened a door for someone in the global PKI community.

**That makes you one of us.** Welcome to a small but growing group of people who are actively shaping the future of digital trust.

---

### Your donation details

> **Name:** {{name}}
> {{#if organizationName}}**Organisation:** {{organizationName}}
> {{/if}}**Amount:** {{formattedAmount}}

<div class="notice notice-success">&#10003; Payment confirmed. A receipt from our payment processor will be sent separately to <strong>{{email}}</strong>.</div>

---

### Want to go further? Become our top fundraiser.

We've created a **personal fundraising page just for you** — with your name and badge attached. When someone donates through your link, it counts toward your total.

<div class="cta"><a href="{{shareUrl}}">Share your fundraising page &rarr;</a></div>

Even a single share to your network could match — or multiply — what you donated today. Who in your network cares about open security standards? Send them your link.

We track every contribution that comes through your page, and our top fundraisers get a shout-out in our community newsletter.

---

*PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States. This payment is voluntary and is not a ticket, fee, or payment for goods or services. Please consult your tax advisor regarding any possible business-expense treatment or other tax consequences.*

Questions? [contact us](mailto:contact@pkic.org).

With gratitude,<br>
The PKI Consortium team
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 16. Donation expired — checkout session timed out before payment
  // Sent when Stripe fires checkout.session.expired for a known donor.
  // Variables: firstName, name, formattedAmount, currency
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "donation_expired",
    subjectTemplate: "Your donation checkout expired — PKI Consortium",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Donor,{{/if}}

It looks like your checkout for a **{{formattedAmount}}** donation to the **PKI Consortium** was not completed — this can happen if you closed the page, navigated away, or the session expired.

**No charge was made to your account.**

If you still wish to support us, you can start a new checkout at any time:

<div class="cta"><a href="https://pkic.org/donate/">Retry my donation &rarr;</a></div>

Of course, there is absolutely no obligation — but if you change your mind, we would truly appreciate your support.

PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States.

If you have any questions, please [contact us](mailto:contact@pkic.org).

The PKI Consortium team
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 17. Donation payment failed — async payment bounced after checkout
  // Sent when Stripe fires checkout.session.async_payment_failed.
  // Variables: firstName, name, formattedAmount, currency
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "donation_payment_failed",
    subjectTemplate: "Your donation payment failed — PKI Consortium",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Donor,{{/if}}

We wanted to let you know that the payment for your **{{formattedAmount}}** donation to the **PKI Consortium** unfortunately did not go through.

This can happen with bank transfers, direct debits, or other delayed payment methods if the payment was declined or returned by your bank.

**No funds have been taken from your account.**

If you would still like to support the PKI Consortium, you are very welcome to try again:

<div class="cta"><a href="https://pkic.org/donate/">Try donating again &rarr;</a></div>

Of course, there is absolutely no obligation — but if you change your mind, we would truly appreciate your support.

PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States.

If you have any questions or believe this is an error, please [contact us](mailto:contact@pkic.org).

The PKI Consortium team
`,
  },
];
function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function toSqlNullableText(value) {
  if (value === null || value === undefined || String(value).trim().length === 0) {
    return "NULL";
  }
  return sqlString(value);
}

function parseArgs(argv) {
  const parsed = {
    mode: "local",
    database: process.env.D1_DATABASE_NAME ?? "pkic-db",
    wranglerEnv: null,
    configPath: DEFAULT_CONFIG_PATH,
    bucket: DEFAULT_BUCKET,
    adminEmail: DEFAULT_ADMIN_EMAIL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--remote") {
      parsed.mode = "remote";
      continue;
    }
    if (arg === "--local") {
      parsed.mode = "local";
      continue;
    }

    if (arg === "--db" && next) {
      parsed.database = next;
      index += 1;
      continue;
    }

    if (arg === "--env" && next) {
      parsed.wranglerEnv = next;
      index += 1;
      continue;
    }

    if ((arg === "--config" || arg === "--file") && next) {
      parsed.configPath = path.isAbsolute(next) ? next : path.join(process.cwd(), next);
      index += 1;
      continue;
    }

    if (arg === "--bucket" && next) {
      parsed.bucket = next;
      index += 1;
      continue;
    }

    if (arg === "--admin-email" && next) {
      parsed.adminEmail = next;
      index += 1;
      continue;
    }

  }

  return parsed;
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return YAML.parse(raw) ?? {};
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runWrangler(args, options = {}) {
  const stdio = options.captureOutput
    ? "pipe"
    : options.input !== undefined
      ? ["pipe", "inherit", "inherit"]
      : "inherit";

  return execFileSync("npx", args, {
    cwd: process.cwd(),
    stdio,
    encoding: options.captureOutput ? "utf8" : undefined,
    input: options.input,
  });
}

function seedConfig(config, cli) {
  const configured = Array.isArray(config?.emailTemplates?.templates)
    ? config.emailTemplates.templates
    : [];

  const merged = new Map();
  for (const item of DEFAULT_TEMPLATES) {
    merged.set(item.key, item);
  }

  for (const item of configured) {
    if (!item?.key || !item?.content) {
      continue;
    }
    merged.set(item.key, {
      key: item.key,
      content: item.content,
      subjectTemplate: item.subjectTemplate ?? null,
    });
  }

  return {
    templates: Array.from(merged.values()),
  };
}

function ensureAdminExists(cli) {
  const queryArgs = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    ...(cli.wranglerEnv ? ["--env", cli.wranglerEnv] : []),
    cli.mode === "remote" ? "--remote" : "--local",
    "--command",
    `SELECT id FROM users WHERE normalized_email = ${sqlString(cli.adminEmail.trim().toLowerCase())} LIMIT 1;`,
    "--json",
  ];

  const output = runWrangler(queryArgs, { captureOutput: true });
  const parsed = JSON.parse(output);
  const resultRows = parsed?.[0]?.results ?? [];
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    throw new Error(
      `Admin user '${cli.adminEmail}' not found. Run seed admin first (npm run seed:admin:${cli.mode}).`,
    );
  }
}

function putR2Object(cli, bucket, key, content, contentType) {
  const args = [
    "wrangler",
    "r2",
    "object",
    "put",
    `${bucket}/${key}`,
    ...(cli.wranglerEnv ? ["--env", cli.wranglerEnv] : []),
    cli.mode === "remote" ? "--remote" : "--local",
    "--content-type",
    contentType,
    "--pipe",
  ];

  runWrangler(args, { input: content });
}

function buildTemplateSqlStatements(cli, templates) {
  const statements = [];
  const normalizedAdminEmail = cli.adminEmail.trim().toLowerCase();

  for (const template of templates) {
    statements.push(`
UPDATE email_template_versions
SET status = 'archived'
WHERE template_key = ${sqlString(template.key)} AND status = 'active';

INSERT INTO email_template_versions (
  id, template_key, version, subject_template, body, content_type, r2_object_key,
  checksum_sha256, status, created_by_user_id, created_at
)
SELECT
  ${sqlString(randomUUID())},
  ${sqlString(template.key)},
  COALESCE((SELECT MAX(version) FROM email_template_versions WHERE template_key = ${sqlString(template.key)}), 0) + 1,
  ${toSqlNullableText(template.subjectTemplate)},
  ${sqlString(template.content)},
  ${sqlString(template.contentType ?? 'markdown')},
  NULL,
  ${sqlString(sha256Hex(template.content))},
  'active',
  (SELECT id FROM users WHERE normalized_email = ${sqlString(normalizedAdminEmail)} LIMIT 1),
  datetime('now');
`);
  }

  return statements.join("\n");
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = loadConfig(cli.configPath);
  const seed = seedConfig(config, cli);

  ensureAdminExists(cli);

  const sql = buildTemplateSqlStatements(cli, seed.templates);
  const executeArgs = [
    "wrangler",
    "d1",
    "execute",
    cli.database,
    ...(cli.wranglerEnv ? ["--env", cli.wranglerEnv] : []),
    cli.mode === "remote" ? "--remote" : "--local",
    "--command",
    sql,
  ];

  runWrangler(executeArgs);
  console.log(`Seeded ${seed.templates.length} email templates in ${cli.mode} mode.`);
}

main();
