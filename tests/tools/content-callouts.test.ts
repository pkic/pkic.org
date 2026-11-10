import { describe, expect, it } from "vitest";
import { contentCallouts } from "../../functions/_lib/services/site-content-callouts";

describe("content callouts", () => {
  it("renders GitHub alerts as site callouts, including multi-paragraph alerts", () => {
    const html = contentCallouts(
      "<blockquote>\n<p>[!NOTE]\n<strong>Why?</strong></p>\n<p>Second.</p>\n</blockquote>\n<blockquote>\n<p>[!WARNING]</p>\n<p>Careful.</p>\n</blockquote>",
    );
    expect(html).toContain(
      '<blockquote class="pk-content-callout pk-content-callout--info callout-info"><p><strong>Why?</strong></p>',
    );
    expect(html).toContain("<p>Second.</p>");
    expect(html).toContain(
      '<blockquote class="pk-content-callout pk-content-callout--warning callout-warning"><p>Careful.</p>',
    );
    expect(html).not.toContain("[!");
  });

  it("keeps the site's trailing callout marker and leaves plain quotes alone", () => {
    expect(contentCallouts("<blockquote>\n<p>Point.\n{.callout-info}</p>\n</blockquote>")).toBe(
      '<blockquote class="pk-content-callout pk-content-callout--info callout-info"><p>Point.</p></blockquote>',
    );
    expect(contentCallouts("<blockquote><p>Quote.</p></blockquote>")).toBe("<blockquote><p>Quote.</p></blockquote>");
  });
});
