import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { DEFAULT_EVENT_MESSAGE_TEMPLATES } from "../../scripts/lib/event-message-default-templates.mjs";
import { DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { buildTemplateSqlStatements } from "../../scripts/lib/email-template-seed-sql.mjs";
import { renderEmail, renderSubject } from "../../functions/_lib/email/render";
import { emailPlainText } from "../../functions/_lib/email/plain-text";
import { findBroadcastOnlyTemplateRefs } from "../../functions/_lib/services/event-email-campaign/broadcast-safety";

const baseUrl = "https://events.example.test";
const data = { firstName: emailPlainText("Alex"), eventName: "Example conference", eventSlug: "example-conference" };
const layout = "<html><body>{{{body_html}}}</body></html>";

describe("editable attendee session message examples", () => {
  it.each(DEFAULT_EVENT_MESSAGE_TEMPLATES)(
    "renders $key through the canonical compiler and authenticated agenda destination",
    async (template) => {
      const rendered = await renderEmail(template.content, data, layout, "markdown", baseUrl);
      expect(renderSubject(template.subjectTemplate, "Event message", data)).toContain(data.eventName);
      expect(rendered.text).toContain("Hello Alex");
      expect(rendered.text).toContain(data.eventName);
      expect(rendered.html).toContain(`${baseUrl}/portal/#/events/${data.eventSlug}/agenda`);
      expect(rendered.html).not.toMatch(/\{\{/);
      expect(rendered.text).not.toMatch(/\{\{/);
      expect(rendered.html).not.toContain("localhost");
      expect(DEFAULT_TEMPLATES.filter((seed) => seed.key === template.key)).toEqual([template]);
    },
  );

  it("does not invent recipient booking, approval or waitlist facts in generic messages", async () => {
    const reservation = DEFAULT_EVENT_MESSAGE_TEMPLATES.find(({ key }) => key === "msg_attendee_session_reservations")!;
    const waitlist = DEFAULT_EVENT_MESSAGE_TEMPLATES.find(({ key }) => key === "msg_attendee_session_waitlist")!;
    const favorite = DEFAULT_EVENT_MESSAGE_TEMPLATES.find(({ key }) => key === "msg_attendee_session_favorites")!;
    const rendering = (content: string) => renderEmail(content, data, layout, "markdown", baseUrl);
    expect((await rendering(reservation.content)).text).toContain("does not confirm a booking or approval");
    expect((await rendering(waitlist.content)).text).toContain("If you are waiting for a session place");
    expect((await rendering(waitlist.content)).text).toContain("does not announce that a place is available");
    expect((await rendering(favorite.content)).text).toContain("does not register you for the session");
  });

  it("handles missing names and escaped user text while retaining personal-campaign safety", async () => {
    const template = DEFAULT_EVENT_MESSAGE_TEMPLATES[0]!;
    const unnamed = await renderEmail(template.content, { ...data, firstName: "" }, layout, "markdown", baseUrl);
    expect(unnamed.text).toContain("Hello,");
    expect(unnamed.text).not.toMatch(/\{\{/);
    const hostile = await renderEmail(
      template.content,
      { ...data, firstName: emailPlainText("<script>profile()</script>") },
      layout,
      "markdown",
      baseUrl,
    );
    expect(hostile.html).not.toContain("<script>");
    expect(hostile.text).toContain("<script>profile()</script>");
    expect(findBroadcastOnlyTemplateRefs([], [template.content])).toContain("firstName");
  });

  it("seeds missing examples idempotently without replacing an editor's active version, and retains history on explicit replacement", () => {
    const db = new DatabaseSync(":memory:");
    try {
      db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,normalized_email TEXT UNIQUE);
        INSERT INTO users VALUES('editor','editor@example.test');
        CREATE TABLE email_template_versions(id TEXT PRIMARY KEY,template_key TEXT,version INTEGER,
          subject_template TEXT,body TEXT,content_type TEXT,r2_object_key TEXT,checksum_sha256 TEXT,
          status TEXT,created_by_user_id TEXT,created_at TEXT,UNIQUE(template_key,version));`);
      const key = DEFAULT_EVENT_MESSAGE_TEMPLATES[0]!.key;
      db.prepare(
        `INSERT INTO email_template_versions VALUES('authored',?,7,'Edited subject','Edited instructions',
        'markdown',NULL,'authored-checksum','active','editor','2026-10-01T00:00:00.000Z')`,
      ).run(key);
      const missing = buildTemplateSqlStatements(
        { adminEmail: "editor@example.test", ifMissing: true },
        DEFAULT_EVENT_MESSAGE_TEMPLATES,
      );
      db.exec(missing);
      db.exec(missing);
      expect(db.prepare("SELECT COUNT(*) AS total FROM email_template_versions").get()).toEqual({ total: 4 });
      expect(
        db.prepare("SELECT version,body,status FROM email_template_versions WHERE template_key=?").get(key),
      ).toEqual({ version: 7, body: "Edited instructions", status: "active" });
      db.exec(
        buildTemplateSqlStatements({ adminEmail: "editor@example.test", ifMissing: false }, [
          DEFAULT_EVENT_MESSAGE_TEMPLATES[0]!,
        ]),
      );
      expect(
        db
          .prepare("SELECT version,body,status FROM email_template_versions WHERE template_key=? ORDER BY version")
          .all(key),
      ).toEqual([
        { version: 7, body: "Edited instructions", status: "archived" },
        { version: 8, body: DEFAULT_EVENT_MESSAGE_TEMPLATES[0]!.content, status: "active" },
      ]);
    } finally {
      db.close();
    }
  });
});
