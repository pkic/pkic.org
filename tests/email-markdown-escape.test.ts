import { describe, expect, it } from "vitest";
import { escapeMarkdownText } from "../functions/_lib/email/markdown";
import { emailMarkdownText, emailPlainText } from "../functions/_lib/email/plain-text";
import { renderEmail, renderSubject } from "../functions/_lib/email/render";
import { buildInviteEmailQueueRow } from "../functions/_lib/services/invite-email";
import { buildEventInviteRecipientVariables } from "../functions/_lib/services/event-invite-email-variables";
import {
  buildAttendeeCampaignRecipients,
  buildPersonalCampaignTemplateData,
  buildSpeakerTemplateData,
} from "../functions/_lib/services/admin-email-campaign/template-data";

const LAYOUT = "<!doctype html><html><body>{{{body_html}}}</body></html>";

describe("untrusted Markdown email text", () => {
  it.each([
    "[review](https://attacker.invalid/link)",
    "![pixel](https://attacker.invalid/pixel.gif)",
    '<img src="https://attacker.invalid/raw.gif">',
    '<a href="https://attacker.invalid/raw">review</a>',
    "[review][target]\n\n[target]: https://attacker.invalid/reference",
    "<https://attacker.invalid/autolink>",
    "https://attacker.invalid/bare",
    "# Heading",
    "Heading\n=======",
    "> Quote",
    "- List item",
  ])("renders %j as literal text without active attacker content", async (input) => {
    const rendered = await renderEmail("{{value}}", { value: escapeMarkdownText(input) }, LAYOUT);

    if (input.includes("attacker.invalid")) expect(rendered.text).toContain("attacker.invalid");
    else expect(rendered.text).not.toHaveLength(0);
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(rendered.html).not.toMatch(/<(?:h1|blockquote|ul)\b/i);
  });

  it("resolves serialized plain-text values by body content type while preserving trusted URLs and subjects", async () => {
    const malicious = '[review](https://attacker.invalid/link)\n<img src="https://attacker.invalid/pixel.gif">';
    const serialized = JSON.parse(JSON.stringify(emailPlainText(malicious))) as unknown;
    const markdown = await renderEmail(
      "{{value}}\n\n[Continue]({{trustedUrl}})",
      { value: serialized, trustedUrl: "https://app.test/manage" },
      LAYOUT,
      "markdown",
    );
    expect(markdown.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(markdown.html).toContain('href="https://app.test/manage"');

    const html = await renderEmail("<p>{{value}}</p>", { value: serialized }, LAYOUT, "html");
    expect(html.html).not.toContain('<img src="https://attacker.invalid/pixel.gif">');
    expect(html.html).toContain("&lt;img src=&quot;https://attacker.invalid/pixel.gif&quot;&gt;");

    expect(renderSubject("Proposal: {{value}}", "Fallback", { value: serialized })).toBe(
      'Proposal: [review](https://attacker.invalid/link) <img src="https://attacker.invalid/pixel.gif">',
    );
  });

  it("retains authorized Markdown while neutralizing raw HTML", async () => {
    const rendered = await renderEmail(
      "{{note}}",
      {
        note: emailMarkdownText(
          '**Approved** [details](https://app.test/details) <img src="https://attacker.invalid/pixel.gif">',
        ),
      },
      LAYOUT,
    );
    expect(rendered.html).toContain("<strong>Approved</strong>");
    expect(rendered.html).toContain('href="https://app.test/details"');
    expect(rendered.html).not.toMatch(/<img\b/i);
    expect(rendered.text).toContain("attacker.invalid/pixel.gif");
  });

  it("protects generic invitation names after durable-outbox serialization", async () => {
    const row = buildInviteEmailQueueRow({
      event: {
        id: "email-security-event",
        name: "Security event",
        slug: "security-event",
        base_path: null,
        starts_at: "2027-01-01T09:00:00.000Z",
        settings_json: "{}",
      },
      invite: {
        id: "email-security-invite",
        invitee_email: "speaker@example.test",
        invitee_first_name: "[Speaker](https://attacker.invalid/speaker)",
        invitee_last_name: '<img src="https://attacker.invalid/name.gif">',
        invite_type: "speaker",
        expires_at: "2027-01-01T09:00:00.000Z",
      },
      appBaseUrl: "https://app.test",
      source: "security-test",
      subject: "Speaker invitation",
      reminderCount: "0",
      linkSecretFingerprint: "a".repeat(64),
      inviterName: '[Organizer](https://attacker.invalid/inviter) <img src="https://attacker.invalid/pixel.gif">',
    });
    const payload = JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>;
    const rendered = await renderEmail(
      "Hello {{attendeeName}} ({{firstName}} {{lastName}}). Invited by {{inviterName}}. [Respond]({{proposalUrl}})",
      payload,
      LAYOUT,
    );
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(rendered.html).toContain('href="https://app.test/');
  });

  it("protects the shared preview and peer-invitation recipient variables", async () => {
    const data = JSON.parse(
      JSON.stringify(
        buildEventInviteRecipientVariables(
          {
            firstName: "[Speaker](https://attacker.invalid/speaker)",
            lastName: '<img src="https://attacker.invalid/name.gif">',
          },
          "Speaker",
        ),
      ),
    ) as Record<string, unknown>;
    const rendered = await renderEmail("{{attendeeName}} ({{firstName}} {{lastName}})", data, LAYOUT);
    expect(rendered.html).not.toMatch(/<(?:a|img)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
    expect(rendered.text).toContain("attacker.invalid");
  });

  it("protects proposal and profile fields in speaker campaign templates", async () => {
    const data = buildSpeakerTemplateData({
      email: "speaker@example.test",
      first_name: "Speaker",
      last_name: "Person",
      organization_name: '<img src="https://attacker.invalid/org.gif">',
      job_title: "Engineer",
      speaker_status: "confirmed",
      proposal_title: "[Review](https://attacker.invalid/title)",
      proposal_abstract: '<script src="https://attacker.invalid/script.js"></script>',
      proposal_type: "Talk",
      details_json: null,
      proposal_updated_at: null,
      speaker_confirmed_at: null,
      formResponse: { answers: null, fields: null },
    });
    const payload = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
    for (const contentType of ["markdown", "html"] as const) {
      const rendered = await renderEmail(
        "{{organizationName}} {{proposalTitle}} {{proposalAbstract}}",
        payload,
        LAYOUT,
        contentType,
      );
      expect(rendered.html).not.toMatch(/<(?:a|img|script)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
      expect(rendered.text).toContain("attacker.invalid");
    }
  });

  it("protects attendee campaign fields and cannot shadow canonical route data", async () => {
    const [recipient] = buildAttendeeCampaignRecipients(
      [
        {
          registration_id: "registration-1",
          manage_link_secret: "secret",
          user_id: "user-1",
          email: "attendee@example.test",
          first_name: "Attendee",
          last_name: "Person",
          organization_name: '<img src="https://attacker.invalid/org.gif">',
          job_title: "[Reviewer](https://attacker.invalid/job)",
          status: "registered",
          attendance_type: "virtual",
          custom_answers_json: JSON.stringify({
            interests: '<script src="https://attacker.invalid/answer.js"></script>',
            registrationUrl: "https://attacker.invalid/shadowed-route",
          }),
          formResponse: {
            answers: {
              interests: '<script src="https://attacker.invalid/answer.js"></script>',
              registrationUrl: "https://attacker.invalid/shadowed-route",
            },
            fields: [
              {
                id: "10000000-0000-4000-8000-000000000001",
                key: "interests",
                label: "Interests",
                fieldType: "text",
                required: false,
                options: null,
                optionSource: null,
                validation: null,
                sortOrder: 0,
                updatedAt: "2027-01-01T00:00:00.000Z",
                archivedAt: null,
              },
              {
                id: "10000000-0000-4000-0000-000000000002",
                key: "registrationUrl",
                label: "Registration URL",
                fieldType: "text",
                required: false,
                options: null,
                optionSource: null,
                validation: null,
                sortOrder: 1,
                updatedAt: "2027-01-01T00:00:00.000Z",
                archivedAt: null,
              },
            ],
          },
        },
      ],
      { attendanceByRegistration: new Map(), waitlistByRegistration: new Map() },
    );
    expect(recipient).toBeDefined();
    const payload = JSON.parse(
      JSON.stringify(
        buildPersonalCampaignTemplateData(recipient, {
          registrationUrl: "https://app.test/events/security/register",
        }),
      ),
    ) as Record<string, unknown>;

    for (const contentType of ["markdown", "html"] as const) {
      const rendered = await renderEmail(
        "{{organizationName}} {{jobTitle}} {{interests}} [Register]({{registrationUrl}})",
        payload,
        LAYOUT,
        contentType,
      );
      expect(rendered.html).not.toMatch(/<(?:a|img|script)\b[^>]*(?:href|src)=["']?https:\/\/attacker\.invalid/i);
      expect(rendered.html).toContain("https://app.test/events/security/register");
      expect(rendered.html).not.toContain("https://attacker.invalid/shadowed-route");
    }
  });
});
