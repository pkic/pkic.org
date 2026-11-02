import fontkit from "@pdf-lib/fontkit";
import { fetchHeroImage } from "../../functions/_lib/services/og-badge-hero-image";
import { promotionImageCover } from "../../functions/_lib/services/event-agenda/promotion-image";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { buildPromotionPages } from "../../functions/_lib/services/event-agenda/promotion-scene";
import { promotionFontMeasure } from "../../functions/_lib/services/event-agenda/promotion-text";
import { renderPersonalPromotionSvg } from "../../functions/_lib/services/event-agenda/promotion-personal";
import { defaultEventPromotionDesign } from "../../assets/shared/schemas/event-promotion-design";
import { personalPromotionRoleStyle } from "../../assets/shared/badge-role-colors";
import {
  PERSONAL_PROMOTION_IMAGE_DIMENSIONS,
  type PersonalPromotionImageFormat,
} from "../../assets/shared/personal-promotion-image";
const measure = promotionFontMeasure(
  ["PromotionRoboto-Regular.ttf", "PromotionRoboto-Bold.ttf"].map((name) => readFileSync(`static/fonts/${name}`)),
  {
    mono: readFileSync("static/fonts/PromotionRobotoMono-Medium.ttf"),
    monoBold: readFileSync("static/fonts/PromotionRobotoMono-SemiBold.ttf"),
    medium: readFileSync("static/fonts/PromotionRoboto-Medium.ttf"),
  },
);
const eventName = "Post-Quantum Cryptography Conference";
describe("automatic Open Graph cards", () => {
  it("loads the large event photo before rendering both aspect ratios", async () => {
    const source = readFileSync("content/events/2026/pqc-conference-amsterdam-nl/amsterdam-nl.png");
    const original = await sharp(source).metadata();
    const heroImage = await fetchHeroImage(
      JSON.stringify({ heroImageUrl: "/events/2026/pqc-conference-amsterdam-nl/amsterdam-nl.png" }),
      "https://pkic.org",
      {
        ASSETS: {
          fetch: async (request) => {
            expect(new URL(request.url).pathname).toBe(
              "/content-media/events/2026/pqc-conference-amsterdam-nl/amsterdam-nl.png",
            );
            return new Response(new Uint8Array(source), {
              headers: { "content-type": "image/png", "content-length": String(source.length) },
            });
          },
        },
        IMAGES: {
          input: (stream) => ({
            transform: (options) => {
              expect(options).toEqual({});
              return {
                output: async (output) => {
                  expect(output).toEqual({ format: "image/jpeg", quality: 95 });
                  const bytes = await sharp(Buffer.from(await new Response(stream).arrayBuffer()))
                    .jpeg({ quality: 95 })
                    .toBuffer();
                  return {
                    response: () => new Response(new Uint8Array(bytes), { headers: { "content-type": "image/jpeg" } }),
                  };
                },
              };
            },
          }),
        },
      },
    );
    expect(heroImage).toMatchObject({ width: original.width, height: original.height, contentType: "image/jpeg" });
    for (const format of ["landscape", "square"] as const) {
      const svg = renderPersonalPromotionSvg({
        firstName: "Alex",
        lastName: "Morgan",
        role: "attendee",
        eventName,
        startsAt: "2026-12-01T08:00:00.000Z",
        endsAt: "2026-12-03T17:00:00.000Z",
        timeZone: "Europe/Amsterdam",
        registrationUrl: "https://pkic.org/r/example",
        city: "Amsterdam",
        location: "Meervaart · Amsterdam",
        design: defaultEventPromotionDesign("Synthetic"),
        measure,
        format,
        heroImage,
        logoDataUrl: `data:image/svg+xml;base64,${readFileSync("static/img/logo.svg").toString("base64")}`,
      });
      expect(svg).toContain(heroImage!.dataUrl);
      const image = await sharp(Buffer.from(svg)).png().toBuffer();
      const metadata = await sharp(image).metadata();
      expect({ width: metadata.width, height: metadata.height }).toEqual(PERSONAL_PROMOTION_IMAGE_DIMENSIONS[format]);
    }
  });
  it.each(["landscape", "square"] as PersonalPromotionImageFormat[])(
    "encodes a separate %s image without sponsors",
    async (format) => {
      const design = defaultEventPromotionDesign("Synthetic");
      design.sponsorGroups = [{ key: "hidden", source: "event", tierName: "Never show this sponsor tier" }];
      const svg = renderPersonalPromotionSvg({
        firstName: "Alex",
        lastName: "Somerville",
        role: "speaker",
        eventName,
        startsAt: "2026-12-01T08:00:00.000Z",
        endsAt: "2026-12-03T17:00:00.000Z",
        timeZone: "Europe/Amsterdam",
        registrationUrl: "https://pkic.org/r/example",
        organization: "Example Trust Services",
        jobTitle: "Security architect",
        design,
        measure,
        format,
        sessions: [{ title: "Migrating before Q-Day" }, { title: "Deploying quantum-safe systems" }],
      });
      const image = await sharp(Buffer.from(svg)).png().toBuffer();
      const metadata = await sharp(image).metadata();
      expect({ width: metadata.width, height: metadata.height }).toEqual(PERSONAL_PROMOTION_IMAGE_DIMENSIONS[format]);
      expect([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1]).join(" ")).toContain(
        "Alex Somerville",
      );
      expect(svg).toContain("2 SESSIONS");
      expect(svg).not.toContain("Never show this sponsor tier");
      expect(svg).not.toContain("SPONSORED BY");
      expect(svg).not.toContain("sponsor-logos/");
    },
  );
  it.each(["landscape", "square"] as const)(
    "fits long names, missing portraits and public session summaries in %s",
    (format) => {
      for (const portrait of [false, true])
        for (const longName of [false, true]) {
          const name = longName ? "Alexandria Somerville-Winterbottom" : "Alex Morgan";
          const pages = buildPromotionPages(
            {
              personal: {
                eventName,
                heading: "Speaker",
                roleStyle: personalPromotionRoleStyle("speaker"),
                dates: "December 1–3, 2026",
                location: "Meervaart · Amsterdam",
                people: [
                  { userId: "person", displayName: name, affiliation: "Security architect · Example Trust Services" },
                ],
                sessions: [
                  { title: "Migrating before Q-Day" },
                  { title: "Protecting certificate lifecycles" },
                  { title: "Deploying quantum-safe systems" },
                ],
              },
              registrationUrl: "https://pkic.org/r/example",
              measure,
              portraits: portrait ? { person: "data:image/png;base64,AA==" } : undefined,
            },
            format,
          );
          expect(pages).toHaveLength(1);
          const page = pages[0]!;
          const nameLines = page.texts.filter((line) => line.role === "H1");
          expect(nameLines.map((line) => line.text).join(" ")).toBe(name);
          expect(page.texts.map((line) => line.text).join(" ")).toContain("+ 2 more on the agenda");
          expect(page.social!.focalPoint).toEqual(format === "square" ? { x: 0.62, y: 0.4 } : { x: 0.5, y: 0.55 });
          const picture = page.pictures[0]!;
          expect(picture.width).toBe(picture.height);
          expect(picture.y + picture.height).toBeLessThan(page.social!.bandTop);
          if (format === "square") {
            expect(picture.x + picture.width / 2).toBe(page.width / 2);
            expect(nameLines[0]!.y - nameLines[0]!.size).toBeGreaterThan(picture.y + picture.height);
          } else {
            for (const line of nameLines)
              expect(
                line.x +
                  measure(line.text, line.size, line.bold, line.mono, line.weight) +
                  (line.letterSpacing ?? 0) * Array.from(line.text).length,
              ).toBeLessThan(picture.x - 30);
          }
          for (const line of page.texts) {
            const textWidth =
              measure(line.text, line.size, line.bold, line.mono, line.weight) +
              (line.letterSpacing ?? 0) * Array.from(line.text).length;
            const left = line.x - (line.anchor === "middle" ? textWidth / 2 : 0);
            expect(left).toBeGreaterThanOrEqual(60);
            expect(left + textWidth).toBeLessThanOrEqual(page.width - 60);
            expect(line.y).toBeLessThan(page.height - 30);
          }
        }
    },
  );
});

it("preserves the source photo's aspect ratio and the handoff focal points", () => {
  const original = { width: 1920, height: 1072 };
  const landscape = promotionImageCover(original, 1200, 490, { x: 0.5, y: 0.55 });
  expect(landscape).toMatchObject({ x: 0, width: 1200, height: 670, scale: 0.625 });
  expect(landscape.y).toBeCloseTo(-99, 10);
  const square = promotionImageCover(original, 1080, 890, { x: 0.62, y: 0.4 });
  expect(square.x).toBeCloseTo(-318.698507, 5);
  expect(square.y).toBeCloseTo(0, 10);
  for (const frame of [landscape, square])
    expect(frame.width / original.width).toBeCloseTo(frame.height / original.height, 12);
});

it("retains previously supported Greek and Cyrillic names in the pinned body font", () => {
  const font = fontkit.create(readFileSync("static/fonts/PromotionRoboto-Regular.ttf"));
  for (const glyph of Array.from("Александр Παύλος"))
    expect(font.hasGlyphForCodePoint(glyph.codePointAt(0)!)).toBe(true);
});
