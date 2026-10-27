import { personalPromotionSharePath } from "../../../assets/shared/personal-promotion-image";
import { personalPromotionImageCacheKey } from "../../../assets/shared/personal-promotion-image";
/**
 * OG badge pre-rendering service.
 *
 * Owns the resvg-wasm and font singletons (initialized once per worker
 * isolate) and exposes:
 *
 *   renderBadgeSourcePng  — render loaded personal promotion facts to PNG bytes
 *   renderAndCacheBadge   — load, render, and write to R2 (throws on error)
 *   prerenderAndCache     — background-safe wrapper around renderAndCacheBadge
 *   invalidateAndRerender — overwrite R2 for every badge owned by a user
 *   trySeedGravatarThenPrerender — try Gravatar on first-time users, then prerender
 *
 * Background helpers are safe to call via context.waitUntil(). Durable job
 * processors use renderAndCacheBadge so failures remain observable/retryable.
 */

import { ensureResvgWasm } from "../utils/resvg";
import { renderDonationBadgeSvg } from "./og-badge";
import { first, all } from "../db/queries";
import { fetchGravatar } from "./gravatar";
import type { Env } from "../types";
import { fetchHeroImage, fetchStaticAsset, uint8ToBase64 } from "./og-badge-hero-image";
import { validateRasterImage } from "../utils/image-format";
import { STANDARD_HEADSHOT_MAX_BYTES } from "../../../assets/shared/schemas/images";
import { socialBadgeRoleSchema } from "../../../assets/shared/schemas/participant-roles";
import { eventPlaceSummary } from "../../../assets/shared/event-place";
import { readBadgeSource, personalBadgeCacheMetadata, type BadgeSource } from "./og-badge-source";
import { renderPersonalPromotionSvg } from "./event-agenda/promotion-personal";
import { promotionFontMeasure } from "./event-agenda/promotion-text";
import { eventPromotionDesignFromSettings } from "../../../assets/shared/schemas/event-promotion-design";
import { parseJsonSafe } from "../utils/json";

type BadgeRenderEnv = Pick<
  Env,
  "SPEAKER_UPLOADS_BUCKET" | "ASSETS" | "ASSETS_PUBLIC" | "ASSETS_BUCKET" | "IMAGES" | "HERO_IMAGE_ALLOWED_HOSTS"
>;
type BadgeCacheEnv = Pick<
  Env,
  "DB" | "ASSETS_BUCKET" | "IMAGES" | "SPEAKER_UPLOADS_BUCKET" | "ASSETS" | "ASSETS_PUBLIC" | "HERO_IMAGE_ALLOWED_HOSTS"
>;
type DonationRenderEnv = Pick<Env, "DB" | "ASSETS" | "ASSETS_PUBLIC">;

// ─── WASM + font singletons (shared for the lifetime of the worker isolate) ──

function ensureWasm(): Promise<(typeof import("@resvg/resvg-wasm"))["Resvg"]> {
  return ensureResvgWasm();
}

let fontBuffersCache: Promise<Uint8Array[]> | null = null;

function getFontBuffers(origin: string, env: Pick<Env, "ASSETS" | "ASSETS_PUBLIC">): Promise<Uint8Array[]> {
  if (!fontBuffersCache) {
    const p = Promise.all(
      [
        "PromotionRoboto-Regular.ttf",
        "PromotionRoboto-Bold.ttf",
        "PromotionRobotoMono-Medium.ttf",
        "PromotionRobotoMono-SemiBold.ttf",
        "PromotionRoboto-Medium.ttf",
      ].map((name) =>
        fetchStaticAsset(env, origin, `/fonts/${name}`)
          .then((response) => (response.ok ? response.arrayBuffer() : new ArrayBuffer(0)))
          .catch(() => new ArrayBuffer(0))
          .then((buffer) => new Uint8Array(buffer)),
      ),
    );
    fontBuffersCache = p.then((fonts) => {
      if (fonts.every((f) => f.length === 0)) fontBuffersCache = null;
      return fonts;
    });
  }
  return fontBuffersCache;
}

