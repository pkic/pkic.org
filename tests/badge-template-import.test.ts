import { describe, expect, it } from "vitest";
import { exportBadgeTemplateHtml, importBadgeTemplateHtml } from "../assets/shared/badge-template-import";
import { compileBadgeTemplate } from "../assets/shared/badge-template-render";
import type { EventBadgeTemplate } from "../assets/shared/schemas/event-badge-template";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#123456"/></svg>';
const template: EventBadgeTemplate = {
  version: 1,
  name: "Owned & editable",
  widthMm: 105,
  heightMm: 148,
  frontHtml:
    '<div>{{displayName}}</div><img src="asset:artwork" alt="Event artwork"/><div>{{qr}}</div><div>{{sponsors:front}}</div>',
  backHtml: "<p>Editable location text</p>",
  css: ".event{font-family:'Arial';color:#123456}",
  assets: { artwork: { mime: "image/svg+xml", base64: btoa(svg) } },
  sponsorGroups: [{ key: "front", tierName: "Diamond" }],
};
describe("editable plain HTML event badge import", () => {
  it("round-trips a complete authored HTML template with vector assets and real editable CSS", () => {
    const html = exportBadgeTemplateHtml(template);
    expect(html).toContain("font-family:'Arial'");
    const imported = importBadgeTemplateHtml(html);
    expect(imported.name).toBe(template.name);
    expect(imported.css).toBe(template.css);
    expect(imported.sponsorGroups).toEqual(template.sponsorGroups);
    expect(Object.values(imported.assets)).toEqual(Object.values(template.assets));
    expect(
      compileBadgeTemplate(imported).renderSide("front", { displayName: "Owned person", badgeRole: "staff", svg }),
    ).toContain("Owned person");
  });
  it("accepts ordinary unpaired HTML image tags without inserting the document into a DOM", () => {
    expect(
      importBadgeTemplateHtml(
        exportBadgeTemplateHtml(template).replace('alt="Event artwork"/>', 'alt="Event artwork">'),
      ).frontHtml,
    ).toContain("asset:imported_asset_0");
  });
  it("extracts inert inline SVG as shared artwork", () => {
    const html = exportBadgeTemplateHtml({ ...template, assets: {}, frontHtml: "<div>{{qr}}</div>" }).replace(
      "<div>{{qr}}</div>",
      `${svg}<div>{{qr}}</div>`,
    );
    expect(Object.values(importBadgeTemplateHtml(html).assets)[0].mime).toBe("image/svg+xml");
  });
  it("keeps location artwork event-owned and allows plain text edits in the uploaded HTML", () => {
    const imported = importBadgeTemplateHtml(
      exportBadgeTemplateHtml(template).replace("Editable location text", "Different event location"),
    );
    expect(imported.backHtml).toContain("Different event location");
    expect(template.backHtml).toBe("<p>Editable location text</p>");
  });
  it.each([
    (html: string) => html.replace("</head>", "<script>alert(1)</script></head>"),
    (html: string) => html.replace("<body>", '<body onload="alert(1)">'),
    (html: string) => html.replace('lang="en"', 'onclick="alert(1)"'),
    (html: string) => html.replace('alt="Event artwork"', 'onerror="alert(1)"'),
    (html: string) => html.replace(/data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+/, "https://example.invalid/private"),
    (html: string) => html.replace("</style>", '@import "https://example.invalid/private";</style>'),
    (html: string) => html.replace("{{displayName}}", "{{credential}}"),
    (html: string) => html.replace('name="badge-template"', 'name="unknown"'),
    (html: string) =>
      html.replace("<!doctype html>", '<!DOCTYPE html [<!ENTITY leak SYSTEM "https://example.invalid">]>'),
    (html: string) => html.replace('<section data-badge-side="back">', '<section data-badge-side="front">'),
  ])("refuses active, external, unknown, or ambiguous imported HTML without executing it", (alter) => {
    expect(() => importBadgeTemplateHtml(alter(exportBadgeTemplateHtml(template)))).toThrow();
  });
  it("refuses oversized original bundles and requires the inert template document format", () => {
    expect(() => importBadgeTemplateHtml(" ".repeat(2 * 1024 * 1024 + 1))).toThrow("2 MiB");
    expect(() => importBadgeTemplateHtml('<html><head><script>eval("bundle")</script></head><body/></html>')).toThrow();
  });
});
