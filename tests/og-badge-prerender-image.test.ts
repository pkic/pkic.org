import { personalPromotionRoleStyle, BADGE_DISPLAY_ROLE_COLORS } from "../assets/shared/badge-role-colors";
import { personalPromotionImagePath, PERSONAL_PROMOTION_RENDERER } from "../assets/shared/personal-promotion-image";
import { describe, expect, it } from "vitest";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../assets/shared/schemas/images";
import { loadValidatedHeadshotDataUrl } from "../functions/_lib/services/og-badge-prerender";
import { renderPersonalPromotionSvg } from "../functions/_lib/services/event-agenda/promotion-personal";
import { buildPromotionPages } from "../functions/_lib/services/event-agenda/promotion-scene";
import {
  defaultPromotionComposition,
  eventPromotionDesignFromSettings,
  defaultEventPromotionDesign,
} from "../assets/shared/schemas/event-promotion-design";
import { socialBadgeRoleSchema } from "../assets/shared/schemas/participant-roles";
import { validPngBytes } from "./helpers/raster-images";

function bucketWith(bytes: Uint8Array, size = bytes.byteLength): R2Bucket {
  return {
    get: async () => ({ arrayBuffer: async () => bytes.buffer, size }),
  } as unknown as R2Bucket;
}

describe("OG sponsor badge rendering", () => {
  it("renders the canonical sponsor role with the shared promotion artwork and escaped event details", () => {
    const svg = renderPersonalPromotionSvg({
      design: defaultEventPromotionDesign("Synthetic"),
      timeZone: "Europe/Amsterdam",
      registrationUrl: "https://pkic.org/r/synthetic",
      firstName: "Synthetic",
      lastName: "Sponsor",
      role: socialBadgeRoleSchema.parse("sponsor"),
      eventName: "Conference & workshop",
      startsAt: "2026-12-01T09:00:00.000Z",
      endsAt: "2026-12-01T17:00:00.000Z",
    });

    expect(svg).toContain('width="1200" height="630"');
    expect(svg).toContain("SPONSOR");
    expect(svg).toContain('id="panorama"');
    expect(svg).toContain('id="grid-fade"');
    expect([...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/gu)].map((match) => match[1]).join(" ")).toContain(
      "Synthetic Sponsor",
    );
    expect(svg).toContain("Conference &amp; workshop");
    expect(svg).not.toContain(">Attendee</text>");
    expect(svg).not.toContain("SPONSORED BY");
  });
});

describe("personal promotion scenes", () => {
  it("reuses physical badge role colors while keeping related speaking and staff roles consistent", () => {
    expect(personalPromotionRoleStyle("attendee").color).toBe("#ffffff");
    expect(personalPromotionRoleStyle("speaker").color).toBe(BADGE_DISPLAY_ROLE_COLORS.speaker);
    expect(personalPromotionRoleStyle("sponsor").color).toBe(BADGE_DISPLAY_ROLE_COLORS.sponsor);
    expect(personalPromotionRoleStyle("staff").color).toBe(BADGE_DISPLAY_ROLE_COLORS.staff);
    expect(personalPromotionRoleStyle("moderator").color).toBe(personalPromotionRoleStyle("speaker").color);
    expect(personalPromotionRoleStyle("organizer").color).toBe(personalPromotionRoleStyle("staff").color);
  });
  it("versions the image design and profile without losing either query parameter", () => {
    const url = new URL(personalPromotionImagePath("synthetic", "profile:2"), "https://pkic.org");
    expect(url.searchParams.get("layout")).toBe(PERSONAL_PROMOTION_RENDERER);
    expect(url.searchParams.get("v")).toBe("profile:2");
  });
  it("uses the event promotion design instead of a second social theme", () => {
    const chosen = { ...defaultEventPromotionDesign("Toronto event"), colors: ["#112233", "#445566"] };
    expect(eventPromotionDesignFromSettings("Event", { promotionDesign: chosen })).toEqual(chosen);
    const svg = renderPersonalPromotionSvg({
      firstName: "Example",
      lastName: "Participant",
      role: "attendee",
      eventName: "Event",
      timeZone: "America/Toronto",
      startsAt: "2027-05-01T13:00:00.000Z",
      endsAt: "2027-05-01T21:00:00.000Z",
      registrationUrl: "https://pkic.org/r/example",
      design: chosen,
    });
    expect(svg).toContain('stop-color="#112233"');
    expect(svg).toContain('stop-color="#445566"');
    expect(svg).toContain("https://pkic.org/r/example");
    expect(svg).not.toContain("01 / 01");
  });
  it("retains long identity details on one measured social image beside the portrait", () => {
    const name = "Synthetic Participant ".repeat(8).trim();
    const affiliation = "Organization and professional role ".repeat(10).trim();
    const personal = {
      eventName: "Post-Quantum Cryptography Conference",
      heading: "I’m attending",
      people: [{ userId: "person", displayName: name, affiliation }],
      details: "December 1–3, 2026 · Amsterdam",
    };
    for (const value of [personal, { ...personal, people: [{ ...personal.people[0], affiliation: "" }] }]) {
      const pages = buildPromotionPages(
        {
          personal: value,
          registrationUrl: "https://pkic.org/r/example",
          composition: { ...defaultPromotionComposition(), panels: ["cover"] },
          portraits: { person: "data:image/png;base64,AA==" },
        },
        "landscape",
      );
      expect(pages).toHaveLength(1);
      const page = pages[0];
      expect(page.texts.map((line) => line.text).join(" ")).toContain(name);
      if (value.people[0].affiliation) expect(page.texts.map((line) => line.text).join(" ")).toContain(affiliation);
      const portrait = page.pictures[0]!;
      expect(portrait.y + portrait.height).toBeLessThan(page.social!.bandTop);
      expect(page.texts.every((line) => line.y < page.height)).toBe(true);
    }
  });
});

describe("OG badge legacy headshot boundary", () => {
  it("embeds structurally valid stored images using their inspected MIME type", async () => {
    const bytes = validPngBytes();
    await expect(loadValidatedHeadshotDataUrl("headshots/user/legacy.jpg", bucketWith(bytes))).resolves.toBe(
      `data:image/png;base64,${btoa(String.fromCharCode(...bytes))}`,
    );
  });

  it("does not embed a stored image with truncated or oversized dimensions", async () => {
    await expect(
      loadValidatedHeadshotDataUrl("headshots/user/legacy.png", bucketWith(validPngBytes().slice(0, 24))),
    ).resolves.toBeNull();

    const oversized = validPngBytes();
    new DataView(oversized.buffer).setUint32(16, 4097);
    await expect(loadValidatedHeadshotDataUrl("headshots/user/legacy.png", bucketWith(oversized))).resolves.toBeNull();

    await expect(
      loadValidatedHeadshotDataUrl(
        "headshots/user/legacy.png",
        bucketWith(validPngBytes(), STANDARD_HEADSHOT_MAX_BYTES + 1),
      ),
    ).resolves.toBeNull();
  });
});
