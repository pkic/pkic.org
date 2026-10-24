import sharp from "sharp";
import jsQR from "jsqr";
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString } from "pdf-lib";
import {
  hasUnsupportedPromotionScript,
  buildPromotionPages,
  renderPromotionPdf,
  renderPromotionSvg,
  promotionCardPages,
  promotionMeasuredLines,
} from "../../functions/_lib/services/event-agenda/promotion-render";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema } from "../../assets/shared/schemas/event-session-history";
import {
  defaultPromotionComposition,
  eventPromotionDesignSchema,
} from "../../assets/shared/schemas/event-promotion-design";
const agenda = agendaSnapshotSchema.parse({
  eventSlug: "event",
  eventName: "PKI Consortium Conference",
  timeZone: "Europe/Amsterdam",
  revision: 2,
  publishedRevision: 2,
  rooms: [],
  shifts: [],
  assignments: [],
  roleMembers: [],
  occurrences: [
    {
      id: "session",
      title: "Building trustworthy cryptographic systems across organizations",
      description: "Practical cryptographic system design for engineers and policy teams.",
      startAt: "2026-12-01T08:00:00.000Z",
      endAt: "2026-12-01T09:00:00.000Z",
      roomId: null,
      speakers: [{ userId: "synthetic-speaker", displayName: "Example Speaker" }],
    },
  ],
});
const data = {
  agenda,
  occurrence: agenda.occurrences[0]!,
  copy: {
    whyAttend:
      "Explore practical cryptographic design choices and the operational tradeoffs behind reliable deployment.",
    takeaways: ["Evaluate certificate lifecycle boundaries", "Choose observable deployment controls"],
    callToAction: "Join this session",
    campaign: "speaker-kit",
    approvedAt: "2026-10-03T00:00:00.000Z",
  },
  registrationUrl: "https://pkic.org/events/event/register/?ref=synthetic",
  sessionUrl: "https://pkic.org/events/event/sessions/session/",
};
describe("promotion exports", () => {
  it("uses variable panels, abstract content, event artwork, and lower-tier-only sponsors", () => {
    const composition = {
      ...defaultPromotionComposition(),
      panels: ["content", "sponsors"] as const,
      content: "abstract" as const,
    };
    const sample = {
      ...data,
      composition: { ...composition, panels: [...composition.panels] },
      sponsors: [
        {
          tierName: "Community supporters",
          sponsors: [{ id: "example", name: "Synthetic supporter", base64: "PHN2Zy8+" }],
        },
      ],
    };
    const pages = buildPromotionPages(sample, "carousel");
    expect(pages).toHaveLength(2);
    expect(pages[0]!.texts.map((item) => item.text).join(" ")).toContain(data.occurrence.description);
    expect(pages[1]!.pictures.map((item) => item.alt)).toEqual(["Synthetic supporter"]);
    const noSponsors = buildPromotionPages({ ...sample, sponsors: [] }, "carousel");
    expect(noSponsors).toHaveLength(1);
    const svg = renderPromotionSvg(
      {
        ...data,
        composition: { ...defaultPromotionComposition(), motif: false },
        design: {
          version: 1,
          name: "Toronto",
          colors: ["#123456", "#654321"],
          assets: {},
          sponsorGroups: [],
          sponsorSource: "event",
          panels: ["cover"],
          advertiseLiveStreaming: false,
        },
      },
      "portrait",
    );
    expect(svg).toContain("#123456");
    expect(svg).not.toContain("canal");
    expect(svg).not.toContain("recorded");
    expect(
      eventPromotionDesignSchema.safeParse({
        version: 1,
        name: "Unsafe",
        colors: ["#123456", "#654321"],
        assets: {
          motif: {
            mime: "image/svg+xml",
            base64: btoa('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
          },
        },
        sponsorGroups: [],
        panels: ["cover"],
      }).success,
    ).toBe(false);
  });
  it("provides ordered headings, list items, QR alternate text and linked annotations", async () => {
    const bytes = await renderPromotionPdf(
      data,
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    const pdf = await PDFDocument.load(bytes);
    const root = pdf.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
    const roles: string[] = [];
    const figures: string[] = [];
    function walk(node: PDFDict) {
      const role = node.get(PDFName.of("S"));
      if (role instanceof PDFName) roles.push(role.decodeText());
      if (role?.toString() === "/Figure") figures.push(node.lookup(PDFName.of("Alt"), PDFString).decodeText());
      const children = node.get(PDFName.of("K"));
      if (children instanceof PDFArray)
        for (const child of children.asArray()) {
          const value = pdf.context.lookup(child);
          if (value instanceof PDFDict) walk(value);
        }
    }
    walk(root);
    expect(roles[0]).toBe("Document");
    expect(roles.filter((role) => role === "H1")).toHaveLength(1);
    expect(roles.filter((role) => role === "H2").length).toBeGreaterThan(0);
    expect(roles.filter((role) => role === "LI")).toHaveLength(data.copy.takeaways.length);
    expect(roles).toContain("LBody");
    expect(figures).toHaveLength(pdf.getPageCount());
    expect(new Set(figures)).toEqual(new Set([`QR code: register for this event at ${data.registrationUrl}`]));
    expect(roles).toContain("Link");
    const nums = root.lookup(PDFName.of("ParentTree"), PDFDict).lookup(PDFName.of("Nums"), PDFArray);
    for (const page of pdf.getPages()) {
      const key = page.node.lookup(PDFName.of("StructParents"), PDFNumber).asNumber();
      expect(nums.asArray().some((value) => value instanceof PDFNumber && value.asNumber() === key)).toBe(true);
    }
    const last = pdf.getPages().at(-1)!;
    const annotation = last.node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    expect(annotation.lookup(PDFName.of("StructParent"), PDFNumber).asNumber()).toBeGreaterThanOrEqual(
      pdf.getPageCount(),
    );
    expect(annotation.lookup(PDFName.of("A"), PDFDict).lookup(PDFName.of("URI"), PDFString).decodeText()).toBe(
      data.registrationUrl,
    );
  });

  it("embeds the bundled emoji fallback glyphs into selectable PDF text", async () => {
    const bytes = await renderPromotionPdf(
      { ...data, occurrence: { ...data.occurrence, title: "Public key infrastructure 🔐" } },
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
      [readFileSync("static/fonts/NotoEmoji-Regular.ttf")],
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toContain("Public key infrastructure 🔐");
    if (process.env.PKIC_PROMOTION_REVIEW_CJK_PDF) writeFileSync(process.env.PKIC_PROMOTION_REVIEW_CJK_PDF, bytes);
  });

  it("asks for the English spelling instead of rendering Chinese, Japanese or Korean script", () => {
    expect(hasUnsupportedPromotionScript("密码基础设施")).toBe(true);
    expect(hasUnsupportedPromotionScript("キー")).toBe(true);
    expect(hasUnsupportedPromotionScript("Zoë Müller — Post-quantum 🔐")).toBe(false);
  });

  it("escapes speaker titles and includes a decodable matrix destination in every card aspect", async () => {
    for (const format of ["landscape", "square", "portrait", "panel"] as const) {
      const svg = renderPromotionSvg(
        { ...data, occurrence: { ...data.occurrence, title: "A <script> title & question" } },
        format,
      );
      expect(svg).toContain("&lt;script&gt;");
      expect(svg).not.toContain("<script>");
      expect(svg).toContain("<g fill=");
      const raster = await sharp(new TextEncoder().encode(svg))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const decoded = jsQR(new Uint8ClampedArray(raster.data), raster.info.width, raster.info.height);
      if (process.env.PKIC_PROMOTION_REVIEW_PDF)
        await sharp(new TextEncoder().encode(svg))
          .png()
          .toFile(process.env.PKIC_PROMOTION_REVIEW_PDF.replace(/\.pdf$/u, `-debug-${format}.png`));
      expect(decoded?.data, format).toBe(data.registrationUrl);
      if (process.env.PKIC_PROMOTION_REVIEW_PDF) {
        const logoDataUrl = `data:image/svg+xml;base64,${readFileSync("static/img/logo.svg").toString("base64")}`;
        const preview = renderPromotionSvg(promotionCardPages({ ...data, logoDataUrl }, format)[0]!, format);
        await sharp(new TextEncoder().encode(preview))
          .png()
          .toFile(process.env.PKIC_PROMOTION_REVIEW_PDF.replace(/\.pdf$/u, `-${format}.png`));
      }
    }
    const font = await PDFDocument.create().then(async (document) => {
      document.registerFontkit((await import("@pdf-lib/fontkit")).default);
      return document.embedFont(readFileSync("static/fonts/Roboto-Bold.ttf"));
    });
    const wide = promotionMeasuredLines("W".repeat(300), 468, (text) => font.widthOfTextAtSize(text, 27));
    expect(wide.every((line) => font.widthOfTextAtSize(line, 27) <= 468)).toBe(true);
    expect(wide.join("")).toBe("W".repeat(300));
    expect(promotionMeasuredLines("one two three four", 7, (text) => text.length)).toEqual([
      "one two",
      "three",
      "four",
    ]);
  });
  it("flows every long title and panel credit across complete cards", async () => {
    const appearances = Array.from({ length: 30 }, (_, index) => ({
      userId: `speaker-${index}`,
      affiliations: [
        {
          identityId: null,
          title: "Research director",
          organizationId: null,
          organizationName: "Organization ".repeat(15),
        },
      ],
      displayName: `Speaker ${index} ${"Complete name ".repeat(12)}`,
      biography: "",
      photoUrl: null,
      approvedAt: "2026-10-03T00:00:00.000Z",
    }));
    const extended = {
      ...data,
      occurrence: {
        ...data.occurrence,
        title: "Long title ".repeat(25),
        history: sessionHistoryMetadataSchema.parse({
          prerequisites: "",
          legacyPaths: [],
          sessionSlug: null,
          archivalTiming: null,
          sourceDecisions: [],
          proposalRepresentations: [],
          appearances,
          archivalCredits: [],
          materials: [],
        }),
      },
    };
    const pages = promotionCardPages(extended, "panel");
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.flatMap((page) => page.cardLines?.map((line) => line.text) ?? []).join(" ");
    for (let index = 0; index < 30; index++) expect(text).toContain(`Speaker ${index}`);
    for (const page of pages) expect(renderPromotionSvg(page, "panel")).toContain("<svg");
    const pdf = await renderPromotionPdf(
      extended,
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    expect((await PDFDocument.load(pdf)).getPageCount()).toBeGreaterThan(4);
  });
  it("produces a multi-page document with embedded font, semantic text and registration annotation", async () => {
    const font = readFileSync("static/fonts/Roboto-Regular.ttf");
    const bold = readFileSync("static/fonts/Roboto-Bold.ttf");
    const logoPng = await sharp(readFileSync("static/img/logo.svg")).resize({ width: 500 }).png().toBuffer();
    const bytes = await renderPromotionPdf({ ...data, logoPng }, font, bold);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThanOrEqual(5);
    expect(bytes.byteLength).toBeLessThan(100 * 1024 * 1024);
    expect(document.getTitle()).toContain("Building trustworthy");
    expect(document.getPages()[3]!.node.get(PDFName.of("Annots"))).toBeDefined();
    if (process.env.PKIC_PROMOTION_REVIEW_PDF) writeFileSync(process.env.PKIC_PROMOTION_REVIEW_PDF, bytes);
  });
});
