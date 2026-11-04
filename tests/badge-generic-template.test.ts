import { describe, expect, it } from "vitest";
import { createGenericBadgeTemplate } from "../assets/shared/badge-generic-template";
import { BADGE_GENERIC_FONT_LICENSE } from "../assets/shared/badge-generic-font-license";
import { compileBadgeTemplate } from "../assets/shared/badge-template-render";
import { composeBadgePrintSvg, splitBadgePrintSvg } from "../assets/shared/badge-print-svg";
import { badgeCredentialSchema, formatBadgeCredential } from "../assets/shared/schemas/badge-credential";
import { exportBadgeTemplateHtml, importBadgeTemplateHtml } from "../assets/shared/badge-template-import";
import { eventCreateSchema, eventResourceCoreSchema } from "../assets/shared/schemas/event-management";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>';
const input = {
  eventName: "Owned event",
  sponsorGroups: [
    { key: "tier-a", tierName: "Diamond" },
    { key: "tier-b", tierName: "Titanium" },
  ],
};
const badge = {
  displayName: "A real attendee",
  organization: "Authorized company",
  jobTitle: "Director of Cryptographic Engineering",
  badgeRole: "staff" as const,
  svg,
};
describe("generic PKIC complete event badge", () => {
  it("provides a full branded front and back with QR, name, role, current groups, and bundled fonts", () => {
    const template = createGenericBadgeTemplate(input);
    const compiled = compileBadgeTemplate(template);
    for (const side of ["front", "back"] as const) {
      const html = compiled.renderSide(side, badge);
      expect(html).toContain("A real attendee");
      if (side === "front") expect(html).toContain("STAFF");
      expect(html).toContain("Director of Cryptographic Engineering");
      expect(html).toContain("Authorized company");
      if (side === "front") expect(html).toContain("Owned event");
      expect(html).toContain(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    expect(template.widthMm).toBe(105);
    expect(template.heightMm).toBe(148);
    expect(template.frontHtml).toContain("{{sponsors:tier-a}}");
    expect(template.backHtml).toContain("{{sponsors:tier-a}}");
    expect(template.backHtml).toContain("{{sponsors:tier-b}}");
    expect(compiled.css).toContain("data:font/woff2;base64,");
    expect(compiled.css).toContain("var(--badge-role-color)");
    expect(compiled.css).toContain("linear-gradient");
  });
  it("uses the owning event dates and city without Amsterdam artwork", () => {
    const template = createGenericBadgeTemplate({
      ...input,
      startsAt: "2027-02-10T09:00:00.000Z",
      endsAt: "2027-02-12T17:00:00.000Z",
      timezone: "Europe/London",
      city: "London",
    });
    expect(template.frontHtml).toContain("London");
    expect(template.frontHtml).toContain("2027");
    expect(template.frontHtml).not.toContain("canal_houses");
  });
  it("preserves caller-owned sponsor slots even when their keys match another generated slot", () => {
    const template = createGenericBadgeTemplate({
      eventName: "Summit",
      sponsorGroups: [
        { key: "event-2", tierName: "Diamond", source: "event" },
        { key: "event-1", tierName: "Titanium", source: "event" },
      ],
    });
    expect(template.frontHtml).toContain("{{sponsors:event-2}}");
    expect(template.frontHtml).not.toContain("{{sponsors:event-1}}");
    expect(template.backHtml).toContain("{{sponsors:event-1}}");
  });
  it("keeps the shared current-event Agenda and Q&A redirects on the default back", () => {
    const compiled = compileBadgeTemplate(createGenericBadgeTemplate(input));
    const back = compiled.renderSide("back", badge);
    expect(back).toContain("Agenda");
    expect(back).toContain("pkic.org/pqcc");
    expect(back).toContain("Q&amp;A");
    expect(back).toContain("pkic.org/ask");
    expect(back).toContain("pkic.org/join");
  });
  it("prints the scanner's manual-entry badge code as text beside the QR on both sides", () => {
    const credential = "ABCDEFGHJKLMNPQR";
    const code = formatBadgeCredential(credential);
    const printable = composeBadgePrintSvg(svg, credential);
    const split = splitBadgePrintSvg(printable)!;
    const compiled = compileBadgeTemplate(createGenericBadgeTemplate(input));
    for (const side of ["front", "back"] as const) {
      const html = compiled.renderSide(side, { ...badge, svg: printable });
      expect(html).toContain(code);
      expect(badgeCredentialSchema.parse(code)).toBe(credential);
      expect(html).toContain(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(split.qr)}`);
      expect(html).not.toContain(encodeURIComponent(printable));
      expect(html).not.toContain(credential);
    }
  });
  it("fits long names and organizations by size, breaking only between words", () => {
    const compiled = compileBadgeTemplate(createGenericBadgeTemplate(input));
    const html = compiled.renderSide("front", { ...badge, displayName: "Paul van Brouwershaven" });
    expect(html).toContain("--badge-display-name-longest:13;--badge-display-name-length:22");
    expect(compiled.css).toContain("word-break:normal");
    expect(compiled.css).toContain("--badge-display-name-longest");
  });
  it("keeps Amsterdam artwork, event location, and reference sponsor companies out of the default", () => {
    const template = createGenericBadgeTemplate({ eventName: "Another owned event", sponsorGroups: [] });
    const html = template.frontHtml + template.backHtml;
    expect(html).not.toMatch(/Amsterdam|Dec 1|IBM|Crypto4A|Keyfactor|SSL\.com|Cryptomathic/);
    expect(template.sponsorGroups).toEqual([]);
    expect(template.assets).not.toHaveProperty("canal_houses");
    expect(template.assets).not.toHaveProperty("canal_houses_ink");
    expect(html).not.toContain("{{sponsors:");
  });
  it("escapes explicit custom copy without granting a template expression or injecting active HTML", () => {
    const template = createGenericBadgeTemplate({
      ...input,
      eventName: "Owner's & <event>",
      customTextOverlay: '<script>alert("copy")</script>',
    });
    const html = compileBadgeTemplate(template).renderSide("front", badge);
    expect(html).toContain("Owner&#39;s &amp; &lt;event&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;copy&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    const literal = compileBadgeTemplate(
      createGenericBadgeTemplate({
        ...input,
        eventName: "{{displayName}} event",
        customTextOverlay: "{{credential}} is literal copy",
      }),
    ).renderSide("front", badge);
    expect(literal).toContain("<span>{</span><span>{</span>displayName<span>}</span><span>}</span> event");
    expect(literal).toContain("<span>{</span><span>{</span>credential<span>}</span><span>}</span> is literal copy");
  });
  it("accepts the canonical event title boundary and preserves persisted titles beyond the creation bound", () => {
    const atBoundary = eventCreateSchema.shape.name.parse("A".repeat(180));
    expect(
      compileBadgeTemplate(createGenericBadgeTemplate({ eventName: atBoundary, sponsorGroups: [] })).renderSide(
        "front",
        badge,
      ),
    ).toContain(atBoundary);
    const persisted = eventResourceCoreSchema.shape.name.parse("B".repeat(181));
    expect(eventCreateSchema.shape.name.safeParse(persisted).success).toBe(false);
    expect(
      compileBadgeTemplate(createGenericBadgeTemplate({ eventName: persisted, sponsorGroups: [] })).renderSide(
        "front",
        badge,
      ),
    ).toContain(persisted);
  });
  it("renders live supplied sponsor vectors and allows importing the generic design as editable HTML", () => {
    const template = importBadgeTemplateHtml(exportBadgeTemplateHtml(createGenericBadgeTemplate(input)));
    const compiled = compileBadgeTemplate(template, [
      {
        key: "tier-b",
        tierName: "Titanium",
        sponsors: [{ id: "28a2c3d4-05f6-47ab-89cd-0123456789ef", name: "Current event sponsor", svg }],
      },
    ]);
    expect(compiled.renderSide("back", badge)).toContain("Current event sponsor");
    expect(compiled.renderSide("front", badge)).not.toContain("Current event sponsor");
    expect(compiled.resourcesHtml).toContain('<symbol id="badge-vector-');
  });
  it("retains the actual font license for the document owner to include once with shared artwork", () => {
    expect(BADGE_GENERIC_FONT_LICENSE).toContain("Copyright 2011 The Roboto Project Authors");
    expect(BADGE_GENERIC_FONT_LICENSE).toContain("SIL OPEN FONT LICENSE Version 1.1");
    expect(BADGE_GENERIC_FONT_LICENSE).toContain("PERMISSION & CONDITIONS");
  });
});
