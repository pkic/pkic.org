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
  ["Roboto-Regular.ttf", "Roboto-Bold.ttf"].map((name) => readFileSync(`static/fonts/${name}`)),
  readFileSync("static/fonts/RobotoMono-Regular.ttf"),
);
const eventName = "Post-Quantum Cryptography Conference";
describe("automatic Open Graph cards", () => {
  it.each(["landscape", "square"] as PersonalPromotionImageFormat[])(
    "encodes a separate %s image without sponsors",
    async (format) => {
      const design = defaultEventPromotionDesign("Synthetic");
      design.sponsorGroups = [{ key: "hidden", source: "event", tierName: "Never show this sponsor tier" }];
      const svg = renderPersonalPromotionSvg({
        firstName: "Paul",
        lastName: "van Brouwershaven",
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
      expect(svg).toContain("Paul van Brouwershaven");
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
          const name = longName ? "Alexandria van Brouwershaven-Winterbottom" : "Alex Morgan";
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
          const picture = page.pictures[0]!;
          expect(picture.width).toBe(picture.height);
          expect(picture.y + picture.height).toBeLessThan(page.social!.bandTop);
          if (format === "square") {
            expect(picture.x + picture.width / 2).toBe(page.width / 2);
            expect(nameLines[0]!.y - nameLines[0]!.size).toBeGreaterThan(picture.y + picture.height);
          } else {
            for (const line of nameLines)
              expect(line.x + measure(line.text, line.size, line.bold, line.mono)).toBeLessThan(picture.x - 30);
          }
          for (const line of page.texts) {
            const textWidth = measure(line.text, line.size, line.bold, line.mono);
            const left = line.x - (line.anchor === "middle" ? textWidth / 2 : 0);
            expect(left).toBeGreaterThanOrEqual(60);
            expect(left + textWidth).toBeLessThanOrEqual(page.width - 60);
            expect(line.y).toBeLessThan(page.height - 30);
          }
        }
    },
  );
});
