import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
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
  "attendee_invite",
  "co_speaker_invite",
  "donation_expired",
  "donation_payment_failed",
  "donation_thank_you",
  "email_layout",
  "msg_attendee_inperson_check_plans",
  "msg_dear_firstname",
  "msg_message_only",
  "partial_about_pkic",
  "partial_donation_request",
  "partial_reg_details",
  "partial_sponsors_block",
  "presentation_upload_reminder",
  "presentation_upload_request",
  "proposal_decision",
  "proposal_manage_link_transferred",
  "proposal_submitted",
  "registration_confirm_email",
  "registration_confirmation_reminder",
  "registration_confirmed",
  "registration_manage_link",
  "registration_unauthorized",
  "registration_updated",
  "registration_waitlist_offer",
  "rsvp_downgraded",
  "rsvp_warning",
  "speaker_invite",
  "speaker_profile_request",
  "user_magic_link",
] as const;

describe("buildTemplateSqlStatements", () => {
  it("keeps the baseline layout light and separates public branding from action links", () => {
    expect(DEFAULT_LAYOUT_HTML).toContain('content="light only"');
    expect(DEFAULT_LAYOUT_HTML).toContain("{{brandBaseUrl}}/img/logo-white.png");
    expect(DEFAULT_LAYOUT_HTML).not.toContain("prefers-color-scheme:dark");
    expect(new Set(DEFAULT_TEMPLATES.map((item) => item.key)).size).toBe(DEFAULT_TEMPLATES.length);
    expect(DEFAULT_TEMPLATES.map((item) => item.key).sort()).toEqual(EXPECTED_BASELINE_TEMPLATE_KEYS);
  });

  it("renders the seeded sign-in template for Outlook-safe local delivery", async () => {
    const signIn = DEFAULT_TEMPLATES.find((item) => item.key === "user_magic_link");
    expect(signIn).toBeDefined();

    const rendered = await renderEmail(
      signIn!.content,
      {
        email: "admin@pkic.org",
        expiresInMinutes: 15,
        magicLinkUrl: "http://localhost:8788/portal/#/verify?token=secret",
      },
      DEFAULT_LAYOUT_HTML,
      "markdown",
      "http://localhost:8788",
    );

    expect(rendered.html).toContain('src="https://pkic.org/img/logo-white.png"');
    expect(rendered.html).toContain('href="http://localhost:8788/portal/#/verify?token=secret"');
    expect(rendered.html).toContain("background:#0d1b2a");
    expect(rendered.html).toContain("word-break:break-all");
    expect(rendered.html).not.toContain("http://localhost:8788/img/logo-white.png");
  });

  it("guards missing-only seeds without archiving the active version", () => {
    const sql = buildTemplateSqlStatements({ adminEmail: " Admin@Example.test ", ifMissing: true }, [template]);
    expect(sql).toContain("WHERE NOT EXISTS");
    expect(sql).not.toContain("SET status = 'archived'");
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

  it("seeds one idempotent baseline version for the complete canonical catalog", () => {
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
    `);

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
        "partial_about_pkic",
        "partial_reg_details",
        "partial_sponsors_block",
        "partial_donation_request",
        "msg_attendee_inperson_check_plans",
        "user_magic_link",
        "proposal_manage_link_transferred",
      ]),
    );
    expect(rows.some((row) => row.template_key === "admin_magic_link")).toBe(false);

    db.close();
  });
});
