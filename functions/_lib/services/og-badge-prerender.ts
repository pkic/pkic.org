/**
 * OG badge pre-rendering service.
 *
 * Owns the resvg-wasm and font singletons (initialised once per worker
 * isolate) and exposes:
 *
 *   generateBadgePng      — fetch data + render SVG → PNG bytes
 *   prerenderAndCache     — generateBadgePng + write to R2 (silent on error)
 *   invalidateAndRerender — overwrite R2 for every badge owned by a user
 *   trySeedGravatarThenPrerender — try Gravatar on first-time users, then prerender
 *
 * All exported functions are safe to call via context.waitUntil() — they
 * swallow errors so a badge failure never breaks the primary request flow.
 */

import { renderBadgeSvg, renderDonationBadgeSvg, type BadgeRole } from "./og-badge";
import { first, all } from "../db/queries";
import { fetchGravatar } from "../utils/gravatar";
import type { Env } from "../types";

// ─── WASM + font singletons (shared for the lifetime of the worker isolate) ──

let wasmReady: Promise<typeof import("@resvg/resvg-wasm")["Resvg"]> | null = null;

function ensureWasm(): Promise<typeof import("@resvg/resvg-wasm")["Resvg"]> {
  if (!wasmReady) {
    wasmReady = (async () => {
      const [{ initWasm, Resvg }, wasmModule] = await Promise.all([
        import("@resvg/resvg-wasm"),
        import("@resvg/resvg-wasm/index_bg.wasm"),
      ]);
      await initWasm(wasmModule.default);
      return Resvg;
    })();
  }
  return wasmReady;
}

let fontBuffersCache: Promise<Uint8Array[]> | null = null;

function getFontBuffers(origin: string): Promise<Uint8Array[]> {
  if (!fontBuffersCache) {
    const p = Promise.all([
      fetch(`${origin}/fonts/Roboto-Regular.ttf`)
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .catch(() => new ArrayBuffer(0))
        .then((b) => new Uint8Array(b)),
      fetch(`${origin}/fonts/Roboto-Bold.ttf`)
        .then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)))
        .catch(() => new ArrayBuffer(0))
        .then((b) => new Uint8Array(b)),
    ]);
    fontBuffersCache = p.then((fonts) => {
      if (fonts.every((f) => f.length === 0)) fontBuffersCache = null;
      return fonts;
    });
  }
  return fontBuffersCache;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Fast Uint8Array → base64 without quadratic string re-allocation.
 * Chunks stay under V8's spread-argument stack limit (~32k args).
 */
export function uint8ToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function extractLocation(settingsJson: string): string | null {
  try {
    const s = JSON.parse(settingsJson) as Record<string, unknown>;
    if (typeof s.location === "string" && s.location) return s.location;
    if (typeof s.city    === "string" && s.city)     return s.city;
  } catch { /* ignore */ }
  return null;
}

function extractHeroImageUrl(settingsJson: string): string | null {
  try {
    const s = JSON.parse(settingsJson) as Record<string, unknown>;
    if (typeof s.heroImageUrl === "string" && s.heroImageUrl) return s.heroImageUrl;
  } catch { /* ignore */ }
  return null;
}

