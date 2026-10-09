import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PQC_CONFERENCE_BADGE_FONT_URLS,
  PQC_CONFERENCE_BADGE_SPONSOR_GROUPS,
  createPqcConferenceBadgeTemplate,
} from "../../assets/shared/badge-pqc-template";
import {
  BADGE_GENERIC_BRAND_ASSETS,
  BADGE_GENERIC_BRAND_PROVENANCE,
} from "../../assets/shared/badge-generic-template-assets";
import { BADGE_PQC_ARTWORK_ASSETS, BADGE_PQC_ARTWORK_PROVENANCE } from "../../assets/shared/badge-pqc-template-assets";
import { compileBadgeTemplate } from "../../assets/shared/badge-template-render";
import { splitBadgePrintSvg } from "../../assets/shared/badge-print-svg";
import { eventBadgeTemplateSchema } from "../../assets/shared/schemas/event-badge-template";
import { badgePrintingResponseSchema } from "../../assets/shared/schemas/route-contracts-event-badges";
import { badgeFaceHtml, badgePrintHtml } from "../../assets/ts/components/event-badges/badge-print-artifacts";
import { badgePrintPreset } from "../../assets/shared/badge-print-layout";
import { BADGE_FACE_CREDENTIAL, badgeFaceBadge } from "./helpers/badge-face-fixture";

const sponsorSvg = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 10"><rect width="40" height="10" fill="${fill}"/></svg>`;
const fonts = {
  roboto_latin: BADGE_GENERIC_BRAND_ASSETS.roboto_latin,
  roboto_latin_ext: BADGE_GENERIC_BRAND_ASSETS.roboto_latin_ext,
};
const template = createPqcConferenceBadgeTemplate({
  fonts,
  title: "Post-⁠Quantum Cryptography Conference",
  dates: "Dec 1–3, 2026",
  city: "Amsterdam",
  sponsorGroups: [...PQC_CONFERENCE_BADGE_SPONSOR_GROUPS, { source: "event", tierName: "Leader" }],
});
function printing() {
  return badgePrintingResponseSchema.parse({
    revision: "b".repeat(64),
    template,
    branding: [
      {
        ...template.sponsorGroups[0],
        sponsors: [{ id: "28a2c3d4-05f6-47ab-89cd-0123456789e1", name: "Lead Sponsor", svg: sponsorSvg("#111111") }],
      },
      {
        ...template.sponsorGroups[1],
        sponsors: [
          { id: "28a2c3d4-05f6-47ab-89cd-0123456789e2", name: "Second Sponsor A", svg: sponsorSvg("#222222") },
          { id: "28a2c3d4-05f6-47ab-89cd-0123456789e3", name: "Second Sponsor B", svg: sponsorSvg("#333333") },
        ],
      },
    ],
  });
}
/** Every image a print document can carry is SVG; no bitmap reaches paper. */
function expectVectorOnly(html: string) {
  expect(html).not.toMatch(/data:image\/(?!svg\+xml)/i);
  expect(html).not.toMatch(/<image\b/i);
  for (const match of html.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/g)) expect(match[1]).toMatch(/^data:image\/svg\+xml/);
}

