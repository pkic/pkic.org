import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { buildWranglerD1ExecuteArgs, parseSeedCliArgs } from "./lib/seed-cli.mjs";
import { sqlString } from "./lib/sql.mjs";
import { buildTemplateSqlStatements } from "./lib/email-template-seed-sql.mjs";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "scripts", "seed-event.yaml");
const DEFAULT_BUCKET = process.env.ASSETS_BUCKET_NAME ?? "pkic-assets";
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@pkic.org";
export const DEFAULT_LAYOUT_HTML = `<!doctype html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="format-detection" content="telephone=no,address=no,email=no,date=no,url=no">
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
  <style>
    :root{color-scheme:light only;supported-color-schemes:light}
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
    .eb code{font-family:'Courier New',Courier,monospace;font-size:13px;background:#f1f5f9;padding:2px 7px;border-radius:4px;color:#0d1b2a;border:1px solid #e5e9ef;overflow-wrap:anywhere;word-break:break-word}
    .eb pre{background:#f8fafc;border:1px solid #e5e9ef;border-radius:6px;padding:16px;font-size:13px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;margin:0 0 16px}
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
              <a href="{{brandBaseUrl}}" target="_blank" style="text-decoration:none;display:inline-block;line-height:1;">
                <img src="{{brandBaseUrl}}/img/logo-white.png" width="160" alt="PKI Consortium" style="display:block;width:160px;max-width:160px;height:auto;border:0;">
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
                      <a href="{{brandBaseUrl}}" target="_blank" style="color:#4ade80;text-decoration:none;font-weight:600;">pkic.org</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="{{brandBaseUrl}}/privacy/" target="_blank" style="color:#6b7280;text-decoration:none;">Privacy Policy</a>
                      <span style="color:#374151;">&nbsp;&nbsp;&middot;&nbsp;&nbsp;</span>
                      <a href="{{brandBaseUrl}}/join/" target="_blank" style="color:#6b7280;text-decoration:none;">Become a Member</a>
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

// NOTE: shared email partials are seeded here and managed through the portal.
// Keep these in sync with the editor labels and the partial loader.
export const DEFAULT_TEMPLATES = [
  {
    key: "email_layout",
    subjectTemplate: null,
    contentType: "html",
    content: DEFAULT_LAYOUT_HTML,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared PKI Consortium description
  // Variables: brandBaseUrl
  // Partials:  {{> about_pkic}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_about_pkic",
    subjectTemplate: null,
    contentType: "markdown",
    content: `**About the PKI Consortium**

