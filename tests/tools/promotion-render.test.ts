import sharp from "sharp";
import { agendaOccurrenceMedia } from "../../assets/shared/event-agenda-media";
import { promotionMediaWording } from "../../assets/shared/promotion-media";
import { promotionSceneSvg } from "../../functions/_lib/services/event-agenda/promotion-svg";
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
  it("inherits location media but honors session overrides without promising unavailable recordings", () => {
    const rooms = [{ id: "main", equipment: ["live_streaming", "recording"] }];
    const inherited = agendaOccurrenceMedia(rooms, { roomId: "main" });
    const design = { advertiseLiveStreaming: true, advertiseRecordings: true };
    expect(promotionMediaWording(design, inherited)).toBe("In person and online · Recording planned");
    expect(promotionMediaWording(design, inherited, "https://example.test/recording")).toContain(
      "On-demand recording available",
    );
    const overridden = agendaOccurrenceMedia(rooms, {
      roomId: "main",
      plannedMedia: { recording: false, liveStreaming: false },
    });
    expect(overridden.inherited).toBe(false);
    expect(promotionMediaWording(design, overridden, "https://example.test/recording")).toBeUndefined();
    expect(
      promotionMediaWording({ advertiseLiveStreaming: false, advertiseRecordings: false }, inherited),
    ).toBeUndefined();
  });
  it("separates every line of the cover eyebrow from the session title", () => {
    for (const eventName of ["PQC Conference", "Post-Quantum Cryptography Conference ".repeat(4)]) {
      const page = buildPromotionPages({ ...data, agenda: { ...data.agenda, eventName } }, "carousel")[0]!;
      const title = page.texts.find((text) => text.role === "H1")!;
      const eyebrow = page.texts.filter((text) => text.role === "H2");
      expect(title.y - title.size - Math.max(...eyebrow.map((text) => text.y))).toBeGreaterThanOrEqual(24);
    }
  });
  it("fades the event grid smoothly to transparency before the footer", async () => {
    const sample = {
      ...data,
      composition: { ...defaultPromotionComposition(), panels: ["cover"] as "cover"[] },
      design: eventPromotionDesignSchema.parse({
        version: 1,
        name: "Sample",
        colors: ["#123456", "#654321"],
        panels: ["cover"],
        assets: {
          texture: {
            mime: "image/svg+xml",
            base64: Buffer.from(
              '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="white"/></svg>',
            ).toString("base64"),
          },
        },
      }),
    };
    const page = buildPromotionPages(sample, "carousel")[0]!;
    const raster = async (value: typeof sample) =>
      await sharp(Buffer.from(promotionSceneSvg(value, page, false)))
        .removeAlpha()
        .raw()
        .toBuffer();
    const textured = await raster(sample),
      plain = await raster({ ...sample, design: { ...sample.design, assets: {} } });
    const difference = (y: number) => {
      const pixel = (y * page.width + 10) * 3;
      return Math.abs(textured[pixel]! - plain[pixel]!);
    };
    expect(difference(50)).toBeGreaterThan(difference(600));
    expect(difference(600)).toBeGreaterThan(difference(1050));
    expect(difference(1050)).toBe(0);
  });
  it("uses the numbered takeaway rail and labeled details grid without losing long copy", () => {
    const items = Array.from(
      { length: 8 },
      (_, index) => `Takeaway ${index + 1}: ${"Complete migration guidance ".repeat(5)}`,
    );
    const pages = buildPromotionPages(
      {
        ...data,
        composition: { ...defaultPromotionComposition(), panels: ["content", "details"], takeaways: items },
        occurrence: { ...data.occurrence, format: "Workshop" },
      },
      "carousel",
    );
    const content = pages.filter((page) => page.title === "Key takeaways");
    expect(content.length).toBeGreaterThan(1);
    const text = content
      .flatMap((page) => page.texts.filter((value) => value.role === "LI").map((value) => value.text))
      .join(" ");
    for (const item of items) expect(text).toContain(item.trim());
    expect(content.flatMap((page) => page.bars ?? [])).toHaveLength(8);
    const details = pages.find((page) => page.title === "When & where")!;
    const day = details.texts.find((value) => value.text === "DAY")!,
      time = details.texts.find((value) => value.text === "TIME")!;
    expect(day.y).toBe(time.y);
    expect(time.x).toBeGreaterThan(day.x);
    expect(details.texts.some((value) => value.text === "Workshop")).toBe(true);
    expect(details.texts.some((value) => /livestream|recording/i.test(value.text))).toBe(false);
  });
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
    expect(pages.every((page) => !page.qr)).toBe(true);
    expect(renderPromotionSvg(sample, "portrait")).not.toContain('<g fill="#0b0d0c">');
    expect(pages[0]!.sponsorBoard).toMatchObject({ x: 990, width: 1170 });
    expect(pages[1]!.sponsorBoard).toMatchObject({ x: -90, width: 1170 });
    const bold = buildPromotionPages(
      { ...sample, composition: { ...sample.composition, overlap: "bold" } },
      "carousel",
    );
    expect(bold[0]!.sponsorBoard?.x).toBe(860);
    expect(bold[1]!.sponsorBoard?.x).toBe(-220);
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
          advertiseRecordings: false,
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
  it("keeps dynamic sponsor logos inside padded, optically balanced cells across continuation pages", () => {
    const sponsors = [1, 4, 60].map((count, tier) => ({
      tierName: `Tier ${tier + 1}`,
      sponsors: Array.from({ length: count }, (_, index) => ({
        id: `${tier}-${index}`,
        name: `Sponsor ${tier}-${index}`,
        base64: "PHN2Zy8+",
        aspectRatio: index % 2 ? 7 : 1,
      })),
    }));
    for (const qrCode of [false, true]) {
      for (const format of ["landscape", "panel", "square", "portrait", "carousel"] as const) {
        const pages = buildPromotionPages(
          {
            ...data,
            composition: { ...defaultPromotionComposition(), panels: ["register", "sponsors"], qrCode },
            sponsors,
          },
          format,
        );
        const boards = pages.filter((page) => page.light);
        expect(boards.length).toBeGreaterThan(1);
        expect(boards.flatMap((page) => page.pictures)).toHaveLength(65);
        for (const page of boards) {
          if (page.height < 800)
            expect(page.sponsorBoard!.y + page.sponsorBoard!.height).toBeLessThanOrEqual(
              page.height - (qrCode ? 180 : 130),
            );
          for (const text of page.texts) {
            expect(text.y - text.size).toBeGreaterThanOrEqual(page.sponsorBoard!.y);
            expect(text.y).toBeLessThan(page.sponsorBoard!.y + page.sponsorBoard!.height);
          }
          for (const picture of page.pictures) {
            expect(picture.x).toBeGreaterThanOrEqual(124 * (page.width / 1080));
            expect(picture.x + picture.width).toBeLessThanOrEqual(956 * (page.width / 1080));
            expect(picture.y).toBeGreaterThanOrEqual(page.sponsorBoard!.y);
            expect(picture.y + picture.height).toBeLessThanOrEqual(page.sponsorBoard!.y + page.sponsorBoard!.height);
            for (const other of page.pictures) {
              if (picture === other) continue;
              const separated =
                picture.x + picture.width + 39 * (page.width / 1080) <= other.x ||
                other.x + other.width + 39 * (page.width / 1080) <= picture.x ||
                picture.y + picture.height <= other.y ||
                other.y + other.height <= picture.y;
              expect(separated).toBe(true);
            }
          }
        }
      }
    }
  });
  it("provides ordered headings, list items, QR alternate text and linked annotations", async () => {
    const takeaways = Array.from(
      { length: 8 },
      (_, index) => `${index + 1}. ${"Explain migration controls and deployment evidence. ".repeat(3)}`,
    );
    const bytes = await renderPromotionPdf(
      { ...data, composition: { ...defaultPromotionComposition(), qrCode: true, takeaways } },
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    const pdf = await PDFDocument.load(bytes);
    const root = pdf.catalog.lookup(PDFName.of("StructTreeRoot"), PDFDict);
    const roles: string[] = [];
    const figures: string[] = [];
    const order = new Map<string, number[]>();
    function walk(node: PDFDict) {
      const role = node.get(PDFName.of("S"));
      if (role instanceof PDFName) roles.push(role.decodeText());
      if (role?.toString() === "/Figure") figures.push(node.lookup(PDFName.of("Alt"), PDFString).decodeText());
      const children = node.get(PDFName.of("K"));
      if (children instanceof PDFArray)
        for (const child of children.asArray()) {
          const value = pdf.context.lookup(child);
          if (value instanceof PDFDict) {
            if (value.get(PDFName.of("Type"))?.toString() === "/MCR") {
              const page = value.get(PDFName.of("Pg"))!.toString();
              const ids = order.get(page) ?? [];
              ids.push(value.lookup(PDFName.of("MCID"), PDFNumber).asNumber());
              order.set(page, ids);
            } else walk(value);
          }
        }
    }
    walk(root);
    for (const ids of order.values()) expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => index));
    expect(roles[0]).toBe("Document");
    expect(roles.filter((role) => role === "H1")).toHaveLength(1);
    expect(roles.filter((role) => role === "H2").length).toBeGreaterThan(0);
    expect(roles.filter((role) => role === "LI")).toHaveLength(takeaways.length);
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
        {
          ...data,
          composition: { ...defaultPromotionComposition(), qrCode: true },
          occurrence: { ...data.occurrence, title: "A <script> title & question" },
        },
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
