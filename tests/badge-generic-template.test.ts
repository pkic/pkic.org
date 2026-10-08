import { describe, expect, it } from "vitest";
import { createGenericBadgeTemplate } from "../assets/shared/badge-generic-template";
import { BADGE_GENERIC_FONT_LICENSE } from "../assets/shared/badge-generic-template-assets";
import { compileBadgeTemplate } from "../assets/shared/badge-template-render";
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
const badge = { displayName: "A real attendee", organization: "Authorized company", badgeRole: "staff" as const, svg };
describe("generic PKIC complete event badge", () => {
  it("provides a full branded front and back with QR, name, role, current groups, and bundled fonts", () => {
    const template = createGenericBadgeTemplate(input);
    const compiled = compileBadgeTemplate(template);
    for (const side of ["front", "back"] as const) {
      const html = compiled.renderSide(side, badge);
      expect(html).toContain("A real attendee");
      expect(html).toContain("STAFF");
      expect(html).toContain("Owned event");
      expect(html).toContain(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    }
    expect(template.widthMm).toBe(105);
    expect(template.heightMm).toBe(148);
    expect(template.frontHtml).toContain("{{sponsors:tier-a}}");
    expect(template.backHtml).toContain("{{sponsors:tier-a}}");
    expect(template.backHtml).toContain("{{sponsors:tier-b}}");
    expect(compiled.css).toContain("data:font/woff2;base64,");
    expect(compiled.resourcesHtml).toContain('fill="var(--badge-role-color)"');
    expect(compiled.resourcesHtml).toContain("linearGradient");
  });
  it("keeps Amsterdam artwork, event location, and reference sponsor companies out of the default", () => {
    const template = createGenericBadgeTemplate({ eventName: "Another owned event", sponsorGroups: [] });
    const html = template.frontHtml + template.backHtml;
    expect(html).not.toMatch(/Amsterdam|Dec 1|IBM|Crypto4A|Keyfactor|SSL\.com|Cryptomathic/);
    expect(template.sponsorGroups).toEqual([]);
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
        "back",
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
