import { env as workerEnv } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createReferralCode } from "../functions/_lib/services/referrals";
import { onRequestGet as donationBadgeImage } from "../functions/api/v1/og/donation/[session_id]";
import { onRequestGet as donationSharePage } from "../functions/donate/r/[code]";
import { onRequestGet as eventBadgeImage } from "../functions/api/v1/og/[code]";
import { onRequestGet as eventSharePage } from "../functions/r/[code]";
import { createContext, seedEventAndAdmin } from "./helpers/context";
import { resetDb } from "./helpers/reset-db";
import type { Env } from "../functions/_lib/types";

vi.mock("../functions/_lib/services/og-badge-prerender", () => ({
  generateBadgePng: vi.fn(),
  generateDonationBadgePng: vi.fn(),
}));

import * as ogBadgePrerender from "../functions/_lib/services/og-badge-prerender";

const mockedGenerateBadgePng = vi.mocked(ogBadgePrerender.generateBadgePng);
const mockedGenerateDonationBadgePng = vi.mocked(ogBadgePrerender.generateDonationBadgePng);

const baseEnv = {
  ...workerEnv,
  INTERNAL_SIGNING_SECRET: "test-signing-secret",
} as Env;

function metaContent(html: string, property: string): string | null {
  const match = html.match(new RegExp(`<meta property="${property}"\\s+content="([^"]+)">`));
  return match?.[1] ?? null;
}

function metaNameContent(html: string, name: string): string | null {
  const match = html.match(new RegExp(`<meta name="${name}"\\s+content="([^"]+)">`));
  return match?.[1] ?? null;
}

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

function cachedImage(contentType: string): {
  httpMetadata: { contentType: string };
  arrayBuffer: () => Promise<ArrayBuffer>;
} {
  return {
    httpMetadata: { contentType },
    arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([0x52, 0x49, 0x46, 0x46]).buffer),
  };
}

async function seedEventReferral(): Promise<string> {
  const { eventId } = await seedEventAndAdmin(baseEnv.DB);
  const userId = crypto.randomUUID();
  const registrationId = crypto.randomUUID();

  await baseEnv.DB.batch([
    baseEnv.DB.prepare(`
      INSERT INTO users (id, email, normalized_email, first_name, last_name, created_at, updated_at)
      VALUES ('${userId}', 'attendee@example.test', 'attendee@example.test', 'Ada', 'Lovelace', datetime('now'), datetime('now'))
    `),
    baseEnv.DB.prepare(`
      INSERT INTO registrations (
        id, event_id, user_id, invite_id, status, attendance_type, source_type, source_ref,
        custom_answers_json, referred_by_code, confirmation_token_hash,
        confirmation_token_expires_at, manage_token_hash, confirmed_at, cancelled_at,
        created_at, updated_at
      ) VALUES (
        '${registrationId}', '${eventId}', '${userId}', NULL, 'registered', 'in_person', 'direct', NULL,
        NULL, NULL, NULL, NULL, 'manage-token', NULL, NULL, datetime('now'), datetime('now')
      )
    `),
  ]);

  return createReferralCode(baseEnv.DB, {
    eventId,
    ownerType: "registration",
    ownerId: registrationId,
    length: 7,
  });
}

async function seedCompletedDonation(sessionId: string, name = "Ada Lovelace", grossAmount = 10000): Promise<void> {
  await baseEnv.DB.prepare(
    `
    INSERT INTO donations (
      id, checkout_session_id, status, name, email, currency, gross_amount, completed_at, created_at
    ) VALUES (?, ?, 'completed', ?, 'ada@example.test', 'usd', ?, datetime('now'), datetime('now'))
  `,
  )
    .bind(crypto.randomUUID(), sessionId, name, grossAmount)
    .run();
}

