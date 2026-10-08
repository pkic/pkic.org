import { describe, expect, it } from "vitest";
import { BADGE_PRINT_CONTENT_SECURITY_POLICY, compileBadgeTemplate } from "../assets/shared/badge-template-render";
import {
  badgeTemplateBrandingSchema,
  eventBadgeTemplateSchema,
  type EventBadgeTemplate,
} from "../assets/shared/schemas/event-badge-template";
import { eventSettingsUpdateSchema } from "../assets/shared/schemas/event-management";
import { badgeDisplayRoleSchema, eventParticipantRoleSchema } from "../assets/shared/schemas/participant-roles";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>';
const badge = {
  displayName: 'Alice <script> & "Bob"',
  firstName: "Alice",
  lastName: "Example",
  organization: "Owned & approved",
  badgeRole: "attendee" as const,
  svg,
};
const sponsorId = "28a2c3d4-05f6-47ab-89cd-0123456789ef";
function template(overrides: Partial<EventBadgeTemplate> = {}): EventBadgeTemplate {
  return {
    version: 1,
    name: "Event badge",
    widthMm: 105,
    heightMm: 148,
    frontHtml:
      '<div class="name">{{displayName}}</div><div>{{qr}}</div><div class="badge-template-role">{{badgeRole}}</div><div>{{sponsors:front}}</div>',
    backHtml:
      "<div>{{firstName}} {{lastName}}</div><div>{{organization}}</div><div>{{qr}}</div><div>{{sponsors:back}}</div>",
    css: ".name{font-size:22pt}",
    assets: {},
    sponsorGroups: [
      { key: "front", tierName: "Diamond" },
      { key: "back", tierName: "Titanium" },
    ],
    ...overrides,
  };
}