export async function loadValidatedHeadshotDataUrl(
  r2Key: string | null,
  bucket: Env["SPEAKER_UPLOADS_BUCKET"],
): Promise<string | null> {
  if (!r2Key || !bucket) return null;
  try {
    const obj = await bucket.get(r2Key);
    if (!obj) return null;
    if (obj.size > STANDARD_HEADSHOT_MAX_BYTES) return null;
    const buf = await obj.arrayBuffer();
    if (buf.byteLength > STANDARD_HEADSHOT_MAX_BYTES) return null;
    const validation = validateRasterImage(buf);
    if (!validation.ok) return null;
    return `data:${validation.image.contentType};base64,${uint8ToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  }
}

// ─── Core generation ─────────────────────────────────────────────────────────

interface CodeRow {
  code: string;
}

/** Rendering a loaded snapshot performs no further D1 work. */
export async function renderBadgeSourcePng(
  code: string,
  source: BadgeSource,
  env: BadgeRenderEnv,
  origin: string,
  format: import("../../../assets/shared/personal-promotion-image").PersonalPromotionImageFormat = "landscape",
): Promise<Uint8Array> {
  const [Resvg, fontBuffers, headshotDataUrl, logoResponse, heroImage] = await Promise.all([
    ensureWasm(),
    getFontBuffers(origin, env),
    loadValidatedHeadshotDataUrl(source.headshot_r2_key, env.SPEAKER_UPLOADS_BUCKET),
    fetchStaticAsset(env, origin, "/img/logo.svg"),
    fetchHeroImage(source.settings_json, origin, env),
  ]);
  const logoBytes = logoResponse.ok ? new Uint8Array(await logoResponse.arrayBuffer()) : null;
  const settings = parseJsonSafe<Record<string, unknown>>(source.settings_json, {});
  const svg = renderPersonalPromotionSvg({
    firstName: source.first_name ?? "",
    lastName: source.last_name ?? "",
    role: socialBadgeRoleSchema.parse(source.role),
    eventName: source.event_name,
    startsAt: source.starts_at,
    endsAt: source.ends_at,
    timeZone: source.timezone,
    location: eventPlaceSummary({ ...source, venue: typeof settings.venue === "string" ? settings.venue : null }),
    city: source.city,
    organization: source.organization_name,
    jobTitle: source.job_title,
    headshotDataUrl,
    heroImage,
    sessions: source.sessions,
    format,
    registrationUrl: new URL(personalPromotionSharePath(code), origin).href,
    design: eventPromotionDesignFromSettings(source.event_name, settings),
    measure: promotionFontMeasure(fontBuffers, {
      mono: fontBuffers[2],
      monoBold: fontBuffers[3],
      medium: fontBuffers[4],
    }),
    logoDataUrl: logoBytes ? `data:image/svg+xml;base64,${uint8ToBase64(logoBytes)}` : undefined,
  });

  const resvg = new Resvg(svg, { font: { fontBuffers, defaultFontFamily: "Roboto" } });
  try {
    return resvg.render().asPng();
  } finally {
    resvg.free();
  }
}

// ─── Cache management ─────────────────────────────────────────────────────────

/**
 * Convert a PNG buffer to JPEG (via the Images binding when available) and
 * store the result in R2. Falls back to storing raw PNG in local dev where the
 * IMAGES binding is absent — content-type is set correctly in both cases so the
 * outbox can read it back without assuming JPEG.
 *
 * Returns the stored content-type so callers can log or branch if needed.
 * Throws on R2 write failure (callers should catch as appropriate).
 */
async function pngToR2(
  png: Uint8Array,
  r2Key: string,
  customMetadata: Record<string, string>,
  env: Pick<Env, "ASSETS_BUCKET" | "IMAGES">,
): Promise<void> {
  if (!env.ASSETS_BUCKET) throw new Error("ASSETS_BUCKET is required to cache an OG badge");

  if (env.IMAGES) {
    const pngStream = new ReadableStream<Uint8Array>({
      start(ctrl) {
        ctrl.enqueue(png);
        ctrl.close();
      },
    });
    const result = await env.IMAGES.input(pngStream).transform({}).output({ format: "image/jpeg", quality: 95 });
    const jpegBuf = await (await result.response()).arrayBuffer();
    await env.ASSETS_BUCKET.put(r2Key, jpegBuf, {
      httpMetadata: { contentType: "image/jpeg" },
      customMetadata,
    });
  } else {
    // Fallback for local dev: store raw PNG.
    await env.ASSETS_BUCKET.put(r2Key, png.buffer as ArrayBuffer, {
      httpMetadata: { contentType: "image/png" },
      customMetadata,
    });
  }
}

/**
 * Render and atomically overwrite one cached badge. The previous R2 object is
 * left in place until the replacement bytes have been generated successfully.
 */
export async function renderAndCacheBadge(code: string, env: BadgeCacheEnv, origin: string): Promise<void> {
  const source = await readBadgeSource(env.DB, code);
  if (!source) throw new Error(`Badge source not found for referral code ${code}`);
  const metadata = personalBadgeCacheMetadata(code, source);
  const png = await renderBadgeSourcePng(code, source, env, origin);
  await pngToR2(png, personalPromotionImageCacheKey(code), metadata, env);
}

/**
 * Generate the badge PNG, convert it to JPEG via the Cloudflare Images binding,
 * and store the JPEG at og-badges/{code}. Silently swallows errors so it is
 * always safe to call via context.waitUntil().
 *
 * Stored key: og-badges/{code} — 1200×630 JPEG served to social crawlers and
 *             attached to confirmation emails.
 */
export async function prerenderAndCache(code: string, env: BadgeCacheEnv, origin: string): Promise<void> {
  try {
    await renderAndCacheBadge(code, env, origin);
  } catch {
    /* silent — badge pre-render must never break the primary flow */
  }
}

/**
 * Re-render and overwrite every OG badge cached in R2 for the given user.
 * Used after a headshot upload or Gravatar import — overwrites so the next
 * social scrape gets the updated image without needing a cache eviction.
 *
 * Silently swallows errors.
 */
export async function invalidateAndRerender(userId: string, env: BadgeCacheEnv, origin: string): Promise<void> {
  try {
    const rows = await all<CodeRow>(env.DB, "SELECT code FROM referral_codes WHERE created_by_user_id = ?", [userId]);
    await Promise.all(rows.map((r) => prerenderAndCache(r.code, env, origin)));
  } catch {
    /* silent */
  }
}

/**
 * For a newly created user: try to fetch their Gravatar (if no headshot yet),
 * then pre-render and cache their OG badge.
 *
 * Safe to call via context.waitUntil() — never throws.
 */
export async function trySeedGravatarThenPrerender(
  userId: string,
  email: string,
  referralCode: string,
  env: BadgeCacheEnv,
  origin: string,
): Promise<void> {
  try {
    await fetchGravatar(userId, email, env); // skips if headshot already exists
    await prerenderAndCache(referralCode, env, origin);
  } catch {
    /* silent */
  }
}

// ─── Donation badge generation ────────────────────────────────────────────────

interface DonationRow {
  name: string | null;
  gross_amount: number;
  currency: string;
}

/**
 * Fetch a completed donation by Stripe session ID, render a donation badge
 * SVG, and rasterise to PNG.
 *
 * Returns `null` when the session ID is not found or the donation is not yet
 * completed (webhook has not fired).
 */
export async function generateDonationBadgePng(
  sessionId: string,
  env: DonationRenderEnv,
  origin: string,
): Promise<Uint8Array | null> {
  const [Resvg, fontBuffers, donationRow] = await Promise.all([
    ensureWasm(),
    getFontBuffers(origin, env),
    first<DonationRow>(
      env.DB,
      `SELECT name, gross_amount, currency
       FROM   donations
       WHERE  checkout_session_id = ?
         AND  completed_at IS NOT NULL`,
      [sessionId],
    ),
  ]);

  if (!donationRow) return null;

  // Format the amount using the same logic as the thank-you page TS.
  // We do it server-side here — Intl is available in Workers.
  const currency = donationRow.currency.toUpperCase();
  // Zero-decimal currencies (JPY, KRW, …) store amounts in major units already.
  const zeroDecimal = [
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
  ].includes(currency);
  const majorAmount = zeroDecimal ? donationRow.gross_amount : donationRow.gross_amount / 100;
  let formattedAmount: string;
  try {
    formattedAmount = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: zeroDecimal ? 0 : 2,
    }).format(majorAmount);
  } catch {
    formattedAmount = `${currency} ${majorAmount}`;
  }

  const fullName = (donationRow.name ?? "").trim();
  const [firstName, ...rest] = fullName.split(" ");

  const svg = renderDonationBadgeSvg({
    firstName: firstName || "A supporter",
    lastName: rest.length > 0 ? rest.join(" ") : null,
    formattedAmount,
  });

  const resvg = new Resvg(svg, {
    font: { fontBuffers, defaultFontFamily: "Roboto" },
  });
  return resvg.render().asPng();
}

/**
 * Generates the donation badge for `sessionId`, converts it to JPEG, and
 * stores it in R2 at `og-badges/donation-{sessionId}`. No-ops gracefully when
 * the IMAGES or ASSETS_BUCKET bindings are absent (e.g. local dev without R2).
 *
 * Call this before queueing the thank-you email so the badge is already in R2
 * when `processOutboxById` looks it up. Queue a badge attachment descriptor
 * pointing at `og-badges/donation-${sessionId}` so the outbox can attach it.
 */
export async function prerenderDonationBadge(
  sessionId: string,
  env: Pick<Env, "DB" | "ASSETS_BUCKET" | "IMAGES">,
  origin: string,
): Promise<void> {
  if (!env.ASSETS_BUCKET) return;
  const png = await generateDonationBadgePng(sessionId, env, origin);
  if (!png) return;
  try {
    await pngToR2(png, `og-badges/donation-${sessionId}`, { sessionId }, env);
  } catch {
    // Non-fatal — email will be sent without the attachment
  }
}