describe("OG share links", () => {
  beforeEach(async () => {
    await resetDb();
    vi.resetAllMocks();
  });

  it("declares event share badges as JPEG when the image pipeline is available", async () => {
    const code = await seedEventReferral();
    const envWithImages = { ...baseEnv, IMAGES: {} as Env["IMAGES"] } as Env;

    const response = await eventSharePage(
      createContext(
        envWithImages,
        new Request(`https://app.test/r/${code}`, {
          headers: { "user-agent": "LinkedInBot/1.0" },
        }),
        { code },
      ),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(metaContent(html, "og:image:type")).toBe("image/jpeg");
    expect(metaContent(html, "og:image:width")).toBe("1200");
    expect(metaContent(html, "og:image:height")).toBe("630");
    expect(metaContent(html, "og:image:alt")).toContain("Ada Lovelace");
    expect(metaNameContent(html, "twitter:image:alt")).toContain("Ada Lovelace");
    expect(metaContent(html, "og:description")?.length ?? 0).toBeGreaterThanOrEqual(100);
  });

  it("declares donation share badges as PNG when the image pipeline is unavailable", async () => {
    await baseEnv.DB.prepare(
      `
      INSERT INTO donation_promoters (code, checkout_session_id, name, clicks, created_at)
      VALUES ('don1234', 'cs_test_share', 'Ada', 0, datetime('now'))
    `,
    ).run();

    const envWithoutImages = { ...baseEnv, IMAGES: undefined } as Env;
    const response = await donationSharePage(
      createContext(
        envWithoutImages,
        new Request("https://app.test/donate/r/don1234", {
          headers: { "user-agent": "LinkedInBot/1.0" },
        }),
        { code: "don1234" },
      ),
    );

    expect(response.status).toBe(200);
    const html = await response.text();
    expect(metaContent(html, "og:image:type")).toBe("image/png");
    expect(metaContent(html, "og:image:width")).toBe("1200");
    expect(metaContent(html, "og:image:height")).toBe("630");
    expect(metaContent(html, "og:image:alt")).toContain("Ada");
    expect(metaNameContent(html, "twitter:image:alt")).toContain("Ada");
    expect(metaContent(html, "og:description")?.length ?? 0).toBeGreaterThanOrEqual(100);
  });

  it("downloads event badge fallbacks with a png filename", async () => {
    mockedGenerateBadgePng.mockResolvedValue(pngBytes());
    const code = await seedEventReferral();
    const envWithoutImages = { ...baseEnv, IMAGES: undefined } as Env;

    const response = await eventBadgeImage(
      createContext(
        envWithoutImages,
        new Request(`https://app.test/api/v1/og/${code}?download=1&name=event-badge`, {
          headers: { "user-agent": "LinkedInBot/1.0" },
        }),
        { code },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="event-badge.png"');
  });

  it("downloads donation badge fallbacks with a png filename", async () => {
    await seedCompletedDonation("cs_test_share");
    mockedGenerateDonationBadgePng.mockResolvedValue(pngBytes());
    const envWithoutImages = { ...baseEnv, IMAGES: undefined } as Env;

    const response = await donationBadgeImage(
      createContext(
        envWithoutImages,
        new Request("https://app.test/api/v1/og/donation/cs_test_share?download=1&name=donation-badge", {
          headers: { "user-agent": "LinkedInBot/1.0" },
        }),
        { session_id: "cs_test_share" },
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="donation-badge.png"');
  });

  it("preserves cached webp badge filenames for event and donation cards", async () => {
    const code = await seedEventReferral();
    const cachedObject = cachedImage("image/webp");
    const envWithCachedWebp = {
      ...baseEnv,
      ASSETS_BUCKET: {
        get: vi.fn().mockResolvedValue(cachedObject),
      } as unknown as Env["ASSETS_BUCKET"],
    } as Env;

    const eventResponse = await eventBadgeImage(
      createContext(
        envWithCachedWebp,
        new Request(`https://app.test/api/v1/og/${code}?download=1&name=event-badge.webp`),
        { code },
      ),
    );

    expect(eventResponse.status).toBe(200);
    expect(eventResponse.headers.get("content-type")).toBe("image/webp");
    expect(eventResponse.headers.get("content-disposition")).toBe('attachment; filename="event-badge.webp"');

    const donationResponse = await donationBadgeImage(
      createContext(
        envWithCachedWebp,
        new Request("https://app.test/api/v1/og/donation/cs_test_share?download=1&name=donation-badge.webp"),
        { session_id: "cs_test_share" },
      ),
    );

    expect(donationResponse.status).toBe(200);
    expect(donationResponse.headers.get("content-type")).toBe("image/webp");
    expect(donationResponse.headers.get("content-disposition")).toBe('attachment; filename="donation-badge.webp"');
  });
});
