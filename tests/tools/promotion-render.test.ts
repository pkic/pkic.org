import sharp from "sharp";
import jsQR from "jsqr";
import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFString } from "pdf-lib";
import {
  renderPromotionPdf,
  renderPromotionSvg,
  promotionLines,
  promotionCardPages,
  promotionMeasuredLines,
  promotionPdfBodyPages,
} from "../../functions/_lib/services/event-agenda/promotion-render";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { sessionHistoryMetadataSchema } from "../../assets/shared/schemas/event-session-history";
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
  it("keeps a fitting panel credit together when the preceding credit fills the page", async () => {
    const document = await PDFDocument.create();
    document.registerFontkit((await import("@pdf-lib/fontkit")).default);
    const font = await document.embedFont(readFileSync("static/fonts/Roboto-Regular.ttf"));
    const credits = [
      [
        "Alexandra Catherine van Example-Rivera, certificate lifecycle and migration engineering",
        "Certificate lifecycle engineering director",
        "Synthetic Infrastructure Research Consortium and Independent Certificate Operations Laboratory 92d610f9-65af-4f22-95fd-1e2ce59b9b49",
      ],
      [
        "Benjamin Christopher Example-MacKenzie, cryptographic governance and assurance research",
        "Cryptographic governance research lead",
        "Synthetic Cryptographic Policy Institute and Cross-Organization Migration Working Group 35f0f138-7516-46dc-81cb-0bf728f7e9aa",
      ],
    ];
    const blocks = credits.map((credit) =>
      credit.flatMap((text) => promotionMeasuredLines(text, 468, (line) => font.widthOfTextAtSize(line, 17))),
    );
    expect(blocks.map((block) => block.length)).toEqual([6, 6]);
    const pages = promotionPdfBodyPages(blocks, 12, 11);
    expect(pages).toEqual(blocks);
    for (const [index, credit] of credits.entries()) {
      const text = pages[index]!.join(" ");
      for (const field of credit) expect(text).toContain(field);
    }
  });

  it("continues an oversized credit without losing lines or interleaving the next person", () => {
    const oversized = Array.from({ length: 29 }, (_, index) => `Long affiliation line ${index}`);
    const following = ["Next person", "Research director", "Independent organization"];
    const pages = promotionPdfBodyPages([oversized, following], 12, 11);
    expect(pages.map((page) => page.length)).toEqual([12, 11, 10]);
    expect(pages.flat().filter(Boolean)).toEqual([...oversized, ...following]);
    expect(pages.at(-1)!.slice(-3)).toEqual(following);
  });

  it("moves a fitting credit past a taller first-page heading", () => {
    const credit = ["Person", "Role", "Organization", "Complete affiliation"];
    expect(promotionPdfBodyPages([credit], 2, 4)).toEqual([[], credit]);
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
    expect(roles.filter((role) => role === "H2")).toHaveLength(3);
    expect(roles.filter((role) => role === "LI")).toHaveLength(data.copy.takeaways.length);
    expect(roles).toContain("LBody");
    expect(figures).toEqual([`QR code: register for this event at ${data.registrationUrl}`]);
    expect(roles.at(-1)).toBe("Link");
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

  it("embeds bundled CJK and emoji fallback glyphs into selectable PDF text", async () => {
    const bytes = await renderPromotionPdf(
      { ...data, occurrence: { ...data.occurrence, title: "密码基础设施 🔐" } },
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
      [readFileSync("static/fonts/NotoSansSC-Regular.ttf"), readFileSync("static/fonts/NotoEmoji-Regular.ttf")],
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getTitle()).toContain("密码基础设施 🔐");
    expect(bytes.length).toBeLessThan(16_000_000);
    if (process.env.PKIC_PROMOTION_REVIEW_CJK_PDF) writeFileSync(process.env.PKIC_PROMOTION_REVIEW_CJK_PDF, bytes);
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
      expect(decoded?.data).toBe(data.registrationUrl);
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
    expect(promotionLines("one two three four", 7)).toEqual(["one two", "three", "four"]);
  });
  it("flows every long title and panel credit across complete cards", async () => {
    const appearances = Array.from({ length: 30 }, (_, index) => ({
      userId: `speaker-${index}`,
      actingIdentityId: null,
      displayName: `Speaker ${index} ${"Complete name ".repeat(12)}`,
      organizationName: "Organization ".repeat(15),
      jobTitle: "Research director",
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
    expect(document.getPageCount()).toBe(4);
    expect(bytes.byteLength).toBeLessThan(100 * 1024 * 1024);
    expect(document.getTitle()).toContain("Building trustworthy");
    expect(document.getPages()[3]!.node.get(PDFName.of("Annots"))).toBeDefined();
    if (process.env.PKIC_PROMOTION_REVIEW_PDF) writeFileSync(process.env.PKIC_PROMOTION_REVIEW_PDF, bytes);
  });
});
