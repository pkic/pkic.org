import { describe, expect, it } from "vitest";
import { applyCampaignCustomText } from "../functions/_lib/email/campaign-custom";

describe("applyCampaignCustomText", () => {
  it("replaces message placeholder in markdown templates", () => {
    const template = "Dear {{#if firstName}}{{firstName}}{{/if}},\n\n{{message}}";
    const custom = "**Update**\n\n- Item 1\n- Item 2";

    const out = applyCampaignCustomText(template, "markdown", custom);

    expect(out).toContain("**Update**");
    expect(out).toContain("- Item 1");
    expect(out).not.toContain("{{message}}");
  });

  it("treats replacement-pattern characters as literal custom text", () => {
    expect(applyCampaignCustomText("Hello {{{message}}}", "markdown", "$& $` $'")).toBe("Hello $& $` $'");
  });

  it("does not reinterpret placeholder syntax contained in custom text", () => {
    const custom = "Literal {{message}} and {{{message}}}";
    expect(applyCampaignCustomText("Hello {{{message}}}", "markdown", custom)).toBe(`Hello ${custom}`);
  });

  it("removes message placeholder when no custom text is provided", () => {
    const template = "Header\n\n{{message}}\n\nFooter";

    const out = applyCampaignCustomText(template, "markdown", "");

    expect(out).toContain("Header");
    expect(out).toContain("Footer");
    expect(out).not.toContain("{{message}}");
  });

  it("replaces message placeholder in html templates with escaped content", () => {
    const template = "<p>{{message}}</p>";
    const custom = "<b>unsafe</b>\nline2";

    const out = applyCampaignCustomText(template, "html", custom);

    expect(out).toContain("&lt;b&gt;unsafe&lt;/b&gt;<br>");
    expect(out).not.toContain("{{message}}");
  });

  it("fails before expanding many placeholders with oversized custom text", () => {
    const template = Array.from({ length: 30 }, () => "{{{message}}}").join("\n");
    const custom = "x".repeat(100_000);

    expect(() => applyCampaignCustomText(template, "markdown", custom)).toThrowError(
      expect.objectContaining({ code: "EMAIL_TEMPLATE_RENDER_LIMIT_EXCEEDED", status: 422 }),
    );
  });

  it("leaves templates without message placeholders unchanged", () => {
    const template = "Header\n\nNo custom message slot\n\nFooter";

    expect(applyCampaignCustomText(template, "markdown", "Custom text")).toBe(template);
  });
});