async function fetchHeroImage(settingsJson: string, origin: string): Promise<string | null> {
  const raw = extractHeroImageUrl(settingsJson);
  if (!raw) return null;
  const url = raw.startsWith("/") ? `${origin}${raw}` : raw;
  try {
    // Resize to badge dimensions and convert to JPEG before embedding.
    // The hero is used as a dark-overlaid full-bleed background so quality 60
    // is indistinguishable from the original at this display size.
    // The `cf.image` option is a Cloudflare Worker-specific extension to fetch();
    // it is silently ignored in non-CF environments (local dev) so no cast needed
    // at runtime, but TypeScript doesn't know about it — hence the assertion.
    const res = await fetch(url, {
      cf: { image: { width: 1200, height: 630, fit: "cover", format: "jpeg", quality: 60 } },
    } as unknown as RequestInit);
    if (!res.ok) return null;
    const buf  = await res.arrayBuffer();
    const ct   = res.headers.get("content-type") ?? "image/jpeg";
    const mime = ct.split(";")[0].trim();
    return `data:${mime};base64,${uint8ToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  }
}

async function fetchHeadshot(
  r2Key: string | null,
  bucket: Env["SPEAKER_UPLOADS_BUCKET"],
): Promise<string | null> {
  if (!r2Key || !bucket) return null;
  try {
    const obj = await bucket.get(r2Key);
    if (!obj) return null;
    const buf  = await obj.arrayBuffer();
    const ext  = r2Key.split(".").pop()?.toLowerCase() ?? "";
    const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
    return `data:${mime};base64,${uint8ToBase64(new Uint8Array(buf))}`;
  } catch {
    return null;
  }
}

// ─── DB row types ─────────────────────────────────────────────────────────────

interface ReferralCodeRow {
  event_id: string;
  owner_type: "registration" | "proposal";
  owner_id: string;
  created_by_user_id: string | null;
}

interface AttendeeRow {
  first_name: string | null;
  last_name: string | null;
  organization_name: string | null;
  job_title: string | null;
  headshot_r2_key: string | null;
  event_name: string;
  starts_at: string | null;
  ends_at: string | null;
  settings_json: string;
  /** Effective badge role: highest-priority active non-attendee participant role, or null (= attendee) */
  effective_role: string | null;
}

interface SpeakerRow extends AttendeeRow {
  speaker_role: string;
}

interface CodeRow {
  code: string;
}

// ─── Core generation ─────────────────────────────────────────────────────────

const R2_KEY_PREFIX = "og-badges/";

/**
 * Fetch all data for a referral code, render the badge SVG, and rasterise to
 * PNG. Returns `null` when the code is not found in the database.
 *
 */
export async function generateBadgePng(
  code: string,
  env: Pick<Env, "DB" | "SPEAKER_UPLOADS_BUCKET">,
  origin: string,
): Promise<Uint8Array | null> {
  // Kick off wasm init + fonts + referral lookup together.
  const [, fontBuffers, ref] = await Promise.all([
    ensureWasm(),
    getFontBuffers(origin),
    first<ReferralCodeRow>(
      env.DB,
      "SELECT event_id, owner_type, owner_id, created_by_user_id FROM referral_codes WHERE code = ?",
      [code],
    ),
  ]);

  if (!ref) return null;

  let svg: string;

  if (ref.owner_type === "registration") {
    const row = await first<AttendeeRow>(
      env.DB,
      `SELECT u.first_name, u.last_name, u.organization_name, u.job_title,
              u.headshot_r2_key,
              e.name   AS event_name,
              e.starts_at, e.ends_at, e.settings_json,
              (
                SELECT ep2.role
                FROM   event_participants ep2
                WHERE  ep2.event_id = r.event_id
                  AND  ep2.user_id  = r.user_id
                  AND  ep2.role    != 'attendee'
                  AND  ep2.status   = 'active'
                ORDER BY CASE ep2.role
                  WHEN 'speaker'   THEN 1
                  WHEN 'moderator' THEN 2
                  WHEN 'panelist'  THEN 3
                  WHEN 'organizer' THEN 4
                  ELSE 5
                END
                LIMIT 1
              ) AS effective_role
       FROM   registrations r
       JOIN   users  u ON u.id = r.user_id
       JOIN   events e ON e.id = r.event_id
       WHERE  r.id = ?`,
      [ref.owner_id],
    );
    if (!row) return null;

    const [headshotDataUrl, heroImageDataUrl] = await Promise.all([
      fetchHeadshot(row.headshot_r2_key, env.SPEAKER_UPLOADS_BUCKET),
      fetchHeroImage(row.settings_json, origin),
    ]);

    svg = renderBadgeSvg({
      firstName:       row.first_name ?? "",
      lastName:        row.last_name  ?? "",
      role:            (row.effective_role as BadgeRole) ?? "attendee",
      eventName:       row.event_name,
      startsAt:        row.starts_at,
      endsAt:          row.ends_at,
      location:        extractLocation(row.settings_json),
      organization:    row.organization_name,
      jobTitle:        row.job_title,
      headshotDataUrl,
      heroImageDataUrl,
    });
  } else {
    const userId = ref.created_by_user_id;
    if (!userId) return null;

    const row = await first<SpeakerRow>(
      env.DB,
      `SELECT u.first_name, u.last_name, u.organization_name, u.job_title,
              u.headshot_r2_key,
              e.name    AS event_name,
              e.starts_at, e.ends_at, e.settings_json,
              COALESCE(ps.role, 'speaker') AS speaker_role
       FROM   session_proposals sp
       JOIN   users  u  ON u.id  = ?
       JOIN   events e  ON e.id  = sp.event_id
       LEFT   JOIN proposal_speakers ps
              ON  ps.proposal_id = sp.id
              AND ps.user_id     = u.id
       WHERE  sp.id = ?`,
      [userId, ref.owner_id],
    );
    if (!row) return null;

    const [headshotDataUrl, heroImageDataUrl] = await Promise.all([
      fetchHeadshot(row.headshot_r2_key, env.SPEAKER_UPLOADS_BUCKET),
      fetchHeroImage(row.settings_json, origin),
    ]);

    svg = renderBadgeSvg({
      firstName:       row.first_name ?? "",
      lastName:        row.last_name  ?? "",
      role:            (row.speaker_role as BadgeRole) ?? "speaker",
      eventName:       row.event_name,
      startsAt:        row.starts_at,
      endsAt:          row.ends_at,
      location:        extractLocation(row.settings_json),
      organization:    row.organization_name,
      jobTitle:        row.job_title,
      headshotDataUrl,
      heroImageDataUrl,
    });
  }

  const Resvg = await ensureWasm();
  const resvgOpts = {
    font: { fontBuffers, defaultFontFamily: "Roboto" },
  };
  const resvg = new Resvg(svg, resvgOpts);
  return resvg.render().asPng();
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
  if (!env.ASSETS_BUCKET) return;

  if (env.IMAGES) {
    const pngStream = new ReadableStream<Uint8Array>({
      start(ctrl) { ctrl.enqueue(png); ctrl.close(); },
    });
    const result  = await env.IMAGES.input(pngStream).transform({}).output({ format: "image/jpeg", quality: 85 });
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
 * Generate the badge PNG, convert it to JPEG via the Cloudflare Images binding,
 * and store the JPEG at og-badges/{code}. Silently swallows errors so it is
 * always safe to call via context.waitUntil().
 *
 * Stored key: og-badges/{code} — 1200×630 JPEG served to social crawlers and
 *             attached to confirmation emails.
 */
export async function prerenderAndCache(
  code: string,
  env: Pick<Env, "DB" | "ASSETS_BUCKET" | "IMAGES" | "SPEAKER_UPLOADS_BUCKET">,
  origin: string,
): Promise<void> {
  try {
    const png = await generateBadgePng(code, env, origin);
    if (!png || !env.ASSETS_BUCKET) return;
    await pngToR2(png, `${R2_KEY_PREFIX}${code}`, { referralCode: code }, env);
  } catch { /* silent — badge pre-render must never break the primary flow */ }
}

/**
 * Re-render and overwrite every OG badge cached in R2 for the given user.
 * Used after a headshot upload or Gravatar import — overwrites so the next
 * social scrape gets the updated image without needing a cache eviction.
 *
 * Silently swallows errors.
 */
export async function invalidateAndRerender(
  userId: string,
  env: Pick<Env, "DB" | "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">,
  origin: string,
): Promise<void> {
  try {
    const rows = await all<CodeRow>(
      env.DB,
      "SELECT code FROM referral_codes WHERE created_by_user_id = ?",
      [userId],
    );
    await Promise.all(rows.map((r) => prerenderAndCache(r.code, env, origin)));
  } catch { /* silent */ }
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
  env: Pick<Env, "DB" | "ASSETS_BUCKET" | "SPEAKER_UPLOADS_BUCKET">,
  origin: string,
): Promise<void> {
  try {
    await fetchGravatar(userId, email, env); // skips if headshot already exists
    await prerenderAndCache(referralCode, env, origin);
  } catch { /* silent */ }
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
  env: Pick<Env, "DB">,
  origin: string,
): Promise<Uint8Array | null> {
  const [Resvg, fontBuffers, donationRow] = await Promise.all([
    ensureWasm(),
    getFontBuffers(origin),
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
  const currency   = donationRow.currency.toUpperCase();
  // Zero-decimal currencies (JPY, KRW, …) store amounts in major units already.
  const zeroDecimal = ["BIF","CLP","DJF","GNF","JPY","KMF","KRW","MGA","PYG","RWF","UGX","VND","VUV","XAF","XOF","XPF"].includes(currency);
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

  const fullName    = (donationRow.name ?? "").trim();
  const [firstName, ...rest] = fullName.split(" ");

  const svg = renderDonationBadgeSvg({
    firstName:      firstName || "A supporter",
    lastName:       rest.length > 0 ? rest.join(" ") : null,
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
 * when `processOutboxById` looks it up. Pass `__badgeCode: `donation-${sessionId}``
 * in the email data so the outbox attaches it automatically.
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
