import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import YAML from "yaml";

const DEFAULT_CONFIG_PATH = path.join(process.cwd(), "scripts", "seed-event.yaml");
const DEFAULT_BUCKET = process.env.ASSETS_BUCKET_NAME ?? "pkic-assets";
const DEFAULT_LAYOUT_KEY = process.env.EMAIL_LAYOUT_R2_KEY ?? "layouts/email/default.html";
const DEFAULT_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@pkic.org";
const DEFAULT_LAYOUT_HTML = "<!doctype html><html><body>{{{body_html}}}</body></html>"; // NOTE: layout is rendered server-side in render.ts — this R2 value is not currently consumed.

// NOTE: email partials (partial_reg_details, partial_sponsors_block, partial_about_pkic)
// are seeded automatically by migration 0009 and managed via the admin UI.
// Do not add them here — the migration is the single source of truth.
const DEFAULT_TEMPLATES = [
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

Once confirmed you can [manage your registration]({{manageUrl}}) at any time.

Know someone who should attend? Share your personal referral link: [{{shareUrl}}]({{shareUrl}})

{{> sponsors_block}}
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
    subjectTemplate: "Your registration is confirmed — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

We are delighted to confirm that **your registration for {{eventName}} has been successfully processed**.

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
<div class="notice notice-warning">&#9203; You are currently on the <strong>waitlist</strong> for in-person attendance. One of the limiting factors for in-person capacity is the event budget — we will be able to admit more attendees as sponsors commit to the conference. If {{#if organizationName}}<strong>{{organizationName}}</strong>{{else}}your organization{{/if}} is willing and able to sponsor this conference, please <a href="mailto:contact@pkic.org">contact us</a>. We will notify you as soon as a seat becomes available.</div>
{{/if}}

---

{{> reg_details}}

[Manage your registration &rarr;]({{manageUrl}})

Know someone who should attend? Share your personal referral link and use the attached personal image to help grow the community:
[{{shareUrl}}]({{shareUrl}})

We look forward to seeing you at the *{{eventName}}**!

{{> sponsors_block}}
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
    subjectTemplate: "Registration updated — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Registrant,{{/if}}

This email confirms that your registration for **{{eventName}}** has been successfully updated.

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

If the details above don't look right, [edit your registration &rarr;]({{manageUrl}})
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
  // Variables: eventName, firstName, lastName, registrationUrl, declineUrl,
  //            sponsorsImageUrl, heroImageUrl
  // Partials:  {{> about_pkic}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "attendee_invite",
    subjectTemplate: "You're invited to {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Colleague,{{/if}}

You have been personally invited to attend **{{eventName}}**, an event organized by the [PKI Consortium](https://pkic.org).

Join security experts, researchers, and industry leaders to explore the latest developments in public key infrastructure and post-quantum cryptography.

<div class="cta"><a href="{{registrationUrl}}">Register now &rarr;</a></div>

{{#if declineUrl}}<div class="cta-secondary"><a href="{{declineUrl}}">No thanks, decline this invitation</a></div>{{/if}}

Seats are limited — please register at your earliest convenience.

---

{{> about_pkic}}

{{> sponsors_block}}
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Speaker invite
  // Variables: eventName, firstName, lastName, proposalUrl, declineUrl,
  //            sponsorsImageUrl, heroImageUrl
  // Partials:  {{> about_pkic}}, {{> sponsors_block}}
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "speaker_invite",
    subjectTemplate: "Invitation to speak at {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

We would be honoured to have you present at **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).

We believe your expertise would be a valuable contribution to the programme. We invite you to submit a proposal for a session, workshop, or roundtable.

<div class="cta"><a href="{{proposalUrl}}">Submit a proposal &rarr;</a></div>

{{#if declineUrl}}<div class="cta-secondary"><a href="{{declineUrl}}">No thanks, decline this invitation</a></div>{{/if}}

<div class="notice notice-info">&#128274; This invitation link is <strong>personal</strong> and pre-filled with your details. Please do not share it with others.</div>

If you have any questions or would like to discuss your proposal first, please [contact us](mailto:contact@pkic.org).

---

{{> about_pkic}}

{{> sponsors_block}}
`,
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
    subjectTemplate: "You have been added as a speaker — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

{{proposerFirstName}} has listed you as a speaker on their proposal for **{{eventName}}**, organized by the [PKI Consortium](https://pkic.org).

> **Proposal:** {{proposalTitle}}

Please review the proposal and **confirm or decline your participation**. You will also be prompted to review your speaker profile (bio and headshot) so we can promote the session.

<div class="cta"><a href="{{manageUrl}}">Review proposal &amp; confirm participation &rarr;</a></div>

<div class="notice notice-info">&#128274; This link is <strong>personal</strong> — please do not share it. It gives access to your speaker profile and participation management.</div>

If you have questions, please [contact us](mailto:contact@pkic.org).

{{> sponsors_block}}
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
`,
  },

  // ─────────────────────────────────────────────────────────────────────────
  // 13. Presentation upload request
  // Sent to all speakers when a proposal is accepted.
  // Variables: eventName, firstName, proposalTitle, uploadUrl, deadline
  // ─────────────────────────────────────────────────────────────────────────
  {
    key: "presentation_upload_request",
    subjectTemplate: "Please upload your presentation — {{eventName}}",
    content: `{{#if firstName}}Dear {{firstName}},{{else}}Dear Speaker,{{/if}}

We are looking forward to your session **{{proposalTitle}}** at **{{eventName}}**!

Please upload your presentation slides by the deadline below so our team can prepare the AV setup and programme materials.

{{#if deadline}}<div class="notice notice-warning">&#128197; <strong>Upload deadline: {{deadline}}</strong></div>{{/if}}

**Accepted formats:** PDF, PPTX, PPT, PPTM, ODP (max 200 MB)

<div class="cta"><a href="{{uploadUrl}}">Upload my presentation &rarr;</a></div>

You can replace your file at any time before the deadline.

If you have any questions, please [contact us](mailto:contact@pkic.org).
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
    layoutKey: DEFAULT_LAYOUT_KEY,
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

    if (arg === "--layout-key" && next) {
      parsed.layoutKey = next;
      index += 1;
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
    layoutKey: config?.emailTemplates?.layoutKey ?? cli.layoutKey,
    layoutHtml: config?.emailTemplates?.layoutHtml ?? DEFAULT_LAYOUT_HTML,
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

  // Seed the layout to R2 if a bucket is configured (used for HTML wrapping).
  // Template content goes to DB only, so no R2 content uploads are needed.
  try {
    putR2Object(cli, cli.bucket, seed.layoutKey, seed.layoutHtml, "text/html; charset=utf-8");
  } catch {
    // R2 bucket may not be configured in dev — layout will fall back to plain HTML.
  }

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
