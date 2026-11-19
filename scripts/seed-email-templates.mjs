import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import { buildWranglerD1ExecuteArgs, parseSeedCliArgs } from "./lib/seed-cli.mjs";
import { sqlString } from "./lib/sql.mjs";
import { buildTemplateSqlStatements } from "./lib/email-template-seed-sql.mjs";
import { DEFAULT_EVENT_MESSAGE_TEMPLATES } from "./lib/event-message-default-templates.mjs";
import { DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES } from "./lib/transactional-email-default-templates.mjs";

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
    .pk-email-box>:first-child{margin-top:0!important}
    .pk-email-box>:last-child{margin-bottom:0!important}
    @media only screen and (max-width:680px){
      .pk-email-col{display:block!important;width:100%!important;box-sizing:border-box!important;margin:0 0 16px!important}
      .pk-email-gap,.pk-email-empty{display:none!important}
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
  ...DEFAULT_EVENT_MESSAGE_TEMPLATES,
  ...DEFAULT_TRANSACTIONAL_EMAIL_TEMPLATES,
  {
    key: "agenda_changed",
    subjectTemplate: "Your schedule changed — {{eventName}}",
    content:
      "Hello,\n\nThe schedule for **{{eventName}}** has changed, and a session in your agenda is affected.\n\nCheck your agenda in the PKI Consortium portal before you go. Your registration hasn't changed.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "agenda_session_reminder",
    subjectTemplate: "Starting soon: {{sessionTitle}}",
    content:
      "Hello,\n\nYour session **{{sessionTitle}}** at **{{eventName}}** starts at {{sessionStart}}.\n\nLocation: **{{sessionLocation}}**\n\nCheck your agenda in the PKI Consortium portal for any last-minute changes.",
    contentType: "markdown",
    messageType: "transactional",
  },
  {
    key: "email_layout",
    subjectTemplate: null,
    contentType: "html",
    content: DEFAULT_LAYOUT_HTML,
  },
  {
    key: "sponsorship-new-inquiry",
    subjectTemplate: "New sponsorship inquiry",
    contentType: "markdown",
    content: `A new sponsorship inquiry is ready for follow-up.

- Contact: {{contactNameText}} ({{contactEmailText}})
- Organization: {{organizationNameText}}
- Sponsor type: {{sponsorTypeText}}
- Tier: {{tierText}}
{{#if notesText}}- Notes: {{notesText}}
{{/if}}
[View sponsorship]({{managementUrl}})`,
  },
  {
    key: "org-content-review-digest",
    subjectTemplate: "Pending organization content reviews",
    contentType: "markdown",
    content: `## Organization content reviews

{{pendingCount}} organization {{#if eq pendingCount "1"}}profile is{{else}}profiles are{{/if}} awaiting review in the shared queue.

{{#each reviews}}- {{organizationName}}
{{/each}}
{{#if hasMore}}This email lists the first 50 organizations. Open the queue to see every pending review.
{{/if}}
[Review pending organization profiles]({{reviewUrl}})

The queue shows the latest changes and review status.`,
  },
  {
    key: "membership-participation-warning",
    subjectTemplate: "Action required: {{organizationNameText}}'s PKI Consortium membership",
    contentType: "markdown",
    content: `{{#if contactNameText}}Dear {{contactNameText}},{{else}}Hello,{{/if}}

**{{organizationNameText}}'s PKI Consortium membership is at risk of cancellation.**

{{#if noCurrentRepresentatives}}We do not have a current representative recorded for your organization.{{else}}We have not recorded recent meeting participation from a representative of your organization.{{/if}}

Please reply to this email with the name and work email address of someone who can represent your organization and participate in meetings. If your current representative has left, please let us know who should take their place.

{{#if responseDeadlineText}}Please reply by **{{responseDeadlineText}}**.

{{/if}}If we do not hear from you{{#if responseDeadlineText}} by that date{{/if}}, we will cancel your organization's membership.

If our records are incomplete, please tell us who has been participating so we can review them before taking action.

Thank you for helping us keep your organization's membership active.

The PKI Consortium team`,
  },
  // Membership consultation and Executive Council review digests.
  {
    key: "membership-workflow-review-digest",
    subjectTemplate: "{{stepLabel}}: membership applications \u2014 {{reviewDate}} UTC",
    contentType: "markdown",
    content: `Dear {{#if isMemberConsultation}}Members{{else}}{{#if isExecutiveCouncil}}Executive Council{{else}}Reviewers{{/if}}{{/if}},

We have received the following membership applications:

{{applicationSummary}}

Applications must be approved by the Executive Council after feedback from the Members. Feedback and approval on a membership application by each Member and the Executive Council shall be based solely on a determination of whether the applicant meets the stated membership criteria, and not on any other basis including competitive considerations.

We would also like to remind you that welcoming new members must not be done with commercial objectives. Outreach should focus on collaboration and community, not on selling products or services.

Please only respond to this email if you have any questions or concerns regarding these membership applications. You can also record questions and objections on each application's review page.

{{#if deliveryWindowClosesOn}}{{#if isMemberConsultation}}The feedback period{{else}}The review period{{/if}} will close on {{deliveryWindowClosesOn}} (UTC){{#if isMemberConsultation}}, at which point we will forward eligible applications to the Executive Council for final approval{{/if}}.{{else}}The feedback and review period will close {{durationDays}} days after this email is sent.{{/if}} Each review page shows the exact deadline and current requirements.

{{instructions}}

Below you will find the complete application details:

{{applicationDetails}}

Best regards,

PKI Consortium`,
  },
  // Weekly working group membership changes for the group's chairs.
  {
    key: "wg-chair-membership-digest",
    subjectTemplate: "{{workingGroupName}}: weekly membership update",
    contentType: "markdown",
    content: `Dear {{recipientName}},

Here are last week's membership changes in **{{workingGroupName}}**, which you lead as {{recipientRole}}.

{{#if hasJoined}}**Joined**

{{#each joined}}- {{name}}{{#if organizationName}} ({{organizationName}}){{/if}}
{{/each}}
{{/if}}{{#if hasLeft}}**Left**

{{#each left}}- {{name}}{{#if organizationName}} ({{organizationName}}){{/if}}
{{/each}}
{{/if}}
You can turn off this weekly update in your notification settings.

The PKI Consortium team`,
  },
  {
    key: "partial_membership_review_summary",
    subjectTemplate: null,
    contentType: "markdown",
    content: `[Membership application from {{applicationName}}]({{reviewUrl}})`,
  },
  {
    key: "partial_membership_review_details",
    subjectTemplate: null,
    contentType: "markdown",
    content: `### Membership application from {{applicationName}}

Category: ({{categoryCode}}) {{categoryLabel}}  
Applicant name: {{applicantName}}  
{{#if applicantEmail}}Email: {{applicantEmail}}  
{{/if}}{{#if organizationName}}Organization: {{organizationName}}  
{{/if}}{{#each answerRows}}{{label}}: {{value}}  
{{/each}}
{{#each objections}}> {{#if author}}**{{author}}:** {{/if}}{{body}}

{{/each}}[Read the application form and respond]({{reviewUrl}})`,
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

The PKI Consortium is a vendor-neutral community of PKI practitioners working to advance trust, security, and interoperability in digital infrastructure. [Learn more &rarr;]({{brandBaseUrl}}/about/)
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
> {{/if}}{{#if jobTitle}}**Job title:** {{jobTitle}}<br>
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

**Help keep PKI Consortium membership, conferences, and resources free**

If our work is valuable to you or your organization, please consider a voluntary contribution. Any amount helps keep membership, conferences, and resources open to everyone.

:::button variant=secondary
[Support the PKI Consortium →]({{brandBaseUrl}}/donate/)
:::

{{> donation_tax_notice}}

Want your organization to make a bigger impact? Sponsors fund free, open events for the global PKI and security community. [Explore sponsorship]({{brandBaseUrl}}/sponsors/).
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared greeting: by first name, or a plain hello
  // Variables: firstName
  // Partials:  {{> greeting}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_greeting",
    subjectTemplate: null,
    contentType: "markdown",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Hello,{{/if}}
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared donation tax notice
  // Variables: none
  // Partials:  {{> donation_tax_notice}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_donation_tax_notice",
    subjectTemplate: null,
    contentType: "markdown",
    content: `*The PKI Consortium is a section 501(c)(6) nonprofit business league. Contributions or gifts to the PKI Consortium are not deductible as charitable contributions for federal income tax purposes in the United States. Contributions are voluntary and are not a ticket, fee, or payment for goods or services. Please consult your tax advisor about any business-expense treatment or other tax consequences.*
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Shared notice for a single-use sign-in link
  // Variables: expiresInMinutes, email
  // Partials:  {{> link_safety_notice}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_link_safety_notice",
    subjectTemplate: null,
    contentType: "markdown",
    content: `<div class="notice notice-warning">&#9888;&#65039; <strong>Keep this link to yourself</strong><br>&bull; It works <strong>once</strong>, for <strong>{{expiresInMinutes}} minutes</strong>.<br>&bull; It only works for <code>{{email}}</code>.<br>&bull; Didn't ask for it? You can ignore this email.</div>
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // Confirming as a speaker is not acceptance of the proposal
  // Variables: none
  // Partials:  {{> speaker_confirmation_note}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_speaker_confirmation_note",
    subjectTemplate: null,
    contentType: "markdown",
    content: `Confirming as a speaker doesn't mean the proposal is accepted. The program committee decides that, and the schedule, separately.
`,
  },
  // ─────────────────────────────────────────────────────────────────────────
  // In-person waitlist notice that invites sponsorship
  // Variables: organizationName, contactEmail
  // Partials:  {{> budget_waitlist_notice}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "partial_budget_waitlist_notice",
    subjectTemplate: null,
    contentType: "markdown",
    content: `<div class="notice notice-warning">&#9203; In-person seats are limited by the event budget, and we can admit more attendees as sponsors commit. If {{#if organizationName}}<strong>{{organizationName}}</strong>{{else}}your organization{{/if}} would like to sponsor the event, please <a href="mailto:{{contactEmail}}">contact us</a>. We'll email you as soon as a seat opens up.</div>
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
    subjectTemplate: "Confirm your registration for {{eventName}}",
    content: `{{> greeting}}

Thanks for registering for **{{eventName}}**. One more step: confirm your email address, **{{email}}**, to complete your registration.

:::button
[Confirm my registration →]({{confirmationUrl}})
:::

<div class="notice notice-warning"><strong>You're not registered until you confirm.</strong> Open the link and select <strong>Confirm my registration</strong> on the page. The link expires in 24 hours.</div>

Once you confirm, we'll email your confirmation, with a calendar invitation and a personal link to change your registration at any time. It also shows any days you're on the waitlist for.

Didn't register? [Cancel this registration and remove your data]({{manageUrl}}).

---

{{> reg_details}}

{{#if shareUrl}}Know someone who should attend? Share your personal link: [{{shareUrl}}]({{shareUrl}}){{/if}}

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 2. Registration confirmed
  // Variables: eventName, eventUrl, firstName, lastName, email, organizationName,
  //            jobTitle, dayAttendance, venue, status, manageUrl, myAgendaUrl, shareUrl,
  //            sponsorsImageUrl, heroImageUrl, customAnswerRows, acceptedTermsText
  // Partials:  {{> reg_details}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_confirmed",
    subjectTemplate: `{{#if eq status "waitlisted"}}You're on the waitlist for {{eventName}}{{else}}Your registration is confirmed — {{eventName}}{{/if}}`,
    content: `{{> greeting}}

{{#if eq status "waitlisted"}}
<div class="notice notice-warning">We received your registration for <strong>{{eventName}}</strong>, and you're on the waitlist. {{#if dayAttendance}}The details below show which days are confirmed and which are waitlisted.{{else}}No seat is confirmed yet.{{/if}}</div>
{{else}}
You're registered for **{{eventName}}**. We look forward to seeing you!
{{/if}}

{{#if hasCalendarInvite}}
<div class="notice notice-success">A calendar invitation is attached for your confirmed live attendance days.</div>
{{/if}}

{{#if venue}}
<div class="notice notice-info">&#128205; The event takes place at <strong>{{venue}}</strong>. See the <a href="{{eventUrl}}">event website</a> for travel and hotel information.</div>
{{/if}}

{{#if eq status "waitlisted"}}
{{> budget_waitlist_notice}}
{{/if}}

---

{{> reg_details}}

[Manage your registration &rarr;]({{manageUrl}})

{{#if myAgendaUrl}}
Plan the sessions you want to attend in [My agenda &rarr;]({{myAgendaUrl}})
{{/if}}

{{#if shareUrl}}Know someone who should attend? Share your personal link, and the attached image, with your network:
[{{shareUrl}}]({{shareUrl}}){{/if}}

{{> sponsors_block}}

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3. Registration updated
  // Variables: eventName, firstName, lastName, email, organizationName,
  //            jobTitle, attendanceSummary, statusLabel, manageUrl, myAgendaUrl,
  //            customAnswerRows, acceptedTermsText
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_updated",
    subjectTemplate: `{{#if adminAdmitNotice}}Your in-person seat is confirmed — {{eventName}}{{else}}{{#if waitlistOfferNotice}}A seat is available — {{eventName}}{{else}}{{#if eq status "cancelled"}}Your registration is cancelled — {{eventName}}{{else}}Your registration was updated — {{eventName}}{{/if}}{{/if}}{{/if}}`,
    content: `{{> greeting}}

Your registration for **{{eventName}}** was updated.

{{#if adminAdmitNotice}}
<div class="notice notice-success"><strong>Good news:</strong> you have an in-person seat for the days marked confirmed below.</div>
{{/if}}
{{#if eq status "waitlisted"}}
<div class="notice notice-warning">You're on the waitlist, so your attendance isn't confirmed yet.</div>
{{/if}}
{{#if waitlistOfferNotice}}
<div class="notice notice-info"><strong>A seat is available.</strong> <a href="{{manageUrl}}">Open your registration</a> to claim it.</div>
{{/if}}

---

{{> reg_details}}

{{#if eq status "waitlisted"}}
{{> budget_waitlist_notice}}
{{/if}}
{{#if eq status "cancelled"}}
<div class="notice notice-danger">Your registration is <strong>cancelled</strong>. If this was a mistake, register again on the event page.</div>
{{/if}}

{{#if eq status "cancelled"}}{{else}}Something not right? [Review or change your registration]({{manageUrl}}).{{/if}}

{{#if eq status "cancelled"}}{{else}}
{{#if myAgendaUrl}}
Plan the sessions you want to attend in [My agenda &rarr;]({{myAgendaUrl}})
{{/if}}
{{/if}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 3b. Waitlist offer
  // Variables: eventName, firstName, manageUrl, dayAttendance, dayWaitlist,
  //            waitlistedDayCount
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_waitlist_offer",
    subjectTemplate: "An in-person seat is available — {{eventName}}",
    content: `{{> greeting}}

Good news: an in-person seat is now available for you at **{{eventName}}**.

<div class="notice notice-info"><strong>Claim it within 24 hours.</strong> Open your registration, keep the offered day set to in person, and save.</div>

:::button
[Claim my seat →]({{manageUrl}})
:::

No longer coming in person? Change that day to virtual attendance or cancel your registration on the same page, so we can offer the seat to the next person on the waitlist.

---

## Your registration details

> {{#if firstName}}**Name:** {{firstName}} {{lastName}}  
> {{/if}}{{#if email}}**Email:** {{email}}  
> {{/if}}{{#if organizationName}}**Organization:** {{organizationName}}  
> {{/if}}{{#if jobTitle}}**Job title:** {{jobTitle}}  
> {{/if}}{{#each dayAttendance}}**{{dayLabel}}:** {{attendanceLabel}} — {{statusLabel}}  
> {{/each}}{{#if attendanceLabel}}**Attendance:** {{attendanceLabel}}  
> {{/if}}

{{#if waitlistedDayCount}}
Some of your in-person days may still be on the waitlist. Your registration shows the latest status for each day.
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
    content: `{{> greeting}}

Thanks for letting us know that you didn't register for **{{eventName}}**.

<div class="notice notice-success">&#10003; We cancelled the registration and <strong>removed your personal data</strong> from our records.</div>

There's nothing more you need to do. If you get more email about this event that you didn't expect, please [contact us](mailto:{{contactEmail}}).

We're sorry for the trouble.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 10. Management link resend
  // Sent when a registrant requests a fresh management link.
  // Variables: eventName, firstName, manageUrl, myAgendaUrl, status
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_manage_link",
    subjectTemplate: "Manage your registration for {{eventName}}",
    content: `{{> greeting}}

Here's the link to your registration for **{{eventName}}**. Use it to review, change, or cancel your registration at any time.

:::button
[Manage your registration →]({{manageUrl}})
:::

{{#if eq status "cancelled"}}{{else}}
{{#if myAgendaUrl}}
Plan the sessions you want to attend in [My agenda &rarr;]({{myAgendaUrl}})
{{/if}}
{{/if}}

Didn't ask for this link? You can ignore this email.

{{> sponsors_block}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 11. Confirmation reminder (for unconfirmed registrations)
  // Sent automatically when a registration remains pending confirmation.
  // Variables: eventName, firstName, confirmationUrl, manageUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "registration_confirmation_reminder",
    subjectTemplate: "Reminder: confirm your registration for {{eventName}}",
    content: `{{> greeting}}

Your registration for **{{eventName}}** isn't complete yet. Confirm your email address to secure your place.

:::button
[Confirm my registration →]({{confirmationUrl}})
:::

Didn't register? [Cancel this registration and remove your data]({{manageUrl}}).
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 12. RSVP warning / follow-up
  // Variables: firstName, event_name, event_day, manage_url
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "rsvp_warning",
    subjectTemplate: "Are you still coming in person to {{event_name}} on {{event_day}}?",
    content: `{{> greeting}}

We noticed that you declined or removed the calendar invitation for **{{event_name}} on {{event_day}}**.

In-person seats are limited, and each one costs $150–$300 per day for venue and catering, paid by sponsors so attendance stays free. So it matters that we know who is coming.

Still coming in person? Please confirm as soon as you can. If you don't, we'll switch that day to virtual attendance and offer your seat to someone on the waitlist.

:::button
[I'm still coming in person →]({{manage_url}})
:::

Not coming after all? You don't need to do anything. Only this day changes; your other days stay as they are.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 13. RSVP day-attendance update notice
  // Variables: firstName, event_name, event_day, action_taken, new_attendance_type, manage_url
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "rsvp_downgraded",
    subjectTemplate: "Your attendance for {{event_name}} on {{event_day}} changed",
    content: `{{> greeting}}

You declined the calendar invitation for **{{event_name}} on {{event_day}}**, and we didn't hear back that you're still coming in person. So we gave your in-person seat to someone on the waitlist.

{{#if eq new_attendance_type "not_attending"}}
<div class="notice notice-warning"><strong>You're no longer attending on this day.</strong> Your other days haven't changed.</div>
{{else}}
<div class="notice notice-info"><strong>You're now attending this day as {{new_attendance_type}}.</strong> Your other days haven't changed.</div>
{{/if}}

Is this a mistake, and do you still want to come in person? [Update your registration]({{manage_url}}) while seats remain.
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
    content: `{{> greeting}}

{{#if isReminder}}
<div class="notice notice-warning">A quick follow-up on your personal invitation to <strong>{{eventName}}</strong>.{{#if daysUntilExpiry}}{{#if lte daysUntilExpiry "2"}} Your invitation expires in {{daysUntilExpiry}} day(s).{{else}} We'd love to have you in the room for this one.{{/if}}{{/if}}</div>
{{/if}}

{{#if inviterName}}You have been personally invited by **{{inviterName}}** to attend **{{eventName}}**, an event organized by the [PKI Consortium]({{brandBaseUrl}}).{{else}}You have been personally invited to attend **{{eventName}}**, an event organized by the [PKI Consortium]({{brandBaseUrl}}).{{/if}}

Join security experts, researchers, and industry leaders to explore the latest developments in public key infrastructure and post-quantum cryptography.

:::button
[Register now →]({{registrationUrl}})
:::

{{#if declineUrl}}
:::button variant=secondary
[No thanks, decline the invitation]({{declineUrl}})
:::
{{/if}}

{{#if isReminder}}If this is relevant to your work, now is a good time to register while seats remain.{{else}}Seats are limited, so register soon.{{/if}}

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
    content: `{{> greeting}}

{{#if isReminder}}
<div class="notice notice-warning">A quick follow-up on your speaker invitation for <strong>{{eventName}}</strong>.{{#if daysUntilExpiry}}{{#if lte daysUntilExpiry "2"}} This opportunity closes in {{daysUntilExpiry}} day(s).{{else}} We'd be excited to feature your perspective in this program.{{/if}}{{/if}}</div>
{{/if}}

{{#if inviterName}}You have been personally nominated by **{{inviterName}}** to speak at **{{eventName}}**, organized by the [PKI Consortium]({{brandBaseUrl}}).{{else}}We would be honored to have you present at **{{eventName}}**, organized by the [PKI Consortium]({{brandBaseUrl}}).{{/if}}

Your expertise would be a valuable addition to the program, and we invite you to submit a proposal for a session, workshop, or roundtable.

{{#if isReminder}}If this topic matters to you, don't miss the chance to help shape the conversation on stage.{{/if}}

:::button
[Submit a proposal →]({{proposalUrl}})
:::

{{#if declineUrl}}
:::button variant=secondary
[No thanks, decline the invitation]({{declineUrl}})
:::
{{/if}}

<div class="notice notice-info">&#128274; This invitation link is <strong>personal</strong> and filled in with your details. Please don't share it.</div>

If you have any questions or would like to discuss your proposal first, please [contact us](mailto:{{contactEmail}}).

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
    content: `{{> greeting}}

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
    subjectTemplate: "Can't come to {{eventName}} in person? Pass your seat on",
    content: `{{> greeting}}

**{{eventName}}** is full, and people on the waitlist are hoping for a seat. **If you can no longer come in person, please update your registration now.** Switching to virtual or on-demand attendance gives your seat to someone who is waiting.

<div class="notice notice-info">An empty seat costs the event money and keeps out someone on the waitlist.</div>

:::button
[Update my registration →]({{manageUrl}})
:::

{{> reg_details}}

Thank you for helping us make room for everyone.

{{> sponsors_block}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 6. Proposal submitted
  // Variables: eventName, firstName, lastName, proposalTitle, proposalAbstract,
  //            proposalType, speakerLineupText, manageUrl, speakerManageUrl, shareUrl
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "proposal_submitted",
    subjectTemplate: "Proposal received: {{proposalTitle}}",
    content: `{{> greeting}}

Thank you for submitting a proposal to **{{eventName}}**. We received it, and the program committee will start reviewing proposals soon.

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

1. **Review**: the program committee reviews every proposal.
2. **Decision**: we email you as soon as the committee decides.
3. **Preparation** *(if accepted)*: we contact you about scheduling and logistics.

Please check the details above. You can view or change your proposal at any time: [Manage my proposal &rarr;]({{manageUrl}})

{{#if speakerManageUrl}}
[Choose who I speak as]({{speakerManageUrl}})
{{/if}}

{{#if shareUrl}}Invite colleagues to attend by sharing your personal link: [{{shareUrl}}]({{shareUrl}}){{/if}}

Thank you for contributing to **{{eventName}}** and the PKI community!

{{> donation_request}}
`,
  },
  {
    key: "agenda_speaker_declined",
    subjectTemplate: "A speaker declined — {{eventName}}",
    content: `{{> greeting}}

{{speakerName}} declined to speak on **{{proposalTitle}}** at **{{eventName}}**, so they were taken off these sessions in the agenda draft:

{{sessionTitles}}

{{#if sessionsWithoutSpeakers}}
**These sessions now have no speakers.** They stay on the agenda until you change them:

{{sessionsWithoutSpeakers}}
{{/if}}

The published agenda still shows the earlier version until you approve the draft again.

[Open the agenda]({{agendaUrl}})
`,
  },
  {
    key: "proposal_representation_review",
    subjectTemplate: "Choose who you speak as — {{eventName}}",
    content: `{{> greeting}}

We received the proposal **{{proposalTitle}}** for **{{eventName}}**.

Please choose who you will speak as: yourself, or an organization you represent. We need to review this before the session can go on the agenda.

[Choose who I speak as]({{speakerManageUrl}})

This link is personal and manages only your own speaker profile.
`,
  },
  {
    key: "proposal_speaker_confirmed_by_organizer",
    subjectTemplate: "You're confirmed as a speaker — {{eventName}}",
    contentType: "markdown",
    messageType: "transactional",
    content: `Hello,

An organizer confirmed, on your behalf, that you will speak on **{{proposalTitle}}** at **{{eventName}}**.

You speak as **{{speakerName}}**{{#if organizationName}}, {{organizationName}}{{else}}, on your own behalf{{/if}}.

{{#if terms}}The organizer also accepted these terms for you:

{{#each terms}}- {{label}} (version {{version}}){{#if helpText}}: {{helpText}}{{/if}}{{#if contentRef}} ({{contentRef}}){{/if}}

{{/each}}{{/if}}{{> speaker_confirmation_note}}

Don't agree with this{{#if terms}} or with these terms{{/if}}? Email [{{contactEmail}}](mailto:{{contactEmail}}).
`,
  },
  {
    key: "proposal_speaker_declined",
    subjectTemplate: "A speaker declined your proposal — {{eventName}}",
    content: `{{> greeting}}

{{speakerName}} declined to speak on your proposal **{{proposalTitle}}** for **{{eventName}}**.

{{#if declineReason}}
They gave this reason:

> {{declineReason}}
{{/if}}

You can invite another speaker or change the proposal on its page.

[Manage my proposal]({{manageUrl}})
`,
  },
  {
    key: "proposal_organizational_representation_request",
    subjectTemplate: "Speak on behalf of your organization — {{eventName}}",
    content: `{{> greeting}}

Thank you for proposing **{{proposalTitle}}** for **{{eventName}}**.

Our reviewers ask that you give this talk on behalf of the organization connected to its topic, not on your own behalf. The organization authorizes the talk and may own the material you present.

Please confirm your work email address and choose the organization you represent.

[Choose my organization]({{speakerManageUrl}})

Do you take part independently? Let the event organizers know. This link is personal and manages only your own speaker profile.
`,
  },
  {
    key: "proposal_manage_link_transferred",
    subjectTemplate: "You now manage the proposal {{proposalTitle}}",
    content: `{{> greeting}}

You now manage the proposal **{{proposalTitle}}** for **{{eventName}}**.

[Manage the proposal &rarr;]({{manageUrl}})

This link is personal; please don't share it. The previous proposer's link no longer works.
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 7. Proposal decision
  // Variables: eventName, proposalTitle, finalStatus, decisionNote
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "proposal_decision",
    subjectTemplate: "A decision on your proposal {{proposalTitle}}",
    content: `{{> greeting}}

The program committee has reviewed your proposal for **{{eventName}}**.

---

## Decision: {{proposalTitle}}

{{#if eq finalStatus "accepted"}}
<div class="notice notice-success">&#127881; <strong>Congratulations, your proposal is accepted!</strong><br>We're glad to include <strong>{{proposalTitle}}</strong> in the {{eventName}} program. We'll contact you about scheduling, AV, and speaker logistics.</div>
{{/if}}
{{#if eq finalStatus "rejected"}}
<div class="notice notice-danger">After careful consideration, we're sorry to say that <strong>{{proposalTitle}}</strong> wasn't selected for this program.</div>

Thank you for the time and effort you put into it. We hope to see you at the event, in person or online, and we'd welcome another proposal from you, for this event or a future one.
{{/if}}
{{#if eq finalStatus "needs-work"}}
<div class="notice notice-warning">&#128679; The program committee asks for changes to <strong>{{proposalTitle}}</strong> before it decides. Please read the committee's note below and update your proposal.</div>

:::button
[Update my proposal →]({{manageUrl}})
:::
{{/if}}
{{#if eq finalStatus "waitlisted"}}
<div class="notice notice-warning">&#9203; <strong>{{proposalTitle}}</strong> is on the <strong>waitlist</strong>. We may still include it if a slot opens up, and we'll keep you posted.</div>

You can view or withdraw your proposal at any time: [Manage my proposal &rarr;]({{manageUrl}})
{{/if}}

{{#if decisionNote}}

**Note from the program committee:**

> {{decisionNote}}

{{/if}}

---

If you have any questions, please [contact us](mailto:{{contactEmail}}).

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
    subjectTemplate: `{{#if isReminder}}Reminder: speaker invitation for {{eventName}}{{else}}Speaker invitation for {{eventName}}{{/if}}`,
    content: `{{> greeting}}

{{#if isReminder}}
<div class="notice notice-warning">A quick reminder: we still need your answer to this speaker invitation.</div>
{{/if}}

{{#if invitedByDisplay}}{{invitedByDisplay}}{{else}}{{#if proposerFirstName}}{{proposerFirstName}}{{else}}The proposer{{/if}}{{/if}} has proposed a session for **{{eventName}}**, organized by the [PKI Consortium]({{brandBaseUrl}}), and invited you to take part as a speaker.

> **Proposal:** **{{proposalTitle}}**

{{#if proposalAbstract}}
## Proposal abstract

{{proposalAbstract}}
{{/if}}

{{#if speakerLineupText}}
## Speakers on this proposal

{{speakerLineupText}}
{{/if}}

Please review the proposal and **let us know whether you will speak**. We'll also ask you to check your speaker profile (bio and headshot), so we can promote the session.

{{> speaker_confirmation_note}}

Past the invitation deadline? Sign in to respond. An organizer then reviews your response, because someone else may already have been invited.

:::button
[Review and respond →]({{manageUrl}})
:::

<div class="notice notice-info">&#128274; This link is <strong>personal</strong> and opens your speaker profile, so please don't share it.</div>

If you have questions, please [contact us](mailto:{{contactEmail}}).

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
    subjectTemplate: "Complete your speaker profile — {{eventName}}",
    content: `{{> greeting}}

Great news: your session **{{proposalTitle}}** is accepted for **{{eventName}}**!

Please take a moment to complete your speaker profile, so we can introduce you and promote your session.

{{#unless hasBio}}<div class="notice notice-warning">&#9997;&#65039; Your <strong>bio</strong> is missing. Please add a short one.</div>{{/unless}}
{{#unless hasHeadshot}}<div class="notice notice-warning">&#128247; Your <strong>headshot</strong> is missing. Please upload a high-resolution photo so attendees can recognize you (JPEG, PNG, or WebP; at least 1000 &times; 1000 px; up to 20 MB).</div>{{/unless}}
{{#if and hasBio hasHeadshot}}<div class="notice notice-success">&#10003; Your profile looks complete. You can still change it before the event.</div>{{/if}}

:::button
[Review my speaker profile →]({{profileUrl}})
:::

You can update your profile at any time before the event.

{{> donation_request}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Profile reminders are independent from proposal decisions.
  {
    key: "speaker_profile_reminder",
    subjectTemplate: "Review your speaker profile — {{eventName}}",
    content: `{{> greeting}}

{{#if eq proposalDecisionStatus "accepted"}}Your session **{{proposalTitle}}** is accepted for **{{eventName}}**. Please review your speaker profile so we can prepare the program.{{else}}
{{#if eq proposalDecisionStatus "waitlisted"}}Your proposal **{{proposalTitle}}** for **{{eventName}}** is on the waitlist. Please review your speaker profile in the meantime. This doesn't confirm a place in the program.{{else}}
{{#if eq proposalDecisionStatus "needs-work"}}The program committee asked for changes to your proposal **{{proposalTitle}}** for **{{eventName}}**. Please make them and review your speaker profile. The proposal isn't accepted yet.{{else}}Your proposal **{{proposalTitle}}** for **{{eventName}}** is waiting for a decision. Please review your speaker profile to help the committee. This isn't an acceptance.{{/if}}
{{/if}}
{{/if}}

{{#if requiresConfirmation}}You're invited to speak on this proposal. Use the link below to say whether you will, and to review your profile.{{else}}Please check that your bio and headshot are up to date.{{/if}}
{{#unless hasHeadshot}}Please also upload a headshot so attendees can recognize you.{{/unless}}

[Review my speaker profile]({{profileUrl}})
`,
  },

  // 13. Presentation upload request
  // Sent to all speakers when a proposal is accepted.
  // Variables: eventName, firstName, proposalTitle, uploadUrl, deadline
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "presentation_upload_request",
    subjectTemplate: `{{#if isReminder}}{{#if lte daysUntilDeadline "1"}}Final call: upload your presentation today — {{eventName}}{{else}}{{#if lte daysUntilDeadline "3"}}Urgent: upload your presentation — {{eventName}}{{else}}Reminder: upload your presentation — {{eventName}}{{/if}}{{/if}}{{else}}Upload your presentation — {{eventName}}{{/if}}`,
    content: `{{> greeting}}

{{#if isReminder}}
<div class="notice notice-warning">We still need your slides for <strong>{{proposalTitle}}</strong>.{{#if daysUntilDeadline}} {{#if lte daysUntilDeadline "3"}}Only {{daysUntilDeadline}} day(s) left.{{/if}}{{/if}}</div>
{{/if}}

We're looking forward to your session **{{proposalTitle}}** at **{{eventName}}**!

Please upload your slides by the deadline below, so we can prepare the AV setup and program materials.

{{#if deadline}}<div class="notice notice-warning">&#128197; <strong>Upload deadline: {{deadline}}</strong></div>{{/if}}

**Accepted formats:** PDF, PPTX, PPT, PPTM, ODP (max 200 MB)

:::button
[Upload my presentation →]({{uploadUrl}})
:::

You can replace your file at any time before the deadline.

If you have any questions, please [contact us](mailto:{{contactEmail}}).

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
    content: `{{> greeting}}

We haven't received your slides for **{{proposalTitle}}** at **{{eventName}}** yet.

{{#if daysRemaining}}<div class="notice notice-warning">&#9201; <strong>{{daysRemaining}} {{#if eq daysRemaining "1"}}day{{else}}days{{/if}} remaining</strong> — deadline: {{deadline}}</div>{{else}}{{#if deadline}}<div class="notice notice-danger">&#128680; <strong>Deadline: {{deadline}}</strong>. Please upload your slides as soon as you can.</div>{{/if}}{{/if}}

**Accepted formats:** PDF, PPTX, PPT, PPTM, ODP (max 200 MB)

:::button
[Upload my presentation →]({{uploadUrl}})
:::

Trouble uploading, or need more time? Please [contact us](mailto:{{contactEmail}}).
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 8. User magic link
  // Variables: email, magicLinkUrl, expiresInMinutes
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "user_magic_link",
    subjectTemplate: "Your PKI Consortium sign-in link",
    content: `Hello,

Here's your link to sign in to the **PKI Consortium portal**.

:::button
[Sign in →]({{magicLinkUrl}})
:::

{{> link_safety_notice}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // Organization identity reinstatement
  // A person reinstates their own ended organization identity by proving its
  // address again; the link opens their own record, which confirms it.
  // Variables: recipientName, organizationName, accountEmail, reinstatementUrl,
  //            expiresInHours
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "organization_identity_reinstatement",
    subjectTemplate: "Confirm reinstating your representation of {{organizationName}}",
    messageType: "transactional",
    content: `Dear {{recipientName}},

You asked to reinstate your representation of **{{organizationName}}** in the **PKI Consortium portal**, signed in as {{accountEmail}}.

Once you confirm, your {{organizationName}} identity is active again, and the group seats and roles that ended with it come back where they're still available.

:::button
[Confirm reinstatement →]({{reinstatementUrl}})
:::

The link works once, for {{expiresInHours}} hours, while you're signed in to that account. If you ask again, we'll send a new link and this one stops working.

Didn't ask for this? You can ignore this email. Nothing changes unless you confirm.
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
    subjectTemplate: "Thank you for helping secure the internet",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

Thank you for your **{{formattedAmount}}** donation. It means more than you might think.

Donations keep our conferences **free and open** to security engineers, researchers, policymakers, and open-source contributors who couldn't attend otherwise. You've opened a door for someone in the global PKI community.

Welcome to a growing group of people who are shaping the future of digital trust.

---

### Your donation details

> **Name:** {{name}}<br>
> {{#if organizationName}}**Organization:** {{organizationName}}<br>
> {{/if}}**Amount:** {{formattedAmount}}

<div class="notice notice-success">&#10003; Your payment is confirmed. Our payment processor will email a receipt to <strong>{{email}}</strong> separately.</div>

{{#if shareUrl}}---

### Want to do more?

We made a **personal fundraising page** for you, with your name on it. Every donation made through your link counts toward your total.

:::button
[Share my fundraising page →]({{shareUrl}})
:::

Who in your network cares about open security standards? A single share could match, or multiply, what you gave today.{{/if}}

---

{{> donation_tax_notice}}

Questions? [Contact us](mailto:{{contactEmail}}).

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
    subjectTemplate: "Your donation wasn't completed",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

Your **{{formattedAmount}}** donation to the **PKI Consortium** wasn't completed. This happens when the checkout page is closed or left open too long.

**You haven't been charged.**

If you'd still like to support us, you can start again at any time:

:::button
[Donate again →]({{brandBaseUrl}}/donate/)
:::

There's no obligation, but we'd truly appreciate your support.

{{> donation_tax_notice}}

Questions? [Contact us](mailto:{{contactEmail}}).

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
    subjectTemplate: "Your donation payment didn't go through",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear {{name}},{{/if}}

Unfortunately, the payment for your **{{formattedAmount}}** donation to the **PKI Consortium** didn't go through. This can happen with bank transfers, direct debits, and other delayed payments when the bank declines or returns the payment.

**No money was taken from your account.**

If you'd still like to support us, you're very welcome to try again:

:::button
[Donate again →]({{brandBaseUrl}}/donate/)
:::

There's no obligation, but we'd truly appreciate your support.

{{> donation_tax_notice}}

Questions, or think this is a mistake? [Contact us](mailto:{{contactEmail}}).

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
      if (arg === "--check") {
        parsed.check = true;
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

/**
 * Read-only: lists catalog templates that have no active version with content
 * in the target database, and fails when any is missing. Run it against
 * preview and production after a deployment that adds a template.
 */
function checkActiveTemplates(cli, templates) {
  const output = runWrangler(
    [
      ...buildWranglerD1ExecuteArgs(cli),
      "--command",
      `WITH active_versions AS (
         SELECT template_key, body,
                ROW_NUMBER() OVER (PARTITION BY template_key ORDER BY version DESC) AS active_rank
           FROM email_template_versions WHERE status = 'active'
       )
       SELECT template_key FROM active_versions WHERE active_rank = 1 AND length(coalesce(body, '')) > 0;`,
      "--json",
    ],
    { captureOutput: true },
  );
  const active = new Set((parseWranglerJsonOutput(output)?.[0]?.results ?? []).map((row) => row.template_key));
  const missing = templates.map((template) => template.key).filter((key) => !active.has(key));
  if (missing.length === 0) {
    console.log(`All ${templates.length} catalog email template(s) have an active version in ${cli.mode} mode.`);
    return;
  }
  console.error(`Missing active email template(s) in ${cli.mode} mode: ${missing.join(", ")}`);
  console.error(
    "Seed them with: pnpm exec node scripts/seed-email-templates.mjs --if-missing (plus the same target flags).",
  );
  console.error("For an active version without a body, review and activate a new version in the template editor.");
  process.exitCode = 1;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const config = loadConfig(cli.configPath);
  const seed = seedConfig(config, cli);
  if (cli.check) {
    checkActiveTemplates(cli, seed.templates);
    return;
  }

  if (seed.templates.length === 0) {
    throw new Error("No email templates selected for seeding.");
  }

  ensureAdminExists(cli);

  const sql = buildTemplateSqlStatements(cli, seed.templates);
  const directory = fs.mkdtempSync(path.join(tmpdir(), "pkic-email-template-seed-"));
  const sqlPath = path.join(directory, "templates.sql");
  try {
    fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
    runWrangler([...buildWranglerD1ExecuteArgs(cli), "--file", sqlPath]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  console.log(
    `Seeded ${seed.templates.length} email template(s) in ${cli.mode} mode${cli.ifMissing ? " (missing only)" : ""}.`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