The PKI Consortium is a vendor-neutral community of PKI practitioners dedicated to advancing trust, security, and interoperability in digital infrastructure. [Learn more &rarr;]({{brandBaseUrl}}/about/)
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared registration details
  // Variables: registration and custom-answer fields
  // Partials:  {{> reg_details}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_reg_details",
    subjectTemplate: null,
    contentType: "markdown",
    content: `## Your registration details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}<br>
> {{/if}}{{#if email}}**Email:** {{email}}<br>
> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}<br>
> {{/if}}{{#if jobTitle}}**Title / Role:** {{jobTitle}}<br>
> {{/if}}{{#each dayAttendance}}**{{dayLabel}}:** {{attendanceLabel}} — {{statusLabel}}<br>
> {{/each}}{{#if attendanceLabel}}**Attendance:** {{attendanceLabel}}<br>
> {{/if}}{{#each customAnswerRows}}**{{label}}:** {{displayValue}}<br>
> {{/each}}{{#if acceptedTermsText}}**Terms agreed:**<br>
> - {{acceptedTermsText}}{{/if}}
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared, event-derived sponsors block
  // Variables: eventUrl, sponsorsImageUrl
  // Partials:  {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_sponsors_block",
    subjectTemplate: null,
    contentType: "html",
    content: `{{#if sponsorsImageUrl}}
<table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid #e5e9ef;margin:28px 0 0;">
  <tr>
    <td align="center" style="padding:24px 0 8px;">
      <p style="margin:0 0 16px;font-family:'Segoe UI','Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">Event sponsors</p>
      <a href="{{eventUrl}}" target="_blank" style="display:block;text-decoration:none;">
        <img src="{{sponsorsImageUrl}}" alt="Event sponsors" width="504" style="display:block;max-width:100%;height:auto;border:0;">
      </a>
    </td>
  </tr>
</table>
{{/if}}
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared donation request block
  // Variables: brandBaseUrl
  // Partials:  {{> donation_request}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_donation_request",
    subjectTemplate: null,
    contentType: "markdown",
    content: `---

**Help to keep the PKI Consortium Membership, Conferences, and Resources free**

If what we do is valuable to you or your organization, please consider a voluntary contribution — any amount helps us keep membership, conferences, and resources open to the widest possible audience.

<div class="cta-secondary"><a href="{{brandBaseUrl}}/donate/">Support the PKI Consortium &rarr;</a></div>

<div class="notice notice-info">Contributions to the PKI Consortium are <strong>entirely voluntary</strong> and are not a ticket, fee, or payment for goods or services. The PKI Consortium is a <strong>501(c)(6) nonprofit business league</strong> — donations are <strong>not deductible as charitable contributions</strong> for U.S. federal income tax purposes. Consult your tax advisor regarding any applicable treatment in your jurisdiction.<br><br>Does your organization want to make a bigger impact? Sponsors directly fund free, open events for the global PKI and security community — <a href="{{brandBaseUrl}}/sponsors/">explore sponsorship opportunities at pkic.org/sponsors/</a>.</div>
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

Thank you for starting your registration for **{{eventName}}**.

<div class="notice notice-warning"><strong>You are not registered yet.</strong> Please confirm this email address to continue your registration. After you confirm, you will receive a final confirmation email. That final email may still show that you are on the waitlist for one or more days.</div>

This registration was submitted with the email address **{{email}}**.

<div class="cta"><a href="{{confirmationUrl}}">Confirm my registration &rarr;</a></div>

<div class="notice notice-warning">&#9201; This link expires in <strong>24 hours</strong>. If you did not request this registration, <a href="{{manageUrl}}">click here to cancel it and remove your data</a>.</div>

---

{{> reg_details}}

Use your [registration management link]({{manageUrl}}) to review, update your email address, or cancel this registration at any time.

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
    subjectTemplate: `{{#if adminAdmitNotice}}In-person registration accepted — {{eventName}}{{else}}{{#if waitlistOfferNotice}}Waitlist availability update — {{eventName}}{{else}}{{#if eq status "waitlisted"}}Waitlisted registration updated — {{eventName}}{{else}}Registration updated — {{eventName}}{{/if}}{{/if}}{{/if}}`,
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

This email confirms that your registration for **{{eventName}}** has been successfully updated.

{{#if adminAdmitNotice}}
<div class="notice notice-success"><strong>Accepted for in-person attendance:</strong> you have been admitted from the waitlist for the in-person day(s) shown as confirmed below.</div>
{{/if}}
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
  // 3b. Waitlist offer
  // Variables: eventName, firstName, manageUrl, dayAttendance, dayWaitlist,
  //            waitlistedDayCount
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_waitlist_offer",
    subjectTemplate: "In-person spot available — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

An in-person spot is now available for **{{eventName}}**.

<div class="notice notice-info"><strong>Please review your registration within 24 hours.</strong> Open your management link, keep the offered day selected as in-person, and save your registration to claim the available spot.</div>

<div class="cta"><a href="{{manageUrl}}">Review and claim my spot &rarr;</a></div>

If you no longer want to attend in person, you can update that day to virtual attendance or cancel your registration from the same page. This helps us offer the spot to the next person on the waitlist.

---

## Current registration details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}  
> {{/if}}{{#if email}}**Email:** {{email}}  
> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}  
> {{/if}}{{#if jobTitle}}**Title / Role:** {{jobTitle}}  
> {{/if}}{{#each dayAttendance}}**{{dayLabel}}:** {{attendanceLabel}} — {{statusLabel}}  
> {{/each}}{{#if attendanceLabel}}**Attendance:** {{attendanceLabel}}  
> {{/if}}

{{#if waitlistedDayCount}}
Some selected in-person days may still be waitlisted. The management page shows the latest status for each day.
{{/if}}
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
  // 10. Management link resend
  // Sent when a registrant requests a fresh management link.
  // Variables: eventName, firstName, manageUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_manage_link",
    subjectTemplate: "Your management link for {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

Here is your management link for **{{eventName}}**. Use it to review, update, or cancel your registration at any time.

<div class="cta"><a href="{{manageUrl}}">Manage your registration &rarr;</a></div>

If you did not request this email, you can safely ignore it.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Confirmation reminder (for unconfirmed registrations)
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
  // 12. RSVP warning / follow-up
  // Variables: firstName, event_name, event_day, manage_url
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "rsvp_warning",
    subjectTemplate: "Action required: Your in-person attendance for {{event_name}} on {{event_day}} is at risk",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

We noticed that the calendar invitation for **{{event_name}} on {{event_day}}** was recently declined or removed from your calendar.

As a nonprofit, the PKI Consortium covers significant costs for catering and venue space ($150–$300 per attendee, per day) to keep this event fully funded by sponsors and free for attendees. Because in-person capacity is strictly limited, it's incredibly important that we know exactly who will be attending.

If you are still planning to join us in person, please confirm your attendance using the link below as soon as possible. If we do not receive your re-confirmation, we will automatically update your registration to remote / virtual attendance to free up your seat for a community member on the waitlist.

<div class="cta"><a href="{{manage_url}}">Re-confirm my in-person attendance &rarr;</a></div>

If your plans have changed and you intended to decline, you do not need to do anything. We will update this event day only, and your other selected days will remain unchanged. Thank you for your understanding and cooperation!
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 13. RSVP day-attendance update notice
  // Variables: firstName, event_name, event_day, action_taken, new_attendance_type, manage_url
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "rsvp_downgraded",
    subjectTemplate: "Update: Your attendance for {{event_name}} on {{event_day}} has been changed",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

Following up on our previous email regarding your declined calendar invitation, your attendance for **{{event_name}} on {{event_day}}** has now been automatically updated.

Because we did not receive an in-person confirmation, we have released your seat to another community member on the waitlist.

{{#if eq new_attendance_type "not_attending"}}
<div class="notice notice-warning"><strong>You are no longer registered to attend this event day.</strong> Your registration and selections for any other event days remain unchanged.</div>
{{else}}
<div class="notice notice-info"><strong>Your attendance type for this event day has been updated to {{new_attendance_type}}.</strong> Your registration and other event-day selections remain unchanged.</div>
{{/if}}

If this was done in error and you still wish to attend in person, please use your [registration management link]({{manage_url}}) to review and update your registration, subject to remaining availability.
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
<div class="notice notice-warning">A quick follow-up on your speaker invitation for <strong>{{eventName}}</strong>.{{#if daysUntilExpiry}}{{#if lte daysUntilExpiry "2"}} This opportunity closes in {{daysUntilExpiry}} day(s).{{else}} We'd be excited to feature your perspective in this program.{{/if}}{{/if}}</div>
{{/if}}

{{#if inviterName}}You have been personally nominated by **{{inviterName}}** to speak at **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).{{else}}We would be honoured to have you present at **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).{{/if}}

We believe your expertise would be a valuable contribution to the program. We invite you to submit a proposal for a session, workshop, or roundtable.

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
  {
    key: "msg_attendee_inperson_check_plans",
    subjectTemplate: "Cannot attend {{eventName}} in person? Pass your seat to someone on the waitlist.",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

{{eventName}} is currently full, and people on the waitlist are hoping to attend. **If your plans have changed and you can no longer join us in person, please update your registration as soon as possible.** Switching to virtual or on-demand attendance frees your seat for someone waiting.

<div class="notice notice-info">Every unused seat is both an unnecessary event expense and a missed opportunity for someone on the waitlist.</div>

<div class="cta"><a href="{{manageUrl}}">Manage your registration &rarr;</a></div>

{{> reg_details}}

Thank you for helping us make room for everyone waiting for a spot.

{{> sponsors_block}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Proposal submitted
  // Variables: eventName, firstName, lastName, proposalTitle, proposalAbstract,
  //            proposalType, speakerLineupText, manageUrl, shareUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "proposal_submitted",
    subjectTemplate: "Proposal received: {{proposalTitle}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Proposer,{{/if}}

Thank you for submitting your proposal to **{{eventName}}**. We have successfully received it and our program committee will begin reviewing submissions shortly.

---

## Your submission

> **Title:** {{proposalTitle}}  
> **Type:** {{proposalType}}  
> **Event:** {{eventName}}

{{#if proposalAbstract}}
### Abstract

{{proposalAbstract}}
{{/if}}

{{#if speakerLineupText}}
### Speaker(s)

{{speakerLineupText}}
{{/if}}

---

## What happens next?

1. **Review** — Our program committee will evaluate all submissions.
2. **Decision** — You will receive an email with the outcome once a decision has been made.
3. **Preparation** *(if accepted)* — We will be in touch with scheduling and logistical details.

Please review the details above carefully. If anything looks incorrect, use your management link to make changes before the review process begins.

[Manage my proposal &rarr;]({{manageUrl}})

Encourage colleagues to attend by sharing your referral link: [{{shareUrl}}]({{shareUrl}})

Thank you for contributing to **{{eventName}}** and the broader PKI community!

{{> donation_request}}
`,
  },
  {
    key: "proposal_manage_link_transferred",
    subjectTemplate: "You now manage proposal: {{proposalTitle}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Hello,{{/if}}

You are now responsible for managing **{{proposalTitle}}** for **{{eventName}}**.

[Manage the proposal &rarr;]({{manageUrl}})

This link replaces the previous proposer's management link. Keep it private.
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
<div class="notice notice-success">&#127881; <strong>Congratulations — your proposal has been accepted!</strong><br>We are pleased to include <strong>{{proposalTitle}}</strong> in the program for {{eventName}}. Our team will be in touch with scheduling, AV requirements, and speaker logistics.</div>
{{/if}}
{{#if eq finalStatus "rejected"}}
<div class="notice notice-danger">Thank you for your submission. After careful consideration, we regret to inform you that <strong>{{proposalTitle}}</strong> was not selected for this event's program.<br>We truly appreciate the time and effort you invested, and we hope you will consider submitting again for a future event.</div>
{{/if}}
{{#if eq finalStatus "waitlisted"}}
<div class="notice notice-warning">&#9203; Your proposal <strong>{{proposalTitle}}</strong> has been placed on the <strong>waitlist</strong>. We may still be able to include it if a slot becomes available, and will keep you informed.</div>
{{/if}}

{{#if decisionNote}}

**Note from the program committee:**

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

Please upload your presentation slides by the deadline below so our team can prepare the AV setup and program materials.

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
  // 8. User magic link
  // Variables: email, magicLinkUrl, expiresInMinutes
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "user_magic_link",
    subjectTemplate: "Your PKI Consortium sign-in link",
    content: `A sign-in link was requested for the **PKI Consortium portal**.

<div class="cta-navy"><a href="{{magicLinkUrl}}">Sign in to the portal &rarr;</a></div>

<div class="notice notice-warning">&#9888;&#65039; <strong>Security notice</strong><br>&bull; This link is valid for <strong>{{expiresInMinutes}} minutes</strong> only.<br>&bull; It can only be used <strong>once</strong> and is tied to <code>{{email}}</code>.<br>&bull; If you did not request this link, ignore this email immediately.</div>

If the button above does not work, copy and paste the following URL into your browser:

<p style="margin:0;overflow-wrap:anywhere;word-break:break-all;"><a href="{{magicLinkUrl}}" style="color:#198754;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">{{magicLinkUrl}}</a></p>
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
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

Your **{{formattedAmount}}** donation just landed — and it means more than you might think.

Every dollar we raise lets us keep our conferences **free and open** to security engineers, researchers, policymakers, and open-source contributors who otherwise couldn't attend. You didn't just write a cheque — you opened a door for someone in the global PKI community.

**That makes you one of us.** Welcome to a small but growing group of people who are actively shaping the future of digital trust.

---

### Your donation details

> **Name:** {{name}}
> {{#if organizationName}}**Organization:** {{organizationName}}
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
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

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
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

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
// A normal seed only establishes the baseline catalog. Use --replace
// deliberately when an existing active version must be archived and replaced.
function parseArgs(argv) {
  return parseSeedCliArgs(
    argv,
    {
      configPath: DEFAULT_CONFIG_PATH,
      bucket: DEFAULT_BUCKET,
      adminEmail: DEFAULT_ADMIN_EMAIL,
      onlyTemplates: [],
      ifMissing: true,
    },
    ({ arg, next, parsed }) => {
      if ((arg === "--only-template" || arg === "--template") && next) {
        parsed.onlyTemplates.push(
          ...next
            .split(",")
            .map((value) => value.trim())
            .filter(Boolean),
        );
        return 1;
      }
      if (arg === "--if-missing") {
        parsed.ifMissing = true;
      }
      if (arg === "--replace") {
        parsed.ifMissing = false;
      }
      return 0;
    },
  );
}

function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    return {};
  }

  const raw = fs.readFileSync(configPath, "utf8");
  return YAML.parse(raw) ?? {};
}

function runWrangler(args, options = {}) {
  const stdio = options.captureOutput
    ? "pipe"
    : options.input !== undefined
      ? ["pipe", "inherit", "inherit"]
      : "inherit";

  return execFileSync("pnpm", ["exec", ...args], {
    cwd: process.cwd(),
    stdio,
    encoding: options.captureOutput ? "utf8" : undefined,
    input: options.input,
  });
}

function parseWranglerJsonOutput(output) {
  const text = String(output ?? "").trim();
  if (!text) {
    throw new Error("Wrangler returned empty output when JSON was expected.");
  }

  try {
    return JSON.parse(text);
  } catch {
    // Wrangler may print informational text before the JSON payload.
  }

  const lines = text.split(/\r?\n/);
  const jsonStartLine = lines.findIndex((line) => {
    const trimmed = line.trimStart();
    return trimmed.startsWith("[") || trimmed.startsWith("{");
  });

  if (jsonStartLine >= 0) {
    const candidate = lines.slice(jsonStartLine).join("\n").trim();
    try {
      return JSON.parse(candidate);
    } catch {
      // Fall through to a richer error below.
    }
  }

  throw new Error(`Unable to parse Wrangler JSON output. First output lines:\n${lines.slice(0, 6).join("\n")}`);
}

function seedConfig(config, cli) {
  const configured = Array.isArray(config?.emailTemplates?.templates) ? config.emailTemplates.templates : [];

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

  const templates = Array.from(merged.values());

  if (cli.onlyTemplates.length === 0) {
    return { templates };
  }

  const requestedKeys = new Set(cli.onlyTemplates);
  const filteredTemplates = templates.filter((template) => requestedKeys.has(template.key));
  const missingKeys = cli.onlyTemplates.filter((key) => !merged.has(key));

  if (missingKeys.length > 0) {
    throw new Error(`Unknown template key(s): ${missingKeys.join(", ")}`);
  }

  return {
    templates: filteredTemplates,
  };
}

function ensureAdminExists(cli) {
  const queryArgs = [
    ...buildWranglerD1ExecuteArgs(cli),
    "--command",
    `SELECT id FROM users WHERE normalized_email = ${sqlString(cli.adminEmail.trim().toLowerCase())} LIMIT 1;`,
    "--json",
  ];

  const output = runWrangler(queryArgs, { captureOutput: true });
  const parsed = parseWranglerJsonOutput(output);
  const resultRows = parsed?.[0]?.results ?? [];
  if (!Array.isArray(resultRows) || resultRows.length === 0) {
    throw new Error(
      `Admin user '${cli.adminEmail}' not found. Run seed admin first (pnpm run seed:admin:${cli.mode}).`,
    );
  }
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = loadConfig(cli.configPath);
  const seed = seedConfig(config, cli);

  if (seed.templates.length === 0) {
    throw new Error("No email templates selected for seeding.");
  }

  ensureAdminExists(cli);

  const sql = buildTemplateSqlStatements(cli, seed.templates);
  const executeArgs = [...buildWranglerD1ExecuteArgs(cli), "--command", sql];

  runWrangler(executeArgs);
  console.log(
    `Seeded ${seed.templates.length} email template(s) in ${cli.mode} mode${cli.ifMissing ? " (missing only)" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
