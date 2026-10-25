import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPromotionPages } from "../../functions/_lib/services/event-agenda/promotion-scene";
import { promotionFontMeasure } from "../../functions/_lib/services/event-agenda/promotion-text";
import { defaultPromotionComposition } from "../../assets/shared/schemas/event-promotion-design";

const measure = promotionFontMeasure(
  ["Roboto-Regular.ttf", "Roboto-Bold.ttf"].map((name) => readFileSync(`static/fonts/${name}`)),
);

describe("personal promotion typography", () => {
  it.each([false, true])("keeps measured text clear of the logo, headshot and footer (portrait: %s)", (portrait) => {
    const page = buildPromotionPages(
      {
        personal: {
          eventName: "Post-Quantum Cryptography Conference",
          firstName: "Alex",
          heading: "is attending",
          people: [
            {
              userId: "person",
              displayName: "Alex Morgan",
              affiliation: "Security architect · Example Trust Services",
            },
          ],
          details: "December 1–3, 2026 · Meervaart · Amsterdam",
        },
        registrationUrl: "https://pkic.org/r/example",
        composition: defaultPromotionComposition(true),
        measure,
        portraits: portrait ? { person: "data:image/png;base64,AA==" } : undefined,
      },
      "landscape",
    )[0]!;
    const title = page.texts.filter((line) => line.role === "H1");
    const action = page.texts.find((line) => line.text === "is attending")!;
    const eventTitle = page.texts.filter((line) => line.role === "H2" && line !== action);
    expect(title.map((line) => line.text).join(" ")).toBe("ALEX");
    expect(eventTitle.map((line) => line.text).join(" ")).toBe("Post-Quantum Cryptography Conference");
    expect(title).toHaveLength(1);
    expect(title[0]!.size).toBeGreaterThan(action.size * 2.5);
    expect(title[0]!.y - title[0]!.size - 97).toBeGreaterThan(30);
    if (portrait) {
      const picture = page.pictures[0]!;
      expect(picture.circle).toBe(true);
      expect(picture.width).toBe(picture.height);
      expect(picture.x).toBeGreaterThan(page.width / 2);
      expect(picture.width).toBeGreaterThan(200);
      expect(picture.y + picture.height).toBeLessThan(page.height - 95);
      for (const line of page.texts) {
        if (line.y >= picture.y && line.y - line.size <= picture.y + picture.height)
          expect(line.x + measure(line.text, line.size, Boolean(line.bold))).toBeLessThan(picture.x - 20);
      }
    }
    expect(action.y - action.size - title[0]!.y).toBeGreaterThan(20);
    for (const line of page.texts) {
      expect(line.x + measure(line.text, line.size, Boolean(line.bold))).toBeLessThan(page.width - 80);
      expect(line.y).toBeLessThan(page.height - 95);
    }
  });
});
