/**
 * GET /api/v1/geo
 *
 * Returns the ISO 3166-1 alpha-2 country code as detected by Cloudflare from
 * the visitor's IP address. This uses the `cf.country` property that
 * Cloudflare sets on every incoming request — no external API is called, no
 * user location permission is requested, and no personally identifiable
 * information is stored or logged.
 *
 * The response is intentionally minimal so the frontend can offer a soft
 * "did you mean…?" pre-selection without forcing a choice. The field always
 * remains free-form so users can override it.
 *
 * Possible `country` values:
 *   - ISO 3166-1 alpha-2 code (e.g. "NL") when Cloudflare resolves the IP.
 *   - "T1" when the request comes through Tor.
 *   - null when the code is unavailable (e.g. local / localhost / private IP).
 */

import { json } from "../../_lib/http";
import type { PagesContext } from "../../_lib/types";

/**
 * Allowed origins. Must exactly match the site origin (scheme + host + optional
 * port). Add staging/preview origins as needed. An empty string in the set
 * means same-origin requests that don't send an Origin header (e.g. direct
 * navigation or same-origin fetch from some older browsers) are allowed.
 *
 * Sec-Fetch-Site is checked first (faster, no string parsing). Origin is used
 * as a fallback for browsers that don't send Sec-Fetch-Site.
 */
const ALLOWED_ORIGINS = new Set([
  "https://pkic.org",
  "https://www.pkic.org",
  // Local dev — wrangler pages dev binds to localhost
  "http://localhost:8788",
  "http://localhost:1313",
]);

export async function onRequest(context: PagesContext): Promise<Response> {
  const request = context.request;

  // ── Origin guard ─────────────────────────────────────────────────────────
  // Reject cross-site requests. Modern browsers always send Sec-Fetch-Site on
  // navigations and fetches. For same-origin fetches its value is "same-origin".
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return json({ error: "forbidden" }, 403);
  }

  // For browsers / clients that don't send Sec-Fetch-Site, fall back to Origin.
  const origin = request.headers.get("origin");
  if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "forbidden" }, 403);
  }

  // ── Only allow GET / HEAD ────────────────────────────────────────────────
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    return json({ error: "method not allowed" }, 405);
  }

  // ── Geo lookup ───────────────────────────────────────────────────────────
  // Cloudflare attaches geo data to every request in its infrastructure.
  // At local dev (wrangler pages dev) this is typically undefined / null.
  const cf = (request as Request & { cf?: { country?: string } }).cf;
  const country: string | null = cf?.country ?? null;

  return json(
    { country },
    200,
    {
      // Private: must not be stored by shared caches / CDNs.
      // Short TTL: valid for one minute so a user toggling a VPN gets
      // a fresh result quickly without hammering the endpoint.
      "cache-control": "private, max-age=60, stale-while-revalidate=0",
    },
  );
}
