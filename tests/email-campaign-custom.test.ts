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
});
