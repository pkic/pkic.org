import { describe, expect, it } from "vitest";
import { DEFAULT_LAYOUT_HTML, DEFAULT_TEMPLATES } from "../../scripts/seed-email-templates.mjs";
import { emailPlainText } from "../../functions/_lib/email/plain-text";
import { renderEmail, renderSubject } from "../../functions/_lib/email/render";

const template = DEFAULT_TEMPLATES.find(({ key }) => key === "membership-participation-warning")!;
const organizationName = "Example Research";

describe("membership participation warning", () => {
  it.each([false, true])(
    "explains the participation concern with noCurrentRepresentatives=%s",
    async (noCurrentRepresentatives) => {
      const data = {
        organizationNameText: emailPlainText(organizationName),
        contactNameText: emailPlainText("Alex"),
        responseDeadlineText: emailPlainText("November 15, 2026"),
        noCurrentRepresentatives,
      };
      const result = await renderEmail(template.content, data, DEFAULT_LAYOUT_HTML);
      expect(renderSubject(template.subjectTemplate, "Membership notice", data)).toContain(organizationName);
      for (const body of [result.html, result.text]) {
        expect(body).toContain(organizationName);
        expect(body).toContain("November 15, 2026");
        expect(body).toContain("work email address");
        expect(body).toContain("reply to this email");
        expect(body).toContain("we will cancel");
        expect(body).toContain("before taking action");
        expect(body).not.toContain("{{");
      }
      expect(result.text.includes("do not have a current representative")).toBe(noCurrentRepresentatives);
      expect(result.text.includes("not recorded recent meeting participation")).toBe(!noCurrentRepresentatives);
      expect(result.text).not.toContain("has been canceled");
    },
  );

  it("keeps an unnamed contact's warning readable without inventing a response deadline", async () => {
    const result = await renderEmail(
      template.content,
      { organizationNameText: emailPlainText(organizationName) },
      DEFAULT_LAYOUT_HTML,
    );
    expect(result.text).toContain("Hello,");
    expect(result.text).not.toContain("reply by");
    expect(result.text).not.toContain("by that date");
    expect(result.text).toContain("we will cancel");
    expect(result.text).not.toContain("undefined");
    expect(result.html).not.toContain("{{");
  });

  it("renders organization and contact names as literal text rather than injected links or HTML", async () => {
    const name = '[Example](https://attacker.invalid) <img src="x" onerror="attack()">';
    const data = {
      organizationNameText: emailPlainText(name),
      contactNameText: emailPlainText(name),
      responseDeadlineText: emailPlainText("November 15, 2026"),
    };
    const result = await renderEmail(template.content, data, DEFAULT_LAYOUT_HTML);
    expect(renderSubject(template.subjectTemplate, "Membership notice", data)).toContain(name);
    expect(result.text).toContain("[Example](https://attacker.invalid)");
    expect(result.html).not.toContain('href="https://attacker.invalid"');
    expect(result.html).not.toContain('<img src="x"');
  });
});
