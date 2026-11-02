import { promotionFontMeasure } from "../../functions/_lib/services/event-agenda/promotion-text";
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
  it("keeps wrapped speaker credits together beside the portrait and clears the following summary", () => {
    const person = {
      userId: "credit",
      displayName: "Example Speaker With A Long Name",
      affiliation: "Research director · Institute for Applied Cryptography and Digital Infrastructure",
      photoUrl: null,
      role: "speaker",
    };
    for (const format of ["landscape", "square", "portrait"] as const) {
      const pages = buildPromotionPages(
        {
          ...data,
          people: [person],
          portraits: { credit: "data:image/png;base64,portrait" },
        },
        format,
      );
      const page = pages.find((candidate) => candidate.pictures.some((picture) => picture.alt === person.displayName))!;
      const portrait = page.pictures.find((picture) => picture.alt === person.displayName)!;
      const name = page.texts.find((text) => text.text.startsWith("Example Speaker"))!;
      const credit = page.texts.filter((text) => text.group === name.group);
      const names = credit.filter((text) => text.bold);
      const affiliations = credit.filter((text) => !text.bold);
      expect(affiliations.length).toBeGreaterThan(0);
      const lastName = names.at(-1)!;
      const firstAffiliation = affiliations[0]!;
      const nameTop = (line: typeof name) => line.y - line.size * 0.895;
      const affiliationTop = (line: typeof name) => line.y - line.size * 0.995;
      expect(affiliationTop(firstAffiliation) - (nameTop(lastName) + lastName.size * 1.1)).toBeCloseTo(
        (4 * page.width) / 1080,
      );
      expect(name.x - (portrait.x + portrait.width + (portrait.ringWidth ?? 0))).toBeCloseTo((20 * page.width) / 1080);
      const textTop = nameTop(name);
      const lastAffiliation = affiliations.at(-1)!;
      const textBottom = affiliationTop(lastAffiliation) + lastAffiliation.size * 1.3;
      expect((textTop + textBottom) / 2).toBeCloseTo(portrait.y + portrait.height / 2);
      const following = page.texts.find((text) => text.y > lastAffiliation.y && text.group !== name.group);
      if (following)
        expect(following.y - following.size).toBeGreaterThanOrEqual(Math.max(textBottom, portrait.y + portrait.height));
    }
  });
  it("restores a complete standalone panel with its own gradient, metadata, and visible sponsor strip", async () => {
    const people = Array.from({ length: 4 }, (_, index) => ({
      userId: `panelist-${index}`,
      displayName: `Example Speaker ${index + 1}`,
      affiliation: "Research director · Institute for Applied Cryptography and Digital Infrastructure",
      role: index === 0 ? "moderator" : "speaker",
      photoUrl: null,
    }));
    const sponsorSvg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40" fill="#ff0000"/></svg>',
    ).toString("base64");
    const sample = {
      ...data,
      people,
      occurrence: { ...data.occurrence, format: "Panel", roomId: "main" },
      agenda: agendaSnapshotSchema.parse({ ...data.agenda, rooms: [{ id: "main", name: "Main hall", capacity: 100 }] }),
      place: "Example venue",
      composition: { ...defaultPromotionComposition(), summary: "Explore practical cryptographic migration choices." },
      sponsors: [
        {
          tierName: "Community",
          sponsors: Array.from({ length: 5 }, (_, index) => ({
            id: `sponsor-${index}`,
            name: `Example sponsor ${index + 1}`,
            base64: sponsorSvg,
            aspectRatio: 3,
          })),
        },
      ],
    };
    for (const format of ["landscape", "square", "portrait"] as const) {
      const pages = buildPromotionPages(sample, format);
      expect(pages, format).toHaveLength(1);
      const page = pages[0]!;
      for (const person of people)
        expect(
          page.pictures.some((picture) => picture.alt === person.displayName),
          format,
        ).toBe(true);
      expect(
        page.texts.some((text) => text.text === "SPONSORED BY"),
        format,
      ).toBe(true);
      const allText = page.texts.map((text) => text.text).join(" ");
      expect(allText).toContain(sample.composition.summary);
      for (const label of ["DAY", "TIME", "ROOM", "FORMAT"])
        expect(page.texts.some((text) => text.text === label && text.mono)).toBe(true);
      const svg = promotionSceneSvg(sample, page);
      expect(svg).not.toContain(">SWIPE<");
      const raster = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      for (const sponsor of page.pictures.filter((picture) => picture.alt.startsWith("Example sponsor"))) {
        const pixel =
          (Math.floor(sponsor.y + sponsor.height / 2) * raster.info.width + Math.floor(sponsor.x + sponsor.width / 2)) *
          4;
        expect(Array.from(raster.data.subarray(pixel, pixel + 3)), `${format}: ${sponsor.alt}`).toEqual([255, 0, 0]);
        expect(sponsor.y).toBeGreaterThan(page.still!.bandTop);
      }
      const otherIndex = await sharp(Buffer.from(promotionSceneSvg(sample, { ...page, index: 3, total: 5 })))
        .ensureAlpha()
        .raw()
        .toBuffer();
      expect(otherIndex.equals(raster.data), format).toBe(true);
    }
  });
  it("keeps the name, job title, and organization in descending emphasis across exports", () => {
    const person = {
      userId: "hierarchy",
      displayName: "Example Speaker",
      affiliation: "Research lead · Example Institute",
      affiliations: [
        { identityId: null, title: "Research lead", organizationId: null, organizationName: "Example Institute" },
      ],
      role: "speaker",
      photoUrl: null,
    };
    for (const format of ["carousel", "portrait", "square", "landscape"] as const) {
      const pages = buildPromotionPages({ ...data, people: [person] }, format);
      const title = pages.flatMap((page) => page.texts).find((text) => text.text === "Research lead")!;
      const organization = pages.flatMap((page) => page.texts).find((text) => text.text === "Example Institute")!;
      expect(title, format).toBeDefined();
      expect(organization.weight, format).toBe(400);
      expect(title.weight, format).toBe(500);
      expect(title.size, format).toBeGreaterThan(organization.size);
      expect(title.y, format).toBeLessThan(organization.y);
      expect(organization.color, format).not.toBe(title.color);
    }
  });
  it("fits six panelists on one image with adaptive portrait sizes", () => {
    const people = Array.from({ length: 6 }, (_, index) => ({
      userId: `six-${index}`,
      displayName: `Example Speaker ${index + 1}`,
      affiliation: "Research director · Example Institute for Applied Cryptography",
      affiliations: [
        {
          identityId: null,
          title: "Research director",
          organizationId: null,
          organizationName: "Example Institute for Applied Cryptography",
        },
      ],
      role: index === 0 ? "moderator" : "speaker",
      photoUrl: null,
    }));
    for (const format of ["landscape", "square", "portrait"] as const) {
      const pages = buildPromotionPages(
        {
          ...data,
          people,
          composition: { ...defaultPromotionComposition(), summary: "Explore practical migration choices." },
        },
        format,
      );
      expect(pages, format).toHaveLength(1);
      const page = pages[0]!;
      const eyebrow = page.texts.find((text) => text.role === "H2")!;
      expect(eyebrow.y - eyebrow.size, format).toBeGreaterThanOrEqual(
        page.still!.logoY + page.still!.logoHeight + (20 * page.width) / 1080,
      );
      const portraits = page.pictures.filter((picture) => picture.circle);
      expect(portraits, format).toHaveLength(6);
      for (const picture of portraits) {
        expect(picture.width, format).toBeGreaterThanOrEqual(
          format === "square" ? 112 : format === "portrait" ? 128 : 64,
        );
        expect(picture.y + picture.height, format).toBeLessThan(page.still!.bandTop);
      }
      for (const person of people)
        expect(page.texts.map((text) => text.text).join(" "), format).toContain(person.displayName);
    }
  });
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
  it("paints PNG, JPEG, and WebP headshots in every image layout from uploaded and migrated storage", async () => {
    const { initWasm, Resvg } = await import("@resvg/resvg-wasm");
    await initWasm(readFileSync("node_modules/@resvg/resvg-wasm/index_bg.wasm"));
    const servicePath = "../../functions/_lib/services/og-badge-prerender";
    const { loadValidatedHeadshotDataUrl } = await import(servicePath);
    const { renderPersonalPromotionSvg } =
      await import("../../functions/_lib/services/event-agenda/promotion-personal");
    const { defaultEventPromotionDesign } = await import("../../assets/shared/schemas/event-promotion-design");
    const fontBuffers = [readFileSync("static/fonts/Roboto-Regular.ttf"), readFileSync("static/fonts/Roboto-Bold.ttf")];
    const visiblePortraitPixels = async (svg: string) => {
      const renderer = new Resvg(svg, { font: { fontBuffers, defaultFontFamily: "Roboto" } });
      try {
        const pixels = await sharp(renderer.render().asPng()).ensureAlpha().raw().toBuffer();
        let count = 0;
        for (let pixel = 0; pixel < pixels.length; pixel += 4)
          if (pixels[pixel]! > 240 && pixels[pixel + 1]! < 15 && pixels[pixel + 2]! < 15) count++;
        return count;
      } finally {
        renderer.free();
      }
    };
    for (const format of ["png", "jpeg", "webp"] as const) {
      const bytes = Uint8Array.from(
        await sharp({ create: { width: 64, height: 64, channels: 3, background: "#ff0000" } })
          .toFormat(format)
          .toBuffer(),
      );
      const bucket = { get: async () => ({ size: bytes.byteLength, arrayBuffer: async () => bytes.buffer }) };
      const images = {
        input: (stream: ReadableStream) => ({
          transform: () => ({
            output: async ({ format }: { format: string }) => ({
              response: async () =>
                new Response(
                  Uint8Array.from(
                    await sharp(Buffer.from(await new Response(stream).arrayBuffer()))
                      .toFormat(format === "image/jpeg" ? "jpeg" : "png")
                      .toBuffer(),
                  ),
                  { headers: { "content-type": format } },
                ),
            }),
          }),
        }),
      };
      for (const prefix of ["headshots/person", "member-photos/example"]) {
        const headshot = await loadValidatedHeadshotDataUrl(`${prefix}/photo.${format}`, {
          SPEAKER_UPLOADS_BUCKET: bucket,
          ASSETS_BUCKET: bucket,
          IMAGES: images,
        });
        expect(headshot).toMatch(/^data:image\/(png|jpeg);base64,/);
        const sample = {
          ...data,
          actorId: "person",
          people: [
            {
              userId: "person",
              displayName: "Example Speaker",
              affiliation: "Example Organization",
              role: "speaker",
              photoUrl: null,
            },
          ],
          portraits: { person: headshot },
        };
        for (const layout of ["landscape", "square", "portrait"] as const) {
          let count = 0;
          for (const page of promotionCardPages(sample, layout))
            count += await visiblePortraitPixels(renderPromotionSvg(page, layout));
          expect(count, `${prefix} ${format} ${layout}`).toBeGreaterThan(1000);
        }
        for (const layout of ["landscape", "square"] as const) {
          const svg = renderPersonalPromotionSvg({
            firstName: "Example",
            lastName: "Speaker",
            role: "speaker",
            eventName: "Example Conference",
            timeZone: "UTC",
            startsAt: "2026-12-01T09:00:00.000Z",
            endsAt: "2026-12-01T17:00:00.000Z",
            registrationUrl: data.registrationUrl,
            design: defaultEventPromotionDesign("Example"),
            headshotDataUrl: headshot,
            format: layout,
          });
          expect(await visiblePortraitPixels(svg), `${prefix} ${format} personal ${layout}`).toBeGreaterThan(1000);
        }
      }
    }
  });
  it("features the participating downloader and keeps the remaining panelists in a grid", () => {
    const people = Array.from({ length: 4 }, (_, index) => ({
      userId: `panelist-${index}`,
      displayName: `Synthetic Panelist ${index}`,
      affiliation: "Program director · Example Institute for Cryptographic Research",
      photoUrl: null,
      role: index === 0 ? "moderator" : "speaker",
    }));
    for (const actorId of ["panelist-2", "staff"]) {
      const sample = {
        ...data,
        actorId,
        people,
        portraits: Object.fromEntries(people.map((person) => [person.userId, "data:image/png;base64,AA=="])),
      };
      const pages = buildPromotionPages(sample, "carousel");
      const featured = pages.find((page) => page.title === "Featured speaker")!;
      const primary = people[actorId === "staff" ? 0 : 2]!;
      expect(featured.pictures[0]!.alt).toBe(primary.displayName);
      expect(featured.pictures[0]!.width).toBeGreaterThan(500);
      const panel = pages.find((page) => page.title === "Meet the speakers")!;
      expect(panel.pictures).toHaveLength(3);
      expect(new Set(panel.pictures.map((picture) => picture.x)).size).toBe(3);
      expect(panel.pictures.some((picture) => picture.alt === primary.displayName)).toBe(false);
      const credits = [featured, panel].flatMap((page) => page.texts.map((text) => text.text)).join(" ");
      for (const person of people) {
        expect(credits).toContain(person.displayName);
        expect(credits).toContain(person.affiliation);
      }
      const coverPortrait = pages[0]!.pictures.find((picture) => picture.alt === primary.displayName)!;
      expect(coverPortrait.x - pages[0]!.width).toBe(featured.pictures[0]!.x);
    }
  });
  it("keeps the sponsor board and registration action in connected portrait PDF pages", async () => {
    const sample = {
      ...data,
      sponsors: [
        { tierName: "Community", sponsors: [{ id: "sponsor", name: "Synthetic sponsor", base64: "PHN2Zy8+" }] },
      ],
    };
    const frames = buildPromotionPages(sample, "carousel");
    const sponsor = frames.at(-1)!;
    expect(sponsor.title).toBe("Our sponsors");
    expect(sponsor.pictures.map((picture) => picture.alt)).toEqual(["Synthetic sponsor"]);
    expect(frames.filter((frame) => frame.registrationCard)).toHaveLength(1);
    const bytes = await renderPromotionPdf(
      sample,
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(frames.length);
    for (const page of pdf.getPages()) {
      expect(page.getSize()).toEqual({ width: 540, height: 675 });
      const annotations = page.node.Annots()!;
      expect(annotations.size()).toBe(1);
      const rect = annotations.lookup(0, PDFDict).lookup(PDFName.of("Rect"), PDFArray);
      expect((rect.get(0) as PDFNumber).asNumber()).toBeGreaterThanOrEqual(0);
      expect((rect.get(2) as PDFNumber).asNumber()).toBeLessThanOrEqual(540);
    }
  });
  it("keeps the panorama gradient and crossing sponsor board continuous at page edges", async () => {
    const sample = {
      ...data,
      sponsors: [
        { tierName: "Community", sponsors: [{ id: "sponsor", name: "Synthetic sponsor", base64: "PHN2Zy8+" }] },
      ],
    };
    const frames = buildPromotionPages(sample, "carousel");
    const strips = await Promise.all(
      frames.map(async (frame) => {
        const svg = Buffer.from(promotionSceneSvg(sample, frame, false));
        const image = sharp(svg);
        return Promise.all(
          [0, frame.width - 1].map((left) =>
            image.clone().extract({ left, top: 1040, width: 1, height: 1 }).removeAlpha().raw().toBuffer(),
          ),
        );
      }),
    );
    for (let index = 1; index < strips.length; index++)
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(strips[index - 1]![1]![channel]! - strips[index]![0]![channel]!)).toBeLessThanOrEqual(2);
  });
  it("makes the registration card the PDF link target", async () => {
    const sample = { ...data, composition: { ...defaultPromotionComposition(), panels: ["register"] as "register"[] } };
    const scene = buildPromotionPages(sample, "carousel")[0]!;
    expect(scene.registrationCard).toBeDefined();
    const bytes = await renderPromotionPdf(
      sample,
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    const document = await PDFDocument.load(bytes);
    const annotation = document.getPage(0).node.Annots()!.lookup(0, PDFDict);
    const rect = annotation
      .lookup(PDFName.of("Rect"), PDFArray)
      .asArray()
      .map((value) => (value as PDFNumber).asNumber());
    const card = scene.registrationCard!;
    expect(rect).toEqual([
      card.x / 2,
      (scene.height - card.y - card.height) / 2,
      (card.x + card.width) / 2,
      (scene.height - card.y) / 2,
    ]);
  });
  it("shrinks a normal long abstract to one section and prefers an explicitly supplied summary", () => {
    const summary = "Engineers compare deployment choices and explain operational migration controls. "
      .repeat(18)
      .trim();
    const sample = {
      ...data,
      measure: promotionFontMeasure([
        readFileSync("static/fonts/PromotionRoboto-Regular.ttf"),
        readFileSync("static/fonts/PromotionRoboto-Bold.ttf"),
      ]),
      composition: {
        ...defaultPromotionComposition(),
        panels: ["content"] as "content"[],
        content: "abstract" as const,
      },
      occurrence: { ...data.occurrence, description: summary },
    };
    const short = buildPromotionPages(
      { ...sample, occurrence: { ...sample.occurrence, description: "A short description of this session." } },
      "carousel",
    );
    const pages = buildPromotionPages(sample, "carousel");
    expect(pages).toHaveLength(1);
    const body = pages[0]!.texts.filter((line) => line.role === "P");
    expect(body.map((line) => line.text).join(" ")).toBe(summary);
    expect(body[0]!.size).toBeLessThan(short[0]!.texts.find((line) => line.role === "P")!.size);
    expect(body[0]!.size).toBeGreaterThanOrEqual(24);
    expect(body.every((line) => line.y <= 952)).toBe(true);
    const chosen = "A concise summary chosen by the speaker for this carousel.";
    const explicit = buildPromotionPages(
      { ...sample, composition: { ...sample.composition, summary: chosen } },
      "carousel",
    );
    expect(explicit).toHaveLength(1);
    expect(
      explicit[0]!.texts
        .filter((line) => line.role === "P")
        .map((line) => line.text)
        .join(" "),
    ).toBe(chosen);
  });
  it("balances complete long abstracts without an orphaned continuation", () => {
    const summary = "Engineers compare deployment choices and explain operational migration controls. "
      .repeat(50)
      .trim();
    const sample = {
      ...data,
      composition: {
        ...defaultPromotionComposition(),
        panels: ["content"] as "content"[],
        content: "abstract" as const,
      },
      occurrence: { ...data.occurrence, description: summary },
    };
    const pages = buildPromotionPages(sample, "carousel");
    const lines = pages.map((page) => page.texts.filter((text) => text.role === "P"));
    expect(pages.length).toBeGreaterThan(1);
    expect(
      Math.max(...lines.map((page) => page.length)) - Math.min(...lines.map((page) => page.length)),
    ).toBeLessThanOrEqual(1);
    expect(
      lines
        .flat()
        .map((line) => line.text)
        .join(" "),
    ).toBe(summary);
    expect(lines.flat().every((line) => line.y < 1140)).toBe(true);
  });
  it("keeps the event label and panel format clear of the overlapping cover portrait", () => {
    const fonts = ["PromotionRoboto-Regular.ttf", "PromotionRoboto-Bold.ttf"].map((name) =>
      readFileSync(`static/fonts/${name}`),
    );
    const mono = readFileSync("static/fonts/PromotionRobotoMono-Medium.ttf");
    const measure = promotionFontMeasure(fonts, { mono });
    for (const eventName of [
      "PQC Conference",
      "Post-Quantum Cryptography Conference",
      "Post-Quantum Cryptography Conference ".repeat(4),
    ]) {
      const page = buildPromotionPages(
        {
          ...data,
          agenda: { ...data.agenda, eventName },
          occurrence: { ...data.occurrence, format: "Panel" },
          measure,
        },
        "carousel",
      )[0]!;
      const title = page.texts.find((text) => text.role === "H1")!;
      const eyebrow = page.texts.filter((text) => text.mono && text.y < title.y);
      expect(eyebrow.length).toBeGreaterThan(0);
      for (const line of eyebrow) {
        const width =
          measure(line.text, line.size, false, true) + Array.from(line.text).length * (line.letterSpacing ?? 0);
        expect(width).toBeLessThanOrEqual(720);
        expect(line.text).not.toMatch(/^[·]|[·]$/u);
      }
      expect(eyebrow.at(-1)!.text).toContain("PANEL");
      expect(title.y - title.size - Math.max(...eyebrow.map((text) => text.y))).toBeGreaterThanOrEqual(24);
      if (eventName === "Post-Quantum Cryptography Conference") expect(eyebrow.at(-1)!.text).toBe("PANEL");
    }
  });
  it("wraps cover metadata between complete fields and keeps the room name together", () => {
    const fonts = ["PromotionRoboto-Regular.ttf", "PromotionRoboto-Bold.ttf"].map((name) =>
      readFileSync(`static/fonts/${name}`),
    );
    const measure = promotionFontMeasure(fonts, { mono: readFileSync("static/fonts/PromotionRobotoMono-Medium.ttf") });
    const sample = {
      ...data,
      measure,
      agenda: agendaSnapshotSchema.parse({
        ...data.agenda,
        clockCity: "Amsterdam",
        rooms: [{ id: "red", name: "Red hall", capacity: null }],
      }),
      occurrence: { ...data.occurrence, roomId: "red" },
    };
    const page = buildPromotionPages(sample, "carousel")[0]!;
    const titleBottom = Math.max(...page.texts.filter((text) => text.role === "H1").map((text) => text.y));
    const metadata = page.texts.filter((text) => text.mono && text.y > titleBottom);
    expect(metadata.some((line) => line.text.includes("Red hall"))).toBe(true);
    for (const line of metadata) {
      expect(line.text).not.toMatch(/^[·]|[·]$/u);
      expect(
        measure(line.text, line.size, false, true) + Array.from(line.text).length * (line.letterSpacing ?? 0),
      ).toBeLessThanOrEqual(904);
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
      for (const format of ["carousel"] as const) {
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
    const frames = buildPromotionPages(
      { ...data, composition: { ...defaultPromotionComposition(), qrCode: true, takeaways } },
      "carousel",
    );
    expect(figures.filter((value) => value.startsWith("QR code:"))).toHaveLength(frames.length);
    expect(figures).toContain(`QR code: register for this event at ${data.registrationUrl}`);
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

  it("embeds an explicit width for every painted English glyph in the design fonts", async () => {
    const { decodePDFRawStream, PDFRawStream } = await import("pdf-lib");
    const font = readFileSync("static/fonts/PromotionRoboto-Regular.ttf");
    const bold = readFileSync("static/fonts/PromotionRoboto-Bold.ttf");
    const bytes = await renderPromotionPdf(data, font, bold);
    const pdf = await PDFDocument.load(bytes);
    const page = pdf.getPage(0);
    const fonts = page.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
    const explicitWidths = new Map<string, Set<number>>();
    for (const [key, ref] of fonts.entries()) {
      const face = pdf.context.lookup(ref, PDFDict);
      const descendant = face.lookup(PDFName.of("DescendantFonts"), PDFArray).lookup(0, PDFDict);
      const widths = descendant.lookup(PDFName.of("W"), PDFArray).asArray();
      const covered = new Set<number>();
      for (let index = 0; index < widths.length;) {
        const first = (widths[index++] as PDFNumber).asNumber();
        const next = widths[index++]!;
        if (next instanceof PDFArray) for (let glyph = 0; glyph < next.size(); glyph++) covered.add(first + glyph);
        else {
          const last = (next as PDFNumber).asNumber();
          index++;
          for (let glyph = first; glyph <= last; glyph++) covered.add(glyph);
        }
      }
      explicitWidths.set(key.toString(), covered);
    }
    const content = page.node.Contents() as PDFArray;
    const operators = content
      .asArray()
      .map((ref) => {
        const stream = pdf.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) throw new Error("Expected a PDF content stream");
        return new TextDecoder().decode(decodePDFRawStream(stream).decode());
      })
      .join("\n");
    let selected: string | undefined;
    let painted = 0;
    for (const match of operators.matchAll(/(\/[A-Za-z0-9-]+) [\d.]+ Tf|<([0-9A-Fa-f]+)> Tj/g)) {
      if (match[1]) selected = match[1];
      else
        for (let index = 0; index < match[2]!.length; index += 4) {
          expect(
            explicitWidths.get(selected!)?.has(parseInt(match[2]!.slice(index, index + 4), 16)),
            `${selected}: ${match[2]!.slice(index, index + 4)}`,
          ).toBe(true);
          painted++;
        }
    }
    expect(painted).toBeGreaterThan(100);
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
    for (const format of ["landscape", "square", "portrait"] as const) {
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
    const pages = promotionCardPages(extended, "landscape");
    expect(pages.length).toBeGreaterThan(1);
    const text = pages.flatMap((page) => page.cardLines?.map((line) => line.text) ?? []).join(" ");
    for (let index = 0; index < 30; index++) expect(text).toContain(`Speaker ${index}`);
    for (const page of pages) expect(renderPromotionSvg(page, "landscape")).toContain("<svg");
    const pdf = await renderPromotionPdf(
      extended,
      readFileSync("static/fonts/Roboto-Regular.ttf"),
      readFileSync("static/fonts/Roboto-Bold.ttf"),
    );
    const continuous = await PDFDocument.load(pdf);
    expect(continuous.getPageCount()).toBeGreaterThan(4);
    expect(continuous.getPage(0).getSize()).toEqual({ width: 540, height: 675 });
  });
  it("produces connected portrait pages with embedded fonts, semantic text and registration annotations", async () => {
    const font = readFileSync("static/fonts/Roboto-Regular.ttf");
    const bold = readFileSync("static/fonts/Roboto-Bold.ttf");
    const logoPng = await sharp(readFileSync("static/img/logo.svg")).resize({ width: 500 }).png().toBuffer();
    const bytes = await renderPromotionPdf({ ...data, logoPng }, font, bold);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBe(buildPromotionPages(data, "carousel").length);
    expect(document.getPage(0).getWidth()).toBe(540);
    expect(document.getPage(0).getHeight()).toBe(675);
    expect(bytes.byteLength).toBeLessThan(100 * 1024 * 1024);
    expect(document.getTitle()).toContain("Building trustworthy");
    expect(document.getPages()[0]!.node.get(PDFName.of("Annots"))).toBeDefined();
    if (process.env.PKIC_PROMOTION_REVIEW_PDF) writeFileSync(process.env.PKIC_PROMOTION_REVIEW_PDF, bytes);
  });
});

it.each([1, 2])("keeps the featured speaker out of long-credit fallback pages with %i remaining panelists", (count) => {
  const primary = {
    userId: "featured",
    displayName: "Featured Reader",
    affiliation: "Director",
    role: "speaker",
    photoUrl: null,
  };
  const remaining = Array.from({ length: count }, (_, index) => ({
    userId: `remaining-${index}`,
    displayName: `Panelist ${index}`,
    affiliation: "Long organization credit ".repeat(100),
    role: "speaker",
    photoUrl: null,
  }));
  const pages = buildPromotionPages(
    {
      ...data,
      actorId: primary.userId,
      people: [primary, ...remaining],
      portraits: Object.fromEntries(remaining.map((person) => [person.userId, "data:image/png;base64,portrait"])),
      composition: { ...defaultPromotionComposition(), panels: ["speakers"] },
    },
    "carousel",
  );
  expect(pages[0]!.title).toBe("Featured speaker");
  if (count === 1) {
    const speakerPages = pages.slice(1);
    expect(speakerPages.length).toBeGreaterThan(1);
    const portrait = speakerPages[0]!.pictures.find((picture) => picture.alt === remaining[0]!.displayName)!;
    expect(portrait).toBeDefined();
    expect(speakerPages.slice(1).flatMap((page) => page.pictures)).toHaveLength(0);
    for (const page of speakerPages)
      for (const text of page.texts) expect(text.y + text.size * 0.25).toBeLessThan(1050);
    for (const text of speakerPages[0]!.texts)
      expect(text.y + text.size * 0.25 <= portrait.y || text.y - text.size >= portrait.y + portrait.height).toBe(true);
  }
  const lines = pages.flatMap((page) => page.texts.map((line) => line.text));
  expect(lines.filter((line) => line === primary.displayName)).toHaveLength(1);
  for (const person of remaining) expect(lines.filter((line) => line === person.displayName)).toHaveLength(1);
  expect(
    pages
      .slice(1)
      .map((page) => page.texts.map((line) => line.text).join(" "))
      .join(" "),
  ).toContain("Long organization credit");
});
