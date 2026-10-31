import { emailPlainText } from "../../functions/_lib/email/plain-text";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "../../functions/_lib/email/markdown";
import { renderEmail } from "../../functions/_lib/email/render";
import { DEFAULT_LAYOUT_HTML, DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { buildTemplateSqlStatements } from "../../scripts/lib/email-template-seed-sql.mjs";

const template = {
  key: "welcome",
  subjectTemplate: " Welcome {{name}} ",
  content: "Hello {{name}}",
  contentType: "markdown",
};

const EXPECTED_BASELINE_TEMPLATE_KEYS = [
  "agenda_changed",
  "agenda_session_booking",
  "agenda_session_invitation",
  "agenda_session_reminder",
  "agenda_speaker_declined",
  "attendee_invite",
  "co_speaker_invite",
  "donation_expired",
  "donation_payment_failed",
  "donation_thank_you",
  "email_layout",
  "event_proposal_verify",
  "membership-participation-warning",
  "membership-workflow-review-digest",
  "membership_join_verify",
  "msg_attendee_inperson_check_plans",
  "msg_attendee_session_favorites",
  "msg_attendee_session_reminder",
  "msg_attendee_session_reservations",
  "msg_attendee_session_waitlist",
  "msg_dear_firstname",
  "msg_message_only",
  "org-content-review-digest",
  "organization-identity-changed",
  "organization_identity_reinstatement",
  "partial_about_pkic",
  "partial_donation_request",
  "partial_membership_review_details",
  "partial_membership_review_summary",
  "partial_reg_details",
  "partial_sponsors_block",
  "presentation_upload_reminder",
  "presentation_upload_request",
  "proposal_decision",
  "proposal_manage_link_transferred",
  "proposal_organizational_representation_request",
  "proposal_representation_review",
  "proposal_speaker_confirmed_by_organizer",
  "proposal_speaker_declined",
  "proposal_submitted",
  "registration_confirm_email",
  "registration_confirmation_reminder",
  "registration_confirmed",
  "registration_email_verify",
  "registration_manage_link",
  "registration_unauthorized",
  "registration_updated",
  "registration_waitlist_offer",
  "rsvp_downgraded",
  "rsvp_warning",
  "speaker_invite",
  "speaker_profile_reminder",
  "speaker_profile_request",
  "sponsorship-new-inquiry",
  "user_email_verification",
  "user_magic_link",
  "wg-chair-membership-digest",
] as const;

describe("buildTemplateSqlStatements", () => {
  it("renders registration verification as the shared email CTA with a usable plain-text link", async () => {
    const template = DEFAULT_TEMPLATES.find((item) => item.key === "registration_email_verify")!;
    const url = "https://example.test/register/#verify=synthetic-proof";
    const rendered = await renderEmail(
      template.content,
      { verificationUrl: url, eventName: "Example conference" },
      DEFAULT_LAYOUT_HTML,
      template.contentType,
      "https://example.test",
    );
    expect(template.contentType).toBe("markdown");
    expect(rendered.html).toContain('href="' + url + '"');
    expect(rendered.html).toContain("Verify email and continue");
    expect(rendered.html).toContain("cta-navy");
    expect(rendered.text).toContain(url);
  });

  it.each([1, 2, 51])("renders the bounded organization digest with %s pending profiles", async (pendingCount) => {
    const digest = DEFAULT_TEMPLATES.find((item) => item.key === "org-content-review-digest")!;
    const rendered = await renderEmail(
      digest.content,
      {
        pendingCount,
        reviews: [{ organizationName: emailPlainText("[Untrusted name](https://attacker.invalid)") }],
        hasMore: pendingCount > 50,
        reviewUrl: "https://example.test/portal/#/settings/organization-content-reviews",
      },
      DEFAULT_LAYOUT_HTML,
    );
    expect(rendered.text).toContain(
      `${pendingCount} organization ${pendingCount === 1 ? "profile is" : "profiles are"}`,
    );
    expect(rendered.html).toContain('href="https://example.test/portal/#/settings/organization-content-reviews"');
    expect(rendered.html).not.toContain('href="https://attacker.invalid"');
    expect(rendered.text.includes("first 50 organizations")).toBe(pendingCount > 50);
  });

  it.each(["Interested in Gold sponsorship.", "", "[Review agreement](https://attacker.invalid)\n# Urgent"])(
    "renders the seeded staff inquiry template using the submission payload: %s",
    async (notes) => {
      const staffTemplate = DEFAULT_TEMPLATES.find((item) => item.key === "sponsorship-new-inquiry")!;
      const rendered = await renderEmail(
        staffTemplate.content,
        {
          contactNameText: escapeMarkdownText("Dana Sponsor"),
          contactEmailText: escapeMarkdownText("dana@sponsor.example"),
          organizationNameText: escapeMarkdownText("Example Sponsor"),
          sponsorTypeText: "consortium",
          tierText: "Not specified",
          notesText: escapeMarkdownText(notes),
          managementUrl: "https://example.test/portal/#/sponsorships",
        },
        DEFAULT_LAYOUT_HTML,
        staffTemplate.contentType,
        "https://example.test",
      );
      expect(rendered.text).toContain("Dana Sponsor");
      expect(rendered.text).toContain("dana@sponsor.example");
      expect(rendered.text).toContain("Example Sponsor");
      expect(rendered.text).toContain("Not specified");
      expect(rendered.html).toContain('href="https://example.test/portal/#/sponsorships"');
      expect(rendered.text.includes("Notes:")).toBe(Boolean(notes));
      expect(rendered.html).not.toContain('href="https://attacker.invalid"');
      expect(rendered.html).not.toContain("<h1>Urgent</h1>");
      expect(rendered.html).not.toContain("{{");
    },
  );
  it("renders organizer speaker confirmation from the seeded template", async () => {
    const seeded = DEFAULT_TEMPLATES.find((item) => item.key === "proposal_speaker_confirmed_by_organizer")!;
    const rendered = await renderEmail(
      seeded.content,
      {
        eventName: emailPlainText("Test Conference"),
        proposalTitle: emailPlainText("Certificate Automation"),
        speakerName: emailPlainText("Test Speaker"),
        organizationName: emailPlainText("Speaker Organization"),
        contactEmail: "contact@pkic.org",
        terms: [
          {
            label: emailPlainText("Recording permission"),
            version: emailPlainText("v2"),
            helpText: emailPlainText("Publication permitted"),
            contentRef: emailPlainText("https://example.test/terms"),
          },
        ],
      },
      DEFAULT_LAYOUT_HTML,
      seeded.contentType ?? "markdown",
    );
    expect(rendered.text).toContain("on your behalf");
    expect(rendered.text).toContain("Speaker Organization");
    expect(rendered.text).toContain("Recording permission");
    expect(rendered.text).toContain("Publication permitted");
    expect(rendered.text).toContain("v2");
    expect(rendered.text).toContain("contact@pkic.org");
  });

  it("delivers a dedicated speaker representation link without depending on the configured submission template", async () => {
    const review = DEFAULT_TEMPLATES.find((item) => item.key === "proposal_representation_review")!;
    const rendered = await renderEmail(
      review.content,
      {
        firstName: "Alex",
        proposalTitle: "A speaker proposal",
        eventName: "Example conference",
        speakerManageUrl: "https://example.test/private-speaker-profile",
      },
      DEFAULT_LAYOUT_HTML,
      "markdown",
      "https://example.test",
    );
    expect(rendered.text).toContain("https://example.test/private-speaker-profile");
    expect(rendered.text).toContain("individual presentation");
    expect(rendered.text).toContain("only your own speaker profile");
  });
  it.each([true, false])(
    "keeps profile reminders independent of decisions (invited: %s)",
    async (requiresConfirmation) => {
      const reminder = DEFAULT_TEMPLATES.find((item) => item.key === "speaker_profile_reminder")!;
      const rendered = await renderEmail(
        reminder.content,
        {
          firstName: "Alex",
          proposalTitle: "Accessible forms for organizations",
          eventName: "Example user conference",
          profileUrl: "https://example.test/speaker",
          requiresConfirmation,
        },
        DEFAULT_LAYOUT_HTML,
        "markdown",
        "https://example.test",
      );
      expect(rendered.text).toContain("awaiting a decision");
      expect(rendered.text).not.toContain("has been accepted");
      expect(rendered.text.includes("confirm or decline")).toBe(requiresConfirmation);
    },
  );
  it.each([
    ["accepted", "has been accepted"],
    ["waitlisted", "on the waitlist"],
    ["needs-work", "Updates are requested"],
    ["submitted", "awaiting a decision"],
  ])("explains the actual proposal status: %s", async (proposalDecisionStatus, expected) => {
    const reminder = DEFAULT_TEMPLATES.find((item) => item.key === "speaker_profile_reminder")!;
    const rendered = await renderEmail(
      reminder.content,
      { proposalDecisionStatus, proposalTitle: "Forms for organizations", eventName: "User conference" },
      DEFAULT_LAYOUT_HTML,
    );
    expect(rendered.text).toContain(expected);
    expect(rendered.text.includes("has been accepted")).toBe(proposalDecisionStatus === "accepted");
  });
  it("keeps the baseline layout light and separates public branding from action links", () => {
    expect(DEFAULT_LAYOUT_HTML).toContain('content="light only"');
    expect(DEFAULT_LAYOUT_HTML).toContain("{{brandBaseUrl}}/img/logo-white.png");
    expect(DEFAULT_LAYOUT_HTML).not.toContain("prefers-color-scheme:dark");
    expect(new Set(DEFAULT_TEMPLATES.map((item) => item.key)).size).toBe(DEFAULT_TEMPLATES.length);
    expect(DEFAULT_TEMPLATES.map((item) => item.key).sort()).toEqual(EXPECTED_BASELINE_TEMPLATE_KEYS);
  });

  it("renders the seeded sign-in template for Outlook-safe local delivery", async () => {
    const signIn = DEFAULT_TEMPLATES.find((item) => item.key === "user_magic_link");
    const magicLinkUrl = "http://localhost:8788/portal/#/verify?token=secret";
    expect(signIn).toBeDefined();

    const rendered = await renderEmail(
      signIn!.content,
      {
        email: "admin@pkic.org",
        expiresInMinutes: 15,
        magicLinkUrl,
      },
      DEFAULT_LAYOUT_HTML,
      "markdown",
      "http://localhost:8788",
    );

    expect(rendered.html).toContain('src="https://pkic.org/img/logo-white.png"');
    expect(rendered.html.split(`href="${magicLinkUrl}"`)).toHaveLength(2);
    expect(rendered.html).toContain("background:#0d1b2a");
    expect(rendered.html).not.toContain("use this sign-in link");
    expect(rendered.text).toContain("Sign in to the portal");
    expect(rendered.text.split(magicLinkUrl)).toHaveLength(2);
    expect(rendered.html).not.toContain("http://localhost:8788/img/logo-white.png");
  });

  it("guards missing-only seeds without archiving the active version", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: " Admin@Example.test ", ifMissing: true }, [template]);
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).not.toContain("SET status = 'archived'");
    expect(sql).toContain("AND created_by_user_id IS NULL");
    expect(sql).toContain("AND checksum_sha256 = ''");
    expect(sql).toContain("'admin@example.test'");
    expect(sql).toContain("' Welcome {{name}} '");
  });

  it("archives the prior active version before inserting a replacement", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: "admin@example.test", ifMissing: false }, [template]);
    expect(sql).toContain("SET status = 'archived'");
    expect(sql).not.toContain("WHERE NOT EXISTS");
    expect(sql.indexOf("UPDATE email_template_versions")).toBeLessThan(
      sql.indexOf("INSERT INTO email_template_versions"),
    );
  });

  it("stores UTC timestamps for seeded versions", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: "admin@example.test", ifMissing: true }, [template]);
    expect(sql).toContain("strftime('%Y-%m-%dT%H:%M:%fZ', 'now')");
  });

  it("refreshes untouched migration placeholders and seeds one idempotent canonical baseline", async () => {
    const db = new DatabaseSync(":memory:");
    db.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        normalized_email TEXT NOT NULL UNIQUE
      );
      CREATE TABLE email_template_versions (
        id TEXT PRIMARY KEY,
        template_key TEXT NOT NULL,
        version INTEGER NOT NULL,
        subject_template TEXT,
        body TEXT NOT NULL,
        content_type TEXT NOT NULL,
        r2_object_key TEXT,
        checksum_sha256 TEXT NOT NULL,
        status TEXT NOT NULL,
        created_by_user_id TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(template_key, version)
      );
      INSERT INTO users (id, normalized_email) VALUES ('admin-id', 'admin@example.test');
      INSERT INTO email_template_versions
        (id, template_key, version, subject_template, body, content_type,
         r2_object_key, checksum_sha256, status, created_by_user_id, created_at)
      VALUES
        ('migration-layout', 'email_layout', 1, NULL,
         '<!doctype html><html><body>{{{body_html}}}</body></html>',
         'html', NULL, '', 'active', NULL, '2025-01-01T00:00:00.000Z'),
        ('migration-sign-in', 'user_magic_link', 1, 'Your PKI Consortium sign-in link',
         'Use the secure link below to sign in.\n\n[Sign in]({{magicLinkUrl}})',
         'markdown', NULL, '', 'active', NULL, '2025-01-01T00:00:00.000Z');
    `);

    db.exec(`INSERT INTO email_template_versions (id,template_key,version,subject_template,body,content_type,r2_object_key,checksum_sha256,status,created_by_user_id,created_at)
      VALUES('legacy-identity','organization-identity-changed',1,'Identity changed','Hi {{recipientName}}, {{changeMessage}}','markdown',NULL,'','active',NULL,'2025-01-01T00:00:00.000Z')`);
    const sql = buildTemplateSqlStatements({ adminEmail: "admin@example.test", ifMissing: true }, DEFAULT_TEMPLATES);
    db.exec(sql);
    db.exec(sql);

    const rows = db
      .prepare(
        `SELECT template_key, version, status, created_at
         FROM email_template_versions
         ORDER BY template_key`,
      )
      .all() as Array<{ template_key: string; version: number; status: string; created_at: string }>;

    expect(rows).toHaveLength(DEFAULT_TEMPLATES.length);
    expect(rows.every((row) => row.version === 1 && row.status === "active")).toBe(true);
    expect(rows.every((row) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(row.created_at))).toBe(true);
    expect(rows.map((row) => row.template_key)).toEqual(
      expect.arrayContaining([
        "email_layout",
        "membership-workflow-review-digest",
        "partial_about_pkic",
        "partial_membership_review_details",
        "partial_membership_review_summary",
        "partial_reg_details",
        "partial_sponsors_block",
        "partial_donation_request",
        "msg_attendee_inperson_check_plans",
        "user_magic_link",
        "proposal_manage_link_transferred",
      ]),
    );
    expect(rows.some((row) => row.template_key === "admin_magic_link")).toBe(false);
    expect(db.prepare("SELECT body FROM email_template_versions WHERE template_key = 'email_layout'").get()).toEqual({
      body: DEFAULT_LAYOUT_HTML,
    });
    expect(db.prepare("SELECT body FROM email_template_versions WHERE template_key = 'user_magic_link'").get()).toEqual(
      { body: DEFAULT_TEMPLATES.find((item) => item.key === "user_magic_link")!.content },
    );

    const invitation = db
      .prepare("SELECT body FROM email_template_versions WHERE template_key='organization-identity-changed'")
      .get() as { body: string };
    const rendered = await renderEmail(
      invitation.body,
      {
        recipientName: "Test person",
        organizationName: "Example Organization",
        changeMessage: "You are invited.",
        invitationToken: "synthetic-proof",
      },
      DEFAULT_LAYOUT_HTML,
      "markdown",
      "https://preview.example.test",
    );
    expect(rendered.html).toContain(
      'href="https://preview.example.test/portal/#/identity-invitations?token=synthetic-proof"',
    );
    expect(rendered.text).toContain("https://preview.example.test/portal/#/identity-invitations?token=synthetic-proof");
    db.close();
  });
});