describe("PQC conference badge preset", () => {
  it("is a valid, self-contained organizer template at A6 with editable sponsor tier mapping", () => {
    expect(eventBadgeTemplateSchema.parse(template)).toEqual(template);
    expect(template).toMatchObject({ widthMm: 105, heightMm: 148 });
    expect(template.sponsorGroups).toEqual([
      { key: "consortium-1", source: "consortium", tierName: "Diamond", label: "Diamond sponsor" },
      { key: "consortium-2", source: "consortium", tierName: "Titanium", label: "Titanium sponsors" },
      { key: "event-3", source: "event", tierName: "Leader", label: "Leader sponsors" },
    ]);
    const defaults = createPqcConferenceBadgeTemplate({ title: "PQC", dates: "", city: "", fonts });
    expect(defaults.sponsorGroups.map(({ source, tierName }) => [source, tierName])).toEqual([
      ["consortium", "Diamond"],
      ["consortium", "Titanium"],
    ]);
    expect(defaults.frontHtml).toContain("{{sponsors:consortium-1}}");
    expect(defaults.frontHtml).not.toContain("{{sponsors:consortium-2}}");
    expect(defaults.backHtml).toContain("{{sponsors:consortium-2}}");
    expect(Object.values(template.assets).filter((asset) => asset.mime.startsWith("image/"))).toHaveLength(5);
    expect(Object.values(template.assets).every((asset) => /^(image\/svg\+xml|font\/woff2)$/.test(asset.mime))).toBe(
      true,
    );
    expect(template.css).not.toMatch(/url\((?!["']?asset:)/);
  });

  it("prints the designed front: field header art, attendee, QR with code, lead sponsors and role band", async () => {
    const badge = await badgeFaceBadge();
    const face = badgeFaceHtml(badge, printing());
    expect(face).toMatchObject({ widthMm: 105, heightMm: 148 });
    expect(face.html).toContain("@page{size:105mm 148mm;margin:0}");
    expect(face.html).toContain('class="badge-template-qr"');
    expect(face.html).toContain('<span class="pqc-code">ABCD-EFGH-JKLM-NPQR</span>');
    const qrImage = /<img class="badge-template-qr"[^>]*src="([^"]+)"/.exec(face.html)![1];
    expect(decodeURIComponent(qrImage)).not.toContain("Badge code");
    expect(decodeURIComponent(qrImage)).toContain(splitBadgePrintSvg(badge.svg)!.qr);
    expect(BADGE_FACE_CREDENTIAL).toHaveLength(16);
    for (const visual of ["pqc-dots", "pqc-mark", "pqc-canal-tile", "pqc-logo"])
      expect(face.html).toMatch(new RegExp(`<svg class="${visual}" role="img"[^>]*><use href="#badge-vector-\\d+">`));
    expect(face.html.match(/class="pqc-canal-tile"/g)).toHaveLength(4);
    expect(face.html).toContain("Post-⁠Quantum Cryptography Conference");
    expect(face.html).toContain('<p class="pqc-first">Femke</p><p class="pqc-last">de Vries</p>');
    expect(face.html).toContain("Ministry of the Interior");
    expect(face.html).toContain('<span class="badge-template-sponsor-tier">Diamond sponsor</span>');
    expect(face.html).toContain('aria-label="Lead Sponsor"');
    expect(face.html).not.toContain('aria-label="Second Sponsor A"');
    expect(face.html).toContain('<div class="pqc-role">SPEAKER</div>');
    expect(face.html).toContain("--badge-role-color:#ed7d31");
    expectVectorOnly(face.html);
  });

  it("prints the designed back with both sponsor tiers, links and the ink footer", async () => {
    const badge = await badgeFaceBadge();
    const back = badgeFaceHtml(badge, printing(), "back").html;
    expect(back).toContain('<p class="pqc-back-name">Femke de Vries</p>');
    expect(back).toContain('<span class="pqc-key">ID</span><span class="pqc-value pqc-id">ABCD-EFGH-JKLM-NPQR</span>');
    expect(back).toContain("pkic.org/pqcc");
    expect(back).toContain("Q&amp;A");
    expect(back).toContain('<span class="badge-template-sponsor-tier">Titanium sponsors</span>');
    expect(back).toContain('aria-label="Lead Sponsor"');
    expect(back).toContain('<div class="pqc-back-tier"></div>');
    expect(back).not.toContain("Leader sponsors");
    expect(back).toContain('aria-label="Second Sponsor B"');
    expect(back.match(/class="pqc-back-canal-tile"/g)).toHaveLength(11);
    expect(back).not.toContain('class="pqc-role"');
    expectVectorOnly(back);
    const sheet = badgePrintHtml([badge], badgePrintPreset("a6"), printing(), "event_badge");
    expect(sheet).toContain("@page{size:105mm 148mm;margin:0}");
    expect(sheet.match(/aria-label="Badge (front|back)"/g)).toEqual([
      'aria-label="Badge front"',
      'aria-label="Badge back"',
    ]);
  });

  it("falls back to the display name when no first name is known and omits empty sponsor tiers", () => {
    const compiled = compileBadgeTemplate(template, []);
    const front = compiled.renderSide("front", { displayName: "Dr. Example", badgeRole: "attendee", svg: "<svg/>" });
    expect(front).toContain('<p class="pqc-first"></p><p class="pqc-last"></p><p class="pqc-display">Dr. Example</p>');
    expect(compiled.css).toContain(".pqc-first:empty~.pqc-display{display:block}");
    expect(front).toContain('<div class="pqc-front-sponsors"></div>');
    expect(compiled.css).toContain(".pqc-front-sponsors:empty");
    const bare = createPqcConferenceBadgeTemplate({ title: "PQC", dates: "", city: "", sponsorGroups: [], fonts });
    expect(bare.sponsorGroups).toEqual([]);
    expect(bare.frontHtml).not.toContain("{{sponsors:");
    expect(bare.frontHtml).not.toContain("pqc-dates");
  });

  it("splits the canonical QR composition into the untouched square QR and its manual code", async () => {
    const badge = await badgeFaceBadge();
    const split = splitBadgePrintSvg(badge.svg)!;
    expect(split.code).toBe("ABCD-EFGH-JKLM-NPQR");
    const viewBox = /viewBox="([^"]+)"/.exec(split.qr)![1].split(" ").map(Number);
    expect(viewBox[2]).toBe(viewBox[3]);
    const modules = (svg: string) => /<path[^>]*stroke="#000000"[^>]*d="([^"]+)"/.exec(svg)?.[1];
    expect(modules(split.qr)).toBeTruthy();
    expect(modules(split.qr)).toBe(modules(badge.svg));
    expect(split.qr).not.toContain("<text");
    expect(splitBadgePrintSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>')).toBeNull();
    const preview = compileBadgeTemplate(template).renderSide("front", {
      displayName: "Preview",
      badgeRole: "attendee",
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    });
    expect(preview).toContain('<span class="pqc-code"></span>');
  });

  it("prints the job title under the name on both sides and collapses it when unknown", async () => {
    const badge = { ...(await badgeFaceBadge()), jobTitle: "Cryptography Policy Advisor" };
    const front = badgeFaceHtml(badge, printing()).html;
    expect(front).toContain(
      '<p class="pqc-job">Cryptography Policy Advisor</p><p class="pqc-org">Ministry of the Interior</p>',
    );
    expect(front).toContain('<div class="pqc-qr-column"><div class="pqc-qr"><img class="badge-template-qr"');
    expect(front).toMatch(/<\/div><span class="pqc-code">ABCD-EFGH-JKLM-NPQR<\/span><\/div>/);
    const back = badgeFaceHtml(badge, printing(), "back").html;
    expect(back).toContain(
      '<p class="pqc-back-meta"><strong class="pqc-back-job">Cryptography Policy Advisor</strong><span class="pqc-back-org">Ministry of the Interior</span></p>',
    );
    expect(back).toContain('.pqc-back-org::before{content:" · "}');
    const untitled = badgeFaceHtml({ ...badge, jobTitle: null }, printing());
    expect(untitled.html).toContain('<p class="pqc-job"></p>');
    expect(untitled.html).toContain(".pqc-job:empty{display:none}");
    expect(badgeFaceHtml({ ...badge, jobTitle: "<b>Lead</b>" }, printing()).html).toContain(
      '<p class="pqc-job">&lt;b&gt;Lead&lt;/b&gt;</p>',
    );
  });

  it("never breaks attendee names or organizations inside a word on either side", () => {
    const compiled = compileBadgeTemplate(template, []);
    const long = {
      jobTitle: "Principal Post-Quantum Cryptography Migration Programme Architect",
      displayName: "Maximiliana Wolfeschlegelsteinhausen",
      firstName: "Maximiliana",
      lastName: "Wolfeschlegelsteinhausen",
      organization: "Ministerie van Binnenlandse Zaken en Koninkrijksrelaties",
      badgeRole: "attendee" as const,
      svg: "<svg/>",
    };
    const front = compiled.renderSide("front", long);
    expect(front).toContain("--badge-last-name-longest:24;");
    expect(front).toContain("--badge-organization-longest:19;");
    expect(front).toContain("--badge-job-title-longest:12;--badge-job-title-length:65");
    expect(compiled.renderSide("back", { ...long, displayName: "Paul van Brouwershaven" })).toContain(
      "--badge-display-name-longest:13;--badge-display-name-length:22",
    );
    const textRules = compiled.css.match(
      /\.pqc-(?:names|first|last|display|job|org|back-person|back-name|back-meta|back-job|back-org)\b[^{]*\{[^}]*\}/g,
    )!;
    expect(textRules.length).toBeGreaterThanOrEqual(6);
    expect(textRules.filter((rule) => rule.includes("anywhere"))).toEqual([]);
    for (const selector of [".pqc-names p{", ".pqc-back-person p{"])
      expect(compiled.css).toContain(`${selector}overflow-wrap:normal;word-break:normal;hyphens:manual}`);
    for (const field of ["first-name", "last-name", "display-name", "organization", "job-title"])
      expect(compiled.css).toContain(`var(--badge-${field}-longest,1)`);
  });

  it("draws a group only from sponsors of its own source", () => {
    const crossed = badgePrintingResponseSchema.parse({
      revision: "c".repeat(64),
      template,
      branding: [
        {
          ...template.sponsorGroups[0],
          source: "event",
          sponsors: [{ id: "28a2c3d4-05f6-47ab-89cd-0123456789e4", name: "Event Diamond", svg: sponsorSvg("#444444") }],
        },
      ],
    });
    const front = compileBadgeTemplate(crossed.template!, crossed.branding).renderSide("front", {
      displayName: "X",
      badgeRole: "attendee",
      svg: "<svg/>",
    });
    expect(front).not.toContain("Event Diamond");
  });

  it("escapes organizer text and refuses slot syntax in printed lines", () => {
    const escaped = createPqcConferenceBadgeTemplate({
      fonts,
      title: "A <b> & {{qr}}",
      dates: "",
      city: "",
      sponsorGroups: [],
    });
    expect(escaped.frontHtml.match(/{{qr(?:Image)?}}/g)).toHaveLength(1);
    expect(
      compileBadgeTemplate(escaped).renderSide("front", { displayName: "X", badgeRole: "staff", svg: "<svg/>" }),
    ).toContain("A &lt;b&gt; &amp; <span>{</span>");
  });

  it("embeds the site's own canonical Roboto files, which callers load from their public URLs", () => {
    for (const key of ["roboto_latin", "roboto_latin_ext"] as const)
      expect(`static${PQC_CONFERENCE_BADGE_FONT_URLS[key]}`).toBe(BADGE_GENERIC_BRAND_PROVENANCE[key].path);
    expect(template.css).toContain('url("asset:roboto_latin")');
    expect(() =>
      createPqcConferenceBadgeTemplate({
        title: "PQC",
        dates: "",
        city: "",
        sponsorGroups: [],
        fonts: { ...fonts, roboto_latin: { mime: "font/ttf", base64: fonts.roboto_latin.base64 } },
      }),
    ).toThrow();
  });

  it("snapshots canonical public artwork and requires regeneration when it changes", () => {
    for (const source of Object.values(BADGE_PQC_ARTWORK_PROVENANCE)) {
      const bytes = readFileSync(resolve(process.cwd(), source.path));
      expect(createHash("sha256").update(bytes).digest("hex"), source.path).toBe(source.sha256);
    }
    const paths = (svg: string) => [...svg.matchAll(/\bd="([^"]+)"/g)].map((match) => match[1]);
    for (const key of Object.keys(BADGE_PQC_ARTWORK_ASSETS) as (keyof typeof BADGE_PQC_ARTWORK_ASSETS)[]) {
      const original = readFileSync(resolve(process.cwd(), BADGE_PQC_ARTWORK_PROVENANCE[key].path), "utf8");
      const snapshot = Buffer.from(BADGE_PQC_ARTWORK_ASSETS[key].base64, "base64").toString("utf8");
      expect(paths(snapshot)).toEqual(paths(original));
      expect(snapshot).not.toMatch(/<style|\bclass=|\bstyle=/);
    }
  });
});