describe("private event HTML badge compiler", () => {
  it("escapes authorized attendee text and keeps QR as a real owned SVG image", () => {
    const output = compileBadgeTemplate(template()).renderSide("front", badge);
    expect(output).toContain("Alice &lt;script&gt; &amp; &quot;Bob&quot;");
    expect(output).not.toContain("<script>");
    expect(output).toContain(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
    expect(output).toContain("ATTENDEE");
  });
  it("keeps front/back fields separate and does not split or invent missing name components", () => {
    const compiled = compileBadgeTemplate(template());
    expect(compiled.renderSide("back", { displayName: "Dr. Example", badgeRole: "attendee", svg })).not.toContain(
      "Dr. Example",
    );
    expect(compiled.renderSide("back", badge)).toContain("Owned &amp; approved");
  });
  it.each([
    ["attendee", "#0b0d0c", "ATTENDEE"],
    ["speaker", "#ed7d31", "SPEAKER"],
    ["staff", "#198754", "STAFF"],
    ["sponsor", "#5a9bd5", "SPONSOR"],
  ] as const)("uses the supplied %s display band without granting duty roles", (role, color, label) => {
    const output = compileBadgeTemplate(template()).renderSide("front", { ...badge, badgeRole: role });
    expect(output).toContain(`--badge-role-color:${color}`);
    expect(output).toContain(label);
    expect(badgeDisplayRoleSchema.safeParse(role).success).toBe(true);
    if (role === "sponsor") expect(eventParticipantRoleSchema.safeParse(role).success).toBe(false);
  });
  it("renders only the exact configured event tier and omits empty sponsor groups", () => {
    const branding = [{ key: "front", tierName: "Diamond", sponsors: [{ id: sponsorId, name: "Event & Co", svg }] }];
    const compiled = compileBadgeTemplate(template(), branding);
    expect(compiled.renderSide("front", badge)).toContain("Event &amp; Co");
    expect(compiled.renderSide("back", badge)).not.toContain("Event &amp; Co");
    expect(
      compileBadgeTemplate(template(), [{ ...branding[0], tierName: "Another tier" }]).renderSide("front", badge),
    ).not.toContain("Event &amp; Co");
    expect(compileBadgeTemplate(template()).renderSide("front", badge)).not.toContain("badge-template-sponsor-logos");
  });
  it("reflects sponsor changes in newly rendered badges without retaining original company artwork", () => {
    const output = (name: string) =>
      compileBadgeTemplate(template(), [
        { key: "front", tierName: "Diamond", sponsors: [{ id: sponsorId, name, svg }] },
      ]).renderSide("front", badge);
    expect(output("Previous")).toContain("Previous");
    expect(output("Current")).toContain("Current");
    expect(output("Current")).not.toContain("Previous");
  });
  it("inlines shared vector assets once in compiled CSS and references only owned assets in HTML", () => {
    const input = template({
      assets: { artwork: { mime: "image/svg+xml", base64: btoa(svg) } },
      frontHtml: '<img src="asset:artwork" alt="Design"/><div>{{qr}}</div>',
      css: '.name{background-image:url("asset:artwork")}',
    });
    const compiled = compileBadgeTemplate(input);
    expect(compiled.css).toContain(`data:image/svg+xml;base64,${btoa(svg)}`);
    expect(compiled.resourcesHtml).toContain(svg.replace(' width="10" height="10"', ""));
    expect(compiled.renderSide("front", badge)).toContain('<use href="#badge-vector-0">');
    expect(compiled.renderSide("front", badge)).not.toContain(btoa(svg));
  });
  it.each([
    "<script>alert(1)</script><div>{{qr}}</div>",
    '<img src="asset:unknown"/><div>{{qr}}</div>',
    '<div onclick="alert(1)">{{qr}}</div>',
    '<iframe src="https://example.invalid"/><div>{{qr}}</div>',
    "<style>body{color:red}</style><div>{{qr}}</div>",
    '<div title="{{displayName}}">{{qr}}</div>',
    "<div>{{credential}}</div><div>{{qr}}</div>",
    "<div>Prefix {{qr}}</div>",
    "<div>{{sponsors:missing}}</div><div>{{qr}}</div>",
    "<!DOCTYPE div><div>{{qr}}</div>",
    "<div>{{qr}}</span>",
    "<div>{{qr}}</div><div>{{broken</div>",
  ])("rejects active, malformed, external, or unknown markup %s", (frontHtml) => {
    expect(eventBadgeTemplateSchema.safeParse(template({ frontHtml })).success).toBe(false);
  });
  it.each([
    '@import "https://example.invalid/x.css";',
    ".x{background:url(https://example.invalid/image)}",
    ".x{background:url(data:image/png;base64,AA==)}",
    ".x{background:u\\72l(https://example.invalid/image)}",
    "</style><script>alert(1)</script>",
    "@page{size:100mm 100mm}",
    '.x{background:image-set("https://example.invalid/x")}',
    ".x{background:url(asset:unknown)}",
  ])("rejects hidden or external CSS resources %s", (css) => {
    expect(eventBadgeTemplateSchema.safeParse(template({ css })).success).toBe(false);
  });
  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,AA=="/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect onclick="alert(1)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://example.invalid";</style></svg>',
  ])("rejects non-vector or active sponsor artwork %s", (unsafeSvg) => {
    expect(
      badgeTemplateBrandingSchema.safeParse([
        { key: "front", tierName: "Diamond", sponsors: [{ id: sponsorId, name: "Sponsor", svg: unsafeSvg }] },
      ]).success,
    ).toBe(false);
  });
  it("rejects duplicate groups, oversized payloads, and unknown credential-bearing fields", () => {
    expect(
      eventBadgeTemplateSchema.safeParse(
        template({
          sponsorGroups: [
            { key: "front", tierName: "Diamond" },
            { key: "front", tierName: "Titanium" },
          ],
        }),
      ).success,
    ).toBe(false);
    expect(eventBadgeTemplateSchema.safeParse({ ...template(), credential: "private-token" }).success).toBe(false);
    expect(
      eventBadgeTemplateSchema.safeParse(
        template({
          assets: Object.fromEntries(
            Array.from({ length: 41 }, (_, index) => [`asset_${index}`, { mime: "image/svg+xml", base64: btoa(svg) }]),
          ),
        }),
      ).success,
    ).toBe(false);
    expect(
      eventBadgeTemplateSchema.safeParse(
        template({
          assets: Object.fromEntries(
            Array.from({ length: 4 }, (_, index) => [
              `asset_${index}`,
              { mime: "font/ttf", base64: "AAAA".repeat(90000) },
            ]),
          ),
        }),
      ).success,
    ).toBe(false);
  });
  it("uses canonical managed event settings and rejects the custom-key bypass", () => {
    expect(
      eventSettingsUpdateSchema.safeParse({ expectedUpdatedAt: "revision", badgeTemplate: template() }).success,
    ).toBe(true);
    expect(eventSettingsUpdateSchema.safeParse({ expectedUpdatedAt: "revision", badgeTemplate: null }).success).toBe(
      true,
    );
    expect(
      eventSettingsUpdateSchema.safeParse({ expectedUpdatedAt: "revision", settings: { badgeTemplate: template() } })
        .success,
    ).toBe(false);
  });
  it("stores repeated artwork once and uses foreground vectors with namespaced gradient references", () => {
    const vector =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><linearGradient id="paint"><stop offset="0" stop-color="#123456"/></linearGradient></defs><rect width="10" height="10" fill="url(#paint)"/></svg>';
    const compiled = compileBadgeTemplate(template(), [
      { key: "front", tierName: "Diamond", sponsors: [{ id: sponsorId, name: "Owned sponsor", svg: vector }] },
    ]);
    const html = Array.from({ length: 100 }, () => compiled.renderSide("front", badge)).join("");
    expect(compiled.resourcesHtml).toContain('id="badge-vector-0-paint"');
    expect(compiled.resourcesHtml).toContain('fill="url(#badge-vector-0-paint)"');
    expect(html).toContain('<svg class="badge-template-sponsor-logo" role="img" aria-label="Owned sponsor"');
    expect(html).not.toContain("linearGradient");
    expect(html.match(/href="#badge-vector-0"/g)).toHaveLength(100);
    expect(compiled.resourcesHtml.match(/<symbol /g)).toHaveLength(1);
  });
  it("rejects duplicate actual sponsor IDs and unscoped SVG styles", () => {
    expect(
      badgeTemplateBrandingSchema.safeParse([
        {
          key: "front",
          tierName: "Diamond",
          sponsors: [
            { id: sponsorId, name: "Owned", svg },
            { id: sponsorId, name: "Duplicate", svg },
          ],
        },
      ]).success,
    ).toBe(false);
    expect(
      badgeTemplateBrandingSchema.safeParse([
        {
          key: "front",
          tierName: "Diamond",
          sponsors: [
            {
              id: sponsorId,
              name: "Owned",
              svg: '<svg xmlns="http://www.w3.org/2000/svg"><style>.x{fill:red}</style><path class="x" d="M0 0"/></svg>',
            },
          ],
        },
      ]).success,
    ).toBe(false);
  });
  it("exports the same no-network policy for private preview and downloaded HTML", () => {
    expect(BADGE_PRINT_CONTENT_SECURITY_POLICY).toContain("script-src 'none'");
    expect(BADGE_PRINT_CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
    expect(BADGE_PRINT_CONTENT_SECURITY_POLICY).toContain("img-src data:");
    expect(BADGE_PRINT_CONTENT_SECURITY_POLICY).toContain("font-src data:");
  });
});
