/**
 * Compute the Gravatar avatar hash for an email address.
 *
 * Gravatar migrated from MD5 to SHA-256 in 2024. The Web Crypto API supports
 * SHA-256 natively so no custom implementation is needed.
 *
 * Usage: `const hash = await gravatarHash(email);`
 * URL:   `https://gravatar.com/avatar/${hash}`
 */
export async function gravatarHash(email: string): Promise<string> {
  const input = email.trim().toLowerCase();
  const buf   = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

import { first, run } from "../db/queries";
import { nowIso } from "./time";
import type { Env } from "../types";

const GRAVATAR_SIZE = 512;

/**
 * Fetch a Gravatar for the given email and store it as the user's headshot.
 *
 * By default (force=false) skips silently if the user already has a headshot,
 * making it safe to call speculatively at registration time.
 * Pass { force: true } to always replace (admin import flow).
 *
 * Returns the new R2 key on success, null if no Gravatar exists or on error.
 */
export async function fetchGravatar(
  userId: string,
  email: string,
  env: Pick<Env, "DB" | "SPEAKER_UPLOADS_BUCKET">,
  options?: { force?: boolean },
): Promise<string | null> {
  if (!env.SPEAKER_UPLOADS_BUCKET) return null;

  if (!options?.force) {
    const row = await first<{ headshot_r2_key: string | null }>(
      env.DB,
      "SELECT headshot_r2_key FROM users WHERE id = ?",
      [userId],
    );
    if (row?.headshot_r2_key) return null; // already has one, skip
  }

  const emailHash = await gravatarHash(email);
  const url = `https://gravatar.com/avatar/${emailHash}?s=${GRAVATAR_SIZE}&d=404`;

  try {
    const res = await fetch(url);
    if (!res.ok) return null; // 404 = no Gravatar for this email

    const buf  = await res.arrayBuffer();
    const ct   = res.headers.get("content-type") ?? "image/jpeg";
    const mime = ct.split(";")[0].trim();
    const ext  = mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
    const r2Key = `headshots/${userId}/${Date.now()}-gravatar.${ext}`;

    await env.SPEAKER_UPLOADS_BUCKET.put(r2Key, buf, {
      httpMetadata: { contentType: mime },
    });

    const now = nowIso();
    await run(
      env.DB,
      "UPDATE users SET headshot_r2_key = ?, headshot_updated_at = ?, updated_at = ? WHERE id = ?",
      [r2Key, now, now, userId],
    );

    return r2Key;
  } catch {
    return null;
  }
}

